// functions/api/sync-products.js
// GET /api/sync-products
// Sync products from Airtable -> Cloudflare D1 (env.DB)
// IMPORTANT: active = 1 ONLY if Airtable {Active} === true

export async function onRequestGet({ env, request }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = String(env.AIRTABLE_TABLE_NAME || "").trim();

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!TABLE) throw new Error("AIRTABLE_TABLE_NAME missing");
    if (!env.DB) throw new Error("DB (D1 binding) missing");

    // --- Airtable fetch (pagination) ---
    const allRecords = [];
    let offset = null;

    for (let page = 0; page < 50; page++) {
      const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Airtable error: ${r.status} ${safeJson(data)}`);

      const records = Array.isArray(data.records) ? data.records : [];
      allRecords.push(...records);

      offset = data.offset || null;
      if (!offset) break;
    }

    // --- Upsert into D1 ---
    let synced = 0;
    let skipped = 0;

    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO products (
        pin,
        title,
        description,
        images,
        stock,
        price_eur,
        price_usd,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rec of allRecords) {
      const f = rec?.fields || {};

      const pin = String(f["PIN Code"] ?? "").trim();
      if (!pin) {
        skipped++;
        continue; // cannot insert without primary key
      }

      const title = String(f["Title"] ?? pin);
      const description = String(f["Description"] ?? "");

      // Airtable attachments array -> array of urls
      const images = normalizeImages(f["Images"]);

      const stock = toInt(f["Stock"], 0);
      const priceEur = toNumber(f["Price_EUR"], 0);
      const priceUsd = toNumber(f["Price_USD"], 0);

      // ✅ FIX: active ONLY when Airtable Active === true
      const active = f["Active"] === true ? 1 : 0;

      await stmt
        .bind(
          pin,
          title,
          description,
          JSON.stringify(images),
          stock,
          priceEur,
          priceUsd,
          active
        )
        .run();

      synced++;
    }

    return Response.json({
      ok: true,
      synced,
      skipped,
      total_from_airtable: allRecords.length,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// ---------------- Helpers ----------------

function normalizeImages(imagesRaw) {
  if (!Array.isArray(imagesRaw)) return [];
  return imagesRaw
    .map((x) => {
      if (!x) return null;
      if (typeof x === "string") return x.trim() || null;
      if (typeof x === "object" && x.url) return String(x.url).trim() || null;
      return null;
    })
    .filter(Boolean);
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toNumber(v, fallback = 0) {
  if (v == null) return fallback;

  // supports "22", "22.00", "22,00", "1 234,50"
  const s = String(v).trim();
  if (!s) return fallback;

  const normalized = s.replace(/\s+/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}