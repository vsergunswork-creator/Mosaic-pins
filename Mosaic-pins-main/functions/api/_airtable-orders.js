// Shared Airtable Orders access for Mosaic Pins.
// Keep all order-table field plumbing in one place so Stripe, PayPal and notifications stay consistent.

export function ordersTable(env) {
  return String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders").trim();
}

export function requireOrdersEnv(env) {
  const token = String(env.AIRTABLE_TOKEN || "").trim();
  const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  return { token, baseId, table: ordersTable(env) };
}

export async function createOrderRecord(env, fields) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ fields }),
  });
  return parseOrThrow(r, "Airtable order create");
}

export async function updateOrderRecord(env, recordId, fields) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    headers: authHeaders(token, true),
    body: JSON.stringify({ fields }),
  });
  return parseOrThrow(r, "Airtable order update");
}

export async function getOrderRecord(env, recordId) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(r, "Airtable order read");
}

export async function findOrderByField(env, fieldName, value) {
  value = String(value || "").trim();
  if (!value) return null;
  const out = await listOrderRecords(env, {
    filterByFormula: `{${fieldName}}='${escapeFormulaString(value)}'`,
    maxRecords: 1,
  });
  return out.records?.[0] || null;
}

export async function listOrderRecords(env, { filterByFormula = "", maxRecords = 25, pageSize = 100 } = {}) {
  const { token, baseId, table } = requireOrdersEnv(env);
  const records = [];
  let offset = null;
  let guard = 0;
  const cap = Math.max(1, Math.floor(Number(maxRecords || 25)));

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(Math.min(100, pageSize)));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), { headers: authHeaders(token) });
    const data = await parseOrThrow(r, "Airtable order list");
    records.push(...(Array.isArray(data.records) ? data.records : []));
    if (records.length >= cap) break;
    offset = data.offset || null;
    guard++;
    if (guard > 20) throw new Error("Airtable orders pagination guard exceeded");
  } while (offset);

  return { records: records.slice(0, cap) };
}

export function niceOrderId(rec, env = {}) {
  const f = rec?.fields || {};
  const codeField = String(env.AIRTABLE_ORDER_CODE_FIELD || env.AIRTABLE_ORDER_ID_FIELDI || "OrderCode");
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(f[codeField] || f[idField] || f[stripeField] || rec?.id || "").trim();
}

export function escapeFormulaString(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function authHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseOrThrow(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${safeJson(data)}`);
  return data;
}

function safeJson(x) {
  try { return JSON.stringify(x); } catch (_) { return String(x); }
}
