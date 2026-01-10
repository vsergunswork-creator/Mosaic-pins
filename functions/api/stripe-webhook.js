// functions/api/stripe-webhook.js
// POST /api/stripe-webhook
// Listen checkout.session.completed
// Decrement Stock in Airtable (never below 0)
//
// Improvements:
// - Proper Stripe signature parsing (multiple v1 signatures)
// - Timestamp tolerance check
// - Constant-time compare
// - Optional deduplication via KV (prevents double stock decrement on retries)

export async function onRequestPost({ env, request }) {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const sigHeader = request.headers.get("stripe-signature");
    if (!sigHeader) return json({ error: "Missing stripe-signature" }, 400);

    // Stripe signs the *raw* request body
    const rawBody = await request.text();

    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sigHeader,
      secret: env.STRIPE_WEBHOOK_SECRET,
      toleranceSeconds: 300, // 5 minutes
    });

    if (!ok) return json({ error: "Invalid signature" }, 400);

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // ✅ Optional dedupe (recommended)
    // Bind a KV namespace as STRIPE_EVENTS_KV to prevent double processing:
    // - Cloudflare Pages -> Settings -> Functions -> KV bindings
    // - Name: STRIPE_EVENTS_KV
    // - Value: your KV namespace
    const kv = env.STRIPE_EVENTS_KV || null;

    const eventId = String(event?.id || "").trim();
    if (kv && eventId) {
      const seen = await kv.get(`stripe_evt_${eventId}`);
      if (seen) {
        return json({ received: true, deduped: true });
      }
    }

    if (event?.type !== "checkout.session.completed") {
      // mark as seen anyway (optional)
      if (kv && eventId) {
        await kv.put(`stripe_evt_${eventId}`, "1", { expirationTtl: 60 * 60 * 24 * 7 }); // 7 days
      }
      return json({ received: true });
    }

    const session = event?.data?.object || {};
    const meta = session?.metadata || {};

    // In your checkout.js you set: metadata.items = JSON.stringify([{recordId,pin,qty},...])
    const itemsJson = String(meta.items || "").trim();
    if (!itemsJson) {
      if (kv && eventId) {
        await kv.put(`stripe_evt_${eventId}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
      }
      return json({ received: true, note: "No metadata.items" });
    }

    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      return json({ received: true, note: "Bad metadata.items JSON" });
    }

    if (!Array.isArray(items) || !items.length) {
      if (kv && eventId) {
        await kv.put(`stripe_evt_${eventId}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
      }
      return json({ received: true, note: "Empty items" });
    }

    // Process sequentially (safer for rate limits)
    for (const it of items) {
      const recordId = String(it?.recordId || "").trim();
      const qty = Math.floor(Number(it?.qty || 0));
      if (!recordId) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      await decrementStockByRecordIdSafe({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: env.AIRTABLE_TABLE_NAME,
        recordId,
        qty,
      });
    }

    // Mark processed (idempotency)
    if (kv && eventId) {
      await kv.put(`stripe_evt_${eventId}`, "1", { expirationTtl: 60 * 60 * 24 * 7 });
    }

    return json({
      received: true,
      dedupe: kv ? "KV enabled" : "KV not configured (risk of double processing on retries)",
    });
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

async function decrementStockByRecordIdSafe({ token, baseId, table, recordId, qty }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;

  // 1) get current stock
  const r1 = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable get failed: ${r1.status} ${JSON.stringify(rec)}`);

  const current = Number(rec?.fields?.Stock ?? 0);
  const next = Math.max(0, (Number.isFinite(current) ? current : 0) - qty);

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

/**
 * Stripe signature verification:
 * header example: "t=169...,v1=abc...,v1=def...,v0=..."
 * Signed payload: `${t}.${rawBody}`
 * HMAC SHA256 using webhook secret
 */
async function verifyStripeSignature({ payload, header, secret, toleranceSeconds = 300 }) {
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return false;

  const { timestamp, signaturesV1 } = parsed;
  if (!timestamp || !signaturesV1.length) return false;

  // Timestamp tolerance (prevents replay attacks)
  const now = Math.floor(Date.now() / 1000);
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(now - t) > Math.max(0, Number(toleranceSeconds) || 0)) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  // Compare with any v1 signature
  for (const sig of signaturesV1) {
    if (safeEqualHex(expected, sig)) return true;
  }
  return false;
}

function parseStripeSignatureHeader(header) {
  const parts = String(header)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  let timestamp = null;
  const signaturesV1 = [];

  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || v == null) continue;
    if (k === "t") timestamp = v;
    if (k === "v1") signaturesV1.push(v);
  }

  return { timestamp, signaturesV1 };
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(String(message)));
  return toHex(mac);
}

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/**
 * Constant-time compare for hex strings (same length)
 */
function safeEqualHex(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;

  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}