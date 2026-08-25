// Mosaic Pins notification worker — self-contained Cloudflare Worker.
// Keeps paid/shipped email sweeps, Telegram paid-order fallback, and Etsy review sync.


export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledJobs(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

      if (url.pathname === "/debug-env") {
        return json({
          ok: true,
          mode: "safe-env-debug",
          hasCronSecret: Boolean(String(env.CRON_SECRET || "").trim()),
          hasEtsySyncSecret: Boolean(String(env.ETSY_SYNC_SECRET || "").trim()),
          hasEtsySyncUrl: Boolean(String(env.ETSY_SYNC_URL || "").trim())
        });
      }
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

  // Telegram is sent immediately by Stripe/PayPal on mosaicpins.space.
  // This authenticated site call is only the cron fallback for a failed immediate send.
  let telegramAlerts = { ok: false, skipped: true };
  try {
    const secret = String(env.TELEGRAM_ALERTS_SECRET || env.ETSY_SYNC_SECRET || env.CRON_SECRET || "").trim();
    const alertsUrl = String(env.TELEGRAM_ALERTS_URL || "https://mosaicpins.space/api/telegram-order-alerts").trim();
    if (!secret) throw new Error("TELEGRAM_ALERTS_SECRET/ETSY_SYNC_SECRET/CRON_SECRET is not set");
    const r = await fetch(alertsUrl, {
      method: "POST",
      headers: { "x-telegram-alerts-secret": secret },
    });
    const data = await r.json().catch(() => ({}));
    telegramAlerts = { ok: r.ok, httpStatus: r.status, ...data };
  } catch (e) {
    telegramAlerts = { ok: false, error: String(e?.message || e) };
  }

  let etsySync = { ok: false, skipped: true };
  try {
    const secret = String(env.ETSY_SYNC_SECRET || "").trim();
    const syncUrl = String(env.ETSY_SYNC_URL || "").trim();
    if (!secret) throw new Error("ETSY_SYNC_SECRET is not set");
    if (!syncUrl) throw new Error("ETSY_SYNC_URL is not set");
    const r = await fetch(syncUrl, {
      method: "POST",
      headers: { "x-etsy-sync-secret": secret },
    });
    const data = await r.json().catch(() => ({}));
    etsySync = { ok: r.ok, httpStatus: r.status, ...data };
  } catch (e) {
    etsySync = { ok: false, error: String(e?.message || e) };
  }
  return { notifications, telegramAlerts, etsySync };
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
  const dkimPrivateKey = String(env.DKIM_PRIVATE_KEY || "").replace(/\s+/g, "");
  const dkimDomain = String(env.DKIM_DOMAIN || "mosaicpins.space").trim();
  const dkimSelector = String(env.DKIM_SELECTOR || "mailchannels").trim();
  if (!from) throw new Error("MAIL_FROM is not set");
  if (!to) throw new Error("Recipient email is missing");

  const dkim = dkimPrivateKey && dkimDomain && dkimSelector ? {
    dkim_domain: dkimDomain,
    dkim_selector: dkimSelector,
    dkim_private_key: dkimPrivateKey,
  } : {};

  const payload = {
    personalizations: [{
      to: [{ email: to }],
      ...(bcc ? { bcc: [{ email: bcc }] } : {}),
      ...dkim,
    }],
    from: { email: from, name: getStoreName(env) },
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

function normalizeOrderLanguage(value) {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return ["en", "de", "ru", "fr"].includes(lang) ? lang : "en";
}

function buildPaidEmail(env, { name, orderId, amount, currency, language = "en" }) {
  const store = getStoreName(env);
  const lang = normalizeOrderLanguage(language);
  const t = COPY[lang];
  const greeting = makeGreeting(name, t, lang);
  const amountLine = formatMoney(amount, currency, lang);

  const subject = `${store}: ${t.paidSubject} 💚`;

  const text = `${greeting}

${t.paidThanks} ${orderId}!
${t.paidReceived}
${amountLine ? `\n${t.total}: ${amountLine}\n` : ""}
${t.paidFollowup}

${t.questions}
`;

  const html = shell(store, t.paidSubtitle, `
    <div style="font-size:18px;font-weight:900;margin-bottom:10px;">${escapeHtml(greeting)}</div>
    <div style="color:#a8b3c7;font-size:14px;line-height:1.5;margin-bottom:16px;">
      ${escapeHtml(t.paidThanks)} <b style="color:#e9eef7;">${escapeHtml(orderId)}</b> ✅<br/>
      ${escapeHtml(t.paidReceived)}
    </div>
    <div style="border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);border-radius:16px;padding:14px;">
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">${escapeHtml(t.order)}</div>
      <div style="font-size:15px;font-weight:900;${amountLine ? "margin-bottom:12px;" : ""}">${escapeHtml(orderId)}</div>
      ${amountLine ? `<div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">${escapeHtml(t.total)}</div><div style="font-size:15px;font-weight:900;">${escapeHtml(amountLine)}</div>` : ""}
    </div>
    <div style="color:#a8b3c7;font-size:13px;line-height:1.5;margin-top:16px;">
      ${escapeHtml(t.paidFollowup)}<br/>${escapeHtml(t.questions)}
    </div>
  `, t.footer);

  return { subject, text, html };
}

function buildShippedEmail(env, { name, orderId, tracking, carrier = "DHL Paket", language = "en" }) {
  const store = getStoreName(env);
  const lang = normalizeOrderLanguage(language);
  const t = COPY[lang];
  const greeting = makeGreeting(name, t, lang);
  const safeCarrier = String(carrier || "DHL Paket").trim() || "DHL Paket";
  const trackingUrl = buildDhlTrackingUrl(tracking);

  const subject = `${store}: ${t.shippedSubject} 🚚`;

  const text = `${greeting}

${t.shippedGoodNews} ${orderId} ${t.shippedWith} ${safeCarrier}${t.shippedTail ? ` ${t.shippedTail}` : ""} 🚚📦

${t.carrier}: ${safeCarrier}
${t.tracking}: ${tracking}
${t.track}: ${trackingUrl}

${t.footer}
`;

  const html = shell(store, t.shippedSubtitle, `
    <div style="font-size:18px;font-weight:900;margin-bottom:10px;">${escapeHtml(greeting)}</div>
    <div style="color:#a8b3c7;font-size:14px;line-height:1.5;margin-bottom:16px;">
      ${escapeHtml(t.shippedGoodNews)} <b style="color:#e9eef7;">${escapeHtml(orderId)}</b> ${escapeHtml(t.shippedWith)}
      <b style="color:#e9eef7;">${escapeHtml(safeCarrier)}</b>${t.shippedTail ? ` ${escapeHtml(t.shippedTail)}` : ""} 🚚📦
    </div>
    <div style="border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);border-radius:16px;padding:14px;">
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">${escapeHtml(t.carrier)}</div>
      <div style="font-size:15px;font-weight:900;margin-bottom:12px;">${escapeHtml(safeCarrier)}</div>
      <div style="font-size:13px;color:#a8b3c7;margin-bottom:6px;">${escapeHtml(t.tracking)}</div>
      <div style="font-size:15px;font-weight:900;letter-spacing:.4px;word-break:break-word;">${escapeHtml(tracking)}</div>
      <div style="margin-top:16px;">
        <a href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;padding:11px 16px;border-radius:12px;background:#22c55e;color:#07110a;text-decoration:none;font-size:13px;font-weight:900;">
          ${escapeHtml(t.track)}
        </a>
      </div>
    </div>
    <div style="color:#a8b3c7;font-size:13px;line-height:1.5;margin-top:16px;">${escapeHtml(t.questions)}</div>
  `, t.footer);

  return { subject, text, html };
}

const COPY = {
  en: {
    hello: "Hello",
    paidSubject: "Thanks for your order",
    paidSubtitle: "Order confirmation",
    paidThanks: "Thank you for your order",
    paidReceived: "We’ve received your payment. Your order is being processed now.",
    paidFollowup: "We’ll email you again as soon as your order is shipped.",
    shippedSubject: "Your order has been shipped",
    shippedSubtitle: "Shipping update",
    shippedGoodNews: "Good news — your order",
    shippedWith: "has been shipped with",
    shippedTail: "",
    order: "Order",
    total: "Total",
    carrier: "Carrier",
    tracking: "Tracking number",
    track: "Track your parcel",
    questions: "If you have any questions, just reply to this email.",
    footer: "Thank you for your purchase 💚",
  },
  de: {
    hello: "Hallo",
    paidSubject: "Vielen Dank für Ihre Bestellung",
    paidSubtitle: "Bestellbestätigung",
    paidThanks: "Vielen Dank für Ihre Bestellung",
    paidReceived: "Wir haben Ihre Zahlung erhalten. Ihre Bestellung wird jetzt bearbeitet.",
    paidFollowup: "Sobald Ihre Bestellung versendet wurde, erhalten Sie eine weitere E-Mail.",
    shippedSubject: "Ihre Bestellung wurde versendet",
    shippedSubtitle: "Versandinformation",
    shippedGoodNews: "Gute Nachrichten — Ihre Bestellung",
    shippedWith: "wurde mit",
    shippedTail: "versendet",
    order: "Bestellung",
    total: "Gesamt",
    carrier: "Versanddienst",
    tracking: "Sendungsnummer",
    track: "Sendung verfolgen",
    questions: "Wenn Sie Fragen haben, antworten Sie einfach auf diese E-Mail.",
    footer: "Vielen Dank für Ihren Einkauf 💚",
  },
  ru: {
    hello: "Здравствуйте",
    paidSubject: "Спасибо за ваш заказ",
    paidSubtitle: "Подтверждение заказа",
    paidThanks: "Спасибо за ваш заказ",
    paidReceived: "Мы получили оплату. Ваш заказ уже передан в обработку.",
    paidFollowup: "Мы отправим ещё одно письмо, как только заказ будет отправлен.",
    shippedSubject: "Ваш заказ отправлен",
    shippedSubtitle: "Информация об отправке",
    shippedGoodNews: "Хорошие новости — ваш заказ",
    shippedWith: "отправлен через",
    shippedTail: "",
    order: "Заказ",
    total: "Итого",
    carrier: "Перевозчик",
    tracking: "Трек-номер",
    track: "Отследить посылку",
    questions: "Если у вас возникнут вопросы, просто ответьте на это письмо.",
    footer: "Спасибо за покупку 💚",
  },
  fr: {
    hello: "Bonjour",
    paidSubject: "Merci pour votre commande",
    paidSubtitle: "Confirmation de commande",
    paidThanks: "Merci pour votre commande",
    paidReceived: "Nous avons bien reçu votre paiement. Votre commande est maintenant en cours de traitement.",
    paidFollowup: "Nous vous enverrons un nouvel e-mail dès que votre commande sera expédiée.",
    shippedSubject: "Votre commande a été expédiée",
    shippedSubtitle: "Mise à jour de l’expédition",
    shippedGoodNews: "Bonne nouvelle — votre commande",
    shippedWith: "a été expédiée avec",
    shippedTail: "",
    order: "Commande",
    total: "Total",
    carrier: "Transporteur",
    tracking: "Numéro de suivi",
    track: "Suivre le colis",
    questions: "Si vous avez des questions, répondez simplement à cet e-mail.",
    footer: "Merci pour votre achat 💚",
  },
};

function makeGreeting(name, t, language) {
  const safeName = String(name || "").trim();
  if (normalizeOrderLanguage(language) === "ru") {
    return safeName ? `${t.hello}, ${safeName}!` : `${t.hello}!`;
  }
  return safeName ? `${t.hello} ${safeName},` : `${t.hello},`;
}

function formatMoney(amount, currency, language) {
  if (amount === undefined || amount === null || String(amount).trim() === "") return "";

  const code = String(currency || "").trim().toUpperCase();
  const number = Number(amount);

  if (Number.isFinite(number) && /^[A-Z]{3}$/.test(code)) {
    const locale = {
      en: "en-GB",
      de: "de-DE",
      ru: "ru-RU",
      fr: "fr-FR",
    }[normalizeOrderLanguage(language)];

    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(number);
    } catch (_) {}
  }

  return `${amount} ${code}`.trim();
}

function buildDhlTrackingUrl(tracking) {
  return `https://nolp.dhl.de/nextt-online-public/?piececode=${encodeURIComponent(String(tracking || "").trim())}`;
}

const BRAND_LOGO_URL = "https://mosaicpins.space/assets/img/mosaic-pins-mark.png";

function getStoreName(env) {
  const configured = String(env?.STORE_NAME || "").trim();
  if (!configured || configured.toLowerCase() === "mosaic pins") return "Mosaic Pins Space";
  return configured;
}

function shell(store, subtitle, body, footerText) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;margin:0;background:#ffffff;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:32px 14px 40px;background:#ffffff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;border-collapse:separate;background:#11151b;border:1px solid #252c36;border-radius:18px;box-shadow:0 12px 30px rgba(15,23,42,.18);overflow:hidden;font-family:Arial,sans-serif;color:#e9eef7;text-align:left;">
        <tr>
          <td style="padding:18px;border-bottom:1px solid #252c36;background:linear-gradient(180deg,rgba(34,197,94,.14),rgba(17,21,27,0));border-radius:18px 18px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
              <td style="vertical-align:middle;padding-right:10px;"><img src="${BRAND_LOGO_URL}" width="30" height="30" alt="Mosaic Pins Space" style="display:block;width:30px;height:30px;border:0;border-radius:50%;"/></td>
              <td style="vertical-align:middle;font-weight:900;font-size:16px;letter-spacing:.2px;color:#e9eef7;">${escapeHtml(store)}</td>
            </tr></table>
            <div style="color:#a8b3c7;font-size:13px;margin-top:6px;">${escapeHtml(subtitle)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px;background:#11151b;color:#e9eef7;">${body}</td>
        </tr>
        <tr>
          <td style="padding:14px 18px;border-top:1px solid #252c36;background:#0d1117;color:#a8b3c7;font-size:12px;text-align:center;border-radius:0 0 18px 18px;">${escapeHtml(footerText)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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

  const languageField = String(env.AIRTABLE_LANGUAGE_FIELD || "Language");
  const language = normalizeOrderLanguage(f[languageField]);

  const msg = buildPaidEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    amount: f[amountField],
    currency: f[currencyField],
    language,
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

  // Mosaic Pins currently ships customer parcels with DHL Paket.
  // Do not expose legacy DPD fallback text in customer emails.
  const carrier = "DHL Paket";
  const languageField = String(env.AIRTABLE_LANGUAGE_FIELD || "Language");
  const language = normalizeOrderLanguage(f[languageField]);

  const msg = buildShippedEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    tracking,
    carrier,
    language,
  });
  await sendStoreEmail(env, { to, ...msg });
  await updateOrderRecord(env, rec.id, { [sentField]: true });
  return { sent: true, to, orderId: niceOrderId(rec, env), tracking };
}

function paidFallbackReady(rec, env) {
  // The payment webhook sends the confirmation immediately.
  // The hourly worker is only a fallback, so ignore very fresh orders to avoid
  // racing the webhook and sending the same confirmation twice.
  const f = rec?.fields || {};
  const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");
  const raw = f[createdField];
  if (!raw) return true;

  const createdMs = Date.parse(String(raw));
  if (!Number.isFinite(createdMs)) return true;

  const graceMinutes = Math.max(1, Number(env.PAID_EMAIL_FALLBACK_GRACE_MINUTES || 10));
  return Date.now() - createdMs >= graceMinutes * 60 * 1000;
}

async function runPaidSweep(env, { maxRecords = 20 } = {}) {
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const sentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const formula = `AND({${statusField}}='${paidValue}', NOT({${sentField}}))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });
  return process(
    (list.records || []).filter((rec) => paidFallbackReady(rec, env)),
    (rec) => sendPaidEmailForRecord(env, rec)
  );
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
    const paidPending =
      String(f[statusField] || "").toLowerCase() === String(env.PAID_STATUS_VALUE || "paid").toLowerCase() &&
      f[paidSentField] !== true &&
      paidFallbackReady(rec, env);
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
