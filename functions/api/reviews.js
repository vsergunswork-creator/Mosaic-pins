// functions/api/reviews.js
// GET  /api/reviews?limit=30&offset=...  -> list active reviews
// POST /api/reviews                     -> create review (Active=false)
// Airtable table fields (YOUR):
// Name (text)
// Active (checkbox)  <-- moderation
// Rating (number)
// Date (date)
// Country (text) optional
// Text (long text)
// Avatar (attachment) optional (we won't upload from site now)
// Photos (attachment) optional (we won't upload from site now)

export async function onRequestGet({ env, request }) {
  try {
    const token = (env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    if (!token) return json({ error: "AIRTABLE_TOKEN_REVIEWS (or AIRTABLE_TOKEN) is not set" }, 500);

    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    if (!baseId) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);

    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get("limit"), 1, 100, 30);
    const offset = String(url.searchParams.get("offset") || "").trim();

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("pageSize", String(limit));

    // ✅ only Active=TRUE
    apiUrl.searchParams.set("filterByFormula", "Active=TRUE()");

    // ✅ latest first
    apiUrl.searchParams.set("sort[0][field]", "Date");
    apiUrl.searchParams.set("sort[0][direction]", "desc");

    if (offset) apiUrl.searchParams.set("offset", offset);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

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

    const records = Array.isArray(data?.records) ? data.records : [];

    const reviews = records.map((rec) => {
      const f = rec.fields || {};

      const avatarUrl = Array.isArray(f["Avatar"]) ? (f["Avatar"][0]?.url || "") : "";
      const photosUrls = Array.isArray(f["Photos"]) ? f["Photos"].map((x) => x?.url).filter(Boolean) : [];

      return {
        id: rec.id,
        name: String(f["Name"] || ""),
        rating: Number(f["Rating"] || 0),
        text: String(f["Text"] || ""),
        country: String(f["Country"] || ""),
        date: String(f["Date"] || ""),
        avatar: avatarUrl,
        photos: photosUrls,
      };
    });

    return json(
      {
        ok: true,
        reviews,
        offset: data?.offset || null,
      },
      200,
      { "Cache-Control": "public, max-age=30" }
    );
  } catch (e) {
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

export async function onRequestPost({ env, request }) {
  try {
    const token = (env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    if (!token) return json({ error: "AIRTABLE_TOKEN_REVIEWS (or AIRTABLE_TOKEN) is not set" }, 500);

    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    if (!baseId) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);

    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    const body = await request.json().catch(() => ({}));

    // ✅ honeypot anti-spam (if you add hidden input "website")
    if (String(body?.website || "").trim()) {
      return json({ ok: true }, 200);
    }

    const name = String(body?.name || "").trim();
    const text = String(body?.text || "").trim();
    const ratingRaw = body?.rating;
    const country = String(body?.country || "").trim().slice(0, 40);

    // Validate
    if (name.length < 2) return json({ error: "Name is too short" }, 400);
    if (name.length > 80) return json({ error: "Name is too long" }, 400);

    if (text.length < 10) return json({ error: "Text is too short" }, 400);
    if (text.length > 2000) return json({ error: "Text is too long" }, 400);

    const rating = clampNumber(ratingRaw, 1, 5);
    if (!Number.isFinite(rating)) return json({ error: "Rating must be 1..5" }, 400);

    const now = new Date().toISOString();

    const fields = {
      "Name": name,
      "Rating": rating,
      "Text": text,

      // ✅ moderation
      "Active": false,

      // ✅ date field in Airtable
      "Date": now,
    };

    // optional
    if (country) fields["Country"] = country;

    const payload = {
      records: [{ fields }],
    };

    const apiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;

    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return json(
        {
          error: "Airtable create failed",
          status: r.status,
          details: data,
          hint:
            r.status === 403
              ? "Token has no access to this base/table OR wrong baseId/table name"
              : "Check field names/types in Airtable",
        },
        400
      );
    }

    return json({ ok: true, status: "queued_for_moderation" }, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

/* helpers */
function clampInt(v, min, max, def) {
  const n = parseInt(String(v || ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function clampNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(min, Math.min(max, n));
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}