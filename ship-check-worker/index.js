// index.js (Cloudflare Worker)
// - Scheduled cron runs runShipCheck()
// - Manual test: https://YOUR-WORKER-URL/run?secret=CRON_SECRET
// - Reads Orders from Airtable where Tracking Number != '' AND Shipped Email Sent is NOT checked
// - Sends email via MailChannels (uses X-Api-Key header if MAILCHANNELS_API_KEY is set)
// - Marks Shipped Email Sent = true in Airtable

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runShipCheck(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      const secret = url.searchParams.get("secret") || "";
      if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      try {
        const out = await runShipCheck(env);
        return json({ ok: true, ...out }, 200);
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    }

    return json({ ok: true, info: "Use /run?secret=... to test" }, 200);
  },
};

async function runShipCheck(env) {
  // ---------- REQUIRED ENV ----------
  must(env.AIRTABLE_TOKEN, "AIRTABLE_TOKEN");
  must(env.AIRTABLE_BASE_ID, "AIRTABLE_BASE_ID");
  must(env.MAIL_FROM, "MAIL_FROM");
  must(env.MAIL_REPLY_TO, "MAIL_REPLY_TO");

  // Orders table (default: Orders)
  const ORDERS_TABLE =
    env.AIRTABLE_ORDERS_TABLE_NAME ||
    env.AIRTABLE_ORDERS_TABLE ||
    "Orders";

  // Field names (defaults match your Airtable)
  const TRACKING_FIELD = env.AIRTABLE_TRACKING_FIELD || "Tracking Number";
  const SHIPPED_FIELD = env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent";

  const EMAIL_FIELD = env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email";
  const NAME_FIELD = env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name";

  // Stripe / long order id (keep it if you still need it)
  const ORDER_ID_FIELD = env.AIRTABLE_ORDER_ID_FIELD || "Order ID";

  // ✅ Your short pretty order code (OrderCode)
  // You created AIRTABLE_ORDER_ID_FIELDI on purpose — we use it here.
  const ORDER_CODE_FIELD = env.AIRTABLE_ORDER_ID_FIELDI || "OrderCode";

  // Optional: tracking link field (if you create one later)
  const TRACKING_URL_FIELD = env.AIRTABLE_TRACKING_URL_FIELD || "Tracking URL";

  // ---------- FIND ORDERS READY ----------
  const formula = `AND({${TRACKING_FIELD}}!='', NOT({${SHIPPED_FIELD}}))`;

  const list = await airtableList({
    token: env.AIRTABLE_TOKEN,
    baseId: env.AIRTABLE_BASE_ID,
    table: ORDERS_TABLE,
    filterByFormula: formula,
    maxRecords: 10,
  });

  let sent = 0;
  let skipped = 0;
  const results = [];

  for (const rec of list.records || []) {
    const f = rec.fields || {};

    const email = String(f[EMAIL_FIELD] || "").trim();
    const name = String(f[NAME_FIELD] || "").trim();
    const tracking = String(f[TRACKING_FIELD] || "").trim();

    // long id (stripe), can be empty
    const stripeOrderId = String(f[ORDER_ID_FIELD] || "").trim();

    // ✅ short code (OrderCode)
    const orderCode = String(f[ORDER_CODE_FIELD] || "").trim();

    // what we show to customer:
    const displayOrder = orderCode || stripeOrderId || rec.id;

    // optional tracking URL
    const trackingUrlRaw = String(f[TRACKING_URL_FIELD] || "").trim();
    const trackingUrl = isHttpUrl(trackingUrlRaw) ? trackingUrlRaw : "";

    if (!email || !tracking) {
      skipped++;
      results.push({
        id: rec.id,
        orderId: displayOrder,
        status: "skipped",
        reason: "missing_email_or_tracking",
      });
      continue;
    }

    try {
      const store = env.STORE_NAME || "Mosaic Pins";
      const subject = `${store}: Order ${displayOrder} shipped 🚚`;

      const text = buildTextEmail({
        name,
        displayOrder,
        tracking,
        trackingUrl,
        replyTo: env.MAIL_REPLY_TO,
      });

      const html = buildHtmlEmail({
        store,
        name,
        displayOrder,
        tracking,
        trackingUrl,
        supportEmail: env.MAIL_REPLY_TO || env.MAIL_FROM,
      });

      await sendEmailMailchannels({
        env,
        from: env.MAIL_FROM,
        to: email,
        replyTo: env.MAIL_REPLY_TO,
        bcc: env.MAIL_BCC || "",
        subject,
        text,
        html,
      });

      await airtableUpdate({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        recordId: rec.id,
        fields: { [SHIPPED_FIELD]: true },
      });

      sent++;
      results.push({ id: rec.id, orderId: displayOrder, status: "sent", to: email });
    } catch (e) {
      skipped++;
      results.push({
        id: rec.id,
        orderId: displayOrder,
        status: "error",
        error: String(e?.message || e),
      });
    }
  }

  return {
    table: ORDERS_TABLE,
    found: (list.records || []).length,
    sent,
    skipped,
    results,
  };
}

/* ---------------- Airtable helpers ---------------- */

async function airtableList({ token, baseId, table, filterByFormula, maxRecords = 10 }) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  url.searchParams.set("maxRecords", String(maxRecords));

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable list failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtableUpdate({ token, baseId, table, recordId, fields }) {
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
  if (!r.ok) throw new Error(`Airtable update failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

/* ---------------- MailChannels ---------------- */

async function sendEmailMailchannels({ env, from, to, replyTo, bcc, subject, text, html }) {
  const personalizations = [
    {
      to: [{ email: to }],
      ...(bcc ? { bcc: [{ email: bcc }] } : {}),
    },
  ];

  const payload = {
    personalizations,
    from: { email: from },
    reply_to: { email: replyTo },
    subject,
    content: [
      { type: "text/plain", value: text || "" },
      { type: "text/html", value: html || "" },
    ],
  };

  const headers = {
    "Content-Type": "application/json",
  };

  if (env.MAILCHANNELS_API_KEY) {
    headers["X-Api-Key"] = env.MAILCHANNELS_API_KEY;
  }

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`MailChannels failed: ${r.status} ${body}`);
}

/* ---------------- Email templates ---------------- */

function buildTextEmail({ name, displayOrder, tracking, trackingUrl, replyTo }) {
  return `Hello${name ? " " + name : ""},

Good news — your order ${displayOrder} has been shipped 🚚

Tracking number: ${tracking}${trackingUrl ? `\nTracking link: ${trackingUrl}` : ""}

If you have any questions, just reply to this email (${replyTo || "support"}).

Thank you for your purchase!
`;
}

function buildHtmlEmail({ store, name, displayOrder, tracking, trackingUrl, supportEmail }) {
  const safeStore = escapeHtml(store);
  const safeName = escapeHtml(name || "");
  const safeOrder = escapeHtml(displayOrder);
  const safeTracking = escapeHtml(tracking);
  const safeSupport = escapeHtml(supportEmail || "");

  const hasUrl = !!trackingUrl;
  const safeUrl = hasUrl ? escapeHtmlAttr(trackingUrl) : "";

  const hello = safeName ? `Hello ${safeName},` : "Hello,";
  const btn = hasUrl
    ? `<a href="${safeUrl}" style="
        display:inline-block;
        padding:12px 16px;
        border-radius:12px;
        background:linear-gradient(135deg,#22c55e,#16a34a);
        color:#07110b !important;
        text-decoration:none;
        font-weight:900;
        letter-spacing:.2px;
      ">Track package</a>`
    : "";

  const linkRow = hasUrl
    ? `<div style="margin-top:10px; font-size:13px; color:rgba(168,179,199,.95); line-height:1.5">
        Or open this link:
        <a href="${safeUrl}" style="color:#e9eef7; text-decoration:none; border-bottom:1px solid rgba(255,255,255,.22);">
          ${escapeHtml(trackingUrl)}
        </a>
      </div>`
    : "";

  return `
  <div style="background:#0b0d11; padding:22px; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#e9eef7;">
    <div style="max-width:620px; margin:0 auto;">
      <div style="border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,.10);
                  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
                  box-shadow:0 12px 30px rgba(0,0,0,.45);">
        <div style="padding:16px 18px; border-bottom:1px solid rgba(255,255,255,.10);
                    background:linear-gradient(180deg, rgba(34,197,94,.18), rgba(0,0,0,0));">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:10px; height:10px; border-radius:999px; background:linear-gradient(135deg,#22c55e,#60a5fa);"></div>
            <div style="font-weight:950; letter-spacing:.3px;">${safeStore}</div>
          </div>
          <div style="margin-top:6px; color:rgba(168,179,199,.95); font-size:12px;">Shipping update</div>
        </div>

        <div style="padding:18px;">
          <div style="font-size:16px; font-weight:900; margin:0 0 10px;">${hello}</div>

          <div style="color:rgba(168,179,199,.95); font-size:13px; line-height:1.6;">
            Good news — your order <b style="color:#e9eef7;">${safeOrder}</b> has been shipped 🚚
          </div>

          <div style="margin-top:14px; padding:12px; border-radius:16px;
                      border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.25);">
            <div style="font-weight:950; font-size:13px; margin-bottom:6px;">Tracking number</div>
            <div style="font-size:14px; letter-spacing:.2px; word-break:break-word;">${safeTracking}</div>
          </div>

          ${btn ? `<div style="margin-top:14px;">${btn}</div>` : ""}
          ${linkRow}

          <div style="margin-top:16px; color:rgba(168,179,199,.95); font-size:13px; line-height:1.6;">
            If you have any questions, just reply to this email.
          </div>
        </div>

        <div style="padding:12px 18px; border-top:1px solid rgba(255,255,255,.10);
                    background:rgba(0,0,0,.20); color:rgba(168,179,199,.95); font-size:12px;">
          Support:
          <a href="mailto:${escapeHtmlAttr(supportEmail || "")}" style="color:#e9eef7; text-decoration:none; opacity:.95;">
            ${safeSupport}
          </a>
        </div>
      </div>
    </div>
  </div>
  `.trim();
}

function isHttpUrl(s) {
  return /^https?:\/\/\S+/i.test(String(s || ""));
}

function escapeHtmlAttr(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------- Utils ---------------- */

function must(v, name) {
  if (!v) throw new Error(`${name} missing`);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}