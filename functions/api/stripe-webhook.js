// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// 1) слушаем checkout.session.completed
// 2) списываем Stock в Products (не ниже 0)
// 3) создаём заказ в Airtable -> таблица Orders
// 4) idempotency через KV (STRIPE_EVENTS_KV) + step-keys, чтобы НЕ списать stock/не создать order дважды
// 5) best-effort lock на recordId

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const ORDERS_TABLE = env.AIRTABLE_ORDERS_TABLE_NAME || "Orders"; // ✅ ваша таблица Orders

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    // ВАЖНО: читаем СЫРОЕ тело
    const rawBody = await request.text();

    // ---------- verify signature ----------
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: String(env.STRIPE_WEBHOOK_SECRET).trim(),
      toleranceSec: 5 * 60,
    });

    if (!ok) {
      console.log("[stripe-webhook] invalid signature", {
        bodyLen: rawBody?.length || 0,
        secretLen: String(env.STRIPE_WEBHOOK_SECRET || "").length,
      });
      return json({ error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log("[stripe-webhook] received", { eventId, eventType });

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ---------- IDP (idempotency) ----------
    const EVT_KEY = `stripe_evt:${eventId}`;
    const STEP_STOCK_KEY = `stripe_evt:${eventId}:stock_done`;
    const STEP_ORDER_KEY = `stripe_evt:${eventId}:order_done`;

    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") {
      console.log("[stripe-webhook] duplicate ignored", { eventId });
      return json({ received: true, duplicate: true });
    }

    if (prev === "processing") {
      // лучше вернуть НЕ 2xx -> Stripe будет ретраить
      console.log("[stripe-webhook] already processing -> retry", { eventId });
      return json({ received: true, processing: true }, 409);
    }

    // mark processing (TTL 30 min)
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- handle only checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    // списываем только если paid
    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      console.log("[stripe-webhook] not paid -> ignore", { eventId, sessionId, paymentStatus });
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    const meta = session?.metadata || {};
    const itemsJson = String(meta.items || "").trim();

    console.log("[stripe-webhook] meta", {
      eventId,
      sessionId,
      hasItems: Boolean(itemsJson),
      itemsLen: itemsJson ? itemsJson.length : 0,
    });

    if (!itemsJson) {
      // оплатили, но items нет -> мы не можем списать stock
      // даём 500 чтобы Stripe ретраил, пока вы не почините checkout
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Missing metadata.items" }, 500);
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      console.error("[stripe-webhook] bad metadata.items JSON", { eventId, sessionId });
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // Stripe retry
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
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
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    // ---------- STEP 1: decrement stock (idempotent step) ----------
    const stockDone = await env.STRIPE_EVENTS_KV.get(STEP_STOCK_KEY);
    if (stockDone !== "done") {
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
            console.log("[stripe-webhook] decrement", { recordId: it.recordId, qty: it.qty });
            await decrementStockByRecordIdSafe({
              token: env.AIRTABLE_TOKEN,
              baseId: env.AIRTABLE_BASE_ID,
              table: env.AIRTABLE_TABLE_NAME,
              recordId: it.recordId,
              qty: it.qty,
            });
          } finally {
            await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token });
          }
        }

        // mark stock step done (30 days)
        await env.STRIPE_EVENTS_KV.put(STEP_STOCK_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
        console.log("[stripe-webhook] stock step done", { eventId, sessionId });
      } catch (e) {
        console.error("[stripe-webhook] stock step failed", { eventId, sessionId, error: String(e?.message || e) });
        await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // allow Stripe retry
        return json({ error: "Stock decrement failed", details: String(e?.message || e) }, 500);
      }
    } else {
      console.log("[stripe-webhook] stock step already done", { eventId, sessionId });
    }

    // ---------- STEP 2: create/update Orders row (idempotent step) ----------
    const orderDone = await env.STRIPE_EVENTS_KV.get(STEP_ORDER_KEY);
    if (orderDone !== "done") {
      try {
        const orderPayload = buildOrderFields({
          session,
          normalizedItems: normalized,
        });

        // создаём запись в Orders (если хотите “upsert”, скажите — сделаем поиск по Stripe Session ID)
        await airtableCreateRecord({
          token: env.AIRTABLE_TOKEN,
          baseId: env.AIRTABLE_BASE_ID,
          table: ORDERS_TABLE,
          fields: orderPayload,
        });

        await env.STRIPE_EVENTS_KV.put(STEP_ORDER_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
        console.log("[stripe-webhook] order step done", { eventId, sessionId });
      } catch (e) {
        console.error("[stripe-webhook] order step failed", { eventId, sessionId, error: String(e?.message || e) });
        await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // allow Stripe retry
        return json({ error: "Order create failed", details: String(e?.message || e) }, 500);
      }
    } else {
      console.log("[stripe-webhook] order step already done", { eventId, sessionId });
    }

    // ---------- FINAL: mark whole event done ----------
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
    console.log("[stripe-webhook] done", { eventId, sessionId });

    return json({ received: true });
  } catch (e) {
    console.error("[stripe-webhook] fatal", String(e?.message || e));
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Orders mapping ----------------

function buildOrderFields({ session, normalizedItems }) {
  const sessionId = String(session?.id || "");
  const paymentIntentId = String(session?.payment_intent || "");
  const createdSec = Number(session?.created || 0);
  const createdIso = createdSec ? new Date(createdSec * 1000).toISOString() : new Date().toISOString();

  const currency = String(session?.currency || "").toUpperCase();
  const amountTotal = Number(session?.amount_total || 0) / 100;

  const customer = session?.customer_details || {};
  const shipping = session?.shipping_details || {};
  const shipAddr = shipping?.address || customer?.address || {};

  const customerName = String(shipping?.name || customer?.name || "").trim();
  const email = String(customer?.email || "").trim();
  const phone = String(customer?.phone || "").trim();

  const country = String(shipAddr?.country || "").trim(); // e.g. "DE"
  const city = String(shipAddr?.city || "").trim();
  const postal = String(shipAddr?.postal_code || "").trim();
  const region = String(shipAddr?.state || "").trim();

  const line1 = String(shipAddr?.line1 || "").trim();
  const line2 = String(shipAddr?.line2 || "").trim();

  const fullShippingAddress = formatShippingAddress({
    name: customerName,
    line1,
    line2,
    city,
    postal,
    region,
    country,
  });

  const productRecordIds = normalizedItems.map((x) => x.recordId);
  const totalQty = normalizedItems.reduce((s, x) => s + (Number(x.qty) || 0), 0);

  // ✅ ВАЖНО: названия полей должны совпадать 1-в-1 с Airtable
  return {
    "Order ID": sessionId || `order-${Date.now()}`,
    "Products": productRecordIds, // Link to Products expects array of record IDs
    "Quantity": totalQty,

    "Currency": currency || null,
    "Order Status": "paid",
    "Refund Status": "not_refunded",

    "Customer Name": customerName || null,
    "Shipping Address": fullShippingAddress || null,

    "Shipping Country": country || null,
    "Shipping City": city || null,
    "Shipping Postal Code": postal || null,
    "Shipping State/Region": region || null,

    "Customer Email": email || null,
    "Telefon": phone || null,

    "Tracking Number": null,
    "Created At": createdIso,
    "Amount Total": Number.isFinite(amountTotal) ? amountTotal : null,

    "Stripe Session ID": sessionId || null,
    "Payment Intent ID": paymentIntentId || null,
  };
}

function formatShippingAddress({ name, line1, line2, city, postal, region, country }) {
  const parts = [];

  if (name) parts.push(name);

  const street = [line1, line2].filter(Boolean).join(", ");
  if (street) parts.push(street);

  const cityLine = [postal, city].filter(Boolean).join(" ");
  const regionLine = [region, country].filter(Boolean).join(", ");

  const last = [cityLine, regionLine].filter(Boolean).join(" • ");
  if (last) parts.push(last);

  return parts.join("\n");
}

// ---------------- Airtable: create record ----------------

async function airtableCreateRecord({ token, baseId, table, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
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

  // 1) get current stock
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const safeCurrent = Number.isFinite(current) ? current : 0;

  const q = Math.floor(Number(qty || 0));
  const safeQty = Number.isFinite(q) ? q : 0;

  const next = Math.max(0, safeCurrent - safeQty);

  // 2) update stock
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

  console.warn("[stripe-webhook] lock not acquired", { key });
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

  // Stripe может прислать несколько v1 — принимаем если совпало с любым
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}