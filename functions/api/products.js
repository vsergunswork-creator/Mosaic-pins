// functions/api/products.js
// GET /api/products
// Returns: { products: [...] }

export async function onRequestGet({ env, request }) {
  try {
    must(env.AIRTABLE_TOKEN, "AIRTABLE_TOKEN");
    must(env.AIRTABLE_BASE_ID, "AIRTABLE_BASE_ID");
    must(env.AIRTABLE_TABLE_NAME, "AIRTABLE_TABLE_NAME");

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: env.AIRTABLE_TABLE_NAME,
      // у Вас поле Active есть ✅
      filterByFormula: "{Active}=TRUE()",
      pageSize: 100,
      maxPagesGuard: 200, // 200*100=20000 товаров (огромный запас)
    });

    const products = records
      .map((rec) => {
        const f = rec.fields || {};

        const pin = String(f[pinField] || "").trim();
        if (!pin) return null;

        const images = extractImageUrls(f["Images"]);

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
          images,
        };
      })
      .filter(Boolean);

    return json(
      { products },
      200,
      { "Cache-Control": "public, max-age=60" }
    );
  } catch (e) {
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

// -------- helpers --------

function must(v, name) {
  if (!v) throw new Error(`${name} is not set`);
}

async function airtableFetchAll({ token, baseId, table, filterByFormula, pageSize = 100, maxPagesGuard = 100 }) {
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
    if (!r.ok) throw new Error(`Airtable error: ${r.status} ${JSON.stringify(data)}`);

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

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}