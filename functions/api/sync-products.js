export async function onRequestGet({ env }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = String(env.AIRTABLE_TABLE_NAME || "").trim();

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!TABLE) throw new Error("AIRTABLE_TABLE_NAME missing");
    if (!env.DB) throw new Error("DB (D1 binding) missing");

    // --- Airtable fetch (with pagination) ---
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
      if (!r.ok) {
        throw new Error(`Airtable error: ${r.status} ${JSON.stringify(data)}`);
      }

      const records = Array.isArray(data.records) ? data.records : [];
      allRecords.push(...records);

      offset = data.offset || null;
      if (!offset) break;
    }

    let inserted = 0;
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
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const rec of allRecords) {
      const f = rec?.fields || {};

      // ✅ Ensure no undefined goes into D1
      const pin = String(f["PIN Code"] ?? "").trim();
      if (!pin) {
        skipped++;
        continue; // can't insert without primary key
      }

      const title = String(f["Title"] ?? pin);
      const description = String(f["Description"] ?? "");

      // Airtable "Attachments" обычно массив объектов.
      // Если у Вас уже массив URL строк — тоже ок.
      const imagesRaw = f["Images"];
      let images = [];
      if (Array.isArray(imagesRaw)) {
        images = imagesRaw
          .map((x) => {
            if (!x) return null;
            if (typeof x === "string") return x;
            // attachment object { url: "..." }
            if (typeof x === "object" && x.url) return String(x.url);
            return null;
          })
          .filter(Boolean);
      }

      const stock = Number(f["Stock"] ?? 0);
      const priceEur = Number(f["Price_EUR"] ?? 0);
      const priceUsd = Number(f["Price_USD"] ?? 0);

      await stmt
        .bind(
          pin,
          title,
          description,
          JSON.stringify(images),
          Number.isFinite(stock) ? stock : 0,
          Number.isFinite(priceEur) ? priceEur : 0,
          Number.isFinite(priceUsd) ? priceUsd : 0
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
    return Response.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}