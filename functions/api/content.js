// functions/api/content.js
// GET /api/content?key=about
// Reads content from Airtable table (default: SiteContent)

export async function onRequestGet({ env, request }) {
  try {
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);

    const table = String(env.AIRTABLE_CONTENT_TABLE || "SiteContent");
    const url = new URL(request.url);
    const key = String(url.searchParams.get("key") || "").trim();
    if (!key) return json({ error: "Missing key" }, 400);

    const formula = `AND({Key}="${escapeForFormula(key)}", {Active}=TRUE())`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Airtable error", details: data }, 400);

    const rec = data?.records?.[0];
    if (!rec) return json({ error: "Not found" }, 404);

    const f = rec.fields || {};

    const heroImage = Array.isArray(f["Hero Image"]) ? (f["Hero Image"][0]?.url || "") : "";
    const gallery = Array.isArray(f["Gallery"]) ? f["Gallery"].map(x => x?.url).filter(Boolean) : [];

    const content = {
      key: String(f["Key"] || key),
      heroImage,
      heroTitle: String(f["Hero Title"] || ""),
      heroSubtitle: String(f["Hero Subtitle"] || ""),
      aboutBody: String(f["About Body"] || ""),
      gallery,
    };

    return json({ content }, 200, { "Cache-Control": "public, max-age=60" });
  } catch (e) {
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

function escapeForFormula(value) {
  return String(value).replace(/"/g, '\\"');
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}