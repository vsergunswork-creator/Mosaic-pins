// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// Listen: checkout.session.completed -> decrement Stock in Airtable

export async function onRequestPost({ env, request }) {
  try {
    must(env.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET");
    must(env.AIRTABLE_TOKEN, "AIRTABLE_TOKEN");
    must(env.AIRTABLE_BASE_ID, "AIRTABLE_BASE_ID");
    must(env.AIRTABLE_TABLE_NAME, "AIRTABLE_TABLE_NAME");

    const sigHeader = request.headers.get("stripe-signature");
    if (!sigHeader) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    const verified = await verifyStripeSignature({
      payload: rawBody,
      header: sigHeader,
      secret: env.STRIPE_WEBHOOK_SECRET,
      toleranceSec: 300, // 5 минут
    });

    if (!verified) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);

    if (event?.type !== "checkout.session.completed") {
      return json({ received: true });
    }

    const session = event?.data?.object || {};
    // важно: не списывать если не paid
    if (session?.payment_status && String(session.payment_status) !== "paid") {
      return json({ received: true, note: "payment_status is not paid" });
    }

    const itemsJson = String(session?.metadata?.items || "").trim();
    if (!itemsJson) return json({ received: true, note: "No metadata.items" });

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      return json({ received: true, note: "Bad metadata.items JSON" });
    }

    if (!Array.isArray(items) || !items.length) return json({ received: true, note: "Empty items" });

    const table = env.AIRTABLE_TABLE_NAME;

    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      await decrementStockByRecordIdSafe({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table,
        recordId,
        qty,
      });
    }

    return json({ received: true });
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

function must(v, name) {
  if (!v) throw new Error(`${name} is not set`);
}

async function decrementStockByRecordIdSafe({ token, baseId, table, recordId, qty }) {
  const recUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;

  // 1) read current
  const r1 = await fetch(recUrl, { headers: { Authorization: `Bearer ${token}` } });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const next = Math.max(0, current - qty); // ✅ never negative

  // 2) update
  const r2 = await fetch(recUrl, {
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

/**
 * Stripe signature verification (HMAC SHA256)
 * Header: t=timestamp,v1=sig1,v1=sig2,...
 */
async function verifyStripeSignature({ payload, header, secret, toleranceSec = 300 }) {
  const parts = String(header).split(",").map(x => x.trim());
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Parts = parts.filter(p => p.startsWith("v1="));

  if (!tPart || !v1Parts.length) return false;

  const timestamp = Number(tPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  // tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

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

  // Stripe может прислать несколько v1 — принимаем любой совпавший
  for (const v1 of v1Parts) {
    const sig = v1.slice(3);
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