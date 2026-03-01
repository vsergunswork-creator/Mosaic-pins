// functions/api/products.js
// GET /api/products
// Returns: { products: [...] }

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 60;                  // ✅ products cache 60s
const FALLBACK_TTL_SEC = 7 * 86400;  // ✅ keep last good for a week

export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_TABLE_NAME || "").trim();
    const pinField = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();

    // ✅ cache keys include base/table/pinField to avoid collisions between envs
    const CACHE_KEY = `cache:products:v3:${baseId}:${table}:${pinField}`;
    const FALLBACK_KEY = `cache:products:last_good:${baseId}:${table}:${pinField}`;

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

    // ✅ only active products
    const filterByFormula = "{Active}=TRUE()";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 60,
      fields: [
        pinField,
        "Title",
        "Description",
        "Type",
        "Diameter",
        "Color",
        "Materials",
        "Stock",
        "Price_EUR",
        "Price_USD",
        "Images",
        "Active",
      ],
    });

    const products = records
      .map((rec) => {
        const f = rec?.fields || {};
        const pin = String(f[pinField] || "").trim();
        if (!pin) return null;

        return {
          pin,
          title: String(f["Title"] || "Untitled"),
          description: String(f["Description"] || ""),
          type: f["Type"] ?? null,
          diameter: f["Diameter"] ?? null,
          color: f["Color"] ?? null,
          materials: Array.isArray(f["Materials"]) ? f["Materials"] : [],
          stock: Math.max(0, toInt(f["Stock"], 0)),
          price: {
            EUR: asNumberOrNull(f["Price_EUR"]),
            USD: asNumberOrNull(f["Price_USD"]),
          },
          images: extractImageUrls(f["Images"]),
        };
      })
      .filter(Boolean)
      // ✅ stable deterministic order (avoid “jumping” list)
      .sort((a, b) => String(a.pin).localeCompare(String(b.pin), "en"));

    const body = JSON.stringify({ products });

    // ✅ 2) save cache + last_good
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return withCachingHeaders(body, {
      xCache: "MISS",
      sMaxage: 60,
      swr: 600,
      request,
    });
  } catch (e) {
    // ✅ 3) if Airtable fails — return last_good
    try {
      const baseId = String(env?.AIRTABLE_BASE_ID || "").trim();
      const table = String(env?.AIRTABLE_TABLE_NAME || "").trim();
      const pinField = String(env?.AIRTABLE_PIN_FIELD || "PIN Code").trim();
      const FALLBACK_KEY = `cache:products:last_good:${baseId}:${table}:${pinField}`;

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

async function airtableFetchAll({
  token,
  baseId,
  table,
  filterByFormula,
  pageSize = 100,
  maxPagesGuard = 60,
  fields = [],
}) {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

  let all = [];
  let offset = null;

  for (let page = 0; page < maxPagesGuard; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

    for (const f of fields) url.searchParams.append("fields[]", f);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // make error readable
      throw new Error(`Airtable error (${r.status}): ${safeJson(data)}`);
    }

    const records = Array.isArray(data.records) ? data.records : [];
    all = all.concat(records);

    offset = data.offset || null;
    if (!offset) break;
  }

  return all;
}

function extractImageUrls(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => x?.url).filter(Boolean);
}

function asNumberOrNull(v) {
  if (v == null) return null;

  // Airtable may return number or string like: "22", "22.00", "22,00", "1 234,50"
  const s = String(v).trim();
  if (!s) return null;

  const normalized = s
    .replace(/\s+/g, "") // remove spaces
    .replace(",", ".");  // comma -> dot

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

function safeJson(v) {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

// ✅ “professional” caching headers (+ optional ETag)
function withCachingHeaders(body, { xCache, sMaxage, swr, request }) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Cache", String(xCache || ""));
  headers.set("Cache-Control", `public, max-age=0, s-maxage=${Number(sMaxage) || 0}, stale-while-revalidate=${Number(swr) || 0}`);

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
  // unsigned 32-bit
  const u = h >>> 0;
  return `W/"${u.toString(16)}"`;
}