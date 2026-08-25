// Shared Airtable product access for Mosaic Pins.
// Airtable is the source of truth. R2 is used only for durable product images.

import { cacheGet, cacheSet, cacheDel } from "./_cache.js";
import { eurToUsd, getEurUsdRate } from "./_fx.js";

export const PRODUCTS_CACHE_KEY = "cache:products:airtable:v8-material-i18n";
export const PRODUCTS_CACHE_TTL = 60; // keep catalog fresh while avoiding per-visit Airtable reads
export const PRODUCTS_FALLBACK_KEY = "cache:products:airtable:last_good:v8-material-i18n";
export const PRODUCTS_FALLBACK_TTL = 7 * 86400;

export function requireAirtableEnv(env) {
  const token = String(env.AIRTABLE_TOKEN || "").trim();
  const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
  const table = String(env.AIRTABLE_TABLE_NAME || "").trim();
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  if (!table) throw new Error("AIRTABLE_TABLE_NAME (Products) is not set");
  return { token, baseId, table };
}

export async function getProductsCatalog(env, { bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = await cacheGet(env, PRODUCTS_CACHE_KEY);
    if (cached) {
      try { return { products: JSON.parse(cached), cache: "HIT" }; } catch (_) {}
    }
  }

  try {
    // These reads are independent, so run them in parallel. This shortens the
    // cold-cache path without relaxing freshness: Airtable is still queried
    // normally whenever the 60-second catalog cache expires.
    //
    // Reuse the last healthy catalog only as a manifest of images already
    // mirrored to R2. It is NOT returned as current price/stock data here.
    const [knownR2Urls, records, materialTranslations, eurUsdRate] = await Promise.all([
      getKnownR2Urls(env),
      listAllProductRecords(env),
      listMaterialTranslations(env),
      getEurUsdRate(env),
    ]);

    // Normalization is mostly synchronous for already mirrored images, but a new
    // Airtable attachment may need an R2 HEAD/fetch/put. Use a small bounded pool
    // so one new image cannot serialize the whole catalog, while avoiding a burst
    // of hundreds of R2 operations.
    const normalized = await mapWithConcurrency(records, 8, (rec) =>
      normalizeAirtableProduct(env, rec, { knownR2Urls, eurUsdRate, materialTranslations })
    );
    const products = normalized.filter(Boolean);
    products.sort((a, b) => String(a.pin).localeCompare(String(b.pin)));

    const raw = JSON.stringify(products);
    await cacheSet(env, PRODUCTS_CACHE_KEY, raw, PRODUCTS_CACHE_TTL);
    await cacheSet(env, PRODUCTS_FALLBACK_KEY, raw, PRODUCTS_FALLBACK_TTL);
    return { products, cache: "MISS" };
  } catch (e) {
    if (!bypassCache) {
      const fallback = await cacheGet(env, PRODUCTS_FALLBACK_KEY);
      if (fallback) {
        try { return { products: JSON.parse(fallback), cache: "FALLBACK", warning: String(e?.message || e) }; } catch (_) {}
      }
    }
    throw e;
  }
}

export async function getProductByPin(env, pin, { fresh = false } = {}) {
  pin = String(pin || "").trim();
  if (!pin) return null;

  if (!fresh) {
    const { products } = await getProductsCatalog(env);
    return products.find((p) => p.pin === pin) || null;
  }

  const records = await findProductRecordsByPins(env, [pin]);
  if (!records.length) return null;
  const materialTranslations = await listMaterialTranslations(env);
  return await normalizeAirtableProduct(env, records[0], { materialTranslations });
}

export async function findProductRecordsByPins(env, pins) {
  const { token, baseId, table } = requireAirtableEnv(env);
  const PIN_FIELD = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();
  const unique = [...new Set((pins || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!unique.length) return [];

  // Airtable OR() formula. Split into chunks to stay safely below URL/formula limits.
  const out = [];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const clauses = chunk.map((pin) => `{${PIN_FIELD}}='${escapeFormulaString(pin)}'`);
    const formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(",")})`;

    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filterByFormula", formula);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable product lookup failed: ${r.status} ${safeJson(data)}`);
    out.push(...(Array.isArray(data.records) ? data.records : []));
  }
  return out;
}

export async function listAllProductRecords(env) {
  const { token, baseId, table } = requireAirtableEnv(env);
  const records = [];
  let offset = null;
  let guard = 0;

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable products failed: ${r.status} ${safeJson(data)}`);

    records.push(...(Array.isArray(data.records) ? data.records : []));
    offset = data.offset || null;
    guard++;
    if (guard > 50) throw new Error("Airtable pagination guard exceeded");
  } while (offset);

  return records;
}

export async function normalizeAirtableProduct(env, rec, { knownR2Urls = null, eurUsdRate = null, materialTranslations = null } = {}) {
  const f = rec?.fields || {};
  const PIN_FIELD = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();
  const pin = String(f[PIN_FIELD] ?? "").trim();
  if (!pin) return null;

  const active = f["Active"] === true;
  const images = await durableImages(env, pin, f["Images"], knownR2Urls);
  const priceEUR = toNumberOrNull(f["Price_EUR"]);
  const materials = normalizeMaterials(f["Materials"]);
  const fxRate = Number.isFinite(Number(eurUsdRate)) && Number(eurUsdRate) > 0
    ? Number(eurUsdRate)
    : await getEurUsdRate(env);

  return {
    recordId: String(rec.id || ""),
    pin,
    title: String(f["Title"] ?? pin),
    // Manual descriptions remain an override for special products.
    // Standard products can leave them empty: Airtable formula fields generate
    // EN/DE/RU/FR automatically from the Moonglow checkbox.
    description: firstNonEmptyText(f["Description"], f["Auto Description EN"]),
    descriptionDE: firstNonEmptyText(f["Description DE"], f["Auto Description DE"]),
    descriptionRU: firstNonEmptyText(f["Description RU"], f["Auto Description RU"]),
    descriptionFR: firstNonEmptyText(f["Description FR"], f["Auto Description FR"]),
    type: valueOrNull(f["Type"]),
    // Keep both the exact Airtable value and a normalized number. The storefront
    // prefers diameterRaw, so values such as 6,35 / Ø6,35 / 10 are never
    // reconstructed from unrelated data or an old cached representation.
    diameterRaw: f["Diameter"] ?? null,
    diameter: toNumberOrNull(f["Diameter"]),
    color: valueOrNull(f["Color"]),
    materials,
    materialsDE: localizeMaterials(materials, materialTranslations, "DE"),
    materialsRU: localizeMaterials(materials, materialTranslations, "RU"),
    materialsFR: localizeMaterials(materials, materialTranslations, "FR"),
    stock: Math.max(0, toInt(f["Stock"], 0)),
    price: {
      EUR: priceEUR,
      USD: eurToUsd(priceEUR, fxRate),
    },
    images,
    active,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let next = 0;
  const count = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));

  async function run() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await worker(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: count }, () => run()));
  return out;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export async function decrementAirtableStock(env, recordId, qty) {
  const { token, baseId, table } = requireAirtableEnv(env);
  recordId = String(recordId || "").trim();
  qty = Math.floor(Number(qty || 0));
  if (!recordId || !Number.isFinite(qty) || qty <= 0) throw new Error("Invalid stock decrement");

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const rec = await r1.json().catch(() => ({}));
  if (!r1.ok) throw new Error(`Airtable stock read failed: ${r1.status} ${safeJson(rec)}`);

  const current = Math.max(0, toInt(rec?.fields?.Stock, 0));
  if (qty > current) throw new Error(`Insufficient stock during payment finalization. Available=${current}, requested=${qty}`);
  const next = current - qty;

  const r2 = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { Stock: next } }),
  });
  const data = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error(`Airtable stock update failed: ${r2.status} ${safeJson(data)}`);

  await invalidateProductCache(env);
  return { current, next };
}

export async function invalidateProductCache(env) {
  await cacheDel(env, PRODUCTS_CACHE_KEY);
  // Keep last_good as emergency fallback. It will be overwritten on next healthy catalog refresh.
}

async function durableImages(env, pin, rawImages, knownR2Urls = null) {
  const list = Array.isArray(rawImages) ? rawImages : [];
  const out = [];
  const publicBase = String(env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const r2 = env.PRODUCT_IMAGES;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const src = typeof item === "string" ? item : String(item?.url || "").trim();
    if (!src) continue;

    // If R2 is not configured yet, Airtable URL is a temporary fallback.
    if (!r2 || !publicBase) {
      out.push(src);
      continue;
    }

    const attachmentId = String(item?.id || "").trim() || `legacy-${i + 1}`;
    const ext = detectExtension(item, src);
    const key = `products/${sanitize(pin)}/${sanitize(attachmentId)}.${ext}`;
    const publicUrl = `${publicBase}/${key}`;

    try {
      // If the previous healthy catalog already used this exact R2 URL, the
      // object was previously verified/mirrored. Skip the expensive HEAD call.
      if (knownR2Urls?.has(publicUrl)) {
        out.push(publicUrl);
        continue;
      }

      const exists = await r2.head(key);
      if (!exists) {
        const imageResp = await fetch(src);
        if (!imageResp.ok) throw new Error(`image ${imageResp.status}`);
        await r2.put(key, await imageResp.arrayBuffer(), {
          httpMetadata: {
            contentType: imageResp.headers.get("content-type") || contentTypeByExt(ext),
            cacheControl: "public, max-age=31536000, immutable",
          },
        });
      }
      knownR2Urls?.add(publicUrl);
      out.push(publicUrl);
    } catch (_) {
      // Never make the whole shop unavailable because one image mirror failed.
      out.push(src);
    }
  }
  return out;
}

async function getKnownR2Urls(env) {
  const set = new Set();
  try {
    const raw = await cacheGet(env, PRODUCTS_FALLBACK_KEY);
    if (!raw) return set;
    const previous = JSON.parse(raw);
    if (!Array.isArray(previous)) return set;
    for (const product of previous) {
      for (const url of (Array.isArray(product?.images) ? product.images : [])) {
        const s = String(url || "").trim();
        if (s) set.add(s);
      }
    }
  } catch (_) {}
  return set;
}

async function listMaterialTranslations(env) {
  const { token, baseId } = requireAirtableEnv(env);
  const table = String(env.AIRTABLE_MATERIAL_TRANSLATIONS_TABLE || "MaterialTranslations").trim();
  const out = new Map();
  let offset = null;
  let guard = 0;

  try {
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Airtable material translations failed: ${r.status} ${safeJson(data)}`);

      for (const rec of (Array.isArray(data.records) ? data.records : [])) {
        const f = rec?.fields || {};
        const material = String(f["Material"] ?? "").trim();
        if (!material) continue;
        out.set(material, {
          DE: String(f["DE"] ?? "").trim(),
          RU: String(f["RU"] ?? "").trim(),
          FR: String(f["FR"] ?? "").trim(),
        });
      }

      offset = data.offset || null;
      guard++;
      if (guard > 20) break;
    } while (offset);
  } catch (e) {
    // Never break the catalog if the optional translation dictionary is unavailable.
    console.warn("MaterialTranslations unavailable; using English material labels", e);
  }

  return out;
}

function localizeMaterials(materials, translations, language) {
  const map = translations instanceof Map ? translations : new Map();
  return (Array.isArray(materials) ? materials : []).map((material) => {
    const fallback = String(material || "");
    const translated = map.get(fallback)?.[language];
    return String(translated || fallback);
  });
}

function normalizeMaterials(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (v == null || v === "") return [];
  return [String(v)];
}
function valueOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function toNumberOrNull(v) {
  if (v == null || v === "") return null;

  // Airtable Diameter may be a Number, formula/text such as "6,35",
  // "Ø6,35", "6.35 mm", or a single-value array. Normalize all of
  // those to one numeric diameter for the storefront/filter logic.
  if (Array.isArray(v)) v = v.length ? v[0] : null;
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v)
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/,/g, ".");
  const match = s.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;

  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function escapeFormulaString(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function sanitize(s) { return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "_"); }
function detectExtension(item, url) {
  const filename = String(item?.filename || "").toLowerCase();
  const fromName = filename.match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (fromName) return normalizeExt(fromName);
  try {
    const path = new URL(url).pathname.toLowerCase();
    const fromUrl = path.match(/\.([a-z0-9]{2,5})$/)?.[1];
    if (fromUrl) return normalizeExt(fromUrl);
  } catch (_) {}
  return "jpg";
}
function normalizeExt(ext) {
  ext = String(ext || "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ["jpg", "png", "webp", "gif", "avif"].includes(ext) ? ext : "jpg";
}
function contentTypeByExt(ext) {
  return ({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" })[ext] || "image/jpeg";
}
function safeJson(x) { try { return JSON.stringify(x); } catch (_) { return String(x); } }
