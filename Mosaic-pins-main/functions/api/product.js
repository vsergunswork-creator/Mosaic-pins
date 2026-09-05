// GET /api/product?pin=XXXX
// Uses the same automatic Airtable catalog cache as /api/products.

import { getProductByPin, PRODUCTS_CACHE_TTL } from "./_airtable-products.js";

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url);
    const pin = String(url.searchParams.get("pin") || "").trim();
    if (!pin) return json({ error: "Missing pin" }, 400);

    const product = await getProductByPin(env, pin);
    if (!product || !product.active) return json({ error: "Product not found" }, 404);
    const { active, ...visible } = product;

    return new Response(JSON.stringify({ product: visible }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return json({ error: "Product unavailable", details: String(e?.message || e) }, 500);
  }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
