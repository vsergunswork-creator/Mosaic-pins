// functions/api/stripe-email-webhook.js
// POST /api/stripe-email-webhook
// слушаем checkout.session.completed
// ✅ НЕ трогаем Airtable вообще (ни create, ни update)
// ✅ отправляем письмо клиенту от MAIL_FROM (например support@mosaicpins.space)
// ✅ Reply-To на Gmail (MAIL_REPLY_TO)
// идемпотентность: KV (STRIPE_EVENTS_KV) по eventId + по sessionId

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  try {
    // --- ENV checks ---
    if (!env.STRIPE_EMAIL_WEBHOOK_SECRET) {
      return json({ error: "STRIPE_EMAIL_WEBHOOK_SECRET is not set" }, 500);
    }
    if (!env.STRIPE_EVENTS_KV) {
      return json({ error: "STRIPE_EVENTS_KV binding is not set" }, 500);
    }

    // optional: fallback billing address from PaymentIntent (если нужно)
    const STRIPE_SECRET_KEY = String(env.STRIPE_SECRET_KEY || "").trim();

    const STORE_NAME = String(env.STORE_NAME || "Mosaic Pins");
    const STORE_URL = String(env.STORE_URL || "https://mosaicpins.space");

    const MAIL_FROM = String(env.MAIL_FROM || "support@mosaicpins.space").trim();
    const MAIL_REPLY_TO = String(env.MAIL_REPLY_TO || "mosaicpinsspace@gmail.com").trim();
    const MAIL_BCC = String(env.MAIL_BCC || "").trim(); // optional

    const sig = request.headers.get("stripe-signature");
    if (!sig) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await request.text();

    // --- verify signature (IMPORTANT: use STRIPE_EMAIL_WEBHOOK_SECRET) ---
    const ok = await verifyStripeSignature({
      payload: rawBody,
      header: sig,
      secret: String(env.STRIPE_EMAIL_WEBHOOK_SECRET).trim(),
      toleranceSec: 5 * 60,
    });
    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(rawBody);
    const eventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();

    if (!eventId) return json({ received: true, note: "Missing event.id" });

    // --- event idempotency (eventId) ---
    const EVT_KEY = `stripe_evt_email:${eventId}`;
    const prev = await env.STRIPE_EVENTS_KV.get(EVT_KEY);
    if (prev === "done") return json({ received: true, duplicate: true });

    // set processing (чтобы при параллельных доставках не было гонки)
    if (prev === "processing") return json({ received: true, processing: true }, 409);
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "processing", { expirationTtl: 30 * 60 });

    // only checkout.session.completed
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

    // --- customer data ---
    const customerEmail = String(session?.customer_details?.email || "").trim();
    const customerName =
      String(session?.customer_details?.name || "").trim() ||
      String(session?.shipping_details?.name || "").trim() ||
      String(session?.collected_information?.shipping_details?.name || "").trim() ||
      "";

    if (!customerEmail) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, note: "No customer email" });
    }

    // --- address: PRIORITY = collected_information.shipping_details.address ---
    const addrFromCollected = session?.collected_information?.shipping_details?.address || null;
    const addrFromShipping = session?.shipping_details?.address || null;

    const paymentIntentId = String(session?.payment_intent || "").trim();
    let addrFromBilling = null;

    // optional fallback (если по какой-то причине нет shipping в session)
    if (!addrFromCollected && !addrFromShipping && paymentIntentId && STRIPE_SECRET_KEY) {
      try {
        const pi = await stripeRetrievePaymentIntent({
          secretKey: STRIPE_SECRET_KEY,
          paymentIntentId,
        });
        const charge0 = pi?.charges?.data?.[0] || null;
        addrFromBilling = charge0?.billing_details?.address || null;
      } catch (_) {
        // ignore
      }
    }

    const addr = addrFromCollected || addrFromShipping || addrFromBilling;

    const shipCountry = addr?.country ? String(addr.country).trim() : "";
    const shipCity = addr?.city ? String(addr.city).trim() : "";
    const shipPostal = addr?.postal_code ? String(addr.postal_code).trim() : "";
    const shipState = addr?.state ? String(addr.state).trim() : "";

    const line1 = addr?.line1 ? String(addr.line1).trim() : "";
    const line2 = addr?.line2 ? String(addr.line2).trim() : "";
    const shippingAddressLong = [line1, line2].filter(Boolean).join("\n");

    // --- cart info from metadata.items (если есть) ---
    const meta = session?.metadata || {};
    const itemsJson = String(meta.items || "").trim();
    let items = [];
    if (itemsJson) {
      try {
        const parsed = JSON.parse(itemsJson);
        if (Array.isArray(parsed)) items = parsed;
      } catch (_) {}
    }
    const normalizedItems = normalizeItemsForEmail(items);

    const currency = String(session?.currency || "").toUpperCase() || "EUR";
    const amountTotalCents = Number(session?.amount_total ?? 0);
    const amountTotal = Number.isFinite(amountTotalCents) ? amountTotalCents / 100 : 0;

    // --- session idempotency (чтобы resend не спамил) ---
    const EMAIL_KEY = `email_sent:${sessionId || eventId}`;
    const already = await env.STRIPE_EVENTS_KV.get(EMAIL_KEY);
    if (already) {
      await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });
      return json({ received: true, email_already_sent: true });
    }

    // --- build & send email ---
    const subject = `${STORE_NAME}: Order confirmed`;

    const { html, text } = buildOrderEmail({
      storeName: STORE_NAME,
      storeUrl: STORE_URL,
      sessionId,
      paymentIntentId,
      customerName,
      currency,
      amountTotal,
      items: normalizedItems,
      shippingAddressLong,
      shipCity,
      shipPostal,
      shipCountry,
      shipState,
    });

    await sendEmailMailchannels({
      from: MAIL_FROM,
      to: customerEmail,
      replyTo: MAIL_REPLY_TO || undefined,
      bcc: MAIL_BCC || undefined,
      subject,
      html,
      text,
    });

    // mark done
    await env.STRIPE_EVENTS_KV.put(EMAIL_KEY, "1", { expirationTtl: 30 * 24 * 60 * 60 });
    await env.STRIPE_EVENTS_KV.put(EVT_KEY, "done", { expirationTtl: 30 * 24 * 60 * 60 });

    return json({ received: true, email_sent: true });
  } catch (e) {
    return json({ error: "Webhook error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Email via MailChannels ----------------
async function sendEmailMailchannels({ from, to, subject, html, text, replyTo, bcc }) {
  const payload = {
    personalizations: [
      {
        to: [{ email: to }],
        ...(bcc ? { bcc: [{ email: bcc }] } : {}),
      },
    ],
    from: { email: from },
    subject,
    content: [
      { type: "text/plain", value: text || "" },
      { type: "text/html", value: html || "" },
    ],
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
  };

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`Mail send failed: ${r.status} ${data}`);
}

// ---------------- Email content ----------------
function buildOrderEmail({
  storeName,
  storeUrl,
  sessionId,
  paymentIntentId,
  customerName,
  currency,
  amountTotal,
  items,
  shippingAddressLong,
  shipCity,
  shipPostal,
  shipCountry,
  shipState,
}) {
  const itemsLines = (items || []).length
    ? items.map((it) => `• ${it.title} × ${it.qty}`).join("\n")
    : "-";

  const shippingOneLine = [
    shippingAddressLong?.replace(/\n/g, ", "),
    shipPostal,
    shipCity,
    shipState,
    shipCountry,
  ]
    .filter(Boolean)
    .join(", ");

  const text =
`Hello${customerName ? " " + customerName : ""}!

Your order is confirmed ✅

Order ID: ${sessionId || "-"}
Payment Intent: ${paymentIntentId || "-"}

Items:
${itemsLines}

Total: ${Number(amountTotal).toFixed(2)} ${currency}

Shipping address:
${shippingOneLine || "-"}

If you have any questions, just reply to this email.

${storeUrl || storeName}
`;

  const htmlItems = (items || []).length
    ? items.map((it) => `<li><b>${escapeHtml(it.title)}</b> × ${it.qty}</li>`).join("")
    : "<li>-</li>";

  const html =
`<div style="font-family:Arial,sans-serif;line-height:1.45">
  <h2 style="margin:0 0 12px">${escapeHtml(storeName)} — Order confirmed ✅</h2>
  <p>Hello${customerName ? " " + escapeHtml(customerName) : ""}!</p>

  <p>Your order is confirmed.</p>

  <p style="margin:12px 0">
    <b>Order ID:</b> ${escapeHtml(sessionId || "-")}<br/>
    <b>Payment Intent:</b> ${escapeHtml(paymentIntentId || "-")}
  </p>

  <p style="margin:12px 0"><b>Items:</b></p>
  <ul style="margin:6px 0 12px 18px">${htmlItems}</ul>

  <p style="margin:12px 0">
    <b>Total:</b> ${Number(amountTotal).toFixed(2)} ${escapeHtml(currency)}
  </p>

  <p style="margin:12px 0"><b>Shipping address:</b><br/>
    ${escapeHtml(shippingAddressLong || "").replace(/\n/g, "<br/>")}
    ${shippingAddressLong ? "<br/>" : ""}
    ${escapeHtml([shipPostal, shipCity, shipState, shipCountry].filter(Boolean).join(" "))}
  </p>

  <p>If you have any questions, just reply to this email.</p>

  ${storeUrl ? `<p><a href="${escapeHtml(storeUrl)}">${escapeHtml(storeUrl)}</a></p>` : ""}
</div>`;

  return { html, text };
}

function normalizeItemsForEmail(items) {
  // ожидаем [{pin,qty}] или [{recordId,pin,qty}]
  const map = new Map(); // key->qty
  for (const it of Array.isArray(items) ? items : []) {
    const pin = String(it?.pin || "").trim();
    const recordId = String(it?.recordId || "").trim();
    const qty = Math.floor(Number(it?.qty || 0));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const key = pin || recordId;
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + qty);
  }

  return [...map.entries()].map(([key, qty]) => ({
    title: key, // можно заменить на красивое название (если захотите fetch из Airtable, но сейчас НЕ трогаем Airtable)
    qty,
  }));
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------- Stripe API helper (optional fallback) ----------------
async function stripeRetrievePaymentIntent({ secretKey, paymentIntentId }) {
  const url = new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  url.searchParams.set("expand[0]", "charges.data");

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${secretKey}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe retrieve PI failed: ${r.status} ${data?.error?.message || ""}`);
  return data;
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