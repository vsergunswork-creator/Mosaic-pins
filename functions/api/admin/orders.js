import { json, requireAdmin } from "./_auth.js";
import { getRecord, listRecords, updateRecord } from "./_airtable.js";
import { sendShippedEmailForRecord } from "../_notifications.js";

const EDITABLE = new Set([
  "Customer Name", "Customer Email", "Telefon", "Shipping Address", "Shipping Country", "Shipping City", "Shipping Postal Code", "Shipping State/Region", "Language", "Tracking Number"
]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const ordersTable = String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders");
    const productsTable = String(env.AIRTABLE_TABLE_NAME || "Products");
    const [orders, products] = await Promise.all([
      listRecords(env, ordersTable, { maxRecords: 3000, sort: [{ field: "Created At", direction: "desc" }] }),
      listRecords(env, productsTable, { maxRecords: 3000, fields: ["PIN Code", "Title", "Images"] }),
    ]);
    const pmap = new Map(products.map((r) => [r.id, {
      id: r.id,
      pin: String(r.fields?.["PIN Code"] || ""),
      title: String(r.fields?.Title || ""),
      image: r.fields?.Images?.[0]?.thumbnails?.small?.url || r.fields?.Images?.[0]?.url || "",
    }]));
    return json({ ok: true, orders: orders.map((r) => normalize(r, pmap)) });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing order id" }, 400);
    const fields = {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (!EDITABLE.has(k)) continue;
      fields[k] = String(v ?? "").trim();
    }
    if (!Object.keys(fields).length) return json({ ok: false, error: "Nothing to update" }, 400);
    const table = String(env.AIRTABLE_ORDERS_TABLE_NAME || env.AIRTABLE_ORDERS_TABLE || "Orders");
    let rec = await updateRecord(env, table, id, fields);
    let shippedEmail = null;
    if (Object.prototype.hasOwnProperty.call(fields, "Tracking Number") && fields["Tracking Number"] && body.sendShippedEmail !== false) {
      const status = String(rec?.fields?.["Order Status"] || "").toLowerCase();
      const refund = String(rec?.fields?.["Refund Status"] || "not_refunded").toLowerCase();
      if (status === "paid" && refund !== "refunded") {
        try {
          shippedEmail = await sendShippedEmailForRecord(env, rec, { recheck: true });
          rec = await getRecord(env, table, id);
        } catch (e) {
          shippedEmail = { sent: false, reason: "error", error: String(e?.message || e) };
        }
      } else {
        shippedEmail = { sent: false, reason: "not_eligible" };
      }
    }
    return json({ ok: true, order: normalize(rec, new Map()), shippedEmail });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

function normalize(rec, pmap) {
  const f = rec?.fields || {};
  const productIds = Array.isArray(f.Products) ? f.Products : [];
  return {
    id: rec?.id || "",
    orderId: String(f.OrderCode || f["Order ID"] || ""),
    rawOrderId: String(f["Order ID"] || ""),
    createdAt: String(f["Created At"] || ""),
    status: String(f["Order Status"] || ""),
    refundStatus: String(f["Refund Status"] || ""),
    amount: number(f["Amount Total"]),
    currency: String(f.Currency || "EUR"),
    quantity: number(f.Quantity),
    customerName: String(f["Customer Name"] || ""),
    customerEmail: String(f["Customer Email"] || ""),
    phone: String(f.Telefon || ""),
    shippingAddress: String(f["Shipping Address"] || ""),
    shippingCountry: String(f["Shipping Country"] || ""),
    shippingCity: String(f["Shipping City"] || ""),
    shippingPostalCode: String(f["Shipping Postal Code"] || ""),
    shippingState: String(f["Shipping State/Region"] || ""),
    language: String(f.Language || ""),
    trackingNumber: String(f["Tracking Number"] || ""),
    paidEmailSent: f["Paid Email Sent"] === true,
    shippedEmailSent: f["Shipped Email Sent"] === true,
    invoiceNumber: String(f["Invoice Number"] || ""),
    invoiceDate: String(f["Invoice Date"] || ""),
    invoiceCreated: f["Invoice Created"] === true,
    invoicePdf: f["Invoice PDF"]?.[0]?.url || "",
    products: productIds.map((id) => pmap.get(id) || { id, pin: "", title: "", image: "" }),
    stripeSessionId: String(f["Stripe Session ID"] || ""),
    paymentIntentId: String(f["Payment Intent ID"] || ""),
  };
}
function number(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
