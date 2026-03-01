export async function onRequestGet({ env }) {
  try {
    const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
    const BASE_ID = env.AIRTABLE_BASE_ID;
    const TABLE = env.AIRTABLE_TABLE_NAME;

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");

    // загрузка из Airtable
    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}?pageSize=100`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    });

    const data = await r.json();
    const records = data.records || [];

    let inserted = 0;

    for (const rec of records) {
      const f = rec.fields || {};

      await env.DB.prepare(`
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
      `).bind(
        f["PIN Code"],
        f["Title"] || "",
        f["Description"] || "",
        JSON.stringify(f["Images"] || []),
        Number(f["Stock"] || 0),
        Number(f["Price_EUR"] || 0),
        Number(f["Price_USD"] || 0)
      ).run();

      inserted++;
    }

    return Response.json({
      ok: true,
      synced: inserted,
    });

  } catch (e) {
    return Response.json({
      ok: false,
      error: String(e.message),
    }, { status: 500 });
  }
}