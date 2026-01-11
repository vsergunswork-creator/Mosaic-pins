// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// 1) списываем Stock в Airtable (не ниже 0)
// 2) создаём заказ в Airtable (таблица Orders)
// + idempotency через KV (STRIPE_EVENTS_KV)
// + best-effort lock на recordId
// + логирование

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500); // products table

    // ✅ orders table name (новое)
    if (!env.AIRTABLE_ORDERS_TABLE_NAME)
      return json({ error: "AIRTABLE_ORDERS_TABLE_NAME is not set (set to Orders)" }, 500);

    // KV binding (не env var)
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    // ---------- verify signature ----------
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: env.STRIPE_WEBHOOK_SECRET,
      toleranceSec: 5 * 60, // 5 минут
    });
    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log(`[stripe-webhook] received`, { eventId, eventType });

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ---------- IDP (idempotency) ----------
    const EVT_KEY = `stripe_evt:${eventId}`;

    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") {
      console.log(`[stripe-webhook] duplicate ignored`, { eventId });
      return json({ received: true, duplicate: true });
    }

    if (prev === "processing") {
      console.log(`[stripe-webhook] already processing -> ask Stripe to retry`, { eventId });
      return json({ received: true, processing: true }, 409);
    }

    // mark processing (TTL 30 minutes)
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 }); // 30 days
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    // важно: списываем только если paid
    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      console.log(`[stripe-webhook] not paid -> ignore`, { eventId, sessionId, paymentStatus });
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    // ---------- получить customer / shipping ----------
    const customerEmail =
      session?.customer_details?.email ||
      session?.customer_email ||
      "";

    const customerName =
      session?.customer_details?.name ||
      session?.shipping_details?.name ||
      "";

    const customerPhone =
      session?.customer_details?.phone ||
      "";

    const ship = session?.shipping_details || null;
    const addr = ship?.address || null;

    const shippingAddressText = addr
      ? [
          addr.line1,
          addr.line2,
          addr.postal_code,
          addr.city,
          addr.state,
          addr.country,
        ].filter(Boolean).join(", ")
      : "";

    const amountTotal = Number(session?.amount_total ?? 0); // cents
    const currency = String(session?.currency || "").toUpperCase();

    // ---------- items from metadata ----------
    const meta = session?.metadata || {};
    const itemsJson = String(meta.items || "").trim();

    console.log(`[stripe-webhook] meta`, {
      eventId,
      sessionId,
      email: Boolean(customerEmail),
      hasShipping: Boolean(shippingAddressText),
      hasItems: Boolean(itemsJson),
      itemsLen: itemsJson ? itemsJson.length : 0,
    });

    if (!itemsJson) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No metadata.items" });
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch (e) {
      console.error(`[stripe-webhook] bad metadata.items JSON`, { eventId, sessionId });
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "Empty items" });
    }

    // ---------- normalize items (unique by recordId) ----------
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

    console.log(`[stripe-webhook] processing`, { eventId, sessionId, items: normalized.length });

    // ---------- process decrements + create order ----------
    try {
      // 1) Списание stock по каждому recordId
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
          console.log(`[stripe-webhook] decrement`, { recordId: it.recordId, qty: it.qty });
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

      // 2) Создание заказа в Airtable (Orders)
      // Собираем читаемые "Products" и "Quantity"
      const productsText = normalized.map((x) => `${x.recordId}`).join(", ");
      const qtyTotal = normalized.reduce((s, x) => s + (Number(x.qty) || 0), 0);

      await createOrderInAirtable({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: env.AIRTABLE_ORDERS_TABLE_NAME,
        fields: {
          // Под Ваши колонки на скрине:
          "Order ID": sessionId,
          "Products": productsText,
          "Quantity": qtyTotal,
          "Customer Name": customerName,
          "Shipping Address": shippingAddressText,
          "Refund Status": "paid",
          "Currency": currency,
          "Order Status": "paid",
          // Если у Вас есть поле для email/phone — добавьте его и сюда:
          // "Email": customerEmail,
          // "Phone": customerPhone,
          // Можно сохранить полный список:
          // "Items": JSON.stringify(normalized),
          // Можно сумму:
          // "Amount": amountTotal / 100,
        },
      });

      // mark done (30 days)
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });

      console.log(`[stripe-webhook] done`, { eventId, sessionId, customerEmail, shippingAddressText });
      return json({ received: true });
    } catch (e) {
      console.error(`[stripe-webhook] processing failed`, { eventId, sessionId, error: String(e?.message || e) });

      // remove marker so Stripe retries
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);

      return json({ error: "Webhook processing failed", details: String(e?.message || e) }, 500);
    }
  } catch (e) {
    console.error(`[stripe-webhook] fatal`, String(e?.message || e));
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

// ---------------- Airtable: stock decrement ----------------

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

// ---------------- Airtable: create order ----------------

async function createOrderInAirtable({ token, baseId, table, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records: [{ fields }] }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable create order failed: ${r.status} ${JSON.stringify(data)}`);
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

  console.warn(`[stripe-webhook] lock not acquired`, { key });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}