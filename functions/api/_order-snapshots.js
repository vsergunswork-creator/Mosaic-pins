// Purchase-time order item snapshots stored in D1.
// Snapshot failures must never block a completed payment flow.

export async function upsertOrderItemSnapshots(env, {
  orderKey,
  provider,
  items,
  currency,
  createdAt,
} = {}) {
  if (!env.DB) {
    return { ok: false, skipped: true, reason: "DB binding is not configured" };
  }

  const safeOrderKey = String(orderKey || "").trim();
  const safeProvider = String(provider || "").trim().toLowerCase();
  const safeCurrency = String(currency || "").trim().toUpperCase();

  if (!safeOrderKey || !safeProvider || !safeCurrency) {
    return { ok: false, skipped: true, reason: "Missing snapshot order metadata" };
  }

  const createdSec = normalizeTimestamp(createdAt);
  const normalized = [];

  for (const raw of Array.isArray(items) ? items : []) {
    const pin = String(raw?.pin || "").trim();
    const title = String(raw?.title || raw?.pin || "").trim();
    const recordId = String(raw?.recordId || raw?.productRecordId || "").trim();
    const image = String(raw?.image || "").trim();
    const qty = Math.floor(Number(raw?.qty ?? raw?.quantity ?? 0));
    const unitPrice = Number(raw?.unitPrice ?? raw?.unit_price);
    const diameter = numberOrNull(raw?.diameter);

    // Legacy checkout payloads do not contain a purchase snapshot. Skip those
    // instead of inventing price/title data later.
    if (!pin || !title) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    normalized.push({
      id: crypto.randomUUID(),
      orderKey: safeOrderKey,
      provider: safeProvider,
      recordId,
      pin,
      title,
      image,
      diameter,
      qty,
      unitPrice,
      currency: safeCurrency,
      createdAt: createdSec,
    });
  }

  if (!normalized.length) {
    return { ok: true, written: 0, skipped: true, reason: "No snapshot-capable items" };
  }

  const statements = normalized.map((item) =>
    env.DB.prepare(
      `INSERT INTO order_item_snapshots
       (id, order_key, provider, product_record_id, pin, title, image, diameter,
        quantity, unit_price, currency, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(order_key, pin) DO UPDATE SET
         provider = excluded.provider,
         product_record_id = excluded.product_record_id,
         title = excluded.title,
         image = excluded.image,
         diameter = excluded.diameter,
         quantity = excluded.quantity,
         unit_price = excluded.unit_price,
         currency = excluded.currency,
         created_at = excluded.created_at`
    ).bind(
      item.id,
      item.orderKey,
      item.provider,
      item.recordId || null,
      item.pin,
      item.title,
      item.image || null,
      item.diameter,
      item.qty,
      item.unitPrice,
      item.currency,
      item.createdAt
    )
  );

  await env.DB.batch(statements);
  return { ok: true, written: normalized.length };
}

function normalizeTimestamp(value) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) {
    return direct > 10_000_000_000 ? Math.floor(direct / 1000) : Math.floor(direct);
  }

  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);

  return Math.floor(Date.now() / 1000);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
