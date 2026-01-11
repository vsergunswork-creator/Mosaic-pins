// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// checkout.session.completed:
// 1) decrement Stock in Products (Airtable)
// 2) create Orders record (Airtable)
// + idempotency via KV (STRIPE_EVENTS_KV)

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500); // ✅ нужно для дозапроса session
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const ORDERS_TABLE = env.AIRTABLE_ORDERS_TABLE_NAME || "Orders";

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: env.STRIPE_WEBHOOK_SECRET,
      toleranceSec: 5 * 60,
    });
    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log(`[stripe-webhook] received`, { eventId, eventType });

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ---------- Idempotency ----------
    const EVT_KEY = `stripe_evt:${eventId}`;

    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);
    if (prev === "done") return json({ received: true, duplicate: true });
    if (prev === "processing") {
      // лучше отдать 409, чтобы Stripe продолжал ретраи, если что-то упало в середине
      return json({ received: true, processing: true }, 409);
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- Only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    let session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    // paid only
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
      return json({ received: true, note: "No valid recordId/qty" });
    }

    // ---------- Decrement stock ----------
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

    // ---------- Ensure we have full session (for address/phone/email) ----------
    // Иногда webhook object урезан. Дозапросим session из Stripe API.
    try {
      session = await stripeGetCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        sessionId,
      });
    } catch (e) {
      console.warn(`[stripe-webhook] stripeGetCheckoutSession failed (continue)`, String(e?.message || e));
      // продолжаем с тем что есть
    }

    // ---------- Create Orders record in Airtable ----------
    try {
      const orderFields = buildOrderFieldsFromSession({
        session,
        normalizedItems: normalized,
      });

      // Привязка Products (Linked record) — массив recordId из Products
      // поле должно быть Link to another record -> Products
      orderFields["Products"] = normalized.map((x) => x.recordId);
      orderFields["Quantity"] = normalized.reduce((s, x) => s + (Number(x.qty) || 0), 0);

      await airtableCreateRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        fields: orderFields,
      });
    } catch (e) {
      // Если сток списали, но Orders не создался — это важно.
      // Возвращаем 500 => Stripe retry. Idempotency защитит от двойного списания.
      console.error(`[stripe-webhook] orders create failed`, String(e?.message || e));
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Orders create failed", details: String(e?.message || e) }, 500);
    }

    // done
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
    return json({ received: true });
  } catch (e) {
    console.error(`[stripe-webhook] fatal`, String(e?.message || e));
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

// ---------------- Orders fields mapping ----------------

function buildOrderFieldsFromSession({ session, normalizedItems }) {
  const sid = String(session?.id || "");
  const pi = String(session?.payment_intent || "");
  const currency = String(session?.currency || "").toUpperCase() || "";
  const amountTotal = Number(session?.amount_total ?? session?.amount_subtotal ?? 0);

  const customer = session?.customer_details || {};
  const email = String(customer?.email || session?.customer_email || "").trim();
  const phone = String(customer?.phone || "").trim();
  const name = String(customer?.name || "").trim();

  // Адрес может быть в разных местах:
  const shipping1 = session?.shipping_details || null;
  const shipping2 = session?.collected_information?.shipping_details || null;

  const addr =
    shipping1?.address ||
    shipping2?.address ||
    customer?.address ||
    null;

  const shipName = String(shipping1?.name || shipping2?.name || name || "").trim();

  const line1 = String(addr?.line1 || "").trim();
  const line2 = String(addr?.line2 || "").trim();
  const city = String(addr?.city || "").trim();
  const postal = String(addr?.postal_code || "").trim();
  const state = String(addr?.state || "").trim();
  const country = String(addr?.country || "").trim(); // ISO code

  const prettyAddress = compactAddress({
    line1,
    line2,
    city,
    state,
    postal,
    country,
  });

  // статусы
  const orderStatus = "paid";
  const refundStatus = "not_refunded";

  const createdAtIso = session?.created
    ? new Date(Number(session.created) * 1000).toISOString()
    : new Date().toISOString();

  // Products (link) и Quantity добавляются выше
  return {
    "Order ID": sid || `order-${Date.now()}`,
    "Stripe Session ID": sid || "",
    "Payments Intent ID": pi || "",
    "Customer Name": shipName || name || "",
    "Customer Email": email || "",
    "Telefon": phone || "",

    "Currency": currency || "",
    "Amount Total": Number.isFinite(amountTotal) ? (amountTotal / 100) : 0,

    "Order Status": orderStatus,
    "Refund Status": refundStatus,
    "Tracking Number": "",

    "Created At": createdAtIso,

    // общий адрес строкой
    "Shipping Address": prettyAddress,

    // раздельно
    "Shipping Country": country || "",
    "Shipping City": city || "",
    "Shipping Postal Code": postal || "",
    "Shipping State/Region": state || "",
  };
}

function compactAddress({ line1, line2, city, state, postal, country }) {
  const parts = [];
  const street = [line1, line2].filter(Boolean).join(", ");
  if (street) parts.push(street);

  const locality = [postal, city].filter(Boolean).join(" ");
  if (locality) parts.push(locality);

  if (state) parts.push(state);
  if (country) parts.push(country);

  return parts.join(", ");
}

// ---------------- Airtable ----------------

async function airtableCreateRecord({ token, baseId, table, fields }) {
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
  if (!r.ok) throw new Error(`Airtable create failed: ${r.status} ${JSON.stringify(data)}`);
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

// ---------------- Stripe (fetch session) ----------------

async function stripeGetCheckoutSession({ secretKey, sessionId }) {
  if (!sessionId) throw new Error("Missing sessionId");
  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`;

  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe get session failed: ${data?.error?.message || r.statusText}`);
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