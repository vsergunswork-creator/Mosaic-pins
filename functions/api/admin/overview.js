import { json, requireAdmin } from "./_auth.js";
import { listRecords } from "./_airtable.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const [products, orders, reviews] = await Promise.all([
      listRecords(env, String(env.AIRTABLE_TABLE_NAME || "Products"), { maxRecords: 2000, fields: ["Stock", "Active", "Price_EUR"] }),
      listRecords(env, String(env.AIRTABLE_ORDERS_TABLE_NAME || "Orders"), { maxRecords: 2000, fields: ["Order Status", "Refund Status", "Tracking Number", "Amount Total", "Currency", "Created At"] }),
      listRecords(env, String(env.AIRTABLE_REVIEWS_TABLE || "Reviews"), { maxRecords: 2000, fields: ["Active", "Rating"] }),
    ]);

    const active = products.filter((r) => r.fields?.Active === true);
    const outOfStock = active.filter((r) => Number(r.fields?.Stock || 0) <= 0).length;
    const lowStock = active.filter((r) => Number(r.fields?.Stock || 0) > 0 && Number(r.fields?.Stock || 0) <= 3).length;
    const paid = orders.filter((r) => String(r.fields?.["Order Status"] || "").toLowerCase() === "paid" && String(r.fields?.["Refund Status"] || "not_refunded") !== "refunded");
    const toShip = paid.filter((r) => !String(r.fields?.["Tracking Number"] || "").trim()).length;
    const revenueByCurrency = {};
    for (const r of paid) {
      const c = String(r.fields?.Currency || "EUR").toUpperCase();
      const amount = Number(r.fields?.["Amount Total"] || 0);
      if (Number.isFinite(amount)) revenueByCurrency[c] = (revenueByCurrency[c] || 0) + amount;
    }

    return json({
      ok: true,
      stats: {
        products: products.length,
        activeProducts: active.length,
        outOfStock,
        lowStock,
        orders: orders.length,
        paidOrders: paid.length,
        toShip,
        activeReviews: reviews.filter((r) => r.fields?.Active === true).length,
        reviews: reviews.length,
        revenueByCurrency,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
