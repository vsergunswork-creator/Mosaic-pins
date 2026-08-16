import { getOrderRecord, listOrderRecords, niceOrderId, updateOrderRecord } from "./_airtable-orders.js";
import { buildPaidEmail, buildShippedEmail, sendStoreEmail } from "./_email.js";

export async function sendPaidEmailForRecord(env, rec, { recheck = true } = {}) {
  if (!rec?.id) return { sent: false, reason: "missing_record" };
  if (recheck) rec = await getOrderRecord(env, rec.id);
  const f = rec.fields || {};
  const sentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  if (f[sentField] === true) return { sent: false, reason: "already_sent" };
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  if (String(f[statusField] || "").toLowerCase() !== String(env.PAID_STATUS_VALUE || "paid").toLowerCase()) {
    return { sent: false, reason: "not_paid" };
  }
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email");
  const nameField = String(env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name");
  const amountField = String(env.AIRTABLE_AMOUNT_FIELD || "Amount Total");
  const currencyField = String(env.AIRTABLE_CURRENCY_FIELD || "Currency");
  const to = String(f[emailField] || "").trim();
  if (!to) return { sent: false, reason: "missing_email" };

  const msg = buildPaidEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    amount: f[amountField],
    currency: f[currencyField],
  });
  await sendStoreEmail(env, { to, ...msg });
  await updateOrderRecord(env, rec.id, { [sentField]: true });
  return { sent: true, to, orderId: niceOrderId(rec, env) };
}

export async function sendShippedEmailForRecord(env, rec, { recheck = true } = {}) {
  if (!rec?.id) return { sent: false, reason: "missing_record" };
  if (recheck) rec = await getOrderRecord(env, rec.id);
  const f = rec.fields || {};
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const sentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  if (f[sentField] === true) return { sent: false, reason: "already_sent" };
  const tracking = String(f[trackingField] || "").trim();
  if (!tracking) return { sent: false, reason: "missing_tracking" };
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email");
  const nameField = String(env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name");
  const to = String(f[emailField] || "").trim();
  if (!to) return { sent: false, reason: "missing_email" };

  const carrierField = String(env.AIRTABLE_CARRIER_FIELD || "").trim();
  const carrier = carrierField && f[carrierField] ? String(f[carrierField]).trim() : "DPD / DHL";
  const msg = buildShippedEmail(env, {
    name: String(f[nameField] || "").trim(),
    orderId: niceOrderId(rec, env),
    tracking,
    carrier,
  });
  await sendStoreEmail(env, { to, ...msg });
  await updateOrderRecord(env, rec.id, { [sentField]: true });
  return { sent: true, to, orderId: niceOrderId(rec, env), tracking };
}

export async function runPaidSweep(env, { maxRecords = 20 } = {}) {
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const sentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const formula = `AND({${statusField}}='${paidValue}', NOT({${sentField}}))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });
  return process(list.records || [], (rec) => sendPaidEmailForRecord(env, rec));
}

export async function runShippedSweep(env, { maxRecords = 20 } = {}) {
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const sentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  const formula = `AND({${trackingField}}!='', NOT({${sentField}}))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });
  return process(list.records || [], (rec) => sendShippedEmailForRecord(env, rec));
}

export async function runNotificationSweep(env, { maxRecords = 25 } = {}) {
  // One Airtable list request per cron run instead of two.
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const paidSentField = String(env.AIRTABLE_PAID_SENT_FIELD || "Paid Email Sent");
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const shippedSentField = String(env.AIRTABLE_SHIPPED_FIELD || "Shipped Email Sent");
  const paidValue = String(env.PAID_STATUS_VALUE || "paid").replace(/'/g, "\\'");
  const formula = `OR(AND({${statusField}}='${paidValue}', NOT({${paidSentField}})), AND({${trackingField}}!='', NOT({${shippedSentField}})))`;
  const list = await listOrderRecords(env, { filterByFormula: formula, maxRecords });

  const paidResults = [];
  const shippedResults = [];
  let paidSent = 0, paidSkipped = 0, shippedSent = 0, shippedSkipped = 0;

  for (const rec of list.records || []) {
    const f = rec.fields || {};
    const paidPending = String(f[statusField] || "").toLowerCase() === String(env.PAID_STATUS_VALUE || "paid").toLowerCase() && f[paidSentField] !== true;
    const shippedPending = Boolean(String(f[trackingField] || "").trim()) && f[shippedSentField] !== true;

    if (paidPending) {
      try { const out = await sendPaidEmailForRecord(env, rec); paidResults.push({ id: rec.id, ...out }); out.sent ? paidSent++ : paidSkipped++; }
      catch (e) { paidSkipped++; paidResults.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) }); }
    }
    if (shippedPending) {
      try { const out = await sendShippedEmailForRecord(env, rec); shippedResults.push({ id: rec.id, ...out }); out.sent ? shippedSent++ : shippedSkipped++; }
      catch (e) { shippedSkipped++; shippedResults.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) }); }
    }
  }

  return {
    airtableQueries: 1,
    matchedOrders: (list.records || []).length,
    paid: { found: paidResults.length, sent: paidSent, skipped: paidSkipped, results: paidResults },
    shipped: { found: shippedResults.length, sent: shippedSent, skipped: shippedSkipped, results: shippedResults },
  };
}

async function process(records, fn) {
  const results = [];
  let sent = 0;
  let skipped = 0;
  for (const rec of records) {
    try {
      const out = await fn(rec);
      if (out.sent) sent++; else skipped++;
      results.push({ id: rec.id, ...out });
    } catch (e) {
      skipped++;
      results.push({ id: rec.id, sent: false, reason: "error", error: String(e?.message || e) });
    }
  }
  return { found: records.length, sent, skipped, results };
}
