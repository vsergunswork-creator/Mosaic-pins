// functions/sitemap.xml.js
// GET /sitemap.xml
// Generates sitemap dynamically from Airtable (only Active=TRUE())
// Includes: static pages + /p/{PIN}

export async function onRequestGet({ env, request }) {
  try {
    // ---- env checks ----
    if (!env.AIRTABLE_TOKEN) return text("AIRTABLE_TOKEN is not set", 500);
    if (!env.AIRTABLE_BASE_ID) return text("AIRTABLE_BASE_ID is not set", 500);
    if (!env.AIRTABLE_TABLE_NAME) return text("AIRTABLE_TABLE_NAME is not set", 500);

    const table = env.AIRTABLE_TABLE_NAME;
    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code"; // у Вас поле так и называется
    const activeField = env.AIRTABLE_ACTIVE_FIELD || "Active";

    // домен берём из запроса, чтобы было корректно и для www/без www
    const url = new URL(request.url);
    const origin = url.origin; // https://mosaicpins.space

    // ---- Airtable fetch (only active) ----
    const filterByFormula = `{${activeField}}=TRUE()`;

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 80,
    });

    const pins = records
      .map((r) => String(r?.fields?.[pinField] || "").trim())
      .filter(Boolean);

    // ---- static pages (ваши страницы) ----
    const staticUrls = [
      { loc: `${origin}/`, changefreq: "daily", priority: 1.0 },
      { loc: `${origin}/about.html`, changefreq: "monthly", priority: 0.6 },
      { loc: `${origin}/shipping.html`, changefreq: "monthly", priority: 0.6 },
      { loc: `${origin}/returns.html`, changefreq: "monthly", priority: 0.6 },
      { loc: `${origin}/reviews.html`, changefreq: "weekly", priority: 0.6 },
      { loc: `${origin}/privacy.html`, changefreq: "yearly", priority: 0.3 },
      { loc: `${origin}/impressum.html`, changefreq: "yearly", priority: 0.3 },
    ];

    // ---- product URLs ----
    // Используем короткие красивые ссылки: /p/PIN
    // (они у Вас редиректят на product.html?pin=PIN — это ок)
    const productUrls = pins.map((pin) => ({
      loc: `${origin}/p/${encodeURIComponent(pin)}`,
      changefreq: "weekly",
      priority: 0.8,
    }));

    const all = [...staticUrls, ...productUrls];

    const xml = buildSitemapXml(all);

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // можно кэшировать, чтобы не дергать Airtable постоянно
        "Cache-Control": "public, max-age=600", // 10 минут
      },
    });
  } catch (e) {
    return text(`Sitemap error: ${String(e?.message || e)}`, 500);
  }
}

// ---------------- Helpers ----------------

async function airtableFetchAll({
  token,
  baseId,
  table,
  filterByFormula,
  pageSize = 100,
  maxPagesGuard = 80,
}) {
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

function buildSitemapXml(items) {
  const esc = (s) =>
    String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));

  const body = items
    .map((it) => {
      const loc = esc(it.loc);
      const cf = it.changefreq ? `<changefreq>${esc(it.changefreq)}</changefreq>` : "";
      const pr = (typeof it.priority === "number")
        ? `<priority>${it.priority.toFixed(1)}</priority>`
        : "";
      return `<url><loc>${loc}</loc>${cf}${pr}</url>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    body +
    `</urlset>`;
}

function text(msg, status = 200) {
  return new Response(String(msg), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}