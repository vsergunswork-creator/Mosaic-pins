import { decrementAirtableStock } from "./_airtable-products.js";
import { runShippedSweep, sendPaidEmailForRecord } from "./_notifications.js";
import { upsertOrderItemSnapshots } from "./_order-snapshots.js";

// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// GET  /api/stripe-webhook?ship_check=1
//
// 1) UPSERT order in Airtable Orders (create or update by "Stripe Session ID")
// 2) Decrement stock in Airtable Products (only once per Stripe event id)
// 3) Airtable remains the only stock source of truth; product cache is invalidated automatically
// Idempotency: KV (STRIPE_EVENTS_KV) with "processing" and "stock_done"

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME (Products) is not set" }, 500);

    const ORDERS_TABLE =
      env.AIRTABLE_ORDERS_TABLE_NAME ||
      env.AIRTABLE_ORDERS_TABLE ||
      "Orders";

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

    // ---------- idempotency ----------
    const EVT_KEY = `stripe_evt:${eventId}`;
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY); // null | processing | stock_done

    if (prev === "processing") {
      // Stripe should retry
      return json({ received: true, processing: true }, 409);
    }

    // mark processing (TTL 30 min)
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "stock_done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "stock_done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true, reason: "payment_status_not_paid" });
    }

    const meta = session?.metadata || {};
    // New sessions store the cart in KV; legacy sessions may still contain metadata.items.
    let itemsJson = String(meta.items || "").trim();
    const cartKey = String(meta.cartKey || "").trim();
    if (!itemsJson && cartKey) itemsJson = String(await env.STRIPE_EVENTS_KV.get(cartKey) || "").trim();
    if (!itemsJson) {
      // Do not mark this event done: Stripe retry may succeed if KV had a temporary issue.
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Checkout cart data is missing" }, 503);
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Bad checkout cart JSON" }, 400);
    }

    // ---------- normalize items ----------
    // meta item format: { recordId, pin, qty }
    const map = new Map(); // recordId -> validated checkout item + purchase snapshot

    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const pin = String(it?.pin || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));

      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const snapshot = {
        pin,
        title: String(it?.title || "").trim(),
        image: String(it?.image || "").trim(),
        diameter: Number.isFinite(Number(it?.diameter)) ? Number(it.diameter) : null,
        unitPrice: Number(it?.unitPrice),
        currency: String(it?.currency || "").trim().toUpperCase(),
      };

      const prevItem = map.get(recordId);
      if (prevItem) {
        prevItem.qty += qty;
        if (!prevItem.pin && pin) prevItem.pin = pin;
        map.set(recordId, prevItem);
      } else {
        map.set(recordId, { qty, ...snapshot });
      }
    }

    const normalized = [...map.entries()].map(([recordId, data]) => ({
      recordId,
      pin: String(data?.pin || "").trim(),
      title: String(data?.title || "").trim(),
      image: String(data?.image || "").trim(),
      diameter: Number.isFinite(Number(data?.diameter)) ? Number(data.diameter) : null,
      unitPrice: Number(data?.unitPrice),
      snapshotCurrency: String(data?.currency || "").trim().toUpperCase(),
      qty: Number(data?.qty || 0),
    }));

    if (!normalized.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "stock_done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    const productRecordIds = normalized.map((x) => x.recordId);
    const totalQty = normalized.reduce((s, x) => s + x.qty, 0);

    // ---------- money / meta ----------
    const currency = String(session?.currency || "").toUpperCase() || "EUR";
    const amountTotalCents = Number(session?.amount_total ?? 0);
    const amountTotal = Number.isFinite(amountTotalCents) ? amountTotalCents / 100 : 0;

    const createdSec = Number(session?.created ?? 0);
    const createdAtISO = createdSec ? new Date(createdSec * 1000).toISOString() : new Date().toISOString();

    const paymentIntentId = String(session?.payment_intent || "").trim();
    const stripeSessionId = sessionId;

    // ---------- address (MAIN: collected_information.shipping_details.address) ----------
    const collectedShipping = session?.collected_information?.shipping_details || null;

    const shippingAddr1 =
      collectedShipping?.address ||
      session?.shipping_details?.address ||
      session?.customer_details?.address ||
      null;

    // fallback: billing from PaymentIntent -> Charge -> billing_details.address
    let billingAddr = null;
    if (!shippingAddr1 && paymentIntentId) {
      try {
        const pi = await stripeRetrievePaymentIntent({
          secretKey: env.STRIPE_SECRET_KEY,
          paymentIntentId,
        });
        const charge0 = pi?.charges?.data?.[0] || null;
        billingAddr = charge0?.billing_details?.address || null;
      } catch {
        // ignore
      }
    }

    const addr = shippingAddr1 || billingAddr;

    const shipCountry = addr?.country ? String(addr.country).trim() : "";
    const shipCity = addr?.city ? String(addr.city).trim() : "";
    const shipPostal = addr?.postal_code ? String(addr.postal_code).trim() : "";
    const shipState = addr?.state ? String(addr.state).trim() : "";
    const line1 = addr?.line1 ? String(addr.line1).trim() : "";
    const line2 = addr?.line2 ? String(addr.line2).trim() : "";

    const customerName =
      String(collectedShipping?.name || "").trim() ||
      String(session?.customer_details?.name || "").trim() ||
      String(session?.shipping_details?.name || "").trim() ||
      "";

    const customerEmail = String(session?.customer_details?.email || "").trim() || "";
    const telefon = String(session?.customer_details?.phone || "").trim() || "";

    // "аккуратно": Country + City + Postal + Address
    const cityLine = [shipCountry, [shipPostal, shipCity].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const streetBlock = [line1, line2].filter(Boolean).join("\n");
    const shippingAddressLong = [cityLine, streetBlock].filter(Boolean).join("\n");

    // ---------- UPSERT order by Stripe Session ID ----------
    const existing = await airtableFindOrderByStripeSessionId({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      stripeSessionId,
    });

    // ВАЖНО: имена полей ровно как у Вас в Airtable
    const orderFields = {
      "Order ID": stripeSessionId,
      "Products": productRecordIds,
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

      "Created At": createdAtISO, // ISO 8601
      "Amount Total": amountTotal,

      "Stripe Session ID": stripeSessionId,
      "Payment Intent ID": paymentIntentId,
    };

    let savedOrder;
    if (!existing?.id) {
      savedOrder = await airtableCreateRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        fields: { ...orderFields, "Tracking Number": "" },
      });
    } else {
      savedOrder = await airtableUpdateRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        recordId: existing.id,
        fields: orderFields,
      });
    }

    // Save exact purchase-time product data for My Orders / Verified Purchase.
    // This is deliberately best-effort: a snapshot failure must never block a
    // completed payment, Airtable order creation, stock update, or confirmation email.
    try {
      await upsertOrderItemSnapshots(env, {
        orderKey: stripeSessionId,
        provider: "stripe",
        currency,
        createdAt: createdSec || createdAtISO,
        items: normalized.map((it) => ({
          recordId: it.recordId,
          pin: it.pin,
          title: it.title,
          image: it.image,
          diameter: it.diameter,
          qty: it.qty,
          unitPrice: it.unitPrice,
        })),
      });
    } catch (snapshotError) {
      console.error("Stripe order snapshot failed; payment flow continues", snapshotError);
    }

    // Customer confirmation is sent immediately when possible.
    // The notification worker is the fallback if this attempt fails.
    const queuePaidEmail = () => {
      const job = sendPaidEmailForRecord(env, savedOrder).catch((e) =>
        console.error("Immediate paid-email failed; cron will retry", e)
      );
      if (ctx.waitUntil) ctx.waitUntil(job);
    };

    // ---------- decrement stock ONLY ONCE ----------
    const alreadyStockDone = prev === "stock_done";
    if (alreadyStockDone) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "stock_done", { expirationTtl: 30 * 24 * 60 * 60 });
      queuePaidEmail();
      return json({ received: true, upserted: true, stock: "skipped_already_done", email: "queued" });
    }

    for (const it of normalized) {
      const ITEM_DONE_KEY = `stripe_stock_done:${eventId}:${it.recordId}`;
      if (await env.STRIPE_EVENTS_KV.get(ITEM_DONE_KEY)) continue;

      const lockKey = `lock:${it.recordId}`;
      const lockToken = await acquireLock({
        kv: env.STRIPE_EVENTS_KV,
        key: lockKey,
        ttlSec: 120,
        retries: 12,
        waitMs: 180,
      });

      // ✅ CRITICAL: если lock не взяли — НЕ трогаем stock, снимаем processing → Stripe retry
      if (!lockToken) {
        await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
        return json({ error: "Stock lock busy, please retry" }, 503);
      }

      try {
        // Airtable is the only stock source of truth.
        // Per-item marker prevents a retry from decrementing an item twice if another item failed later.
        if (!(await env.STRIPE_EVENTS_KV.get(ITEM_DONE_KEY))) {
          await decrementAirtableStock(env, it.recordId, it.qty);
          await env.STRIPE_EVENTS_KV.put(ITEM_DONE_KEY, "1", { expirationTtl: 90 * 24 * 60 * 60 });
        }
      } finally {
        await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token: lockToken });
      }
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "stock_done", { expirationTtl: 30 * 24 * 60 * 60 });
    if (cartKey) await env.STRIPE_EVENTS_KV.delete(cartKey).catch(() => {});
    queuePaidEmail();
    return json({ received: true, upserted: true, stock: "decremented", email: "queued" });
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// Manual authenticated fallback for shipping notifications.
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("ship_check") !== "1") return json({ ok: true, note: "use ?ship_check=1" });
  const required = String(env.CRON_SECRET || "").trim();
  const got = String(request.headers.get("x-cron-secret") || url.searchParams.get("secret") || "").trim();
  if (required && got !== required) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const shipped = await runShippedSweep(env, { maxRecords: 25 });
    return json({ ok: true, shipped });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
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

async function airtableUpdateRecord({ token, baseId, table, recordId, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;

  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable update failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtableFindOrderByStripeSessionId({ token, baseId, table, stripeSessionId }) {
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
  return rec ? { id: rec.id, fields: rec.fields || {} } : null;
}

// Stock updates are handled by _airtable-products.js.

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

// ✅ one single json helper (no duplicates)
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}