export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runShipCheck(env));
  },

  // опционально: ручной запуск из браузера для теста
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ship-check") {
      const got = request.headers.get("x-cron-secret") || url.searchParams.get("secret") || "";
      if (String(env.CRON_SECRET || "") && got !== env.CRON_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const res = await runShipCheck(env);
      return json(res, 200);
    }
    return json({ ok: true, note: "Use /ship-check for manual test" }, 200);
  },
};

async function runShipCheck(env) {
  // ---- required env ----
  if (!env.STRIPE_EVENTS_KV) return { ok: false, error: "STRIPE_EVENTS_KV binding missing" };

  if (!env.AIRTABLE_TOKEN) return { ok: false, error: "AIRTABLE_TOKEN missing" };
  if (!env.AIRTABLE_BASE_ID) return { ok: false, error: "AIRTABLE_BASE_ID missing" };

  const ORDERS_TABLE = String(env.AIRTABLE_ORDERS_TABLE_NAME || "Orders");
  const TRACKING_FIELD = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const SHIPPED_FIELD = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");

  const MAIL_FROM = String(env.MAIL_FROM || "").trim();
  if (!MAIL_FROM) return { ok: false, error: "MAIL_FROM missing" };

  const STORE_NAME = String(env.STORE_NAME || "Mosaic Pins");
  const STORE_URL = String(env.STORE_URL || "https://mosaicpins.space");

  const MAIL_REPLY_TO = String(env.MAIL_REPLY_TO || "").trim();
  const MAIL_BCC = String(env.MAIL_BCC || "").trim();

  // AND({Tracking Number}!="", NOT({Shipped Email Sent}))
  const formula = `AND({${TRACKING_FIELD}}!="", NOT({${SHIPPED_FIELD}}))`;

  const records = await airtableFetchAll({
    token: env.AIRTABLE_TOKEN,
    baseId: env.AIRTABLE_BASE_ID,
    table: ORDERS_TABLE,
    filterByFormula: formula,
    pageSize: 50,
    maxPagesGuard: 10,
  });

  let sent = 0;
  let skipped = 0;
  const details = [];

  for (const rec of records) {
    const recordId = rec?.id;
    const f = rec?.fields || {};
    if (!recordId) continue;

    const tracking = String(f[TRACKING_FIELD] || "").trim();
    const customerEmail = String(f["Customer Email"] || "").trim();
    const customerName = String(f["Customer Name"] || "").trim();
    const orderId = String(f["Order ID"] || f["Stripe Session ID"] || recordId).trim();

    if (!tracking || !customerEmail) {
      skipped++;
      details.push({ recordId, orderId, skipped: true, reason: "missing_tracking_or_email" });
      continue;
    }

    // KV idempotency
    const KV_KEY = `shipped_email_sent:${recordId}`;
    const already = await env.STRIPE_EVENTS_KV.get(KV_KEY);
    if (already) {
      skipped++;
      details.push({ recordId, orderId, skipped: true, reason: "kv_already_sent" });
      continue;
    }

    const shippingAddress = String(f["Shipping Address"] || "").trim();
    const shipCity = String(f["Shipping City"] || "").trim();
    const shipPostal = String(f["Shipping Postal Code"] || "").trim();
    const shipState = String(f["Shipping State/Region"] || "").trim();
    const shipCountry = String(f["Shipping Country"] || "").trim();

    const subject = `${STORE_NAME}: Your order has been shipped 🚚`;
    const { html, text } = buildShippedEmail({
      storeName: STORE_NAME,
      storeUrl: STORE_URL,
      customerName,
      orderId,
      trackingNumber: tracking,
      shippingAddress,
      shipCity,
      shipPostal,
      shipState,
      shipCountry,
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

    await airtablePatchRecord({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      recordId,
      fields: { [SHIPPED_FIELD]: true },
    });

    await env.STRIPE_EVENTS_KV.put(KV_KEY, "1", { expirationTtl: 30 * 24 * 60 * 60 });

    sent++;
    details.push({ recordId, orderId, sent: true });
  }

  return { ok: true, found: records.length, sent, skipped, details };
}

// ---------------- MailChannels ----------------
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

  const addressBlock = formatAddress({ shippingAddress, shipCity, shipPostal, shipState, shipCountry });

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
  if (shippingAddress) lines.push(String(shippingAddress).trim());
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

// ---------------- Airtable helpers ----------------
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

async function airtableFetchAll({ token, baseId, table, filterByFormula, pageSize = 100, maxPagesGuard = 60 }) {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

  let all = [];
  let offset = null;

  for (let page = 0; page < maxPagesGuard; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable error: ${JSON.stringify(data)}`);

    const records = Array.isArray(data.records) ? data.records : [];
    all = all.concat(records);

    offset = data.offset || null;
    if (!offset) break;
  }

  return all;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}