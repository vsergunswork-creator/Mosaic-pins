// functions/api/products.js
// GET /api/products
// Returns: { products: [...] }  (from D1)
// ✅ Uses KV cache via ./_cache.js

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 60;                  // ✅ products cache 60s
const FALLBACK_TTL_SEC = 7 * 86400;  // ✅ keep last good for a week

export async function onRequestGet({ env, request }) {
  try {
    if (!env.DB) return json({ error: "D1 binding env.DB is not set" }, 500);

    // ✅ cache keys include DB name if provided (optional)
    const DB_NAME = String(env.D1_NAME || env.DB_NAME || "db").trim();
    const CACHE_KEY = `cache:products:d1:v1:${DB_NAME}`;
    const FALLBACK_KEY = `cache:products:last_good:d1:${DB_NAME}`;

    // ✅ 1) serve cache instantly
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return withCachingHeaders(cached, {
        xCache: "HIT",
        sMaxage: 60,
        swr: 600,
        request,
      });
    }

    // ✅ 2) read from D1 (only active products)
    // Assumed schema (as you created):
    // products(pin TEXT UNIQUE, title TEXT, description TEXT, type TEXT, diameter REAL,
    //          color TEXT, materials TEXT, images TEXT, stock INTEGER, price_eur REAL,
    //          price_usd REAL, active INTEGER, updated_at DATETIME ...)
    const sql = `
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
      WHERE COALESCE(active, 1) = 1
      ORDER BY pin ASC
      LIMIT 1000
    `;

    const res = await env.DB.prepare(sql).all();
    const rows = Array.isArray(res?.results) ? res.results : [];

    const products = rows
      .map((r) => {
        const pin = String(r?.pin || "").trim();
        if (!pin) return null;

        return {
          pin,
          title: String(r?.title || "Untitled"),
          description: String(r?.description || ""),
          type: r?.type ?? null,
          diameter: (r?.diameter == null) ? null : asNumberOrNull(r.diameter),
          color: r?.color ?? null,
          materials: parseJsonArray(r?.materials),
          stock: Math.max(0, toInt(r?.stock, 0)),
          price: {
            EUR: asNumberOrNull(r?.price_eur),
            USD: asNumberOrNull(r?.price_usd),
          },
          images: parseJsonArray(r?.images),
        };
      })
      .filter(Boolean);

    const body = JSON.stringify({ products });

    // ✅ 3) save cache + last_good
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return withCachingHeaders(body, {
      xCache: "MISS",
      sMaxage: 60,
      swr: 600,
      request,
    });
  } catch (e) {
    // ✅ 4) fallback to last_good on any failure
    try {
      const DB_NAME = String(env?.D1_NAME || env?.DB_NAME || "db").trim();
      const FALLBACK_KEY = `cache:products:last_good:d1:${DB_NAME}`;
      const last = await cacheGet(env, FALLBACK_KEY);

      if (last) {
        return withCachingHeaders(last, {
          xCache: "FALLBACK",
          sMaxage: 30,
          swr: 600,
          request,
        });
      }
    } catch (_) {}

    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

// ---------------- Helpers ----------------

function parseJsonArray(v) {
  // D1 stores JSON as TEXT (e.g. '["a","b"]') or null
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(Boolean);

  const s = String(v).trim();
  if (!s) return [];

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    return [];
  } catch (_) {
    // If accidentally stored as plain string url, return as single-item array
    if (s.startsWith("http://") || s.startsWith("https://")) return [s];
    return [];
  }
}

function asNumberOrNull(v) {
  if (v == null) return null;

  const s = String(v).trim();
  if (!s) return null;

  // allow "22", "22.00", "22,00", "1 234,50"
  const normalized = s.replace(/\s+/g, "").replace(",", ".");
  const n = Number(normalized);

  return Number.isFinite(n) ? n : null;
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

// ✅ “professional” caching headers (+ optional ETag)
function withCachingHeaders(body, { xCache, sMaxage, swr, request }) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Cache", String(xCache || ""));
  headers.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${Number(sMaxage) || 0}, stale-while-revalidate=${Number(swr) || 0}`
  );

  // Optional ETag (helps browser/CDN revalidation)
  const etag = weakEtag(body);
  headers.set("ETag", etag);

  const inm = request?.headers?.get?.("if-none-match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { status: 200, headers });
}

// Simple weak etag without crypto libs
function weakEtag(str) {
  // djb2 hash
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  const u = h >>> 0; // unsigned 32-bit
  return `W/"${u.toString(16)}"`;
}