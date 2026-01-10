// functions/api/stripe-webhook.js
// Stripe webhook endpoint: POST /api/stripe-webhook
// слушаем checkout.session.completed
// списываем Stock в Airtable

export async function onRequestPost({ env, request }) {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME && !env.AIRTABLE_TABLE) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

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

    if (event?.type !== "checkout.session.completed") {
      return json({ received: true });
    }

    const session = event?.data?.object || {};
    const meta = session?.metadata || {};

    const itemsJson = String(meta.items || "").trim();
    if (!itemsJson) return json({ received: true, note: "No metadata.items" });

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      return json({ received: true, note: "Bad metadata.items JSON" });
    }

    if (!Array.isArray(items) || !items.length) return json({ received: true, note: "Empty items" });

    const table = env.AIRTABLE_TABLE_NAME || env.AIRTABLE_TABLE;

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
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

async function decrementStockByRecordIdSafe({ token, baseId, table, recordId, qty }) {
  // 1) get record to know current Stock
  const getUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const r1 = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const next = Math.max(0, current - qty); // ✅ never negative

  // 2) update Stock
  const r2 = await fetch(getUrl, {
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
 * Stripe-Signature: t=timestamp,v1=signature,...
 */
async function verifyStripeSignature({ payload, header, secret }) {
  const parts = String(header).split(",").map(x => x.trim());
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));
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
    headers: { "Content-Type": "application/json" },
  });
}