// functions/api/products.js
// GET /api/products
// Returns: { products: [...] }

export async function onRequestGet({ env }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const table = env.AIRTABLE_TABLE_NAME;

    // ✅ у Вас поле Active есть
    const filterByFormula = "{Active}=TRUE()";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 60, // 60*100 = 6000 товаров (с запасом)
    });

    const products = records
      .map((rec) => {
        const f = rec.fields || {};

        const pin = String(f[pinField] || "").trim();
        if (!pin) return null;

        const title = String(f["Title"] || "Untitled");
        const stock = toInt(f["Stock"], 0);

        const price = {
          EUR: asNumberOrNull(f["Price_EUR"]),
          USD: asNumberOrNull(f["Price_USD"]),
        };

        const images = extractImageUrls(f["Images"]);

        return {
          pin,
          title,

          description: String(f["Description"] || ""),
          type: f["Type"] ?? null,
          diameter: f["Diameter"] ?? null,
          color: f["Color"] ?? null,
          materials: Array.isArray(f["Materials"]) ? f["Materials"] : [],

          stock,
          price,
          images,
        };
      })
      .filter(Boolean);

    return new Response(JSON.stringify({ products }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
}

// ---------------- Helpers ----------------

async function airtableFetchAll({ token, baseId, table, filterByFormula, pageSize = 100, maxPagesGuard = 60 }) {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

  let all = [];
  let offset = null;

  for (let page = 0; page < maxPagesGuard; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);

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