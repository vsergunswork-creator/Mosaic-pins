// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// 1) создаём запись в Airtable Orders (адрес, email, телефон и т.д.)
// 2) списываем Stock в Airtable Products (не ниже 0)
// idempotency через KV (STRIPE_EVENTS_KV)
// best-effort lock на recordId

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500); // Products table
    if (!env.AIRTABLE_ORDERS_TABLE_NAME) return json({ error: "AIRTABLE_ORDERS_TABLE_NAME is not set" }, 500);

    // KV binding
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    // ВАЖНО: сырое тело
    const rawBody = await request.text();

    // ---------- verify signature ----------
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: String(env.STRIPE_WEBHOOK_SECRET).trim(),
      toleranceSec: 5 * 60,
    });

    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ---------- IDP (idempotency) ----------
    const EVT_KEY = `stripe_evt:${eventId}`;

    const prevRaw = await env.STRIPE_EVENTS_KV.get(EVT_KEY);
    const prev = safeParse(prevRaw);

    if (prev?.status === "done") {
      return json({ received: true, duplicate: true });
    }

    // если processing и "свежий" — пусть Stripe ретраит позже
    if (prev?.status === "processing") {
      const ageSec = Math.floor(Date.now() / 1000) - Number(prev.ts || 0);
      if (Number.isFinite(ageSec) && ageSec < 90) {
        return json({ received: true, processing: true }, 500);
      }
      // если слишком старый processing — считаем зависшим и перезапускаем
    }

    await env.STRIPE_EVENTS_KV.put(
      EVT_KEY,
      JSON.stringify({ status: "processing", ts: Math.floor(Date.now() / 1000) }),
      { expirationTtl: 30 * 60 }
    );

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
      return json({ received: true, ignored: true });
    }

    // ✅ ВСЁ БЕРЁМ ИЗ EVENT (без retrieve и expand!)
    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    // metadata.items (recordIds + qty)
    const itemsJson = String(session?.metadata?.items || "").trim();
    if (!itemsJson) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
      return json({ received: true, note: "No metadata.items" });
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
      return json({ received: true, note: "Empty items" });
    }

    // normalize items by recordId
    const map = new Map(); // recordId -> qty
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      map.set(recordId, (map.get(recordId) || 0) + qty);
    }
    const normalized = [...map.entries()].map(([recordId, qty]) => ({ recordId, qty }));
    if (!normalized.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    // ------------- build Order fields -------------
    const currency = String(session?.currency || "").toUpperCase() || "EUR";
    const amountTotal = Number(session?.amount_total || 0) / 100;

    const createdAtISO = session?.created
      ? new Date(Number(session.created) * 1000).toISOString()
      : new Date().toISOString();

    const customerName = session?.customer_details?.name || "";
    const customerEmail = session?.customer_details?.email || "";
    const telefon = session?.customer_details?.phone || "";

    // shipping_details присутствует в event, если включали shipping_address_collection
    const ship = session?.shipping_details || {};
    const addr = ship?.address || {};

    const shippingCountry = addr?.country || "";
    const shippingCity = addr?.city || "";
    const shippingPostalCode = addr?.postal_code || "";
    const shippingStateRegion = addr?.state || "";

    const line1 = addr?.line1 || "";
    const line2 = addr?.line2 || "";

    const shippingAddressLong = [
      ship?.name || "",
      line1,
      line2,
      shippingCity,
      shippingStateRegion,
      shippingPostalCode,
      shippingCountry,
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");

    const orderStatus = "paid";         // single select
    const refundStatus = "not_refunded";// single select

    const paymentIntentId = String(session?.payment_intent || "");
    const orderId = paymentIntentId || sessionId; // Order ID

    // Products (Link to Products): массив recordId
    const productRecordIds = normalized.map((x) => x.recordId);

    // Quantity (Number): суммарное количество
    const quantityTotal = normalized.reduce((s, x) => s + Number(x.qty || 0), 0);

    // ------------- create Orders record FIRST -------------
    // Чтобы даже если stock-часть упадёт — Вы всё равно видели заказ.
    // (И idempotency не даст создать дубль по eventId, а Session ID тоже сохраняем.)
    try {
      await airtableCreateOrder({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        ordersTable: env.AIRTABLE_ORDERS_TABLE_NAME,
        fields: {
          "Order ID": orderId,
          "Products": productRecordIds,
          "Quantity": quantityTotal,
          "Currency": currency,
          "Order Status": orderStatus,
          "Refund Status": refundStatus,
          "Customer Name": customerName,
          "Shipping Address": shippingAddressLong,
          "Shipping Country": shippingCountry,
          "Shipping City": shippingCity,
          "Shipping Postal Code": shippingPostalCode,
          "Shipping State/Region": shippingStateRegion,
          "Customer Email": customerEmail,
          "Telefon": telefon,
          "Tracking Number": "", // пусто — заполните позже
          "Created At": createdAtISO,
          "Amount Total": Number.isFinite(amountTotal) ? amountTotal : 0,
          "Stripe Session ID": sessionId,
          "Payment Intent ID": paymentIntentId,
        },
      });
    } catch (e) {
      // если тут упало — возвращаем 500, чтобы Stripe ретраил
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Orders create failed", details: String(e?.message || e) }, 500);
    }

    // ------------- decrement stock -------------
    try {
      for (const it of normalized) {
        const lockKey = `lock:${it.recordId}`;
        const token = await acquireLock({
          kv: env.STRIPE_EVENTS_KV,
          key: lockKey,
          ttlSec: 120,
          retries: 12,
          waitMs: 180,
        });

        try {
          await decrementStockByRecordIdSafe({
            token: env.AIRTABLE_TOKEN,
            baseId: env.AIRTABLE_BASE_ID,
            table: env.AIRTABLE_TABLE_NAME, // Products
            recordId: it.recordId,
            qty: it.qty,
          });
        } finally {
          await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token });
        }
      }

      await env.STRIPE_EVENTS_KV.put(EVT_KEY, JSON.stringify({ status: "done" }), {
        expirationTtl: 30 * 24 * 60 * 60,
      });

      return json({ received: true });
    } catch (e) {
      // если stock упал — удаляем EVT_KEY чтобы Stripe повторил
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Stock update failed", details: String(e?.message || e) }, 500);
    }
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Airtable: create order ----------------

async function airtableCreateOrder({ token, baseId, ordersTable, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(ordersTable)}`;

  // Airtable: Link to another record ждёт массив record IDs
  // Если products пустой — лучше не отправлять поле, но у нас всегда есть.
  const payload = { fields };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Airtable create failed: ${r.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------- Airtable stock decrement ----------------

async function decrementStockByRecordIdSafe({ token, baseId, table, recordId, qty }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;

  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const safeCurrent = Number.isFinite(current) ? current : 0;

  const q = Math.floor(Number(qty || 0));
  const safeQty = Number.isFinite(q) ? q : 0;

  const next = Math.max(0, safeCurrent - safeQty);

  const r2 = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { Stock: next } }),
  });

  const data = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error(`Airtable update failed: ${r2.status} ${JSON.stringify(data)}`);
}

// ---------------- KV lock (best-effort) ----------------

async function acquireLock({ kv, key, ttlSec = 120, retries = 10, waitMs = 150 }) {
  if (ttlSec < 60) ttlSec = 60;
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  for (let i = 0; i < retries; i++) {
    const existing = await kv.get(key);
    if (!existing) {
      await kv.put(key, token, { expirationTtl: ttlSec });
      const check = await kv.get(key);
      if (check === token) return token;
    }
    await sleep(waitMs + Math.floor(Math.random() * 80));
  }
  return null;
}

async function releaseLock({ kv, key, token }) {
  if (!token) return;
  const existing = await kv.get(key);
  if (existing === token) await kv.delete(key);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- Stripe signature verify ----------------

async function verifyStripeSignature({ payload, header, secret, toleranceSec = 300 }) {
  const parts = String(header).split(",").map((x) => x.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));
  if (!tPart || !v1Parts.length) return false;

  const timestamp = tPart.slice(2);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;

  const signedPayload = `${timestamp}.${payload}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = toHex(mac);

  for (const p of v1Parts) {
    const sig = p.slice(3);
    if (safeEqual(expected, sig)) return true;
  }
  return false;
}

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

function safeParse(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}