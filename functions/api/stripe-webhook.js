// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// 1) verify Stripe signature
// 2) idempotency via KV
// 3) on checkout.session.completed (paid):
//    - decrement Stock in Products
//    - create Orders record in Airtable

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME (Products) is not set" }, 500);
    if (!env.AIRTABLE_ORDERS_TABLE_NAME) return json({ error: "AIRTABLE_ORDERS_TABLE_NAME (Orders) is not set" }, 500);

    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

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

    // ---------- IDP ----------
    const EVT_KEY = `stripe_evt:${eventId}`;
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") return json({ received: true, duplicate: true });
    if (prev === "processing") {
      // Stripe will retry. Это нормально.
      return json({ received: true, processing: true }, 409);
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // Only checkout.session.completed
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    // paid only
    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    // metadata items
    const itemsJson = String(session?.metadata?.items || "").trim();
    if (!itemsJson) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
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
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "Empty items" });
    }

    // normalize by recordId
    const byRecord = new Map(); // recordId -> qty sum
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      byRecord.set(recordId, (byRecord.get(recordId) || 0) + qty);
    }

    const normalized = [...byRecord.entries()].map(([recordId, qty]) => ({ recordId, qty }));
    if (!normalized.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    // ---------- Build order fields ----------
    const currency = String(session?.currency || "").toUpperCase() || "EUR";
    const amountTotal = Number(session?.amount_total ?? 0) / 100;

    const customerDetails = session?.customer_details || {};
    const shippingDetails = session?.shipping_details || {};

    const customerName = String(shippingDetails?.name || customerDetails?.name || "").trim();
    const customerEmail = String(customerDetails?.email || "").trim();
    const telefon = String(customerDetails?.phone || "").trim();

    const addr = shippingDetails?.address || {};
    const shippingCountry = String(addr?.country || "").trim();
    const shippingCity = String(addr?.city || "").trim();
    const shippingPostal = String(addr?.postal_code || "").trim();
    const shippingState = String(addr?.state || "").trim();

    const line1 = String(addr?.line1 || "").trim();
    const line2 = String(addr?.line2 || "").trim();

    // аккуратный long text "Shipping Address"
    const addressParts = [];
    if (line1) addressParts.push(line1);
    if (line2) addressParts.push(line2);
    const cityLine = [shippingPostal, shippingCity].filter(Boolean).join(" ");
    if (cityLine) addressParts.push(cityLine);
    if (shippingState) addressParts.push(shippingState);
    if (shippingCountry) addressParts.push(shippingCountry);
    const shippingAddressLong = addressParts.join(", ");

    const orderStatus = "paid"; // т.к. сюда попали только paid
    const refundStatus = "not_refunded";

    // ✅ Variant B: Created At = YYYY-MM-DD (без времени!)
    const createdUnix = Number(session?.created || 0);
    const createdISODate = createdUnix
      ? new Date(createdUnix * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const paymentIntentId = session?.payment_intent ? String(session.payment_intent) : "";
    const stripeSessionId = sessionId;

    const totalQty = normalized.reduce((s, x) => s + (x.qty || 0), 0);
    const productLinks = [...new Set(normalized.map((x) => x.recordId))];

    // ---------- process: decrement stock + create order ----------
    try {
      // 1) decrement stock in Products (по каждому recordId)
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

      // 2) create Orders record
      await airtableCreateOrder({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        ordersTable: env.AIRTABLE_ORDERS_TABLE_NAME, // Orders
        fields: {
          "Order ID": stripeSessionId,
          "Products": productLinks,                 // link to Products (record IDs)
          "Quantity": totalQty,
          "Currency": currency,

          "Order Status": orderStatus,              // single select
          "Refund Status": refundStatus,            // single select

          "Customer Name": customerName,
          "Shipping Address": shippingAddressLong,  // long text

          "Shipping Country": shippingCountry,
          "Shipping City": shippingCity,
          "Shipping Postal Code": shippingPostal,
          "Shipping State/Region": shippingState,

          "Customer Email": customerEmail,
          "Telefon": telefon,

          "Tracking Number": "",

          "Created At": createdISODate,             // ✅ Variant B (YYYY-MM-DD)
          "Amount Total": Number.isFinite(amountTotal) ? amountTotal : 0,

          "Stripe Session ID": stripeSessionId,
          "Payment Intent ID": paymentIntentId,
        },
      });

      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true });
    } catch (e) {
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // чтобы Stripe повторил
      return json({ error: "Webhook processing failed", details: String(e?.message || e) }, 500);
    }
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Airtable helpers ----------------

async function airtableCreateOrder({ token, baseId, ordersTable, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(ordersTable)}`;

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

// ---------------- KV lock ----------------

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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}