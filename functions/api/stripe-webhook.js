// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// 1) создаём заказ в Airtable Orders
// 2) списываем Stock в Airtable Products (не ниже 0)
// idempotency через KV (STRIPE_EVENTS_KV) + защита от дублей заказа по Stripe Session ID

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set (needed for billing address fallback)" }, 500);

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME (Products) is not set" }, 500);

    // Orders table name can be separate
    const ORDERS_TABLE =
      env.AIRTABLE_ORDERS_TABLE_NAME ||
      env.AIRTABLE_ORDERS_TABLE ||
      "Orders";

    // KV binding
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    // raw body
    const rawBody = await request.text();

    // ---------- verify signature ----------
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: String(env.STRIPE_WEBHOOK_SECRET).trim(),
      toleranceSec: 5 * 60,
    });

    if (!ok) {
      console.log("[stripe-webhook] invalid signature");
      return json({ error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log("[stripe-webhook] received", { eventId, eventType });

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ---------- IDP ----------
    const EVT_KEY = `stripe_evt:${eventId}`;
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") {
      console.log("[stripe-webhook] duplicate ignored", { eventId });
      return json({ received: true, duplicate: true });
    }

    if (prev === "processing") {
      console.log("[stripe-webhook] already processing -> retry", { eventId });
      return json({ received: true, processing: true }, 409);
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    // only if paid
    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      console.log("[stripe-webhook] not paid -> ignore", { eventId, sessionId, paymentStatus });
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    const meta = session?.metadata || {};
    const itemsJson = String(meta.items || "").trim();

    if (!itemsJson) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No metadata.items" });
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch (e) {
      console.error("[stripe-webhook] bad metadata.items JSON", { eventId, sessionId });
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "Empty items" });
    }

    // ---------- normalize items ----------
    // meta item format: { recordId, pin, qty }
    const productRecordIds = [];
    let totalQty = 0;

    const map = new Map(); // recordId -> qty
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      map.set(recordId, (map.get(recordId) || 0) + qty);
    }

    const normalized = [...map.entries()].map(([recordId, qty]) => ({ recordId, qty }));
    for (const it of normalized) {
      productRecordIds.push(it.recordId);
      totalQty += it.qty;
    }

    if (!normalized.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    // ---------- prepare order fields ----------
    const currency = String(session?.currency || "").toUpperCase() || "EUR";
    const amountTotalCents = Number(session?.amount_total ?? 0);
    const amountTotal = Number.isFinite(amountTotalCents) ? amountTotalCents / 100 : 0;

    const createdSec = Number(session?.created ?? 0);
    const createdAtISODate = createdSec
      ? new Date(createdSec * 1000).toISOString().slice(0, 10) // YYYY-MM-DD
      : new Date().toISOString().slice(0, 10);

    const customerName =
      String(session?.customer_details?.name || "").trim() ||
      String(session?.shipping_details?.name || "").trim() ||
      "";

    const customerEmail =
      String(session?.customer_details?.email || "").trim() ||
      "";

    const telefon =
      String(session?.customer_details?.phone || "").trim() ||
      "";

    const paymentIntentId = String(session?.payment_intent || "").trim() || "";
    const stripeSessionId = sessionId;

    // ---------- address: shipping_details -> fallback to billing_details ----------
    const shippingFromSession = session?.shipping_details?.address || null;

    let billingAddress = null;
    if (!shippingFromSession && paymentIntentId) {
      try {
        const pi = await stripeRetrievePaymentIntent({
          secretKey: env.STRIPE_SECRET_KEY,
          paymentIntentId,
        });

        const charge0 = pi?.charges?.data?.[0] || null;
        billingAddress = charge0?.billing_details?.address || null;
      } catch (e) {
        console.warn("[stripe-webhook] payment_intent retrieve failed", String(e?.message || e));
        // не падаем — просто останется пусто
      }
    }

    const addr = shippingFromSession || billingAddress;

    const shipCountry = addr?.country ? String(addr.country).trim() : "";
    const shipCity = addr?.city ? String(addr.city).trim() : "";
    const shipPostal = addr?.postal_code ? String(addr.postal_code).trim() : "";
    const shipState = addr?.state ? String(addr.state).trim() : "";

    const line1 = addr?.line1 ? String(addr.line1).trim() : "";
    const line2 = addr?.line2 ? String(addr.line2).trim() : "";

    // Shipping Address (long text) — аккуратно (улица/дом + доп строка)
    const shippingAddressLong = [line1, line2].filter(Boolean).join("\n");

    // ---------- avoid duplicate order creation by Stripe Session ID ----------
    // (если Stripe ретраит event)
    const existingOrderId = await airtableFindOrderByStripeSessionId({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      stripeSessionId,
    });

    if (!existingOrderId) {
      // ---------- create order in Airtable ----------
      // ВАЖНО: имена полей строго как у вас в таблице
      const fields = {
        "Order ID": stripeSessionId, // можно поменять на любой ваш формат
        "Products": productRecordIds, // Link to Products (array of record IDs)
        "Quantity": totalQty,
        "Currency": currency,

        "Order Status": "paid",
        "Refund Status": "not_refunded",

        "Customer Name": customerName,
        "Shipping Address": shippingAddressLong,

        "Shipping Country": shipCountry,
        "Shipping City": shipCity,
        "Shipping Postal Code": shipPostal,
        "Shipping State/Region": shipState,

        "Customer Email": customerEmail,
        "Telefon": telefon,

        "Tracking Number": "",

        "Created At": createdAtISODate, // YYYY-MM-DD
        "Amount Total": amountTotal,

        "Stripe Session ID": stripeSessionId,
        "Payment Intent ID": paymentIntentId,
      };

      await airtableCreateRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        fields,
      });
    } else {
      console.log("[stripe-webhook] order already exists, skip create", { stripeSessionId, existingOrderId });
    }

    // ---------- decrement stock (after order created OK) ----------
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
            table: env.AIRTABLE_TABLE_NAME, // Products table
            recordId: it.recordId,
            qty: it.qty,
          });
        } finally {
          await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token });
        }
      }

      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true });
    } catch (e) {
      console.error("[stripe-webhook] stock decrement failed", String(e?.message || e));
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Stock decrement failed", details: String(e?.message || e) }, 500);
    }
  } catch (e) {
    console.error("[stripe-webhook] fatal", String(e?.message || e));
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Stripe API helpers ----------------

async function stripeRetrievePaymentIntent({ secretKey, paymentIntentId }) {
  const url = new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  url.searchParams.set("expand[0]", "charges.data");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe retrieve PI failed: ${r.status} ${data?.error?.message || ""}`);
  return data;
}

// ---------------- Airtable helpers ----------------

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
  if (!r.ok) throw new Error(`Airtable create failed: ${r.status} ${JSON.stringify(data)}`);

  return data;
}

async function airtableFindOrderByStripeSessionId({ token, baseId, table, stripeSessionId }) {
  // filterByFormula: {Stripe Session ID}="cs_..."
  const formula = `{Stripe Session ID}="${String(stripeSessionId).replace(/"/g, '\\"')}"`;

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable find failed: ${r.status} ${JSON.stringify(data)}`);

  const rec = data?.records?.[0];
  return rec?.id || null;
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