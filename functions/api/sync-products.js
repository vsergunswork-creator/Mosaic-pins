// functions/api/sync-products.js
// GET /api/sync-products
// Sync all products from Airtable -> D1

export async function onRequestGet({ env }) {
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

      // (опционально) можно подтянуть только нужные поля:
      // [
      //  "PIN Code","Title","Description","Type","Diameter","Color","Materials",
      //  "Stock","Price_EUR","Price_USD","Images","Active"
      // ].forEach(f => url.searchParams.append("fields[]", f));

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

    let synced = 0;
    let skipped = 0;

    // ✅ Если у Вас уже есть колонки type/diameter/color/materials — используйте этот INSERT.
    // Если каких-то колонок нет — скажите, и я дам "упрощённый" вариант под Вашу схему.
    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO products (
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rec of allRecords) {
      const f = rec?.fields || {};

      const pin = String(f["PIN Code"] ?? "").trim();
      if (!pin) {
        skipped++;
        continue;
      }

      const title = String(f["Title"] ?? pin);
      const description = String(f["Description"] ?? "");

      const type = f["Type"] == null ? null : String(f["Type"]);
      const diameter = toNumberOrNull(f["Diameter"]);
      const color = f["Color"] == null ? null : String(f["Color"]);

      // Materials: может быть multi-select array или string
      const materialsRaw = f["Materials"];
      const materials = normalizeStringArray(materialsRaw);

      // Images: attachments[] -> urls[]
      const imagesRaw = f["Images"];
      const images = normalizeImageUrls(imagesRaw);

      const stock = toIntSafe(f["Stock"], 0);
      const priceEur = toNumberSafe(f["Price_EUR"], 0);
      const priceUsd = toNumberSafe(f["Price_USD"], 0);

      // Active: если в Airtable есть {Active} (checkbox)
      // Airtable отдаёт true/false или может отсутствовать.
      const active = f["Active"] === false ? 0 : 1;

      await stmt
        .bind(
          pin,
          title,
          description,
          type,                              // null ok
          diameter,                          // null ok
          color,                             // null ok
          JSON.stringify(materials),         // always string
          JSON.stringify(images),            // always string
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

// ---------------- helpers ----------------

function normalizeImageUrls(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (!x) return null;
      if (typeof x === "string") return x;
      if (typeof x === "object" && x.url) return String(x.url);
      return null;
    })
    .filter(Boolean);
}

function normalizeStringArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

function toIntSafe(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toNumberSafe(v, fallback = 0) {
  if (v == null) return fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}