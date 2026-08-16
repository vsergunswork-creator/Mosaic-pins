// One mail transport + one set of customer email templates for the whole shop.

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

export function buildPaidEmail(env, { name, orderId, amount, currency }) {
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

export function buildShippedEmail(env, { name, orderId, tracking, carrier }) {
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
