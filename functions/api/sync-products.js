// functions/api/sync-products.js
// GET /api/sync-products
// Sync Products: Airtable -> D1
// ✅ writes active=1 only if Airtable {Active} is checked

export async function onRequestGet({ env, request }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = String(env.AIRTABLE_TABLE_NAME || "").trim();

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!TABLE) throw new Error("AIRTABLE_TABLE_NAME missing");
    if (!env.DB) throw new Error("DB (D1 binding) missing");

    // Optional protection (if you want): ?secret=...
    // const SECRET = String(env.SYNC_SECRET || "").trim();
    // if (SECRET) {
    //   const url = new URL(request.url);
    //   if (String(url.searchParams.get("secret") || "") !== SECRET) {
    //     return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    //   }
    // }

    // ---------- LOAD FROM AIRTABLE (pagination) ----------
    const allRecords = [];
    let offset = null;

    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Airtable error ${r.status}: ${safeJson(data)}`);

      const records = Array.isArray(data.records) ? data.records : [];
      allRecords.push(...records);

      offset = data.offset || null;
      if (!offset) break;
    }

    // ---------- INSERT/REPLACE INTO D1 ----------
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

    let inserted = 0;
    let skipped = 0;

    for (const rec of allRecords) {
      const f = rec?.fields || {};

      const pin = String(f["PIN Code"] ?? "").trim();
      if (!pin) {
        skipped++;
        continue;
      }

      const title = String(f["Title"] ?? pin);
      const description = String(f["Description"] ?? "");

      // Airtable Attachments: [{url, ...}, ...] OR sometimes strings
      const imagesRaw = f["Images"];
      let images = [];
      if (Array.isArray(imagesRaw)) {
        images = imagesRaw
          .map((x) => {
            if (!x) return null;
            if (typeof x === "string") return x;
            if (typeof x === "object" && x.url) return String(x.url);
            return null;
          })
          .filter(Boolean);
      }

      const stock = toInt(f["Stock"], 0);
      const priceEur = toNumber(f["Price_EUR"], 0);
      const priceUsd = toNumber(f["Price_USD"], 0);

      // ✅ IMPORTANT: read Active checkbox from Airtable
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

      inserted++;
    }

    return Response.json({
      ok: true,
      synced: inserted,
      skipped,
      total_from_airtable: allRecords.length,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// ---------- helpers ----------
function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function toNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}