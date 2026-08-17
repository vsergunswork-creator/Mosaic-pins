// functions/api/reviews.js
// SAFE version (cache + fallback, но сохраняем вашу логику)

import { cacheGet, cacheSet } from "./_cache.js";

const TTL_SEC = 60;
const FALLBACK_TTL_SEC = 7 * 86400;

// ---------------- GET ----------------
export async function onRequestGet({ env, request }) {
  try {
    const token = (env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get("limit"), 1, 100, 30);
    const offset = String(url.searchParams.get("offset") || "").trim();

    // ✅ cache key учитывает offset
    const CACHE_KEY = `reviews:${limit}:${offset}`;
    const FALLBACK_KEY = `reviews:last:${limit}:${offset}`;

    // 1) cache
    const cached = await cacheGet(env, CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Cache": "HIT",
        },
      });
    }

    // ❗ если Airtable недоступен → fallback
    if (!token || !baseId) {
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Cache": "FALLBACK" },
        });
      }
      return json({ ok: true, reviews: [], offset: null });
    }

    const apiUrl = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    apiUrl.searchParams.set("pageSize", String(limit));
    apiUrl.searchParams.set("filterByFormula", "Active=TRUE()");
    apiUrl.searchParams.set("sort[0][field]", "Date");
    apiUrl.searchParams.set("sort[0][direction]", "desc");

    if (offset) apiUrl.searchParams.set("offset", offset);

    const r = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const last = await cacheGet(env, FALLBACK_KEY);
      if (last) {
        return new Response(last, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Cache": "FALLBACK" },
        });
      }

      return json({ ok: true, reviews: [], offset: null });
    }

    const records = Array.isArray(data?.records) ? data.records : [];

    const reviews = records.map((rec) => {
      const f = rec.fields || {};

      const avatarUrl = Array.isArray(f["Avatar"]) ? (f["Avatar"][0]?.url || "") : "";
      const photosUrls = Array.isArray(f["Photos"])
        ? f["Photos"].map((x) => x?.url).filter(Boolean)
        : [];

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

    const body = JSON.stringify({
      ok: true,
      reviews,
      offset: data?.offset || null,
    });

    // cache + fallback
    await cacheSet(env, CACHE_KEY, body, TTL_SEC);
    await cacheSet(env, FALLBACK_KEY, body, FALLBACK_TTL_SEC);

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Cache": "MISS",
      },
    });
  } catch (e) {
    return json({ ok: true, reviews: [], offset: null });
  }
}

// ---------------- POST (оставляем почти без изменений) ----------------
export async function onRequestPost({ env, request }) {
  try {
    const token = (env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    if (!token || !baseId) {
      return json({ error: "Reviews disabled" }, 500);
    }

    const body = await request.json().catch(() => ({}));

    if (String(body?.website || "").trim()) {
      return json({ ok: true }, 200);
    }

    const name = String(body?.name || "").trim();
    const text = String(body?.text || "").trim();
    const ratingRaw = body?.rating;
    const country = String(body?.country || "").trim().slice(0, 40);

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
      "Active": false,
      "Date": now,
    };

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

    if (!r.ok) {
      return json({ error: "Airtable create failed" }, 400);
    }

    return json({ ok: true, status: "queued_for_moderation" });
  } catch (e) {
    return json({ error: "Server error" }, 500);
  }
}

// ---------------- helpers ----------------
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}