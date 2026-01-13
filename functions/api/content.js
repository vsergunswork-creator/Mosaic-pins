// functions/api/content.js
// GET /api/content?key=about
// Reads content from Airtable table (default: SiteContent)

export async function onRequestGet({ env, request }) {
  try {
    // ---------- ENV checks ----------
    if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID is not set" }, 500);

    // Table name (you set it in Cloudflare Pages -> Variables)
    const table = String(env.AIRTABLE_CONTENT_TABLE || "SiteContent").trim();

    const url = new URL(request.url);
    const key = String(url.searchParams.get("key") || "").trim();
    if (!key) return json({ ok: false, error: "Missing key. Example: /api/content?key=about" }, 400);

    // Airtable formula:
    // find record where Key="about" AND Active = checked
    const formula = `AND({Key}="${escapeForFormula(key)}", {Active}=TRUE())`;

    const apiUrl = new URL(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`
    );
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(
        {
          ok: false,
          error: "Airtable request failed",
          status: r.status,
          details: data,
        },
        400
      );
    }

    const rec = data?.records?.[0];
    if (!rec) return json({ ok: false, error: "Not found (check Key and Active checkbox)" }, 404);

    const f = rec.fields || {};

    // Attachments in Airtable come as array of objects: [{url, filename, ...}]
    const heroImage = Array.isArray(f["Hero Image"]) ? (f["Hero Image"][0]?.url || "") : "";
    const gallery = Array.isArray(f["Gallery"])
      ? f["Gallery"].map((x) => x?.url).filter(Boolean)
      : [];

    const content = {
      key: String(f["Key"] || key),
      heroImage,
      heroTitle: String(f["Hero Title"] || ""),
      heroSubtitle: String(f["Hero Subtitle"] || ""),
      aboutBody: String(f["About Body"] || ""),
      gallery,
    };

    // for debugging (optional):
    // return json({ ok: true, from: "content.js", content }, 200, { "Cache-Control": "no-store" });

    return json({ ok: true, content }, 200, { "Cache-Control": "public, max-age=60" });
  } catch (e) {
    return json({ ok: false, error: "Server error", details: String(e?.message || e) }, 500);
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