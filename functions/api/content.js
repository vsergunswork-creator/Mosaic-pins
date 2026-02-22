// functions/api/content.js
// GET /api/content?key=about
// Reads content from Airtable table (default: SiteContent)

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 3600;                 // ✅ 1 hour cache
const FALLBACK_TTL_SEC = 7 * 86400;   // ✅ keep last good for a week

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

    // ✅ cache keys per content key + per table/base (на всякий)
    const CACHE_KEY = `cache:content:v1:${baseId}:${table}:${key}`;
    const FALLBACK_KEY = `cache:content:last_good:${baseId}:${table}:${key}`;

    // ✅ 1) return cached instantly
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          "X-Cache": "HIT",
        },
      });
    }

    const formula = `AND({Key}="${escapeForFormula(key)}", {Active}=TRUE())`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    // Optional: limit fields to reduce payload (safe)
    apiUrl.searchParams.append("fields[]", "Key");
    apiUrl.searchParams.append("fields[]", "Hero Image");
    apiUrl.searchParams.append("fields[]", "Hero Title");
    apiUrl.searchParams.append("fields[]", "Hero Subtitle");
    apiUrl.searchParams.append("fields[]", "About Body");
    apiUrl.searchParams.append("fields[]", "Gallery");
    apiUrl.searchParams.append("fields[]", "Active");

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    // Better error visibility
    if (!r.ok) {
      // ✅ fallback if Airtable fails
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
            "X-Cache": "FALLBACK",
          },
        });
      }

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
    if (!rec) {
      // ✅ not found: cache short negative to reduce Airtable hits (optional)
      const body = JSON.stringify({ error: "Not found" });
      await cacheSet(env, CACHE_KEY, body, 60);
      return new Response(body, { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    const f = rec.fields || {};

    const heroAttachment = Array.isArray(f["Hero Image"]) ? f["Hero Image"][0] : null;
    const heroImage = heroAttachment?.url || "";

    const heroImageWidth =
      Number(heroAttachment?.width) ||
      Number(heroAttachment?.thumbnails?.large?.width) ||
      Number(heroAttachment?.thumbnails?.full?.width) ||
      0;

    const heroImageHeight =
      Number(heroAttachment?.height) ||
      Number(heroAttachment?.thumbnails?.large?.height) ||
      Number(heroAttachment?.thumbnails?.full?.height) ||
      0;

    const gallery = Array.isArray(f["Gallery"]) ? f["Gallery"].map((x) => x?.url).filter(Boolean) : [];

    const content = {
      key: String(f["Key"] || key),
      heroImage,
      heroImageWidth,
      heroImageHeight,
      heroTitle: String(f["Hero Title"] || ""),
      heroSubtitle: String(f["Hero Subtitle"] || ""),
      aboutBody: String(f["About Body"] || ""),
      gallery,
    };

    const body = JSON.stringify({ content });

    // ✅ 2) save cache + last_good
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        "X-Cache": "MISS",
      },
    });
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