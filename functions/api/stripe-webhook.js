// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// Stripe sends raw body + signature header.

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
  const AIRTABLE_API_KEY = env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = env.AIRTABLE_TABLE || env.AIRTABLE_TABLE_NAME || "Products";

  if (!STRIPE_WEBHOOK_SECRET || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
    return new Response("Webhook env not configured", { status: 500 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400 });

  const rawBody = await request.text();

  // 1) Verify signature
  const ok = await stripeVerifyWebhookSignature({
    payload: rawBody,
    signatureHeader: sig,
    secret: STRIPE_WEBHOOK_SECRET,
  });

  if (!ok) return new Response("Invalid signature", { status: 400 });

  // 2) Parse event
  const event = JSON.parse(rawBody);

  // Нам важен успешный платёж:
  // checkout.session.completed
  if (event?.type !== "checkout.session.completed") {
    return new Response("Ignored", { status: 200 });
  }

  const session = event?.data?.object;
  const meta = session?.metadata || {};
  const itemsStr = meta.items || "[]";

  let items = [];
  try {
    items = JSON.parse(itemsStr);
    if (!Array.isArray(items)) items = [];
  } catch (_) {
    items = [];
  }

  if (!items.length) {
    return new Response("No items", { status: 200 });
  }

  // 3) Update Airtable stock: Stock = max(0, Stock - qty)
  for (const it of items) {
    const recordId = String(it?.recordId || "").trim();
    const qty = Number(it?.qty || 0);

    if (!recordId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    // читаем текущий Stock
    const current = await airtableGetRecord({
      apiKey: AIRTABLE_API_KEY,
      baseId: AIRTABLE_BASE_ID,
      table: AIRTABLE_TABLE,
      recordId,
    });

    const fields = current?.fields || {};
    const stockNow = Number(fields.Stock ?? 0);
    const safeNow = Number.isFinite(stockNow) ? stockNow : 0;

    const next = Math.max(0, safeNow - Math.floor(qty));

    // пишем обратно
    await airtablePatchRecord({
      apiKey: AIRTABLE_API_KEY,
      baseId: AIRTABLE_BASE_ID,
      table: AIRTABLE_TABLE,
      recordId,
      fields: { Stock: next },
    });
  }

  return new Response("OK", { status: 200 });
}

// ---------------- Helpers ----------------

async function airtableGetRecord({ apiKey, baseId, table, recordId }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Airtable get failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function airtablePatchRecord({ apiKey, baseId, table, recordId, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`Airtable patch failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// Stripe webhook signature verification (HMAC SHA256) for Cloudflare Workers
async function stripeVerifyWebhookSignature({ payload, signatureHeader, secret }) {
  // Header looks like: "t=123456,v1=abcdef,v0=..."
  const parts = String(signatureHeader).split(",").map((s) => s.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));

  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const sig = v1Part.slice(3);

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  // timing safe compare
  return timingSafeEqualHex(expected, sig);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufToHex(sig);
}

function bufToHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function timingSafeEqualHex(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;

  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}