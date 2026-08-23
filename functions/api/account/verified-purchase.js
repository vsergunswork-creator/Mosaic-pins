import {
  listOrderRecords,
  niceOrderId,
  escapeFormulaString,
} from "../_airtable-orders.js";

// Backend-only purchase eligibility check for future Verified Purchase reviews.
// Nothing is written to Reviews yet and there are no frontend/UI changes here.
export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB binding is not configured" }, 500);
    }

    const user = await getAuthenticatedUser(request, env);

    if (!user) {
      return json({
        ok: true,
        authenticated: false,
        verifiedPurchase: false,
      }, 401);
    }

    if (!user.email_verified_at) {
      return json({
        ok: false,
        authenticated: true,
        verifiedPurchase: false,
        error: "Email is not verified",
      }, 403);
    }

    const url = new URL(request.url);
    const pin = String(url.searchParams.get("pin") || "").trim();

    if (!pin) {
      return json({
        ok: false,
        authenticated: true,
        verifiedPurchase: false,
        error: "pin is required",
      }, 400);
    }

    if (pin.length > 120) {
      return json({
        ok: false,
        authenticated: true,
        verifiedPurchase: false,
        error: "pin is too long",
      }, 400);
    }

    const emailField = String(
      env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email"
    ).trim();
    const statusField = String(
      env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status"
    ).trim();
    const normalizedEmail = String(user.email || "").trim().toLowerCase();

    // Only paid orders belonging to the currently authenticated, verified email
    // are eligible. This prevents a caller from proving a purchase by guessing an
    // order id or PIN that belongs to somebody else.
    const filterByFormula =
      `AND(` +
      `LOWER({${emailField}})='${escapeFormulaString(normalizedEmail)}',` +
      `LOWER({${statusField}})='paid'` +
      `)`;

    const result = await listOrderRecords(env, {
      filterByFormula,
      maxRecords: 100,
      pageSize: 100,
    });

    const records = Array.isArray(result?.records) ? result.records : [];
    const orderByKey = new Map();

    for (const record of records) {
      const key = snapshotOrderKey(record, env);
      if (key && !orderByKey.has(key)) orderByKey.set(key, record);
    }

    const orderKeys = [...orderByKey.keys()];

    if (!orderKeys.length) {
      return json({
        ok: true,
        authenticated: true,
        verifiedPurchase: false,
        pin,
      });
    }

    const snapshot = await findPurchasedSnapshot(env, orderKeys, pin);

    if (!snapshot) {
      return json({
        ok: true,
        authenticated: true,
        verifiedPurchase: false,
        pin,
      });
    }

    const order = orderByKey.get(String(snapshot.order_key || "")) || null;
    const fields = order?.fields || {};
    const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");

    return json({
      ok: true,
      authenticated: true,
      verifiedPurchase: true,
      pin: String(snapshot.pin || pin),
      purchase: {
        orderId: order ? niceOrderId(order, env) : String(snapshot.order_key || ""),
        orderKey: String(snapshot.order_key || ""),
        provider: String(snapshot.provider || ""),
        productRecordId: String(snapshot.product_record_id || ""),
        title: String(snapshot.title || snapshot.pin || ""),
        diameter: finiteNumberOrNull(snapshot.diameter),
        quantity: finiteNumberOrNull(snapshot.quantity),
        unitPrice: finiteNumberOrNull(snapshot.unit_price),
        currency: String(snapshot.currency || "").toUpperCase(),
        purchasedAt: String(fields[createdField] || ""),
      },
    });
  } catch (error) {
    console.error("account/verified-purchase:", error);
    return json({
      ok: false,
      verifiedPurchase: false,
      error: "Unable to verify purchase right now.",
    }, 500);
  }
}

export async function onRequestPost() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function findPurchasedSnapshot(env, orderKeys, pin) {
  const placeholders = orderKeys.map((_, index) => `?${index + 1}`).join(",");
  const pinIndex = orderKeys.length + 1;

  const query =
    `SELECT order_key, provider, product_record_id, pin, title, diameter, ` +
    `quantity, unit_price, currency, created_at ` +
    `FROM order_item_snapshots ` +
    `WHERE order_key IN (${placeholders}) ` +
    `AND LOWER(pin) = LOWER(?${pinIndex}) ` +
    `ORDER BY created_at DESC ` +
    `LIMIT 1`;

  return env.DB.prepare(query).bind(...orderKeys, pin).first();
}

function snapshotOrderKey(record, env) {
  const fields = record?.fields || {};
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(fields[idField] || fields[stripeField] || "").trim();
}

async function getAuthenticatedUser(request, env) {
  const token = getCookie(request.headers.get("Cookie") || "", "mp_session");
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256(token);

  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       u.id AS user_id,
       u.email AS email,
       u.email_verified_at AS email_verified_at
     FROM account_sessions AS s
     JOIN account_users AS u ON u.id = s.user_id
     WHERE s.token_hash = ?1
       AND s.expires_at >= ?2
     LIMIT 1`
  ).bind(tokenHash, now).first();

  if (!row) return null;

  await env.DB.prepare(
    `UPDATE account_sessions
        SET last_seen_at = ?1
      WHERE id = ?2`
  ).bind(now, row.session_id).run().catch(() => {});

  return row;
}

function getCookie(cookieHeader, name) {
  const prefix = `${name}=`;

  for (const part of cookieHeader.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }

  return "";
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
