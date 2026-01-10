// functions/api/product.js
// GET /api/product?pin=XXXX

export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const url = new URL(request.url);
    const pin = (url.searchParams.get("pin") || "").trim();
    if (!pin) return json({ error: "Missing pin" }, 400);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const formula = `{${pinField}}="${escapeForFormula(pin)}"`;

    const apiUrl = new URL(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`
    );
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Airtable error", details: data }, 400);

    const rec = data?.records?.[0];
    if (!rec) return json({ error: "Product not found" }, 404);

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
      stock: Number(f["Stock"] ?? 0),
      price: {
        EUR: asNumberOrNull(f["Price_EUR"]),
        USD: asNumberOrNull(f["Price_USD"]),
      },
      images,
    };

    return json({ product }, 200, { "Cache-Control": "public, max-age=60" });
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
}

function asNumberOrNull(v) {
  const n = Number(v);
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