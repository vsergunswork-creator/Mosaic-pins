// functions/api/content.js
// GET /api/content?key=about
// Reads content from Airtable table (default: SiteContent)

export async function onRequestGet({ env, request }) {
  try {
    // Prefer a dedicated token for content (safe), fallback to main token
    const token = (env.AIRTABLE_TOKEN_CONTENT || env.AIRTABLE_TOKEN || "").trim();
    if (!token) return json({ error: "AIRTABLE_TOKEN_CONTENT (or AIRTABLE_TOKEN) is not set" }, 500);

    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    if (!baseId) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);

    const table = String(env.AIRTABLE_CONTENT_TABLE || "SiteContent").trim();

    const url = new URL(request.url);
    const key = String(url.searchParams.get("key") || "").trim();
    if (!key) return json({ error: "Missing key" }, 400);

    const formula = `AND({Key}="${escapeForFormula(key)}", {Active}=TRUE())`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    // Better error visibility
    if (!r.ok) {
      return json(
        {
          error: "Airtable request failed",
          status: r.status,
          details: data,
          hint:
            r.status === 403
              ? "Token has no access to this base/table OR wrong baseId/table name"
              : "Check baseId/table name/fields",
        },
        400
      );
    }

    const rec = data?.records?.[0];
    if (!rec) return json({ error: "Not found" }, 404);

    const f = rec.fields || {};

    const heroImage = Array.isArray(f["Hero Image"]) ? (f["Hero Image"][0]?.url || "") : "";
    const gallery = Array.isArray(f["Gallery"]) ? f["Gallery"].map((x) => x?.url).filter(Boolean) : [];

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