export async function onRequestGet() {
  const base = "https://mosaicpins.space";

  try {
    // тянем товары из вашего API
    const r = await fetch(`${base}/api/products`, { cf: { cacheTtl: 0 } });
    const data = await r.json().catch(() => ({}));

    const products = Array.isArray(data?.products)
      ? data.products
      : (Array.isArray(data) ? data : []);

    const staticUrls = [
      { loc: `${base}/`, changefreq: "daily", priority: "1.0" },
      { loc: `${base}/about`, changefreq: "monthly", priority: "0.6" },
      { loc: `${base}/shipping`, changefreq: "monthly", priority: "0.6" },
      { loc: `${base}/returns`, changefreq: "monthly", priority: "0.6" },
      { loc: `${base}/reviews`, changefreq: "weekly", priority: "0.6" },
      { loc: `${base}/impressum.html`, changefreq: "yearly", priority: "0.3" },
      { loc: `${base}/privacy.html`, changefreq: "yearly", priority: "0.3" },
    ];

    const productUrls = products
      .filter(p => p?.pin)
      .map(p => ({
        loc: `${base}/product.html?pin=${encodeURIComponent(String(p.pin))}`,
        changefreq: "weekly",
        priority: "0.8",
      }));

    const urls = [...staticUrls, ...productUrls];

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(u =>
        `  <url>\n` +
        `    <loc>${u.loc}</loc>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        `    <priority>${u.priority}</priority>\n` +
        `  </url>\n`
      ).join("") +
      `</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });

  } catch (e) {
    return new Response("sitemap error", { status: 500 });
  }
}