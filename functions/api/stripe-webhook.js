// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// слушаем checkout.session.completed
// списываем Stock в Airtable (не ниже 0)
// + idempotency через KV (STRIPE_EVENTS_KV)
// + best-effort lock на recordId (уменьшаем race condition)
// + логирование

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // ---------- ENV checks ----------
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    // ✅ KV binding (не env var)
    if (!env.STRIPE_EVENTS_KV) return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    // ---------- verify signature ----------
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });

    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    console.log(`[stripe-webhook] received event`, { eventId, eventType });

    if (!eventId) {
      // странно, но не будем падать
      return json({ received: true, note: "Missing event.id" });
    }

    // ---------- IDP: process each event only once ----------
    const EVT_KEY = `stripe_evt:${eventId}`;

    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);
    if (prev === "done") {
      console.log(`[stripe-webhook] duplicate event ignored`, { eventId });
      return json({ received: true, duplicate: true });
    }
    if (prev === "processing") {
      // Если Stripe шлёт параллельно (или повторно очень быстро), не даём параллельной обработке.
      console.log(`[stripe-webhook] event already processing`, { eventId });
      return json({ received: true, processing: true });
    }

    // помечаем как processing (TTL ~ 30 минут)
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // ---------- only handle checkout.session.completed ----------
    if (eventType !== "checkout.session.completed") {
      // помечаем done, чтобы не гонять этот event повторно
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 }); // 30 дней
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    const meta = session?.metadata || {};
    const sessionId = String(session?.id || "").trim();

    const itemsJson = String(meta.items || "").trim();
    if (!itemsJson) {
      console.log(`[stripe-webhook] no metadata.items`, { eventId, sessionId });
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No metadata.items" });
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      console.error(`[stripe-webhook] bad metadata.items JSON`, { eventId, sessionId });
      // удаляем processing, чтобы Stripe мог повторить
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);
      return json({ error: "Bad metadata.items JSON" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      console.log(`[stripe-webhook] empty items`, { eventId, sessionId });
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "Empty items" });
    }

    // ---------- normalize items (unique by recordId) ----------
    // чтобы случайно не списать дважды один recordId в одном ивенте
    const map = new Map(); // recordId -> qty
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      map.set(recordId, (map.get(recordId) || 0) + qty);
    }

    const normalized = [...map.entries()].map(([recordId, qty]) => ({ recordId, qty }));

    console.log(`[stripe-webhook] processing`, {
      eventId,
      sessionId,
      items: normalized.length,
    });

    // ---------- process decrements ----------
    try {
      for (const it of normalized) {
        // best-effort lock per recordId (уменьшаем гонки между параллельными webhooks)
        const token = await acquireLock({
          kv: env.STRIPE_EVENTS_KV,
          key: `lock:${it.recordId}`,
          ttlSec: 25,
          retries: 12,
          waitMs: 180,
        });

        try {
          console.log(`[stripe-webhook] decrement stock`, { recordId: it.recordId, qty: it.qty });
          await decrementStockByRecordIdSafe({
            token: env.AIRTABLE_TOKEN,
            baseId: env.AIRTABLE_BASE_ID,
            table: env.AIRTABLE_TABLE_NAME,
            recordId: it.recordId,
            qty: it.qty,
          });
        } finally {
          await releaseLock({
            kv: env.STRIPE_EVENTS_KV,
            key: `lock:${it.recordId}`,
            token,
          });
        }
      }

      // ✅ done (TTL 30 days)
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });

      console.log(`[stripe-webhook] done`, { eventId, sessionId });
      return json({ received: true });
    } catch (e) {
      console.error(`[stripe-webhook] processing failed`, { eventId, sessionId, error: String(e?.message || e) });

      // ❗ удаляем marker, чтобы Stripe повторил webhook
      await env.STRIPE_EVENTS_KV.delete(EVT_KEY);

      // отдаём 500, чтобы Stripe сделал retry
      return json({ error: "Webhook processing failed", details: String(e?.message || e) }, 500);
    }
  } catch (e) {
    console.error(`[stripe-webhook] fatal error`, String(e?.message || e));
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

// ---------------- Airtable stock decrement ----------------

async function decrementStockByRecordIdSafe({ token, baseId, table, recordId, qty }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;

  // 1) get current stock
  const r1 = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const safeCurrent = Number.isFinite(current) ? current : 0;

  const q = Math.floor(Number(qty || 0));
  const safeQty = Number.isFinite(q) ? q : 0;

  const next = Math.max(0, safeCurrent - safeQty);

  // 2) update stock (never negative)
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
// Cloudflare KV не даёт атомарного compare-and-set, но “псевдозамок”
// сильно уменьшает вероятность параллельной записи на один recordId.

async function acquireLock({ kv, key, ttlSec = 20, retries = 10, waitMs = 150 }) {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  for (let i = 0; i < retries; i++) {
    const existing = await kv.get(key);

    if (!existing) {
      // пытаемся поставить токен
      await kv.put(key, token, { expirationTtl: ttlSec });

      // проверяем что именно мы владелец (минимальная защита от гонки)
      const check = await kv.get(key);
      if (check === token) return token;
    }

    await sleep(waitMs + Math.floor(Math.random() * 80));
  }

  // если не смогли — всё равно продолжаем без lock (лучше списать, чем зависнуть),
  // но логируем и возвращаем token = null
  console.warn(`[stripe-webhook] lock not acquired`, { key });
  return null;
}

async function releaseLock({ kv, key, token }) {
  if (!token) return;
  const existing = await kv.get(key);
  if (existing === token) {
    await kv.delete(key);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- Stripe signature verify ----------------

async function verifyStripeSignature({ payload, header, secret }) {
  const parts = String(header).split(",").map((x) => x.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const sig = v1Part.slice(3);

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

  return safeEqual(expected, sig);
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