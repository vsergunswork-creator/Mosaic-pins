export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const url = new URL(request.url);
    const pin = (url.searchParams.get("pin") || "").trim();
    if (!pin) return json({ error: "Missing pin" }, 400);

    const apiUrl = new URL(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`
    );

    // ищем по вашему полю "PIN Code"
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", `{PIN Code}="${escapeForFormula(pin)}"`);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json();
    if (!r.ok) return json({ error: "Airtable error", details: data }, 400);

    const rec = (data.records || [])[0];
    if (!rec) return json({ error: "Not found" }, 404);

    const f = rec.fields || {};

    // Active (если вдруг кто-то откроет ссылку напрямую)
    if (f["Active"] === false) return json({ error: "Inactive product" }, 403);

    const images = Array.isArray(f["Images"])
      ? f["Images"].map(img => img?.url).filter(Boolean)
      : [];

    const product = {
      pin: String(f["PIN Code"] || rec.id),
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
      stripe_product_id: f["Stripe Products ID"] ?? null,
      stripe_price_id: f["Stripe Prince ID"] ?? null,
    };

    return json({ product });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
    