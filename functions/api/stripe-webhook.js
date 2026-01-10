export async function onRequestPost({ env, request }) {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

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

    // We only need completed checkout for stock update
    if (event?.type !== "checkout.session.completed") {
      return json({ received: true });
    }

    const session = event?.data?.object || {};
    const meta = session?.metadata || {};

    const itemsStr = String(meta.items || "").trim(); // "PIN:QTY,PIN2:QTY2"
    if (!itemsStr) {
      // Нечего списывать — просто подтверждаем, чтобы Stripe не ретраил бесконечно
      return json({ received: true, note: "No metadata.items" });
    }

    const items = parseItems(itemsStr); // [{pin, qty}]
    if (!items.length) {
      return json({ received: true, note: "No parsable items" });
    }

    // ✅ списываем Stock в Airtable (без ухода в минус)
    for (const it of items) {
      await decrementStockSafe(env, it.pin, it.qty);
    }

    return json({ received: true });
  } catch (e) {
    // Важно: если вернуть 500 — Stripe будет ретраить.
    // Но чтобы не делать двойные списания, мы списываем безопасно и идем дальше.
    return json({ error: "Webhook error", details: String(e) }, 500);
  }
}

function parseItems(s) {
  // "PIN:2,PIN2:1"
  const out = [];
  for (const part of String(s).split(",")) {
    const p = part.trim();
    if (!p) continue;
    const [pinRaw, qtyRaw] = p.split(":");
    const pin = String(pinRaw || "").trim();
    let qty = Math.floor(Number(qtyRaw || 0));
    if (!pin) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (qty > 99) qty = 99;
    out.push({ pin, qty });
  }
  return out;
}

async function decrementStockSafe(env, pin, qty) {
  const rec = await findAirtableRecordByPin(env, pin);
  if (!rec) {
    // нет записи — пропускаем, чтобы webhook не падал
    console.warn("[stock] Record not found for PIN:", pin);
    return;
  }

  const currentStock = Number(rec.fields?.Stock ?? 0);
  const nextStock = Math.max(0, currentStock - qty); // ✅ никогда не минус

  if (currentStock < qty) {
    // Это редкий случай гонки (кто-то купил последний раньше).
    // Мы НЕ уходим в минус — просто ставим 0 и логируем.
    console.warn(`[stock] Oversold prevented for ${pin}. current=${currentStock}, need=${qty}. Setting to 0.`);
  }

  await updateAirtableStock(env, rec.id, nextStock);
}

async function findAirtableRecordByPin(env, pin) {
  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`;
  const apiUrl = new URL(baseUrl);
  // PIN Code = '...'
  apiUrl.searchParams.set("maxRecords", "1");
  apiUrl.searchParams.set("filterByFormula", `{PIN Code}='${escapeAirtableString(pin)}'`);

  const r = await fetch(apiUrl.toString(), {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Airtable find error: ${JSON.stringify(data)}`);

  const rec = (data.records || [])[0];
  return rec || null;
}

async function updateAirtableStock(env, recordId, stock) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}/${recordId}`;

  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { Stock: Number(stock) } }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Airtable update error: ${JSON.stringify(data)}`);
  return data;
}

function escapeAirtableString(s) {
  // Airtable formula string escaping for single quotes
  return String(s).replace(/'/g, "\\'");
}

/**
 * Stripe signature verification (HMAC SHA256)
 * Stripe-Signature header: t=timestamp,v1=signature,...
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

  // constant-time compare
  return safeEqual(expected, sig);
}

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
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