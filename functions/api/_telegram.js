import { getOrderRecord, listOrderRecords, niceOrderId } from "./_airtable-orders.js";

// Paid-order Telegram alerts for the private Mosaic Pins order group.
// Delivery is best-effort and must never block payment finalization/customer email.
// D1 is used as the durable dedupe ledger; STRIPE_EVENTS_KV is a fallback.

const ALERT_TABLE = "telegram_order_alerts";
const META_TABLE = "telegram_alert_meta";
const START_META_KEY = "alerts_started_at";
const STALE_SENDING_SEC = 5 * 60;
const KV_TTL_SEC = 365 * 24 * 60 * 60;

export async function sendTelegramOrderAlertForRecord(env, rec, {
  provider = "",
  recheck = true,
} = {}) {
  if (!rec?.id) return { sent: false, reason: "missing_record" };

  // Initialize the service-start marker even if Telegram configuration/API later fails.
  // The cron fallback uses it so old historical paid orders are never backfilled accidentally.
  await ensureTelegramStartAt(env).catch(() => {});

  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  if (recheck) rec = await getOrderRecord(env, rec.id);
  const fields = rec?.fields || {};
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").toLowerCase();
  if (String(fields[statusField] || "").toLowerCase() !== paidValue) {
    return { sent: false, reason: "not_paid" };
  }

  const providerName = normalizeProvider(provider) || inferProvider(fields, env);
  const claim = await claimAlert(env, rec.id, {
    orderKey: stableOrderKey(rec, env),
    provider: providerName,
  });

  if (!claim.claimed) {
    return {
      sent: false,
      reason: claim.reason || "already_claimed",
      orderId: niceOrderId(rec, env),
    };
  }

  const text = buildTelegramOrderMessage(env, rec, { provider: providerName });

  try {
    const result = await sendTelegramMessage({ token, chatId, text });
    await markAlertSent(env, rec.id, result?.message_id ?? null);
    return {
      sent: true,
      orderId: niceOrderId(rec, env),
      messageId: result?.message_id ?? null,
    };
  } catch (error) {
    await markAlertFailed(env, rec.id, String(error?.message || error)).catch(() => {});
    throw error;
  }
}

export async function runTelegramPaidSweep(env, { maxRecords = 100 } = {}) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    return { configured: false, found: 0, sent: 0, skipped: 0, results: [] };
  }

  const startedAt = await ensureTelegramStartAt(env);
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const list = await listOrderRecords(env, {
    filterByFormula: `{${statusField}}='${paidValue}'`,
    maxRecords,
  });

  const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");
  const eligible = (list.records || []).filter((rec) => {
    const raw = rec?.fields?.[createdField];
    if (!raw) return false;
    const createdSec = Math.floor(Date.parse(String(raw)) / 1000);
    return Number.isFinite(createdSec) && createdSec >= startedAt;
  });

  const results = [];
  let sent = 0;
  let skipped = 0;

  for (const rec of eligible) {
    try {
      const out = await sendTelegramOrderAlertForRecord(env, rec, {
        provider: inferProvider(rec?.fields || {}, env),
        recheck: true,
      });
      out.sent ? sent++ : skipped++;
      results.push({ id: rec.id, ...out });
    } catch (error) {
      skipped++;
      results.push({
        id: rec.id,
        sent: false,
        reason: "error",
        error: String(error?.message || error),
      });
    }
  }

  return {
    configured: true,
    startedAt,
    found: eligible.length,
    sent,
    skipped,
    results,
  };
}

export function buildTelegramOrderMessage(env, rec, { provider = "" } = {}) {
  const f = rec?.fields || {};
  const orderId = niceOrderId(rec, env) || String(rec?.id || "").trim() || "Unknown";
  const countryField = String(env.AIRTABLE_SHIPPING_COUNTRY_FIELD || "Shipping Country");
  const amountField = String(env.AIRTABLE_AMOUNT_FIELD || "Amount Total");
  const currencyField = String(env.AIRTABLE_CURRENCY_FIELD || "Currency");
  const quantityField = String(env.AIRTABLE_QUANTITY_FIELD || "Quantity");

  const countryCode = String(f[countryField] || "").trim().toUpperCase();
  const flag = countryFlag(countryCode);
  const country = countryLabel(countryCode);
  const money = formatMoney(f[amountField], f[currencyField]);
  const qty = Math.max(0, Math.floor(Number(f[quantityField] || 0)));
  const providerName = normalizeProvider(provider) || inferProvider(f, env) || "Payment";

  const lines = [`🟢 NEW MOSAIC PINS ORDER ${orderId}`];
  if (countryCode) lines.push(`${flag ? `${flag} ` : ""}${country}`.trim());
  if (money) lines.push(`💰 ${money}`);
  if (qty > 0) lines.push(`📦 ${qty} ${qty === 1 ? "item" : "items"}`);
  lines.push(`💳 ${providerName}`);
  lines.push("");
  lines.push("🔎 Проверь Airtable");
  return lines.join("\n");
}

async function sendTelegramMessage({ token, chatId, text }) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const description = String(data?.description || `HTTP ${response.status}`).trim();
    throw new Error(`Telegram send failed: ${description}`);
  }
  return data?.result || {};
}

async function ensureTelegramStartAt(env) {
  const now = Math.floor(Date.now() / 1000);

  if (env.DB) {
    await ensureD1Schema(env);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ${META_TABLE} (key, value) VALUES (?1, ?2)`
    ).bind(START_META_KEY, String(now)).run();
    const row = await env.DB.prepare(
      `SELECT value FROM ${META_TABLE} WHERE key = ?1 LIMIT 1`
    ).bind(START_META_KEY).first();
    const stored = Number(row?.value);
    return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : now;
  }

  if (env.STRIPE_EVENTS_KV) {
    const key = "telegram_alerts:started_at";
    let value = Number(await env.STRIPE_EVENTS_KV.get(key));
    if (!Number.isFinite(value) || value <= 0) {
      value = now;
      await env.STRIPE_EVENTS_KV.put(key, String(value));
    }
    return Math.floor(value);
  }

  return now;
}

async function claimAlert(env, recordId, { orderKey, provider }) {
  const now = Math.floor(Date.now() / 1000);

  if (env.DB) {
    await ensureD1Schema(env);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ${ALERT_TABLE}
       (order_record_id, order_key, provider, status, attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)`
    ).bind(recordId, orderKey || null, provider || null, now).run();

    const current = await env.DB.prepare(
      `SELECT status, updated_at FROM ${ALERT_TABLE} WHERE order_record_id = ?1 LIMIT 1`
    ).bind(recordId).first();

    if (String(current?.status || "") === "sent") {
      return { claimed: false, reason: "already_sent" };
    }

    const staleBefore = now - STALE_SENDING_SEC;
    const result = await env.DB.prepare(
      `UPDATE ${ALERT_TABLE}
       SET status = 'sending', provider = COALESCE(?2, provider), order_key = COALESCE(?3, order_key),
           attempts = attempts + 1, updated_at = ?4, last_error = NULL
       WHERE order_record_id = ?1
         AND status != 'sent'
         AND (status != 'sending' OR updated_at <= ?5)`
    ).bind(recordId, provider || null, orderKey || null, now, staleBefore).run();

    if (Number(result?.meta?.changes || 0) < 1) {
      return { claimed: false, reason: "in_progress" };
    }
    return { claimed: true };
  }

  if (env.STRIPE_EVENTS_KV) {
    const sentKey = `telegram_paid_sent:${recordId}`;
    const lockKey = `telegram_paid_lock:${recordId}`;
    if (await env.STRIPE_EVENTS_KV.get(sentKey)) {
      return { claimed: false, reason: "already_sent" };
    }
    const existingLock = await env.STRIPE_EVENTS_KV.get(lockKey);
    if (existingLock) return { claimed: false, reason: "in_progress" };
    await env.STRIPE_EVENTS_KV.put(lockKey, String(now), { expirationTtl: STALE_SENDING_SEC });
    if (await env.STRIPE_EVENTS_KV.get(sentKey)) {
      await env.STRIPE_EVENTS_KV.delete(lockKey).catch(() => {});
      return { claimed: false, reason: "already_sent" };
    }
    return { claimed: true, kvLockKey: lockKey };
  }

  // No durable storage: do not risk duplicate alerts on retries.
  return { claimed: false, reason: "dedupe_storage_missing" };
}

async function markAlertSent(env, recordId, messageId) {
  const now = Math.floor(Date.now() / 1000);
  if (env.DB) {
    await env.DB.prepare(
      `UPDATE ${ALERT_TABLE}
       SET status = 'sent', telegram_message_id = ?2, updated_at = ?3, last_error = NULL
       WHERE order_record_id = ?1`
    ).bind(recordId, messageId == null ? null : String(messageId), now).run();
  }
  if (env.STRIPE_EVENTS_KV) {
    await env.STRIPE_EVENTS_KV.put(`telegram_paid_sent:${recordId}`, "1", { expirationTtl: KV_TTL_SEC });
    await env.STRIPE_EVENTS_KV.delete(`telegram_paid_lock:${recordId}`).catch(() => {});
  }
}

async function markAlertFailed(env, recordId, error) {
  const now = Math.floor(Date.now() / 1000);
  if (env.DB) {
    await env.DB.prepare(
      `UPDATE ${ALERT_TABLE}
       SET status = 'failed', updated_at = ?2, last_error = ?3
       WHERE order_record_id = ?1 AND status != 'sent'`
    ).bind(recordId, now, String(error || "").slice(0, 1000)).run();
  }
  if (env.STRIPE_EVENTS_KV) {
    await env.STRIPE_EVENTS_KV.delete(`telegram_paid_lock:${recordId}`).catch(() => {});
  }
}

async function ensureD1Schema(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${ALERT_TABLE} (
      order_record_id TEXT PRIMARY KEY,
      order_key TEXT,
      provider TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      telegram_message_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ).run();
}

function stableOrderKey(rec, env) {
  const f = rec?.fields || {};
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(f[idField] || f[stripeField] || rec?.id || "").trim();
}

function inferProvider(fields, env) {
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  const stripeSession = String(fields?.[stripeField] || "").trim();
  if (stripeSession) return "Stripe";

  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const orderId = String(fields?.[idField] || "").trim();
  if (orderId.startsWith("cs_")) return "Stripe";
  if (orderId) return "PayPal";
  return "";
}

function normalizeProvider(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "stripe") return "Stripe";
  if (v === "paypal" || v === "pay pal") return "PayPal";
  return String(value || "").trim();
}

function formatMoney(amount, currency) {
  if (amount === undefined || amount === null || String(amount).trim() === "") return "";
  const number = Number(amount);
  const code = String(currency || "").trim().toUpperCase();
  if (Number.isFinite(number) && /^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number);
    } catch (_) {}
  }
  return `${amount} ${code}`.trim();
}

function countryLabel(code) {
  const known = {
    US: "USA",
    GB: "UK",
  };
  return known[code] || code;
}

function countryFlag(code) {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}
