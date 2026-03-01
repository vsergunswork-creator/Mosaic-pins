// functions/api/product.js
// GET /api/product?pin=XXXX

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 60;                  // ✅ product cache 60s
const FALLBACK_TTL_SEC = 7 * 86400;  // ✅ keep last good for a week

export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const url = new URL(request.url);
    const pin = (url.searchParams.get("pin") || "").trim();
    if (!pin) return json({ error: "Missing pin" }, 400);

    const pinField = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();

    // ✅ safer cache keys (include base/table/pinField to avoid cross-collisions)
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_TABLE_NAME || "").trim();
    const CACHE_KEY = `cache:product:v1:${baseId}:${table}:${pinField}:${pin}`;
    const FALLBACK_KEY = `cache:product:last_good:${baseId}:${table}:${pinField}:${pin}`;

    // ✅ 1) serve cache
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

    // ✅ only Active products
    const formula = `AND({${pinField}}="${escapeForFormula(pin)}", {Active}=TRUE())`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    // Optional: limit fields
    apiUrl.searchParams.append("fields[]", "PIN Code");
    apiUrl.searchParams.append("fields[]", "Title");
    apiUrl.searchParams.append("fields[]", "Description");
    apiUrl.searchParams.append("fields[]", "Type");
    apiUrl.searchParams.append("fields[]", "Diameter");
    apiUrl.searchParams.append("fields[]", "Color");
    apiUrl.searchParams.append("fields[]", "Materials");
    apiUrl.searchParams.append("fields[]", "Stock");
    apiUrl.searchParams.append("fields[]", "Price_EUR");
    apiUrl.searchParams.append("fields[]", "Price_USD");
    apiUrl.searchParams.append("fields[]", "Images");
    apiUrl.searchParams.append("fields[]", "Active");

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json().catch(() => ({}));

    // ✅ fallback if Airtable fails
    if (!r.ok) {
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
      return json({ error: "Airtable error", status: r.status, details: data }, 400);
    }

    const rec = data?.records?.[0];
    if (!rec) {
      // short negative cache
      const body = JSON.stringify({ error: "Product not found" });
      await cacheSet(env, CACHE_KEY, body, 30);
      return new Response(body, { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    const f = rec.fields || {};
    const images = Array.isArray(f["Images"]) ? f["Images"].map((x) => x?.url).filter(Boolean) : [];

    const product = {
      pin: String(f["PIN Code"] || pin),
      title: String(f["Title"] || "Untitled"),
      description: String(f["Description"] || ""),
      type: f["Type"] ?? null,
      diameter: f["Diameter"] ?? null,
      color: f["Color"] ?? null,
      materials: Array.isArray(f["Materials"]) ? f["Materials"] : [],
      stock: Math.max(0, Number(f["Stock"] ?? 0) || 0),
      price: {
        EUR: asNumberOrNull(f["Price_EUR"]),
        USD: asNumberOrNull(f["Price_USD"]),
      },
      images,
    };

    const body = JSON.stringify({ product });

    // ✅ 2) save cache + last_good
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
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

function asNumberOrNull(v) {
  if (v == null) return null;

  // Airtable может отдать число или строку: "22", "22.00", "22,00", "1 234,50"
  const s = String(v).trim();
  if (!s) return null;

  const normalized = s
    .replace(/\s+/g, "") // убрать пробелы
    .replace(",", ".");  // запятая -> точка

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function escapeForFormula(value) {
  return String(value).replace(/"/g, '\\"');
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}