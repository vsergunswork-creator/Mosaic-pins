// functions/api/feed.xml.js
// D1 version (NO Airtable)
// Google Merchant Center feed

export async function onRequestGet({ env, request }) {
  try {
    if (!env.DB) return text("DB is not set", 500);

    const baseUrl = getBaseUrl(request);

    const res = await env.DB.prepare(`
      SELECT
        pin,
        title,
        description,
        images,
        stock,
        price_usd,
        type,
        diameter,
        materials
      FROM products
      WHERE COALESCE(active, 1) = 1
      ORDER BY pin ASC
      LIMIT 5000
    `).all();

    const rows = Array.isArray(res?.results) ? res.results : [];

    const items = rows
      .map((r) => {
        const pin = String(r.pin || "").trim();
        if (!pin) return null;

        const title = String(r.title || "Untitled");

        const price = Number(r.price_usd);
        if (!Number.isFinite(price)) return null;

        const images = parseJsonArray(r.images);
        if (!images.length) return null;

        const stock = Number(r.stock || 0);
        const availability = stock > 0 ? "in stock" : "out of stock";

        const description = cleanText(r.description);

        const extra = [
          `PIN: ${pin}`,
          r.type ? `Type: ${r.type}` : null,
          r.diameter ? `Diameter: ${r.diameter} mm` : null,
          Array.isArray(parseJsonArray(r.materials)) && parseJsonArray(r.materials).length
            ? `Materials: ${parseJsonArray(r.materials).join(", ")}`
            : null,
        ].filter(Boolean);

        const fullDesc = [description, extra.join(" • ")]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 5000);

        return {
          id: pin,
          title,
          description: fullDesc || title,
          link: `${baseUrl}/p/${encodeURIComponent(pin)}`,
          image_link: images[0],
          availability,
          price: `${price.toFixed(2)} USD`,
          brand: "Mosaic Pins",
          condition: "new",
          gender: "unisex",
          age_group: "adult",
          color: "Multicolor",
        };
      })
      .filter(Boolean);

    const xml = buildXml(items, baseUrl);

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return text("Feed error: " + String(e?.message || e), 500);
  }
}

// ---------- XML ----------
function buildXml(items, baseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Mosaic Pins</title>
<link>${baseUrl}/</link>
<description>Handcrafted mosaic pins</description>

${items
  .map(
    (it) => `
<item>
<g:id>${xml(it.id)}</g:id>
<title>${xml(it.title)}</title>
<description>${xml(it.description)}</description>
<link>${xml(it.link)}</link>
<g:image_link>${xml(it.image_link)}</g:image_link>
<g:availability>${xml(it.availability)}</g:availability>
<g:price>${xml(it.price)}</g:price>
<g:brand>${xml(it.brand)}</g:brand>
<g:condition>${xml(it.condition)}</g:condition>
<g:gender>${xml(it.gender)}</g:gender>
<g:age_group>${xml(it.age_group)}</g:age_group>
<g:color>${xml(it.color)}</g:color>
</item>`
  )
  .join("")}

</channel>
</rss>`;
}

// ---------- helpers ----------
function parseJsonArray(v) {
  if (!v) return [];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanText(s) {
  return String(s || "")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function xml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function text(msg, status = 200) {
  return new Response(msg, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function getBaseUrl(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}