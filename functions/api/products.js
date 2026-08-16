// GET /api/products
// Airtable is the source of truth. Catalog is cached automatically for 3 minutes.

import { getProductsCatalog, PRODUCTS_CACHE_TTL } from "./_airtable-products.js";

export async function onRequestGet({ env, request }) {
  try {
    const { products, cache, warning } = await getProductsCatalog(env);
    const visible = products.filter((p) => p.active).map(({ active, ...p }) => p);
    const body = JSON.stringify({ products: visible });
    return respond(body, request, cache, warning);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Products unavailable", details: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

function respond(body, request, cache, warning) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Cache": String(cache || ""),
  });
  if (warning) headers.set("X-Data-Warning", "fallback");
  const etag = weakEtag(body);
  headers.set("ETag", etag);
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
function weakEtag(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return `W/"${(h >>> 0).toString(16)}"`;
}
