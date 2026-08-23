// One mail transport + one set of localized customer email templates for the whole shop.

export async function sendStoreEmail(env, { to, subject, text, html }) {
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

export function normalizeOrderLanguage(value) {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return ["en", "de", "ru", "fr"].includes(lang) ? lang : "en";
}

export function buildPaidEmail(env, { name, orderId, amount, currency, language = "en" }) {
  const store = String(env.STORE_NAME || "Mosaic Pins");
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

export function buildShippedEmail(env, { name, orderId, tracking, carrier = "DHL Paket", language = "en" }) {
  const store = String(env.STORE_NAME || "Mosaic Pins");
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

function shell(store, subtitle, body, footerText) {
  return `<div style="background:#0b0d11;padding:24px;font-family:Arial,sans-serif;color:#e9eef7;">
  <div style="max-width:520px;margin:0 auto;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));box-shadow:0 12px 30px rgba(0,0,0,.45);overflow:hidden;">
    <div style="padding:18px;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(34,197,94,.14),rgba(0,0,0,0));">
      <div style="font-weight:900;font-size:16px;letter-spacing:.2px;">🟢 ${escapeHtml(store)}</div>
      <div style="color:#a8b3c7;font-size:13px;margin-top:4px;">${escapeHtml(subtitle)}</div>
    </div>
    <div style="padding:20px;">${body}</div>
    <div style="padding:14px 18px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.25);color:#a8b3c7;font-size:12px;text-align:center;">${escapeHtml(footerText)}</div>
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
