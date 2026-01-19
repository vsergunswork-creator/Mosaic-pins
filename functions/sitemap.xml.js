// functions/sitemap.xml.js
export async function onRequestGet({ env, request }) {
  try {
    // --- env checks ---
    if (!env.AIRTABLE_TOKEN) return text("AIRTABLE_TOKEN is not set", 500);
    if (!env.AIRTABLE_BASE_ID) return text("AIRTABLE_BASE_ID is not set", 500);
    if (!env.AIRTABLE_TABLE_NAME) return text("AIRTABLE_TABLE_NAME is not set", 500);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const table = env.AIRTABLE_TABLE_NAME;

    // Только активные товары (если поля Active нет — можно удалить формулу)
    const filterByFormula = "{Active}=TRUE()";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 60,
    });

    const pins = records
      .map((rec) => String((rec.fields || {})[pinField] || "").trim())
      .filter(Boolean);

    const url = new URL(request.url);
    const origin = url.origin;

    const staticPages = [
      `${origin}/`,
      `${origin}/about`,
      `${origin}/shipping`,
      `${origin}/returns`,
      `${origin}/reviews`,
      `${origin}/privacy.html`,
      `${origin}/impressum.html`,
    ];

    const productPages = pins.map((pin) => `${origin}/p/${encodeURIComponent(pin)}`);

    const all = [...staticPages, ...productPages];

    const now = new Date().toISOString();

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      all
        .map((loc) => {
          return (
            `  <url>\n` +
            `    <loc>${escapeXml(loc)}</loc>\n` +
            `    <lastmod>${now}</lastmod>\n` +
            `    <changefreq>weekly</changefreq>\n` +
            `    <priority>${loc.endsWith("/") ? "1.0" : "0.7"}</priority>\n` +
            `  </url>\n`
          );
        })
        .join("") +
      `</urlset>\n`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return text("Sitemap error: " + String(e?.message || e), 500);
  }
}

// ---------- helpers ----------
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

function escapeXml(s) {
  return String(s || "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

function text(msg, status = 200) {
  return new Response(String(msg), { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}