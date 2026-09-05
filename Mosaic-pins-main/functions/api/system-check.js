// Safe production readiness check. Never exposes secret values.
export async function onRequestGet({ env }) {
  const paypalMode = String(env.PAYPAL_MODE || "").trim().toLowerCase();
  const checks = {
    airtableToken: has(env.AIRTABLE_TOKEN),
    airtableBase: has(env.AIRTABLE_BASE_ID),
    productsTable: has(env.AIRTABLE_TABLE_NAME),
    ordersTable: has(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders"),
    stripeSecret: has(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: has(env.STRIPE_WEBHOOK_SECRET),
    paypalClient: has(env.PAYPAL_CLIENT_ID),
    paypalSecret: has(env.PAYPAL_CLIENT_SECRET),
    paypalModeValid: ["live", "sandbox"].includes(paypalMode),
    paypalLive: paypalMode === "live",
    mailFrom: has(env.MAIL_FROM),
    mailReplyTo: has(env.MAIL_REPLY_TO),
    kv: Boolean(env.STRIPE_EVENTS_KV),
    r2Images: Boolean(env.PRODUCT_IMAGES),
    r2PublicUrl: has(env.R2_PUBLIC_BASE_URL),
  };

  const airtable = { products: "not_tested", orders: "not_tested" };
  if (checks.airtableToken && checks.airtableBase) {
    if (checks.productsTable) airtable.products = await probeTable(env, String(env.AIRTABLE_TABLE_NAME));
    if (checks.ordersTable) airtable.orders = await probeTable(env, String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders"));
  }

  const airtableReachable = airtable.products === "200" && airtable.orders === "200";
  const ok = Object.values(checks).every(Boolean) && airtableReachable;

  return Response.json({
    ok,
    checks,
    airtableReachable,
    airtable,
    paypalMode: checks.paypalModeValid ? paypalMode : "INVALID_OR_MISSING",
    note: paypalMode === "sandbox" ? "PayPal is configured but still in SANDBOX." : undefined,
  }, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

async function probeTable(env, table) {
  try {
    const u = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
    u.searchParams.set("maxRecords", "1");
    const r = await fetch(u, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    return String(r.status);
  } catch (_) {
    return "error";
  }
}

function has(v) { return Boolean(String(v || "").trim()); }
