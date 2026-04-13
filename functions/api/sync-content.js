// functions/api/sync-content.js

export async function onRequestGet({ env }) {
  try {
    const token = String(env.AIRTABLE_TOKEN || "").trim();
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_CONTENT_TABLE || "SiteContent").trim();

    if (!token || !baseId) throw new Error("Missing Airtable config");
    if (!env.DB) throw new Error("D1 not connected");

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(JSON.stringify(data));

    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO content (
        key, heroImage, heroTitle, heroSubtitle, aboutBody, gallery
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;

    for (const rec of data.records || []) {
      const f = rec.fields || {};

      const key = String(f["Key"] || "").trim();
      if (!key) continue;

      const heroImage = Array.isArray(f["Hero Image"])
        ? (f["Hero Image"][0]?.url || "")
        : "";

      const gallery = Array.isArray(f["Gallery"])
        ? f["Gallery"].map(x => x?.url).filter(Boolean)
        : [];

      await stmt.bind(
        key,
        heroImage,
        String(f["Hero Title"] || ""),
        String(f["Hero Subtitle"] || ""),
        String(f["About Body"] || ""),
        JSON.stringify(gallery)
      ).run();

      inserted++;
    }

    return Response.json({ ok: true, inserted });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message) });
  }
}