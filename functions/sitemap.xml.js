// functions/sitemap.xml.js
// D1 version
// Generates sitemap from static pages + active products in D1

export async function onRequestGet({ env, request }) {
  try {
    if (!env.DB) return text("DB (D1 binding) is not set", 500);

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

    const res = await env.DB.prepare(`
      SELECT pin
      FROM products
      WHERE COALESCE(active, 1) = 1
      ORDER BY pin ASC
      LIMIT 5000
    `).all();

    const rows = Array.isArray(res?.results) ? res.results : [];

    const productPages = rows
      .map((row) => String(row?.pin || "").trim())
      .filter(Boolean)
      .map((pin) => `${origin}/p/${encodeURIComponent(pin)}`);

    const all = [...staticPages, ...productPages];
    const now = new Date().toISOString();

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      all.map((loc) => {
        const isHome = loc === `${origin}/`;
        const priority = isHome ? "1.0" : "0.7";

        return (
          `  <url>\n` +
          `    <loc>${escapeXml(loc)}</loc>\n` +
          `    <lastmod>${now}</lastmod>\n` +
          `    <changefreq>weekly</changefreq>\n` +
          `    <priority>${priority}</priority>\n` +
          `  </url>\n`
        );
      }).join("") +
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
  return new Response(String(msg), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}