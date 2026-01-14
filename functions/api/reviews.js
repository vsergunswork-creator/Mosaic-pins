// functions/api/reviews.js
// GET /api/reviews
// Reads reviews from Airtable table (default: Reviews)

export async function onRequestGet({ env }) {
  try {
    const token = (env.AIRTABLE_TOKEN_CONTENT || env.AIRTABLE_TOKEN || "").trim();
    if (!token) return json({ ok:false, error: "AIRTABLE_TOKEN_CONTENT (or AIRTABLE_TOKEN) is not set" }, 500);

    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    if (!baseId) return json({ ok:false, error: "AIRTABLE_BASE_ID is not set" }, 500);

    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    // Only active reviews, newest first by default (client will re-sort anyway)
    const formula = `{Active}=TRUE()`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("pageSize", "100");
    apiUrl.searchParams.set("filterByFormula", formula);
    apiUrl.searchParams.append("sort[0][field]", "Date");
    apiUrl.searchParams.append("sort[0][direction]", "desc");

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(
        {
          ok:false,
          error: "Airtable request failed",
          status: r.status,
          details: data,
        },
        400
      );
    }

    const records = Array.isArray(data?.records) ? data.records : [];

    const reviews = records.map(rec => {
      const f = rec.fields || {};

      const avatar = Array.isArray(f["Avatar"]) ? (f["Avatar"][0]?.url || "") : "";
      const photos = Array.isArray(f["Photos"]) ? f["Photos"].map(x => x?.url).filter(Boolean) : [];

      return {
        id: rec.id,
        name: String(f["Name"] || "Anonymous"),
        rating: Number(f["Rating"] || 0),
        date: String(f["Date"] || ""),     // ISO recommended
        country: String(f["Country"] || ""),
        text: String(f["Text"] || ""),
        avatar,
        photos,
      };
    });

    return json({ ok:true, reviews }, 200, { "Cache-Control":"public, max-age=60" });
  } catch (e) {
    return json({ ok:false, error: "Server error", details: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}