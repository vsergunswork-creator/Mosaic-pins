export async function onRequestGet({ env }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = "SiteContent";

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!env.DB) throw new Error("DB missing");

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    });

    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));

    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO content (
        key,
        heroImage,
        heroTitle,
        heroSubtitle,
        aboutBody,
        gallery,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;

    for (const rec of data.records || []) {
      const f = rec.fields || {};

      const key = String(f["Key"] || "").trim();
      if (!key) continue;

      const heroImage = Array.isArray(f["Hero Image"])
        ? f["Hero Image"][0]?.url || ""
        : "";

      const gallery = Array.isArray(f["Gallery"])
        ? f["Gallery"].map(x => x?.url).filter(Boolean)
        : [];

      const active = f["Active"] === true ? 1 : 0;

      await stmt.bind(
        key,
        heroImage,
        String(f["Hero Title"] || ""),
        String(f["Hero Subtitle"] || ""),
        String(f["About Body"] || ""),
        JSON.stringify(gallery),
        active
      ).run();

      inserted++;
    }

    return Response.json({ ok: true, inserted });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message) }, { status: 500 });
  }
}