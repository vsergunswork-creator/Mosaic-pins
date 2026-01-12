// functions/api/order-shipped-webhook.js
// POST /api/order-shipped-webhook
// Trigger: Airtable Automation when Tracking Number is filled
// Actions:
// 1) Send "Order shipped" email to customer (MailChannels)
// 2) Mark "Shipped Email Sent" checkbox in Airtable Orders
// Idempotency: KV (STRIPE_EVENTS_KV) by orderId OR stripeSessionId

export async function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { env, request } = ctx;
  const headers = corsHeaders(request);

  try {
    // --- Required env ---
    if (!env.STRIPE_EVENTS_KV) return json({ ok: false, error: "STRIPE_EVENTS_KV binding is not set" }, 500, headers);

    if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN is not set" }, 500, headers);
    if (!env.AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID is not set" }, 500, headers);

    // Orders table name (default "Orders")
    const ORDERS_TABLE = String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders");

    // Checkbox field name in Airtable (you created it)
    const SHIPPED_FIELD = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");

    // --- Mail settings ---
    const STORE_NAME = String(env.STORE_NAME || "Mosaic Pins");
    const STORE_URL = String(env.STORE_URL || "https://mosaicpins.space");

    const MAIL_FROM = String(env.MAIL_FROM || "support@mosaicpins.space");
    const MAIL_REPLY_TO = String(env.MAIL_REPLY_TO || "mosaicpinsspace@gmail.com");
    const MAIL_BCC = String(env.MAIL_BCC || ""); // optional

    // Optional security: if set, require header x-webhook-secret
    const REQUIRED_SECRET = String(env.ORDER_SHIPPED_WEBHOOK_SECRET || "").trim();
    if (REQUIRED_SECRET) {
      const got = String(request.headers.get("x-webhook-secret") || "").trim();
      if (got !== REQUIRED_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401, headers);
      }
    }

    // --- Parse body from Airtable webhook ---
    const body = await request.json().catch(() => ({}));

    const orderId = String(body.orderId || "").trim(); // your "Order ID"
    const stripeSessionId = String(body.stripeSessionId || body.stripeSessionID || "").trim(); // optional (if you pass it)
    const customerName = String(body.customerName || "").trim();
    const customerEmail = String(body.customerEmail || "").trim();
    const trackingNumber = String(body.trackingNumber || "").trim();

    const shippingAddress = String(body.shippingAddress || "").trim(); // long text (street)
    const shipCity = String(body.shippingCity || "").trim();
    const shipPostal = String(body.shippingPostal || "").trim();
    const shipState = String(body.shippingState || "").trim();
    const shipCountry = String(body.shippingCountry || "").trim();

    if (!customerEmail) return json({ ok: false, error: "Missing customerEmail" }, 400, headers);
    if (!trackingNumber) return json({ ok: false, error: "Missing trackingNumber" }, 400, headers);

    // Idempotency key: orderId preferred, else stripeSessionId, else email+tracking
    const idKey = orderId || stripeSessionId || `${customerEmail}:${trackingNumber}`;
    const KV_KEY = `shipped_email_sent:${idKey}`;

    const already = await env.STRIPE_EVENTS_KV.get(KV_KEY);
    if (already) {
      return json({ ok: true, skipped: true, reason: "already_sent" }, 200, headers);
    }

    // Find Airtable record by Order ID (or Stripe Session ID if you send it)
    const recordId = await airtableFindOrderRecord({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      orderId,
      stripeSessionId,
    });

    // If record exists and checkbox already true -> skip (extra safety)
    if (recordId) {
      const rec = await airtableGetRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        recordId,
      });

      const sentFlag = Boolean(rec?.fields?.[SHIPPED_FIELD]);
      if (sentFlag) {
        await env.STRIPE_EVENTS_KV.put(KV_KEY, "1", { expirationTtl: 30 * 24 * 60 * 60 });
        return json({ ok: true, skipped: true, reason: "airtable_already_marked" }, 200, headers);
      }
    }

    const subject = `${STORE_NAME}: Your order has been shipped 🚚`;

    const { html, text } = buildShippedEmail({
      storeName: STORE_NAME,
      storeUrl: STORE_URL,
      customerName,
      orderId: orderId || stripeSessionId || "-",
      trackingNumber,
      shippingAddress,
      shipCity,
      shipPostal,
      shipState,
      shipCountry,
    });

    // Send email
    await sendEmailMailchannels({
      from: MAIL_FROM,
      to: customerEmail,
      replyTo: MAIL_REPLY_TO || undefined,
      bcc: MAIL_BCC || undefined,
      subject,
      html,
      text,
    });

    // Mark idempotency
    await env.STRIPE_EVENTS_KV.put(KV_KEY, "1", { expirationTtl: 30 * 24 * 60 * 60 });

    // Mark Airtable checkbox
    if (recordId) {
      await airtablePatchRecord({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        recordId,
        fields: { [SHIPPED_FIELD]: true },
      });
    }

    return json({ ok: true, email_sent: true, recordId: recordId || null }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

/* =========================
   Email via MailChannels
========================= */
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

  const respText = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`Mail send failed: ${r.status} ${respText}`);
}

/* =========================
   Email content (Variant 1)
========================= */
function buildShippedEmail({
  storeName,
  storeUrl,
  customerName,
  orderId,
  trackingNumber,
  shippingAddress,
  shipCity,
  shipPostal,
  shipState,
  shipCountry,
}) {
  const hello = customerName ? `Hello ${customerName}!` : "Hello!";

  const addressBlock = formatAddress({
    shippingAddress,
    shipCity,
    shipPostal,
    shipState,
    shipCountry,
  });

  const text =
`${hello}

Good news — your order has been shipped 🚚

Order ID: ${orderId}
Tracking Number: ${trackingNumber}

Shipping address:
${addressBlock || "-"}

If you have any questions, just reply to this email.

${storeUrl || storeName}
`;

  const html =
`<div style="font-family:Arial,sans-serif;line-height:1.45;color:#111">
  <h2 style="margin:0 0 12px">${escapeHtml(storeName)} — Order shipped 🚚</h2>
  <p style="margin:0 0 10px">${escapeHtml(hello)}</p>

  <p style="margin:0 0 12px">Good news — your order has been shipped.</p>

  <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;margin:12px 0">
    <div><b>Order ID:</b> ${escapeHtml(orderId)}</div>
    <div style="margin-top:6px"><b>Tracking Number:</b> ${escapeHtml(trackingNumber)}</div>
  </div>

  <p style="margin:12px 0 6px"><b>Shipping address:</b></p>
  <div style="white-space:pre-line;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;background:#fff">${escapeHtml(addressBlock || "-")}</div>

  <p style="margin:14px 0 8px">If you have any questions, just reply to this email.</p>

  ${storeUrl ? `<p style="margin:0"><a href="${escapeHtml(storeUrl)}">${escapeHtml(storeUrl)}</a></p>` : ""}
</div>`;

  return { html, text };
}

function formatAddress({ shippingAddress, shipCity, shipPostal, shipState, shipCountry }) {
  const lines = [];

  if (shippingAddress) {
    // keep multiline from Airtable
    lines.push(String(shippingAddress).trim());
  }

  const cityLine = [shipPostal, shipCity].filter(Boolean).join(" ");
  const regionLine = [shipState, shipCountry].filter(Boolean).join(" ");

  if (cityLine) lines.push(cityLine);
  if (regionLine) lines.push(regionLine);

  return lines.filter(Boolean).join("\n").trim();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================
   Airtable helpers
========================= */
async function airtableFindOrderRecord({ token, baseId, table, orderId, stripeSessionId }) {
  // Prefer exact match by Stripe Session ID if provided, else by Order ID
  let formula = "";

  if (stripeSessionId) {
    formula = `{Stripe Session ID}="${String(stripeSessionId).replace(/"/g, '\\"')}"`;
  } else if (orderId) {
    formula = `{Order ID}="${String(orderId).replace(/"/g, '\\"')}"`;
  } else {
    return null;
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable find failed: ${r.status} ${JSON.stringify(data)}`);

  const rec = data?.records?.[0];
  return rec?.id || null;
}

async function airtableGetRecord({ token, baseId, table, recordId }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable get failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtablePatchRecord({ token, baseId, table, recordId, fields }) {
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
  if (!r.ok) throw new Error(`Airtable patch failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

/* =========================
   CORS + JSON
========================= */
function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-webhook-secret",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-webhook-secret",
    "Vary": "Origin",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}