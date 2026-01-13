export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runShipCheck(env));
  },

  async fetch(request, env, ctx) {
    // ручной запуск для теста:
    // https://YOUR-WORKER-URL/run?secret=XXX
    const url = new URL(request.url);

    if (url.pathname === "/run") {
      const secret = url.searchParams.get("secret") || "";
      if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const out = await runShipCheck(env);
      return json({ ok: true, ...out });
    }

    return json({ ok: true, info: "Use /run?secret=... to test" });
  },
};

async function runShipCheck(env) {
  // ---------- REQUIRED ENV ----------
  must(env.AIRTABLE_TOKEN, "AIRTABLE_TOKEN");
  must(env.AIRTABLE_BASE_ID, "AIRTABLE_BASE_ID");

  // Таблица заказов (у Вас именно Orders)
  const ORDERS_TABLE =
    env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders";

  // Названия полей в Orders (как у Вас на скринах)
  const TRACKING_FIELD = env.AIRTABLE_TRACKING_FIELD || "Tracking Number";
  const SHIPPED_FIELD = env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent";

  const EMAIL_FIELD = env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email";
  const NAME_FIELD = env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name";
  const ORDER_ID_FIELD = env.AIRTABLE_ORDER_ID_FIELD || "Order ID";

  // Email settings (MailChannels)
  must(env.MAIL_FROM, "MAIL_FROM");
  must(env.MAIL_REPLY_TO, "MAIL_REPLY_TO");
  // MAIL_BCC optional
  // STORE_NAME optional

  // ---------- FIND ORDERS READY ----------
  // tracking != '' AND NOT(shipped)
  const formula =
    `AND(` +
    `{${TRACKING_FIELD}}!='',` +
    `NOT({${SHIPPED_FIELD}})` +
    `)`;

  const list = await airtableList({
    token: env.AIRTABLE_TOKEN,
    baseId: env.AIRTABLE_BASE_ID,
    table: ORDERS_TABLE,
    filterByFormula: formula,
    maxRecords: 10,
  });

  let sent = 0;
  let skipped = 0;

  for (const rec of list.records || []) {
    const f = rec.fields || {};

    const email = String(f[EMAIL_FIELD] || "").trim();
    const name = String(f[NAME_FIELD] || "").trim();
    const tracking = String(f[TRACKING_FIELD] || "").trim();
    const orderId = String(f[ORDER_ID_FIELD] || "").trim() || rec.id;

    if (!email || !tracking) {
      skipped++;
      continue;
    }

    // Send email via MailChannels
    await sendEmailMailchannels({
      from: env.MAIL_FROM,
      to: email,
      replyTo: env.MAIL_REPLY_TO,
      bcc: env.MAIL_BCC || "",
      subject: `${env.STORE_NAME || "Mosaic Pins"}: Your order has been shipped 🚚`,
      text: `Hello ${name || ""}

Your order ${orderId} has been shipped 🚚
Tracking number: ${tracking}

Thank you for your purchase!
`,
      html: `
Hello ${escapeHtml(name || "")},

Your order **${escapeHtml(orderId)}** has been shipped 🚚

**Tracking number:** ${escapeHtml(tracking)}

Thank you for your purchase!
`,
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
  }

  return {
    table: ORDERS_TABLE,
    found: (list.records || []).length,
    sent,
    skipped,
  };
}

/* ---------------- Airtable helpers ---------------- */

async function airtableList({
  token,
  baseId,
  table,
  filterByFormula,
  maxRecords = 10,
}) {
  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
  );
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  url.searchParams.set("maxRecords", String(maxRecords));

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(`Airtable list failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtableUpdate({ token, baseId, table, recordId, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    table
  )}/${recordId}`;

  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `Airtable update failed: ${r.status} ${JSON.stringify(data)}`
    );
  return data;
}

/* ---------------- MailChannels ---------------- */

async function sendEmailMailchannels({ from, to, replyTo, bcc, subject, text, html }) {
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
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
  };

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return String(s)
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll(">", ">")
    .replaceAll('"', '"""')
    .replaceAll("'", "'");
}