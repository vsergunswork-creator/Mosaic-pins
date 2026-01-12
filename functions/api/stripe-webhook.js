// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// 1) списываем Stock в Airtable (Products)
// 2) создаём запись в Airtable (Orders) с адресом/телефоном/email
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
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    // Orders table name (fallback "Orders")
    const ORDERS_TABLE = String(env.AIRTABLE_ORDERS_TABLE_NAME || "Orders").trim();

    // KV binding
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

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
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") return json({ received: true, duplicate: true });

    if (prev === "processing") {
      // пусть Stripe ретраит, чтобы не зависнуть навсегда
      return json({ received: true, processing: true }, 409);
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    // Stripe event несёт session, но иногда без shipping_details/phone.
    // Поэтому мы достаём session заново из Stripe API.
    const sessionFromEvent = event?.data?.object || {};
    const sessionId = String(sessionFromEvent?.id || "").trim();
    if (!sessionId) {
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Missing session.id" }, 400);
    }

    const session = await stripeRetrieveCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      sessionId,
    });

    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    // ---------- items from metadata ----------
    const meta = session?.metadata || {};
    const itemsJson = String(meta.items || "").trim();
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

    // normalize items -> recordId => qty
    const map = new Map();
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

    // ---------- build Order fields ----------
    const currency = String(session?.currency || "").toUpperCase();
    const amountTotal = Number(session?.amount_total || 0) / 100;

    const customerDetails = session?.customer_details || {};
    const shipping = session?.shipping_details || {};
    const shipAddr = shipping?.address || {};
    const shipName = String(shipping?.name || "").trim();

    const customerName =
      shipName ||
      String(customerDetails?.name || "").trim() ||
      "—";

    const customerEmail = String(customerDetails?.email || "").trim();
    const phone = String(customerDetails?.phone || "").trim();

    const line1 = String(shipAddr?.line1 || "").trim();
    const line2 = String(shipAddr?.line2 || "").trim();
    const postal = String(shipAddr?.postal_code || "").trim();
    const city = String(shipAddr?.city || "").trim();
    const state = String(shipAddr?.state || "").trim();
    const country = String(shipAddr?.country || "").trim();

    const shippingAddressLong = formatShippingLong({
      name: customerName,
      line1,
      line2,
      postal,
      city,
      state,
      country,
    });

    const createdAtIso = toIsoFromStripeSeconds(session?.created);

    const paymentIntentId = String(session?.payment_intent || "").trim();

    // Single select values MUST match exactly what you created in Airtable.
    // Order Status: paid/unpaid/failed/canceled/refunded
    // Refund Status: not_refunded/partial/refunded
    const orderStatus = "paid";
    const refundStatus = "not_refunded";

    // Products (Link to Products) expects an array of record IDs
    const productRecordIds = normalized.map(x => x.recordId);

    // Quantity (Number): total quantity sum
    const quantityTotal = normalized.reduce((s, x) => s + (Number(x.qty) || 0), 0);

    // ---------- 1) decrement stock ----------
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
          table: env.AIRTABLE_TABLE_NAME,
          recordId: it.recordId,
          qty: it.qty,
        });
      } finally {
        await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token });
      }
    }

    // ---------- 2) create Orders row ----------
    await airtableCreateOrder({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      ordersTable: ORDERS_TABLE,
      fields: {
        "Order ID": sessionId, // single line text
        "Products": productRecordIds, // link to Products
        "Quantity": quantityTotal, // number
        "Currency": currency, // single line text
        "Order Status": orderStatus, // single select
        "Refund Status": refundStatus, // single select
        "Customer Name": customerName, // single line text
        "Shipping Address": shippingAddressLong, // long text
        "Shipping Country": country,
        "Shipping City": city,
        "Shipping Postal Code": postal,
        "Shipping State/Region": state,
        "Customer Email": customerEmail || "", // email
        "Telefon": phone || "", // phone number
        "Tracking Number": "", // empty initially
        "Created At": createdAtIso, // Date
        "Amount Total": Number.isFinite(amountTotal) ? amountTotal : 0, // Currency
        "Stripe Session ID": sessionId,
        "Payment Intent ID": paymentIntentId,
      },
    });

    // mark done
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
    return json({ received: true });
  } catch (e) {
    // if we fail after setting processing, delete marker so Stripe retries
    try {
      const msg = String(e?.message || e);
      console.error("[stripe-webhook] fatal", msg);
    } catch {}
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Airtable helpers ----------------

async function airtableCreateOrder({ token, baseId, ordersTable, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(ordersTable)}`;

  // Airtable link field expects { "Products": ["recxxx", "recyyy"] }
  // Ensure it's an array for Products
  if (Array.isArray(fields["Products"])) {
    fields["Products"] = fields["Products"].filter(Boolean);
  }

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
    throw new Error(`Airtable Orders create failed: ${r.status} ${JSON.stringify(data)}`);
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

// ---------------- Stripe: retrieve session ----------------

async function stripeRetrieveCheckoutSession({ secretKey, sessionId }) {
  const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  // expand customer_details + shipping_details обычно и так есть, но expand не мешает
  url.searchParams.append("expand[]", "customer_details");
  url.searchParams.append("expand[]", "shipping_details");

  const r = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe retrieve session failed: ${data?.error?.message || r.statusText}`);
  return data;
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

// ---------------- formatting ----------------

function toIsoFromStripeSeconds(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}

function formatShippingLong({ name, line1, line2, postal, city, state, country }) {
  const parts = [];
  if (name) parts.push(name);

  const street = [line1, line2].filter(Boolean).join(", ");
  if (street) parts.push(street);

  const cityLine = [postal, city].filter(Boolean).join(" ");
  if (cityLine) parts.push(cityLine);

  const regionLine = [state, country].filter(Boolean).join(", ");
  if (regionLine) parts.push(regionLine);

  return parts.join("\n");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}