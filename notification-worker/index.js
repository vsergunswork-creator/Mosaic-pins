// Mosaic Pins notification worker — self-contained Cloudflare Worker.
// Keeps paid/shipped email sweeps and also triggers Etsy review sync.


export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledJobs(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/run") {
      return json({ ok: true, info: "Notification worker is active. Use /run?secret=... for a manual check." });
    }
    const required = String(env.CRON_SECRET || "").trim();
    const got = String(url.searchParams.get("secret") || request.headers.get("x-cron-secret") || "").trim();
    if (!required || got !== required) return json({ ok: false, error: "Unauthorized" }, 401);
    try {
      return json({ ok: true, ...(await runScheduledJobs(env)) });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  },
};

async function runScheduledJobs(env) {
  const notifications = await runNotificationSweep(env, { maxRecords: 25 });
  let etsySync = { ok: false, skipped: true };
  try {
    const secret = String(env.CRON_SECRET || "").trim();
    const syncUrl = String(env.ETSY_SYNC_URL || "").trim();
    if (!secret) throw new Error("CRON_SECRET is not set");
    if (!syncUrl) throw new Error("ETSY_SYNC_URL is not set");
    const r = await fetch(syncUrl, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const data = await r.json().catch(() => ({}));
    etsySync = { ok: r.ok, httpStatus: r.status, ...data };
  } catch (e) {
    etsySync = { ok: false, error: String(e?.message || e) };
  }
  return { notifications, etsySync };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Shared Airtable Orders access for Mosaic Pins.
// Keep all order-table field plumbing in one place so Stripe, PayPal and notifications stay consistent.

function ordersTable(env) {
  return String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders").trim();
}

function requireOrdersEnv(env) {
  const token = String(env.AIRTABLE_TOKEN || "").trim();
  const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  return { token, baseId, table: ordersTable(env) };
}

async function createOrderRecord(env, fields) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ fields }),
  });
  return parseOrThrow(r, "Airtable order create");
}

async function updateOrderRecord(env, recordId, fields) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    headers: authHeaders(token, true),
    body: JSON.stringify({ fields }),
  });
  return parseOrThrow(r, "Airtable order update");
}

async function getOrderRecord(env, recordId) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(r, "Airtable order read");
}

async function findOrderByField(env, fieldName, value) {
  value = String(value || "").trim();
  if (!value) return null;
  const out = await listOrderRecords(env, {
    filterByFormula: `{${fieldName}}='${escapeFormulaString(value)}'`,
    maxRecords: 1,
  });
  return out.records?.[0] || null;
}

async function listOrderRecords(env, { filterByFormula = "", maxRecords = 25, pageSize = 100 } = {}) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const records = [];
  let offset = null;
  let guard = 0;
  const cap = Math.max(1, Math.floor(Number(maxRecords || 25)));

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(Math.min(100, pageSize)));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), { headers: authHeaders(token) });
    const data = await parseOrThrow(r, "Airtable order list");
    records.push(...(Array.isArray(data.records) ? data.records : []));
    if (records.length >= cap) break;
    offset = data.offset || null;
    guard++;
    if (guard > 20) throw new Error("Airtable orders pagination guard exceeded");
  } while (offset);

  return { records: records.slice(0, cap) };
}

function niceOrderId(rec, env = {}) {
  const f = rec?.fields || {};
  const codeField = String(env.AIRTABLE_ORDER_CODE_FIELD || env.AIRTABLE_ORDER_ID_FIELDI || "OrderCode");
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(f[codeField] || f[idField] || f[stripeField] || rec?.id || "").trim();
}

function escapeFormulaString(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function authHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseOrThrow(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${safeJson(data)}`);
  return data;
}

function safeJson(x) {
  try { return JSON.stringify(x); } catch (_) { return String(x); }
}

// One mail transport + one set of customer email templates for the whole shop.

async function sendStoreEmail(env, { to, subject, text, html }) {
  const from = String(env.MAIL_FROM || "support@mosaicpins.space").trim();
  const replyTo = String(env.MAIL_REPLY_TO || "mosaicpinsspace@gmail.com").trim();
  const bcc = String(env.MAIL_BCC || "").trim();
  if (!from) throw new Error("MAIL_FROM is not set");
  if (!to) throw new Error("Recipient email is missing");

  const payload = {
    personalizations: [{
      to: [{ email: to }],
      ...(bcc ? { bcc: [{ email: bcc }] } : {}),
    }],
    from: { email: from },
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
    subject,
    content: [
      { type: "text/plain", value: text || "" },
      { type: "text/html", value: html || "" },
    ],
  };

  const headers = { "Content-Type": "application/json" };
  if (env.MAILCHANNELS_API_KEY) headers["X-Api-Key"] = env.MAILCHANNELS_API_KEY;

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`MailChannels failed: ${r.status} ${body}`);
}

function buildPaidEmail(env, { name, orderId, amount, currency }) {
  const store = String(env.STORE_NAME || "Mosaic Pins");
  const amountLine = amount !== undefined && amount !== null && String(amount).trim() !== ""
    ? `${amount} ${String(currency || "").trim()}`.trim()
    : "";
  const subject = `${store}: Thanks for your order 💚`;
  const text = `Hello ${name || "friend"},\n\nThank you for your order ${orderId}!\nWe’ve received your payment and your order is now in processing.\n${amountLine ? `\nTotal: ${amountLine}\n` : ""}\nWe’ll email you again as soon as your order is shipped.\n\nIf you have any questions, just reply to this email.\n`;
  const html = shell(store, "Order confirmation", `
    <div style="font-size:18px;font-weight:900;margin-bottom:10px;">Hello ${escapeHtml(name || "friend")},</div>
    <div style="color:#a8b3c7;font-size:14px;line-height:1.5;margin-bottom:16px;">Thank you for your order <b style="color:#e9eef7;">${escapeHtml(orderId)}</b> ✅<br/>We’ve received your payment. Your order is being processed now.</div>
    <div style="border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);border-radius:16px;padding:14px;">
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">Order</div>
      <div style="font-size:15px;font-weight:900;${amountLine ? "margin-bottom:12px;" : ""}">${escapeHtml(orderId)}</div>
      ${amountLine ? `<div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">Total</div><div style="font-size:15px;font-weight:900;">${escapeHtml(amountLine)}</div>` : ""}
    </div>
    <div style="color:#a8b3c7;font-size:13px;margin-top:16px;">We’ll email you again as soon as your order is shipped.<br/>If you have any questions, just reply to this email.</div>
  `);
  return { subject, text, html };
}

function buildShippedEmail(env, { name, orderId, tracking, carrier }) {
  const store = String(env.STORE_NAME || "Mosaic Pins");
  const subject = `${store}: Your order has been shipped 🚚`;
  const text = `Hello ${name || "friend"},\n\nGood news — your order ${orderId} has been shipped 🚚📦\n\nCarrier: ${carrier}\nTracking number: ${tracking}\n\nThank you for your purchase!\n`;
  const html = shell(store, "Shipping update", `
    <div style="font-size:18px;font-weight:900;margin-bottom:10px;">Hello ${escapeHtml(name || "friend")},</div>
    <div style="color:#a8b3c7;font-size:14px;line-height:1.5;margin-bottom:16px;">Good news — your order <b style="color:#e9eef7;">${escapeHtml(orderId)}</b> has been shipped 🚚📦</div>
    <div style="border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);border-radius:16px;padding:14px;">
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">Carrier</div>
      <div style="font-size:15px;font-weight:900;margin-bottom:12px;">${escapeHtml(carrier)}</div>
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">Tracking number</div>
      <div style="font-size:15px;font-weight:900;letter-spacing:.4px;word-break:break-word;">${escapeHtml(tracking)}</div>
    </div>
    <div style="color:#a8b3c7;font-size:13px;margin-top:16px;">If you have any questions, just reply to this email.</div>
  `);
  return { subject, text, html };
}

function shell(store, subtitle, body) {
  return `<div style="background:#0b0d11;padding:24px;font-family:Arial,sans-serif;color:#e9eef7;">
  <div style="max-width:520px;margin:0 auto;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));box-shadow:0 12px 30px rgba(0,0,0,.45);overflow:hidden;">
    <div style="padding:18px;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(34,197,94,.14),rgba(0,0,0,0));">
      <div style="font-weight:900;font-size:16px;letter-spacing:.2px;">🟢 ${escapeHtml(store)}</div>
      <div style="color:#a8b3c7;font-size:13px;margin-top:4px;">${escapeHtml(subtitle)}</div>
    </div>
    <div style="padding:20px;">${body}</div>
    <div style="padding:14px 18px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.25);color:#a8b3c7;font-size:12px;text-align:center;">Thank you for your purchase 💚</div>
  </div>
</div>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


async function sendPaidEmailForRecord(env, rec, { recheck = true } = {}) {
  if (!rec?.id) return { sent: false, reason: "missing_record" };
  if (recheck) rec = await getOrderRecord(env, rec.id);
  const f = rec.fields || {};
  const sentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  if (f[sentField] === true) return { sent: false, reason: "already_sent" };
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  if (String(f[statusField] || "").toLowerCase() !== String(env.PAID_STATUS_VALUE || "paid").toLowerCase()) {
    return { sent: false, reason: "not_paid" };
  }
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email");
  const nameField = String(env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name");
  const amountField = String(env.AIRTABLE_AMOUNT_FIELD || "Amount Total");
  const currencyField = String(env.AIRTABLE_CURRENCY_FIELD || "Currency");
  const to = String(f[emailField] || "").trim();
  if (!to) return { sent: false, reason: "missing_email" };

  const msg = buildPaidEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    amount: f[amountField],
    currency: f[currencyField],
  });
  await sendStoreEmail(env, { to, ...msg });
  await updateOrderRecord(env, rec.id, { [sentField]: true });
  return { sent: true, to, orderId: niceOrderId(rec, env) };
}

async function sendShippedEmailForRecord(env, rec, { recheck = true } = {}) {
  if (!rec?.id) return { sent: false, reason: "missing_record" };
  if (recheck) rec = await getOrderRecord(env, rec.id);
  const f = rec.fields || {};
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const sentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  if (f[sentField] === true) return { sent: false, reason: "already_sent" };
  const tracking = String(f[trackingField] || "").trim();
  if (!tracking) return { sent: false, reason: "missing_tracking" };
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email");
  const nameField = String(env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name");
  const to = String(f[emailField] || "").trim();
  if (!to) return { sent: false, reason: "missing_email" };

  const carrierField = String(env.AIRTABLE_CARRIER_FIELD || "").trim();
  const carrier = carrierField && f[carrierField] ? String(f[carrierField]).trim() : "DPD / DHL";
  const msg = buildShippedEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    tracking,
    carrier,
  });
  await sendStoreEmail(env, { to, ...msg });
  await updateOrderRecord(env, rec.id, { [sentField]: true });
  return { sent: true, to, orderId: niceOrderId(rec, env), tracking };
}

async function runPaidSweep(env, { maxRecords = 20 } = {}) {
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const sentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const formula = `AND({${statusField}}='${paidValue}', NOT({${sentField}}))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });
  return process(list.records || [], (rec) => sendPaidEmailForRecord(env, rec));
}

async function runShippedSweep(env, { maxRecords = 20 } = {}) {
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const sentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  const formula = `AND({${trackingField}}!='', NOT({${sentField}}))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });
  return process(list.records || [], (rec) => sendShippedEmailForRecord(env, rec));
}

async function runNotificationSweep(env, { maxRecords = 25 } = {}) {
  // One Airtable list request per cron run instead of two.
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const paidSentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const shippedSentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const formula = `OR(AND({${statusField}}='${paidValue}', NOT({${paidSentField}})), AND({${trackingField}}!='', NOT({${shippedSentField}})))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });

  const paidResults = [];
  const shippedResults = [];
  let paidSent = 0, paidSkipped = 0, shippedSent = 0, shippedSkipped = 0;

  for (const rec of list.records || []) {
    const f = rec.fields || {};
    const paidPending = String(f[statusField] || "").toLowerCase() === String(env.PAID_STATUS_VALUE || "paid").toLowerCase() && f[paidSentField] !== true;
    const shippedPending = Boolean(String(f[trackingField] || "").trim()) && f[shippedSentField] !== true;

    if (paidPending) {
      try { const out = await sendPaidEmailForRecord(env, rec); paidResults.push({ id: rec.id, ...out }); out.sent ? paidSent++ : paidSkipped++; }
      catch (e) { paidSkipped++; paidResults.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) }); }
    }
    if (shippedPending) {
      try { const out = await sendShippedEmailForRecord(env, rec); shippedResults.push({ id: rec.id, ...out }); out.sent ? shippedSent++ : shippedSkipped++; }
      catch (e) { shippedSkipped++; shippedResults.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) }); }
    }
  }

  return {
    airtableQueries: 1,
    matchedOrders: (list.records || []).length,
    paid: { found: paidResults.length, sent: paidSent, skipped: paidSkipped, results: paidResults },
    shipped: { found: shippedResults.length, sent: shippedSent, skipped: shippedSkipped, results: shippedResults },
  };
}

async function process(records, fn) {
  const results = [];
  let sent = 0;
  let skipped = 0;
  for (const rec of records) {
    try {
      const out = await fn(rec);
      if (out.sent) sent++; else skipped++;
      results.push({ id: rec.id, ...out });
    } catch (e) {
      skipped++;
      results.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) });
    }
  }
  return { found: records.length, sent, skipped, results };
}
