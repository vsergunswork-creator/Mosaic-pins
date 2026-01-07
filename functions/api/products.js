export async function onRequestGet({ env }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const apiUrl = new URL(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`
    );

    // берём только активные товары
    apiUrl.searchParams.set("filterByFormula", "{Active}=TRUE()");
    apiUrl.searchParams.set("pageSize", "100");

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json();
    if (!r.ok) return json({ error: "Airtable error", details: data }, 400);

    const products = (data.records || []).map((rec) => {
      const f = rec.fields || {};

      const images = Array.isArray(f["Images"])
        ? f["Images"].map(img => img?.url).filter(Boolean)
        : [];

      return {
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
    });

    return new Response(JSON.stringify({ products }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
}

function asNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
    