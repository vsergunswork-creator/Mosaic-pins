import {
  listOrderRecords,
  niceOrderId,
  escapeFormulaString,
} from "../_airtable-orders.js";
import { getProductsCatalog } from "../_airtable-products.js";

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
        orders: [],
      }, 401);
    }

    if (!user.email_verified_at) {
      return json({
        ok: false,
        authenticated: true,
        error: "Email is not verified",
        orders: [],
      }, 403);
    }

    const emailField = String(
      env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email"
    ).trim();

    const normalizedEmail = String(user.email || "").trim().toLowerCase();

    // Historical guest orders are linked automatically by the verified
    // customer email. No checkout changes are required for this first step.
    const filterByFormula =
      `LOWER({${emailField}})='${escapeFormulaString(normalizedEmail)}'`;

    const result = await listOrderRecords(env, {
      filterByFormula,
      maxRecords: 50,
      pageSize: 100,
    });

    // Reuse the normal cached product catalog so old orders can already show
    // the current product title/image/diameter without touching checkout.
    const { products: catalog = [] } = await getProductsCatalog(env);
    const productByRecordId = new Map(
      (catalog || [])
        .filter((product) => product?.recordId)
        .map((product) => [String(product.recordId), product])
    );

    // Prefer immutable purchase-time snapshots for orders that have them.
    // Historical orders created before snapshots existed keep the current
    // catalog fallback, so enabling snapshots cannot make old orders disappear.
    let snapshotsByOrderKey = new Map();
    try {
      snapshotsByOrderKey = await loadOrderItemSnapshots(
        env,
        result.records || []
      );
    } catch (snapshotError) {
      console.error("account/orders snapshot read failed; using catalog fallback", snapshotError);
    }

    const orders = (result.records || [])
      .map((record) => normalizeOrder(
        record,
        env,
        productByRecordId,
        snapshotsByOrderKey
      ))
      .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));

    return json({
      ok: true,
      authenticated: true,
      user: {
        email: user.email,
      },
      count: orders.length,
      orders,
    });

  } catch (error) {
    console.error("account/orders:", error);

    return json({
      ok: false,
      error: "Unable to load your orders right now.",
    }, 500);
  }
}

export async function onRequestPost() {
  return json({ ok: false, error: "Method not allowed" }, 405);
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

function normalizeOrder(
  record,
  env,
  productByRecordId = new Map(),
  snapshotsByOrderKey = new Map()
) {
  const f = record?.fields || {};

  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const amountField = String(env.AIRTABLE_AMOUNT_FIELD || "Amount Total");
  const currencyField = String(env.AIRTABLE_CURRENCY_FIELD || "Currency");
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");
  const quantityField = String(env.AIRTABLE_QUANTITY_FIELD || "Quantity");
  const countryField = String(env.AIRTABLE_SHIPPING_COUNTRY_FIELD || "Shipping Country");
  const refundField = String(env.AIRTABLE_REFUND_STATUS_FIELD || "Refund Status");
  const productsField = String(env.AIRTABLE_ORDER_PRODUCTS_FIELD || "Products");

  const linkedProductIds = Array.isArray(f[productsField])
    ? f[productsField].map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  const totalQuantity = finiteNumberOrNull(f[quantityField]);
  const orderKey = snapshotOrderKey(record, env);
  const snapshotRows = orderKey
    ? (snapshotsByOrderKey.get(orderKey) || [])
    : [];

  const snapshotItems = snapshotRows.map((row) => ({
    recordId: String(row.product_record_id || ""),
    pin: String(row.pin || ""),
    title: String(row.title || row.pin || ""),
    image: String(row.image || ""),
    diameter: finiteNumberOrNull(row.diameter),
    quantity: finiteNumberOrNull(row.quantity),
    unitPrice: finiteNumberOrNull(row.unit_price),
    currency: String(row.currency || f[currencyField] || "").toUpperCase(),
    snapshot: true,
  }));

  const catalogItems = linkedProductIds
    .map((recordId) => productByRecordId.get(recordId))
    .filter(Boolean)
    .map((product) => ({
      recordId: String(product.recordId || ""),
      pin: String(product.pin || ""),
      title: String(product.title || product.pin || ""),
      image: Array.isArray(product.images) && product.images.length
        ? String(product.images[0] || "")
        : "",
      diameter: finiteNumberOrNull(product.diameter),
      // Historical Orders only store total Quantity, not quantity per linked product.
      // If exactly one product is linked, its quantity is known. Otherwise keep null.
      quantity: linkedProductIds.length === 1 ? totalQuantity : null,
      unitPrice: null,
      currency: String(f[currencyField] || "").toUpperCase(),
      snapshot: false,
    }));

  const items = snapshotItems.length ? snapshotItems : catalogItems;

  return {
    orderId: niceOrderId(record, env),
    createdAt: String(f[createdField] || ""),
    status: String(f[statusField] || ""),
    refundStatus: String(f[refundField] || ""),
    amountTotal: finiteNumberOrNull(f[amountField]),
    currency: String(f[currencyField] || "").toUpperCase(),
    quantity: totalQuantity,
    shippingCountry: String(f[countryField] || ""),
    trackingNumber: String(f[trackingField] || ""),
    items,
  };
}

async function loadOrderItemSnapshots(env, records = []) {
  if (!env.DB) return new Map();

  const orderKeys = [...new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => snapshotOrderKey(record, env))
      .filter(Boolean)
  )];

  if (!orderKeys.length) return new Map();

  // account/orders currently loads at most 50 Airtable orders, so one D1 query
  // stays comfortably below SQLite/D1 bind-variable limits.
  const placeholders = orderKeys.map((_, index) => `?${index + 1}`).join(",");
  const query =
    `SELECT order_key, product_record_id, pin, title, image, diameter, ` +
    `quantity, unit_price, currency, created_at ` +
    `FROM order_item_snapshots ` +
    `WHERE order_key IN (${placeholders}) ` +
    `ORDER BY created_at ASC, pin ASC`;

  const response = await env.DB.prepare(query).bind(...orderKeys).all();
  const grouped = new Map();

  for (const row of Array.isArray(response?.results) ? response.results : []) {
    const key = String(row?.order_key || "").trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return grouped;
}

function snapshotOrderKey(record, env) {
  const f = record?.fields || {};
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(f[idField] || f[stripeField] || "").trim();
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function getCookie(cookieHeader, name) {
  const prefix = `${name}=`;

  for (const part of String(cookieHeader || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      return item.slice(prefix.length);
    }
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
