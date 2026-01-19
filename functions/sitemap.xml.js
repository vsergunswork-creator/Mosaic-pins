export async function onRequestGet({ request, env }) {
  const base = new URL(request.url).origin;

  // Статические страницы
  const staticUrls = [
    { loc: `${base}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${base}/about`, changefreq: "monthly", priority: "0.6" },
    { loc: `${base}/shipping`, changefreq: "monthly", priority: "0.6" },
    { loc: `${base}/returns`, changefreq: "monthly", priority: "0.6" },
    { loc: `${base}/reviews`, changefreq: "weekly", priority: "0.6" },
    { loc: `${base}/impressum.html`, changefreq: "yearly", priority: "0.3" },
    { loc: `${base}/privacy.html`, changefreq: "yearly", priority: "0.3" },
  ];

  // Пытаемся получить товары из API (важно: берем relative URL)
  let productUrls = [];
  try {
    const apiUrl = new URL("/api/products", base).toString();

    const r = await fetch(apiUrl, {
      method: "GET",
      // Если включен кэш CF - пусть будет свежо:
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { "Accept": "application/json" },
    });

    const data = await r.json().catch(() => ({}));

    const products = Array.isArray(data?.products)
      ? data.products
      : (Array.isArray(data) ? data : []);

    productUrls = products
      .filter(p => p && p.pin)
      .map(p => ({
        loc: `${base}/product.html?pin=${encodeURIComponent(String(p.pin))}`,
        changefreq: "weekly",
        priority: "0.8",
      }));
  } catch (_) {
    // если API временно упал — sitemap всё равно отдастся со статикой
    productUrls = [];
  }

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
      // лучше не кэшировать, чтобы товары появлялись быстро
      "Cache-Control": "no-store",
    },
  });
}