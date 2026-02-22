// functions/api/products.js
// GET /api/products
// Returns: { products: [...] }

import { cacheGet, cacheSet } from "./_cache.js";

const CACHE_KEY = "cache:products:v2";
const CACHE_FALLBACK_KEY = "cache:products:last_good";
const TTL_SEC = 60;                 // ✅ 30–60 сек (можете поставить 45)
const FALLBACK_TTL_SEC = 7 * 86400; // ✅ держим “последнюю удачную” неделю

export async function onRequestGet({ env }) {
  try {
    // ✅ 1) отдать кэш мгновенно
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          // CDN/browser cache (выдерживает всплески трафика)
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
          "X-Cache": "HIT",
        },
      });
    }

    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const table = env.AIRTABLE_TABLE_NAME;

    // ✅ только активные
    const filterByFormula = "{Active}=TRUE()";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 60,
      // ✅ уменьшаем payload (меньше трафика и быстрее)
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
        const f = rec.fields || {};
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
          stock: toInt(f["Stock"], 0),
          price: {
            EUR: asNumberOrNull(f["Price_EUR"]),
            USD: asNumberOrNull(f["Price_USD"]),
          },
          images: extractImageUrls(f["Images"]),
        };
      })
      .filter(Boolean);

    const body = JSON.stringify({ products });

    // ✅ 2) записать кэш на 60 сек + last_good на неделю
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, CACHE_FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
        "X-Cache": "MISS",
      },
    });
  } catch (e) {
    // ✅ 3) если Airtable упал/лимит — отдаём last_good
    try {
      const last = await cacheGet(env, CACHE_FALLBACK_KEY);
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

    return json({ error: "Server error", details: String(e) }, 500);
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
    if (!r.ok) throw new Error(`Airtable error: ${JSON.stringify(data)}`);

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
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}