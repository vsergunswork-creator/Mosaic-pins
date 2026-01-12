// /functions/api/stripe-webhook.js
// Cloudflare Pages Functions

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(msg, status = 200) {
  return new Response(msg, { status });
}

// Stripe signature verify (works with raw body)
async function verifyStripeSignature({ rawBody, signatureHeader, secret }) {
  // Stripe signature header format:
  // t=timestamp,v1=signature[,v0=...]
  if (!signatureHeader) return { ok: false, error: "Missing Stripe-Signature header" };
  if (!secret) return { ok: false, error: "Missing STRIPE_WEBHOOK_SECRET" };

  const parts = signatureHeader.split(",").map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return { ok: false, error: "Invalid Stripe-Signature format" };

  const timestamp = tPart.slice(2);
  const v1 = v1Part.slice(3);

  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const sigHex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // timing-safe compare
  const a = encoder.encode(sigHex);
  const b = encoder.encode(v1);
  if (a.length !== b.length) return { ok: false, error: "Signature mismatch" };
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return { ok: false, error: "Signature mismatch" };

  return { ok: true, timestamp };
}

// Airtable helpers
async function airtableList({ token, baseId, table, formula, maxRecords = 10 }) {
  const u = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  if (formula) u.searchParams.set("filterByFormula", formula);
  u.searchParams.set("maxRecords", String(maxRecords));

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable list failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtableCreate({ token, baseId, table, fields }) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ records: [{ fields }] }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable create failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function airtableUpdate({ token, baseId, table, recordId, fields }) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable update failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

// MailChannels send
async function sendEmailMailchannels({ from, to, replyTo, bcc, subject, textBody, htmlBody }) {
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
      { type: "text/plain", value: textBody || "" },
      { type: "text/html", value: htmlBody || "" },
    ],
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
  };

  const r = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`MailChannels error: ${r.status} ${t}`);
}

// Main handler
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);

  // =========================
  // CRON MODE: GET ?ship_check=1
  // =========================
  if (request.method === "GET" && url.searchParams.get("ship_check") === "1") {
    // Auth by header (NOT by query)
    const provided = request.headers.get("X-CRON-SECRET") || "";

    if (!env.CRON_SECRET) return json({ ok: false, error: "CRON_SECRET missing" }, 500);
    if (provided !== env.CRON_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);

    // Required env
    if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN missing" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID missing" }, 500);

    // Email env
    if (!env.MAIL_FROM) return json({ ok: false, error: "MAIL_FROM missing" }, 500);

    const ORDERS_TABLE = env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders";
    const TRACKING_FIELD = env.AIRTABLE_TRACKING_FIELD || "Tracking Number";
    const SHIPPED_FIELD = env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent";

    // Find Orders where Tracking != '' AND Shipped Email Sent is NOT checked
    const formula =
      `AND(` +
      `{${TRACKING_FIELD}}!='',` +
      `NOT({${SHIPPED_FIELD}})` +
      `)`;

    let data;
    try {
      data = await airtableList({
        token: env.AIRTABLE_TOKEN,
        baseId: env.AIRTABLE_BASE_ID,
        table: ORDERS_TABLE,
        formula,
        maxRecords: 10,
      });
    } catch (e) {
      return json({ ok: false, error: "Airtable error", details: String(e) }, 500);
    }

    let sent = 0;

    for (const rec of data.records || []) {
      const f = rec.fields || {};

      const email = f["Customer Email"];
      const name = f["Customer Name"] || "";
      const tracking = f[TRACKING_FIELD];
      const orderId = f["Order ID"] || f["Stripe Session ID"] || rec.id;

      if (!email || !tracking) continue;

      try {
        await sendEmailMailchannels({
          from: env.MAIL_FROM,
          to: email,
          replyTo: env.MAIL_REPLY_TO || env.MAIL_FROM,
          bcc: env.MAIL_BCC || "",
          subject: `${env.STORE_NAME || "Mosaic Pins"}: Your order has been shipped 🚚`,
          textBody:
`Hello ${name || ""}

Your order ${orderId} has been shipped 🚚
Tracking number: ${tracking}

Thank you for your purchase!
`,
          htmlBody:
`<p>Hello ${name || ""},</p>
<p>Your order <b>${orderId}</b> has been shipped 🚚</p>
<p><b>Tracking number:</b> ${tracking}</p>
<p>Thank you for your purchase!</p>`,
        });

        await airtableUpdate({
          token: env.AIRTABLE_TOKEN,
          baseId: env.AIRTABLE_BASE_ID,
          table: ORDERS_TABLE,
          recordId: rec.id,
          fields: { [SHIPPED_FIELD]: true },
        });

        sent++;
      } catch (e) {
        // Do not fail whole cron if one record fails
        console.log("Ship email failed:", rec.id, String(e));
      }
    }

    return json({ ok: true, found: (data.records || []).length, sent });
  }

  // =========================
  // STRIPE WEBHOOK MODE: POST
  // =========================
  if (request.method === "POST") {
    // Required env
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ ok: false, error: "STRIPE_WEBHOOK_SECRET missing" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN missing" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID missing" }, 500);

    // Read raw body for Stripe signature validation
    const rawBody = await request.text();
    const sig = request.headers.get("Stripe-Signature") || "";

    const ver = await verifyStripeSignature({
      rawBody,
      signatureHeader: sig,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });

    if (!ver.ok) return json({ ok: false, error: ver.error }, 400);

    // Parse JSON event
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (e) {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const ORDERS_TABLE = env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders";

    // We'll handle: checkout.session.completed (most common)
    // You can add more events if needed.
    if (event?.type === "checkout.session.completed") {
      const session = event.data?.object || {};

      const customerEmail =
        session.customer_details?.email ||
        session.customer_email ||
        "";

      const customerName =
        session.customer_details?.name ||
        "";

      const phone =
        session.customer_details?.phone ||
        "";

      const shipping = session.shipping_details || {};
      const addr = shipping.address || {};

      const shippingAddress = [
        addr.line1,
        addr.line2,
        addr.city,
        addr.state,
        addr.postal_code,
        addr.country,
      ].filter(Boolean).join(", ");

      const fields = {
        "Stripe Session ID": session.id || "",
        "Payment Intent ID": session.payment_intent || "",
        "Customer Email": customerEmail,
        "Customer Name": customerName,
        "Telefon": phone,
        "Shipping Address": shippingAddress,
        "Shipping Country": addr.country || "",
        "Shipping City": addr.city || "",
        "Shipping Postal Code": addr.postal_code || "",
        "Shipping State/Region": addr.state || "",
        "Amount Total": typeof session.amount_total === "number" ? (session.amount_total / 100) : "",
        "Currency": session.currency ? String(session.currency).toUpperCase() : "",
        "Order Status": "paid",
        "Refund Status": "not_refunded",
        "Created At": new Date().toISOString(),
      };

      try {
        await airtableCreate({
          token: env.AIRTABLE_TOKEN,
          baseId: env.AIRTABLE_BASE_ID,
          table: ORDERS_TABLE,
          fields,
        });
      } catch (e) {
        // If duplicate / or Airtable error
        console.log("Airtable create error:", String(e));
        // We still return 200 so Stripe doesn't retry forever,
        // but we show error in response for manual testing.
        return json({ ok: false, error: "Airtable create failed", details: String(e) }, 200);
      }

      return json({ ok: true });
    }

    // Unhandled events: return 200 so Stripe considers it delivered
    return json({ ok: true, received: event?.type || "unknown" });
  }

  // =========================
  // Other methods
  // =========================
  if (request.method === "GET") {
    // If someone opens in browser without ship_check - show hint
    return json({
      ok: false,
      error: "Use POST for Stripe, or GET ?ship_check=1 with X-CRON-SECRET header",
    }, 400);
  }

  return text("Method not allowed", 405);
}