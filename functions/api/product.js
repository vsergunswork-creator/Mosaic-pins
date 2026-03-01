// functions/api/product.js
// GET /api/product?pin=XXXX
// ✅ D1 version (no Airtable). Returns: { product: {...} }

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 60;                  // cache 60s
const FALLBACK_TTL_SEC = 7 * 86400;  // keep last good for a week

export async function onRequestGet({ env, request }) {
  try {
    if (!env.DB) return json({ error: "DB binding is not set (D1)" }, 500);

    const url = new URL(request.url);
    const pin = (url.searchParams.get("pin") || "").trim();
    if (!pin) return json({ error: "Missing pin" }, 400);

    // ✅ cache keys (D1-based)
    const CACHE_KEY = `cache:product_d1:v1:${pin}`;
    const FALLBACK_KEY = `cache:product_d1:last_good:${pin}`;

    // 1) serve cache
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
          "X-Cache": "HIT",
        },
      });
    }

    // 2) query D1
    const row = await env.DB
      .prepare(
        `
        SELECT
          pin,
          title,
          description,
          type,
          diameter,
          color,
          materials,
          images,
          stock,
          price_eur,
          price_usd,
          active
        FROM products
        WHERE pin = ?
        LIMIT 1
        `
      )
      .bind(pin)
      .first();

    if (!row || Number(row.active) !== 1) {
      // short negative cache
      const body = JSON.stringify({ error: "Product not found" });
      await cacheSet(env, CACHE_KEY, body, 30);
      return new Response(body, {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const product = normalizeProductRow(row);

    const body = JSON.stringify({ product });

    // 3) save cache + last_good
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
        "X-Cache": "MISS",
      },
    });
  } catch (e) {
    // fallback: last good if something goes wrong with D1
    try {
      const url = new URL(request.url);
      const pin = (url.searchParams.get("pin") || "").trim();
      const FALLBACK_KEY = `cache:product_d1:last_good:${pin}`;
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=600",
            "X-Cache": "FALLBACK",
          },
        });
      }
    } catch (_) {}

    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Helpers ----------------

function normalizeProductRow(row) {
  // images/materials stored as JSON string (recommended)
  const images = parseJsonArray(row.images);
  const materials = parseJsonArray(row.materials);

  const diameter =
    row.diameter == null || row.diameter === "" ? null : Number(row.diameter);

  const priceEUR = row.price_eur == null ? null : Number(row.price_eur);
  const priceUSD = row.price_usd == null ? null : Number(row.price_usd);

  return {
    pin: String(row.pin),
    title: String(row.title || "Untitled"),
    description: String(row.description || ""),
    type: row.type == null ? null : String(row.type),
    diameter: Number.isFinite(diameter) ? diameter : null,
    color: row.color == null ? null : String(row.color),
    materials,
    stock: Math.max(0, toInt(row.stock, 0)),
    price: {
      EUR: Number.isFinite(priceEUR) ? priceEUR : null,
      USD: Number.isFinite(priceUSD) ? priceUSD : null,
    },
    images,
  };
}

function parseJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}