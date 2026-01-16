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

    // Manual run for testing:
    // https://YOUR-WORKER-URL/run?secret=XXX
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

  // Stripe order/session id (your existing field)
  const ORDER_ID_FIELD = env.AIRTABLE_ORDER_ID_FIELD || "Order ID";

  // ✅ NEW: Your short code field (you created OrderCode)
  // You named it intentionally AIRTABLE_ORDER_ID_FIELDI
  const ORDER_CODE_FIELD = env.AIRTABLE_ORDER_ID_FIELDI || "OrderCode";

  // ✅ Carrier logic:
  // (You said: Europe = DPD, America = DHL, for now we show DPD / DHL)
  // If later you add Airtable field like "Carrier", just plug it here.
  const CARRIER_FIELD = env.AIRTABLE_CARRIER_FIELD || ""; // optional

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

    // Stripe ID (long)
    const stripeOrderId = String(f[ORDER_ID_FIELD] || "").trim();

    // ✅ Short code (OrderCode)
    const orderCode = String(f[ORDER_CODE_FIELD] || "").trim();

    // We will show OrderCode if exists, otherwise fallback
    const niceOrderId = orderCode || stripeOrderId || rec.id;

    // Carrier (if you add it later in Airtable)
    let carrier = "DPD / DHL";
    if (CARRIER_FIELD && f[CARRIER_FIELD]) {
      carrier = String(f[CARRIER_FIELD] || "").trim() || carrier;
    }

    if (!email || !tracking) {
      skipped++;
      results.push({
        id: rec.id,
        orderId: niceOrderId,
        status: "skipped",
        reason: "missing_email_or_tracking",
      });
      continue;
    }

    try {
      const subject = `${env.STORE_NAME || "Mosaic Pins"}: Your order has been shipped 🚚`;

      const text = `Hello ${name || ""}

Good news — your order ${niceOrderId} has been shipped 🚚📦

Carrier: ${carrier}
Tracking number: ${tracking}

Thank you for your purchase!
`;

      const html = `
<div style="
  background:#0b0d11;
  padding:24px;
  font-family: Arial, sans-serif;
  color:#e9eef7;
">
  <div style="
    max-width:520px;
    margin:0 auto;
    border-radius:18px;
    border:1px solid rgba(255,255,255,.08);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    box-shadow:0 12px 30px rgba(0,0,0,.45);
    overflow:hidden;
  ">

    <div style="
      padding:18px;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:linear-gradient(180deg, rgba(34,197,94,.14), rgba(0,0,0,0));
    ">
      <div style="font-weight:900; font-size:16px; letter-spacing:.2px;">
        🟢 ${escapeHtml(env.STORE_NAME || "Mosaic Pins")}
      </div>
      <div style="color:#a8b3c7; font-size:13px; margin-top:4px;">
        Shipping update
      </div>
    </div>

    <div style="padding:20px;">
      <div style="font-size:18px; font-weight:900; margin-bottom:10px;">
        Hello ${escapeHtml(name || "friend")},
      </div>

      <div style="color:#a8b3c7; font-size:14px; line-height:1.5; margin-bottom:16px;">
        Good news — your order <b style="color:#e9eef7;">${escapeHtml(niceOrderId)}</b> has been shipped 🚚📦
      </div>

      <div style="
        border:1px solid rgba(255,255,255,.08);
        background:rgba(0,0,0,.22);
        border-radius:16px;
        padding:14px;
      ">
        <div style="font-size:13px; color:#a8b3c7; margin-bottom:6px;">
          Carrier
        </div>
        <div style="font-size:15px; font-weight:900; margin-bottom:12px;">
          ${escapeHtml(carrier)}
        </div>

        <div style="font-size:13px; color:#a8b3c7; margin-bottom:6px;">
          Tracking number
        </div>
        <div style="
          font-size:15px;
          font-weight:900;
          letter-spacing:.4px;
          word-break:break-word;
        ">
          ${escapeHtml(tracking)}
        </div>
      </div>

      <div style="color:#a8b3c7; font-size:13px; margin-top:16px;">
        If you have any questions, just reply to this email.
      </div>
    </div>

    <div style="
      padding:14px 18px;
      border-top:1px solid rgba(255,255,255,.08);
      background:rgba(0,0,0,.25);
      color:#a8b3c7;
      font-size:12px;
      text-align:center;
    ">
      Thank you for your purchase 💚
    </div>

  </div>
</div>
`;

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
      results.push({ id: rec.id, orderId: niceOrderId, status: "sent", to: email });
    } catch (e) {
      skipped++;
      results.push({
        id: rec.id,
        orderId: niceOrderId,
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

  // ✅ API key auth (MailChannels) if you added it
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