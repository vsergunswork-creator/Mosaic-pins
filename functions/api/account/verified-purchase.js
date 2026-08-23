import {
  listOrderRecords,
  niceOrderId,
  escapeFormulaString,
} from "../_airtable-orders.js";

// Reusable purchase check used by both the account test endpoint and Reviews.
// The result is tied to the currently authenticated + verified email, an
// eligible paid/shipped Airtable order, and the immutable D1 item snapshot.
export async function verifyPurchaseForRequest({ request, env, pin, orderId = "" }) {
  if (!env.DB) {
    return {
      ok: false,
      authenticated: false,
      verifiedPurchase: false,
      error: "DB binding is not configured",
      status: 500,
    };
  }

  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return {
      ok: true,
      authenticated: false,
      verifiedPurchase: false,
      status: 401,
    };
  }

  if (!user.email_verified_at) {
    return {
      ok: false,
      authenticated: true,
      verifiedPurchase: false,
      error: "Email is not verified",
      status: 403,
    };
  }

  const normalizedPin = String(pin || "").trim();
  const requestedOrderId = String(orderId || "").trim();

  if (!normalizedPin) {
    return {
      ok: false,
      authenticated: true,
      verifiedPurchase: false,
      error: "pin is required",
      status: 400,
    };
  }

  if (normalizedPin.length > 120 || requestedOrderId.length > 120) {
    return {
      ok: false,
      authenticated: true,
      verifiedPurchase: false,
      error: "purchase reference is too long",
      status: 400,
    };
  }

  const emailField = String(
    env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email"
  ).trim();
  const statusField = String(
    env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status"
  ).trim();
  const normalizedEmail = String(user.email || "").trim().toLowerCase();

  // A shipped order was paid before it was shipped, so both statuses remain
  // eligible for a purchase-linked review.
  const filterByFormula =
    `AND(` +
    `LOWER({${emailField}})='${escapeFormulaString(normalizedEmail)}',` +
    `OR(LOWER({${statusField}})='paid',LOWER({${statusField}})='shipped')` +
    `)`;

  const result = await listOrderRecords(env, {
    filterByFormula,
    maxRecords: 100,
    pageSize: 100,
  });

  let records = Array.isArray(result?.records) ? result.records : [];

  // When My Orders sends a specific visible order id, bind the review to that
  // exact order instead of silently choosing another purchase of the same PIN.
  if (requestedOrderId) {
    const wanted = requestedOrderId.toLowerCase();
    records = records.filter((record) =>
      String(niceOrderId(record, env) || "").trim().toLowerCase() === wanted
    );
  }

  const orderByKey = new Map();
  for (const record of records) {
    const key = snapshotOrderKey(record, env);
    if (key && !orderByKey.has(key)) orderByKey.set(key, record);
  }

  const orderKeys = [...orderByKey.keys()];
  if (!orderKeys.length) {
    return {
      ok: true,
      authenticated: true,
      verifiedPurchase: false,
      pin: normalizedPin,
      status: 200,
    };
  }

  const snapshot = await findPurchasedSnapshot(env, orderKeys, normalizedPin);
  if (!snapshot) {
    return {
      ok: true,
      authenticated: true,
      verifiedPurchase: false,
      pin: normalizedPin,
      status: 200,
    };
  }

  const order = orderByKey.get(String(snapshot.order_key || "")) || null;
  const fields = order?.fields || {};
  const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");

  return {
    ok: true,
    authenticated: true,
    verifiedPurchase: true,
    pin: String(snapshot.pin || normalizedPin),
    purchase: {
      orderId: order ? niceOrderId(order, env) : String(snapshot.order_key || ""),
      orderKey: String(snapshot.order_key || ""),
      provider: String(snapshot.provider || ""),
      productRecordId: String(snapshot.product_record_id || ""),
      title: String(snapshot.title || snapshot.pin || ""),
      image: String(snapshot.image || ""),
      diameter: finiteNumberOrNull(snapshot.diameter),
      quantity: finiteNumberOrNull(snapshot.quantity),
      unitPrice: finiteNumberOrNull(snapshot.unit_price),
      currency: String(snapshot.currency || "").toUpperCase(),
      purchasedAt: String(fields[createdField] || ""),
    },
    status: 200,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const result = await verifyPurchaseForRequest({
      request,
      env,
      pin: url.searchParams.get("pin"),
      orderId: url.searchParams.get("order"),
    });

    const { status = 200, ...payload } = result;
    return json(payload, status);
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
    `SELECT order_key, provider, product_record_id, pin, title, image, diameter, ` +
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

  for (const part of String(cookieHeader || "").split(";")) {
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
