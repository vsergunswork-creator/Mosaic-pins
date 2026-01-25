// functions/api/feed.xml.js
// GET /api/feed.xml
// Google Merchant Center product feed (XML) for MosaicPins
//
// Airtable fields used (must exist):
// Active (checkbox / boolean)
// PIN Code (or env AIRTABLE_PIN_FIELD)
// Title
// Description
// Images (attachment)
// Stock
// Price_USD
//
// Links use your short product URL: /p/PIN

export async function onRequestGet({ env, request }) {
  try {
    // --- Required env ---
    if (!env.AIRTABLE_TOKEN) return text("AIRTABLE_TOKEN is not set", 500);
    if (!env.AIRTABLE_BASE_ID) return text("AIRTABLE_BASE_ID is not set", 500);
    if (!env.AIRTABLE_TABLE_NAME) return text("AIRTABLE_TABLE_NAME is not set", 500);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const table = env.AIRTABLE_TABLE_NAME;

    // ✅ Only Active = TRUE products
    const filterByFormula = "{Active}=TRUE()";

    const records = await airtableFetchAll({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table,
      filterByFormula,
      pageSize: 100,
      maxPagesGuard: 60,
    });

    const baseUrl = getBaseUrl(request); // https://mosaicpins.space

    // ✅ FORCE USD feed (for US-only Merchant Center)
    const FEED_CURRENCY = "USD";
    const PRICE_FIELD = "Price_USD";

    const items = records
      .map((rec) => {
        const f = rec.fields || {};

        const pin = String(f[pinField] || "").trim();
        if (!pin) return null;

        const title = String(f["Title"] || "Untitled").trim();

        // ✅ Google requires price -> use USD only
        const usd = asNumberOrNull(f[PRICE_FIELD]);
        if (usd == null) return null;

        const stock = toInt(f["Stock"], 0);
        const availability = stock > 0 ? "in stock" : "out of stock";

        const images = extractImageUrls(f["Images"]);
        // ✅ better to only include products with image (Google требует)
        if (!images.length) return null;

        const description = String(f["Description"] || "").trim();

        // optional fields for better SEO inside Merchant
        const type = f["Type"] ?? null;
        const diameter = f["Diameter"] ?? null;
        const materials = Array.isArray(f["Materials"]) ? f["Materials"] : [];

        const extra = [
          `PIN: ${pin}`,
          type ? `Type: ${type}` : null,
          diameter != null ? `Diameter: ${diameter} mm` : null,
          materials.length ? `Materials: ${materials.join(", ")}` : null,
        ].filter(Boolean);

        const fullDesc = [description, extra.join(" • ")]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 5000);

        const link = `${baseUrl}/p/${encodeURIComponent(pin)}`;

        // ✅ Use first image as main
        const image_link = images[0];

        return {
          id: pin,
          title,
          description: fullDesc || title,
          link,
          image_link,
          availability,
          price: `${usd.toFixed(2)} ${FEED_CURRENCY}`, // ✅ USD only
          brand: "Mosaic Pins",
          condition: "new",

          // ✅ FIX Merchant Center warnings (always same)
          gender: "unisex",
          age_group: "adult",
          color: "Multicolor",
        };
      })
      .filter(Boolean);

    const xml = buildGoogleMerchantXml(items, baseUrl);

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return text(`Server error: ${String(e)}`, 500);
  }
}

function buildGoogleMerchantXml(items, baseUrl) {
  const channelTitle = "Mosaic Pins";
  const channelLink = `${baseUrl}/`;
  const channelDesc = "Handcrafted mosaic pins for knife handles";

  const entries = items
    .map((it) => {
      return `
  <item>
    <g:id>${xmlEscape(it.id)}</g:id>
    <title>${xmlEscape(it.title)}</title>
    <description>${xmlEscape(it.description)}</description>
    <link>${xmlEscape(it.link)}</link>
    <g:image_link>${xmlEscape(it.image_link)}</g:image_link>
    <g:availability>${xmlEscape(it.availability)}</g:availability>
    <g:price>${xmlEscape(it.price)}</g:price>
    <g:brand>${xmlEscape(it.brand)}</g:brand>
    <g:condition>${xmlEscape(it.condition)}</g:condition>

    <!-- ✅ extra required attributes -->
    <g:gender>${xmlEscape(it.gender)}</g:gender>
    <g:age_group>${xmlEscape(it.age_group)}</g:age_group>
    <g:color>${xmlEscape(it.color)}</g:color>
  </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${xmlEscape(channelTitle)}</title>
  <link>${xmlEscape(channelLink)}</link>
  <description>${xmlEscape(channelDesc)}</description>
  ${entries}
</channel>
</rss>`;
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function airtableFetchAll({
  token,
  baseId,
  table,
  filterByFormula,
  pageSize = 100,
  maxPagesGuard = 60,
}) {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    table
  )}`;

  let all = [];
  let offset = null;

  for (let page = 0; page < maxPagesGuard; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (filterByFormula) url.searchParams.set(
      "filterByFormula",
      filterByFormula
    );
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable error: ${JSON.stringify(data)}`);

    all = all.concat(Array.isArray(data.records) ? data.records : []);
    offset = data.offset || null;
    if (!offset) break;
  }

  return all;
}

function extractImageUrls(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => x?.url).filter(Boolean);
}

function asNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function text(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function getBaseUrl(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}