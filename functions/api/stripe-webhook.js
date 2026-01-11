// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// 1) списываем Stock в Products (не ниже 0)
// 2) создаём запись в Orders
// + idempotency через KV (STRIPE_EVENTS_KV)
// + защита от двойного списания при ретраях Stripe
// + best-effort lock на recordId

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);

    // Products table (Ваш вариант A)
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    // Orders table
    const ORDERS_TABLE = env.AIRTABLE_ORDERS_TABLE_NAME || "Orders";

    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });
    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log(`[stripe-webhook] received`, { eventId, eventType });

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // ----- global idempotency marker -----
    const EVT_KEY = `stripe_evt:${eventId}`;
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);

    if (prev === "done") {
      console.log(`[stripe-webhook] duplicate ignored`, { eventId });
      return json({ received: true, duplicate: true });
    }
    if (prev === "processing") {
      // пусть Stripe ретраит — безопасно из-за per-item keys ниже
      console.log(`[stripe-webhook] already processing -> ask retry`, { eventId });
      return json({ received: true, processing: true }, 409);
    }

    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ----- handle only completed checkout -----
    if (eventType !== "checkout.session.completed") {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const sessionId = String(session?.id || "").trim();

    const paymentStatus = String(session?.payment_status || "").toLowerCase();
    if (paymentStatus !== "paid") {
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
    } catch {
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // allow retry after fix
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "Empty items" });
    }

    // normalize by recordId
    const map = new Map(); // recordId -> { qty, pin? }
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      const pin = String(it?.pin || "").trim();

      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const prevQty = map.get(recordId)?.qty || 0;
      map.set(recordId, { qty: prevQty + qty, pin });
    }

    const normalized = [...map.entries()].map(([recordId, v]) => ({ recordId, qty: v.qty, pin: v.pin }));
    if (!normalized.length) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No valid recordId/qty in items" });
    }

    // ---------- 1) decrement stock (idempotent per record) ----------
    try {
      for (const it of normalized) {
        const decKey = `dec:${eventId}:${it.recordId}`;

        // если этот recordId уже списали для этого event — не списываем повторно
        const already = await env.STRIPE_EVENTS_KV.get(decKey);
        if (already === "1") {
          console.log(`[stripe-webhook] decrement already done (skip)`, { eventId, recordId: it.recordId });
          continue;
        }

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

          // mark this record decrement done for this event (30 days)
          await env.STRIPE_EVENTS_KV.put(decKey, "1", { expirationTtl: 30 * 24 * 60 * 60 });
        } finally {
          await releaseLock({ kv: env.STRIPE_EVENTS_KV, key: lockKey, token });
        }
      }
    } catch (e) {
      console.error(`[stripe-webhook] stock decrement failed`, String(e?.message || e));
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY); // retry
      return json({ error: "Stock decrement failed", details: String(e?.message || e) }, 500);
    }

    // ---------- 2) create Orders record (idempotent per event) ----------
    try {
      const orderKey = `order:${eventId}`;
      const existingOrderId = await env.STRIPE_EVENTS_KV.get(orderKey);

      if (!existingOrderId) {
        const orderFields = buildOrderFieldsFromSession({
          session,
          items: normalized,
        });

        // Link field expects array of record IDs
        orderFields["Products"] = normalized.map((x) => x.recordId);

        // Amount total
        const amountTotal = Number(session?.amount_total);
        if (Number.isFinite(amountTotal)) {
          orderFields["Amount Total"] = Math.round(amountTotal) / 100;
        }

        // currency
        const cur = String(session?.currency || "").toUpperCase();
        if (cur) orderFields["Currency"] = cur;

        // order status / refund status
        orderFields["Order Status"] = "paid";
        orderFields["Refund Status"] = "not_refunded";

        // created at
        const created = Number(session?.created);
        if (Number.isFinite(created) && created > 0) {
          orderFields["Created At"] = new Date(created * 1000).toISOString();
        } else {
          orderFields["Created At"] = new Date().toISOString();
        }

        // Order ID (Ваше поле)
        orderFields["Order ID"] = String(sessionId || eventId);

        // Quantity (общее количество)
        const totalQty = normalized.reduce((s, x) => s + (Number(x.qty) || 0), 0);
        orderFields["Quantity"] = totalQty;

        const rec = await airtableCreateRecord({
          token: env.AIRTABLE_TOKEN,
          baseId: env.AIRTABLE_BASE_ID,
          table: ORDERS_TABLE,
          fields: orderFields,
        });

        // save created order record id
        await env.STRIPE_EVENTS_KV.put(orderKey, String(rec?.id || "1"), { expirationTtl: 30 * 24 * 60 * 60 });
      } else {
        console.log(`[stripe-webhook] order already exists (skip)`, { eventId, existingOrderId });
      }
    } catch (e) {
      // ⚠️ stock уже списан, поэтому НЕ удаляем EVT_KEY и НЕ заставляем Stripe ретраить бесконечно.
      // Лучше руками создать order, чем рискнуть повторными действиями.
      console.error(`[stripe-webhook] order create failed`, String(e?.message || e));
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, warning: "Order not created", details: String(e?.message || e) }, 200);
    }

    // mark done
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
    console.log(`[stripe-webhook] done`, { eventId, sessionId });

    return json({ received: true });
  } catch (e) {
    console.error(`[stripe-webhook] fatal`, String(e?.message || e));
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

// ---------------- Order fields builder ----------------

function buildOrderFieldsFromSession({ session, items }) {
  const customer = session?.customer_details || {};
  const shipping = session?.shipping_details || {};

  const addr = (shipping?.address || customer?.address || {}) || {};

  const line1 = String(addr?.line1 || "").trim();
  const line2 = String(addr?.line2 || "").trim();
  const city = String(addr?.city || "").trim();
  const state = String(addr?.state || "").trim();
  const postal = String(addr?.postal_code || "").trim();
  const country = String(addr?.country || "").trim();

  const addressParts = [
    line1,
    line2,
    [postal, city].filter(Boolean).join(" "),
    state,
    country,
  ].filter(Boolean);

  const fullAddress = addressParts.join(", ");

  // Products list text (на всякий случай красиво в Orders)
  const productsText = items
    .map((x) => `${x.pin || x.recordId} × ${x.qty}`)
    .join("; ");

  const fields = {};

  // Ваши поля (как Вы написали)
  fields["Customer Name"] = String(customer?.name || shipping?.name || "").trim() || "—";
  fields["Customer Email"] = String(customer?.email || "").trim() || "—";
  fields["Telefon"] = String(customer?.phone || shipping?.phone || "").trim() || "";

  fields["Shipping Country"] = country || "";
  fields["Shipping City"] = city || "";
  fields["Shipping Postal Code"] = postal || "";
  fields["Shipping State/Region"] = state || "";

  // если поле Shipping Address у Вас ТЕКСТОВОЕ — запишем туда красивую строку
  fields["Shipping Address"] = fullAddress || "";

  // чтобы Вам было удобно видеть состав заказа (если поле Products у Вас link — это отдельно)
  // (если у Вас нет такого текстового поля — Airtable просто проигнорирует при создании? Нет, Airtable не любит неизвестные поля.
  // Поэтому НЕ пишем в "Products" текстом, только link массивом (выше).)
  // Если хотите отдельное поле для текста — сделайте в Orders поле "Products Text"
  // и поменяйте тут ключ.
  // fields["Products Text"] = productsText;

  return fields;
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

// ---------------- Stock decrement ----------------

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

async function verifyStripeSignature({ payload, header, secret }) {
  const parts = String(header).split(",").map((x) => x.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));

  if (!tPart || !v1Parts.length) return false;

  const timestamp = tPart.slice(2);
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