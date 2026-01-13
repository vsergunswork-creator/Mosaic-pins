export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runShipCheck(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ручной запуск для теста:
    // https://YOUR-WORKER-URL/run?secret=XXX
    if (url.pathname === "/run") {
      const secret = url.searchParams.get("secret") || "";
      if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
        return json({ ok: false, error: "Unauthorized (bad CRON_SECRET)" }, 401);
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
  must(env.MAILCHANNELS_API_KEY, "MAILCHANNELS_API_KEY"); // ✅ обязательно
  must(env.MAIL_FROM, "MAIL_FROM");
  must(env.MAIL_REPLY_TO, "MAIL_REPLY_TO");

  // Таблица заказов (у Вас Orders)
  const ORDERS_TABLE =
    env.AIRTABLE_ORDERS_TABLE_NAME ||
    env.AIRTABLE_ORDERS_TABLE ||
    "Orders";

  // Названия полей в Orders
  const TRACKING_FIELD = env.AIRTABLE_TRACKING_FIELD || "Tracking Number";
  const SHIPPED_FIELD = env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent";

  const EMAIL_FIELD = env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email";
  const NAME_FIELD = env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name";
  const ORDER_ID_FIELD = env.AIRTABLE_ORDER_ID_FIELD || "Order ID";

  // ---------- FIND ORDERS READY ----------
  // tracking != '' AND NOT(shipped)
  const formula = `AND({${TRACKING_FIELD}}!='',NOT({${SHIPPED_FIELD}}))`;

  const list = await airtableList({
    token: env.AIRTABLE_TOKEN,
    baseId: env.AIRTABLE_BASE_ID,
    table: ORDERS_TABLE,
    filterByFormula: formula,
    maxRecords: 10,
  });

  let sent = 0;
  let skipped = 0;
  const details = [];

  for (const rec of list.records || []) {
    const f = rec.fields || {};

    const email = String(f[EMAIL_FIELD] || "").trim();
    const name = String(f[NAME_FIELD] || "").trim();
    const tracking = String(f[TRACKING_FIELD] || "").trim();
    const orderId = String(f[ORDER_ID_FIELD] || "").trim() || rec.id;

    if (!email || !tracking) {
      skipped++;
      details.push({ id: rec.id, skipped: true, reason: "missing email or tracking" });
      continue;
    }

    const subject = `${env.STORE_NAME || "Mosaic Pins"}: Your order has been shipped 🚚`;

    const text =
`Hello ${name || ""}

Your order ${orderId} has been shipped 🚚
Tracking number: ${tracking}

Thank you for your purchase!
`;

    const html =
`<p>Hello ${escapeHtml(name || "")},</p>
<p>Your order <b>${escapeHtml(orderId)}</b> has been shipped 🚚</p>
<p><b>Tracking number:</b> ${escapeHtml(tracking)}</p>
<p>Thank you for your purchase!</p>`;

    // Send email via MailChannels (✅ с X-Api-Key)
    await sendEmailMailchannels(env, {
      from: env.MAIL_FROM,
      to: email,
      replyTo: env.MAIL_REPLY_TO,
      bcc: env.MAIL_BCC || "",
      subject,
      text,
      html,
    });

    // Mark shipped flag
    await airtableUpdate({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      recordId: rec.id,
      fields: { [SHIPPED_FIELD]: true },
    });

    sent++;
    details.push({ id: rec.id, sent: true, to: email });
  }

  return {
    table: ORDERS_TABLE,
    found: (list.records || []).length,
    sent,
    skipped,
    details,
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

async function sendEmailMailchannels(env, { from, to, replyTo, bcc, subject, text, html }) {
  const payload = {
    personalizations: [
      {
        to: [{ email: to }],
        ...(bcc ? { bcc: [{ email: bcc }] } : {}),
      },
    ],
    from: { email: from },
    reply_to: { email: replyTo },
    subject,
    content: [
      { type: "text/plain", value: text || "" },
      { type: "text/html", value: html || "" },
    ],
  };

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": String(env.MAILCHANNELS_API_KEY).trim(), // ✅ ключ обязателен
    },
    body: JSON.stringify(payload),
  });

  const body = await r.text().catch(() => "");
  if (!r.ok) {
    // чтобы было видно что именно вернул MailChannels
    throw new Error(`MailChannels failed: ${r.status} ${body}`);
  }
}

/* ---------------- Utils ---------------- */

function must(v, name) {
  if (!v || !String(v).trim()) throw new Error(`${name} missing`);
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