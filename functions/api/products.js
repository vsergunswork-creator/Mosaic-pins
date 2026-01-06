export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    // Можно будет позже вынести названия полей в env, но пока используем дефолты:
    const FIELD_PIN = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const FIELD_TITLE = env.AIRTABLE_TITLE_FIELD || "Title";
    const FIELD_DESC = env.AIRTABLE_DESC_FIELD || "Description";
    const FIELD_IMAGES = env.AIRTABLE_IMAGES_FIELD || "Images";
    const FIELD_STOCK = env.AIRTABLE_STOCK_FIELD || "Stock";
    const FIELD_ACTIVE = env.AIRTABLE_ACTIVE_FIELD || "Active";
    const FIELD_DIAMETER = env.AIRTABLE_DIAMETER_FIELD || "Diameter";
    const FIELD_MATERIALS = env.AIRTABLE_MATERIALS_FIELD || "Materials";
    const FIELD_PRICE_EUR = env.AIRTABLE_PRICE_EUR_FIELD || "Price EUR";
    const FIELD_PRICE_USD = env.AIRTABLE_PRICE_USD_FIELD || "Price USD";

    const url = new URL(request.url);
    const inStockOnly = url.searchParams.get("inStock") === "1"; // опционально
    const q = (url.searchParams.get("q") || "").trim().toLowerCase(); // опционально

    // Забираем записи страницами (если товаров много)
    const all = [];
    let offset;

    for (let page = 0; page < 10; page++) {
      const apiUrl = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`);
      apiUrl.searchParams.set("pageSize", "100");
      if (offset) apiUrl.searchParams.set("offset", offset);

      // Можно сортировать по любому полю позже
      // apiUrl.searchParams.set("sort[0][field]", FIELD_PIN);
      // apiUrl.searchParams.set("sort[0][direction]", "asc");

      const r = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
      });

      const data = await r.json();
      if (!r.ok) return json({ error: "Airtable error", details: data }, 400);

      const records = data.records || [];
      for (const rec of records) {
        const f = rec.fields || {};

        // Active по умолчанию считаем true, если поля нет
        const activeVal = f[FIELD_ACTIVE];
        const isActive = (typeof activeVal === "boolean") ? activeVal : true;
        if (!isActive) continue;

        const pin = f[FIELD_PIN];
        if (!pin) continue;

        const stock = Number(f[FIELD_STOCK] ?? 0);
        if (inStockOnly && !(stock > 0)) continue;

        const title = f[FIELD_TITLE] || String(pin);
        const description = f[FIELD_DESC] || "";

        // Images (Airtable attachments) -> массив url
        const imgs = Array.isArray(f[FIELD_IMAGES]) ? f[FIELD_IMAGES] : [];
        const imageUrls = imgs.map(x => x?.url).filter(Boolean);

        const materials = Array.isArray(f[FIELD_MATERIALS]) ? f[FIELD_MATERIALS] : (f[FIELD_MATERIALS] ? [f[FIELD_MATERIALS]] : []);
        const diameter = f[FIELD_DIAMETER] ?? null;

        const price = {
          EUR: asNumberOrNull(f[FIELD_PRICE_EUR]),
          USD: asNumberOrNull(f[FIELD_PRICE_USD]),
        };

        // Поиск (если захотим)
        if (q) {
          const hay = `${pin} ${title} ${materials.join(" ")} ${diameter ?? ""}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        all.push({
          pin: String(pin),
          title: String(title),
          description: String(description),
          diameter: (diameter === null ? null : Number(diameter)),
          materials,
          stock,
          images: imageUrls,
          price,
        });
      }

      offset = data.offset;
      if (!offset) break;
    }

    // Кэш на минуту (можно менять)
    return new Response(JSON.stringify({ products: all }), {
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
