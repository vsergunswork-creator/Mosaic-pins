// functions/api/content.js
// GET /api/content?key=about
// SAFE version: KV-first, Airtable fallback

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 3600;               // 1 час
const FALLBACK_TTL_SEC = 7 * 86400; // 7 дней

export async function onRequestGet({ env, request }) {
  try {
    const token = (env.AIRTABLE_TOKEN_CONTENT || env.AIRTABLE_TOKEN || "").trim();
    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_CONTENT_TABLE || "SiteContent").trim();

    const url = new URL(request.url);
    const key = String(url.searchParams.get("key") || "").trim();

    if (!key) return json({ error: "Missing key" }, 400);

    const CACHE_KEY = `content:${key}`;
    const FALLBACK_KEY = `content:last:${key}`;

    // ✅ 1. СРАЗУ из cache
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          "X-Cache": "HIT",
        },
      });
    }

    // ❗ Если нет Airtable — сразу fallback
    if (!token || !baseId) {
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          headers: { "X-Cache": "FALLBACK" },
        });
      }
      return json({ error: "Content not available" }, 500);
    }

    // ✅ 2. Airtable запрос
    const formula = `AND({Key}="${escapeForFormula(key)}", {Active}=TRUE())`;

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("maxRecords", "1");
    apiUrl.searchParams.set("filterByFormula", formula);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      // ❗ fallback если Airtable умер
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          headers: { "X-Cache": "FALLBACK" },
        });
      }

      return json({ error: "Airtable failed" }, 500);
    }

    const rec = data?.records?.[0];
    if (!rec) {
      return json({ error: "Not found" }, 404);
    }

    const f = rec.fields || {};

    const heroAttachment = Array.isArray(f["Hero Image"]) ? f["Hero Image"][0] : null;

    const content = {
      key,
      heroImage: heroAttachment?.url || "",
      heroTitle: String(f["Hero Title"] || ""),
      heroSubtitle: String(f["Hero Subtitle"] || ""),
      aboutBody: String(f["About Body"] || ""),
      gallery: Array.isArray(f["Gallery"])
        ? f["Gallery"].map((x) => x?.url).filter(Boolean)
        : [],
    };

    const body = JSON.stringify({ content });

    // ✅ сохраняем cache + fallback
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "MISS",
      },
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

// ---------- helpers ----------
function escapeForFormula(value) {
  return String(value).replace(/"/g, '\\"');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}