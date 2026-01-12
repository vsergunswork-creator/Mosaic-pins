// ================================
// CRON: check shipped orders
// GET /api/stripe-webhook?ship_check=1&secret=XXX
// ================================
export async function onRequestGet(ctx) {
  const { env, request } = ctx;

  const url = new URL(request.url);
  const shipCheck = url.searchParams.get("ship_check");
  const secret = url.searchParams.get("secret");

  if (shipCheck !== "1") {
    return json({ ok: false, error: "Not a cron call" }, 400);
  }

  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ---- required env ----
  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN missing" }, 500);
  if (!env.AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID missing" }, 500);

  const ORDERS_TABLE =
    env.AIRTABLE_ORDERS_TABLE_NAME ||
    env.AIRTABLE_ORDERS_TABLE ||
    "Orders";

  const SHIPPED_FIELD = env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent";
  const TRACKING_FIELD = env.AIRTABLE_TRACKING_FIELD || "Tracking Number";

  // ---- find orders ready to ship ----
  const formula =
    `AND(` +
    `{${TRACKING_FIELD}}!='',` +
    `NOT({${SHIPPED_FIELD}})` +
    `)`;

  const urlA = new URL(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(ORDERS_TABLE)}`
  );
  urlA.searchParams.set("filterByFormula", formula);
  urlA.searchParams.set("maxRecords", "10");

  const r = await fetch(urlA.toString(), {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });

  const data = await r.json();
  if (!r.ok) return json({ ok: false, error: "Airtable error", data }, 500);

  let sent = 0;

  for (const rec of data.records || []) {
    const f = rec.fields || {};

    const email = f["Customer Email"];
    const name = f["Customer Name"] || "";
    const tracking = f[TRACKING_FIELD];
    const orderId = f["Order ID"];

    if (!email || !tracking) continue;

    // 👉 отправка письма
    await sendEmailMailchannels({
      from: env.MAIL_FROM,
      to: email,
      replyTo: env.MAIL_REPLY_TO,
      bcc: env.MAIL_BCC,
      subject: `${env.STORE_NAME || "Mosaic Pins"}: Your order has been shipped 🚚`,
      text:
`Hello ${name || ""}

Your order ${orderId} has been shipped 🚚
Tracking number: ${tracking}

Thank you for your purchase!
`,
      html:
`<p>Hello ${name || ""},</p>
<p>Your order <b>${orderId}</b> has been shipped 🚚</p>
<p><b>Tracking number:</b> ${tracking}</p>
<p>Thank you for your purchase!</p>`,
    });

    // 👉 отмечаем галочку
    await airtableUpdateRecord({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: ORDERS_TABLE,
      recordId: rec.id,
      fields: { [SHIPPED_FIELD]: true },
    });

    sent++;
  }

  return json({ ok: true, found: data.records.length, sent });
}