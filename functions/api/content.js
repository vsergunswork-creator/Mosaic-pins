// GET /api/content?key=about
// Airtable SiteContent remains the source of truth.
// Fast path: shared KV cache. Fresh content lives for 60 seconds.
// After that, refresh Airtable synchronously so edits become visible quickly.
// The stale copy is used only as a fallback if Airtable is temporarily unavailable.

import { cacheGet, cacheSet } from "./_cache.js";

const FRESH_TTL = 60;               // 60 seconds
const STALE_TTL = 7 * 24 * 60 * 60; // 7 days
const IMAGE_CONCURRENCY = 4;

export async function onRequestGet({ env, request, waitUntil }) {
  try {
    const token = String(env.AIRTABLE_TOKEN || "").trim();
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_CONTENT_TABLE_NAME || "SiteContent").trim();

    if (!token || !baseId) {
      return json({ ok:false, error:"Airtable is not configured" }, 500);
    }

    const key = String(new URL(request.url).searchParams.get("key") || "").trim();
    if (!key) return json({ ok:false, error:"Missing key" }, 400);

    const cacheKey = `cache:sitecontent:airtable:v5:${key}`;
    const staleKey = `${cacheKey}:stale`;

    const fresh = await cacheGet(env, cacheKey);
    if (fresh) return contentResponse(fresh, "HIT");

    const stale = await cacheGet(env, staleKey);

    try {
      const body = await refreshContent(env, { token, baseId, table, key, cacheKey, staleKey });
      return contentResponse(body, stale ? "REFRESH" : "MISS");
    } catch (e) {
      if (stale) {
        console.error("content refresh failed; serving stale fallback:", e);
        return contentResponse(stale, "STALE-FALLBACK");
      }
      throw e;
    }
  } catch (e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
}

async function refreshContent(env, { token, baseId, table, key, cacheKey, staleKey }) {
  const formula = `AND({Key}='${escapeFormula(key)}',{Active}=TRUE())`;
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Airtable content failed: ${r.status} ${JSON.stringify(data)}`);
  }

  const rec = data?.records?.[0];
  if (!rec) throw new Error("Content not found");

  const f = rec.fields || {};
  const heroRaw = Array.isArray(f["Hero Image"]) ? f["Hero Image"][0] : null;
  const galleryRaw = Array.isArray(f["Gallery"]) ? f["Gallery"] : [];

  // Hero + gallery migration/checks happen concurrently, with a small gallery
  // concurrency limit so a large Airtable gallery does not create a long
  // sequential waterfall or excessive Worker memory usage.
  const [heroImage, gallery] = await Promise.all([
    durableImage(env, key, "hero", heroRaw),
    mapLimit(galleryRaw, IMAGE_CONCURRENCY, (item, i) =>
      durableImage(env, key, `gallery-${i + 1}`, item)
    ),
  ]);

  const body = JSON.stringify({
    ok: true,
    content: {
      key,
      heroImage,
      heroTitle: String(f["Hero Title"] || ""),
      heroSubtitle: String(f["Hero Subtitle"] || ""),
      aboutBody: String(f["About Body"] || ""),
      aboutBodyDe: String(f["About Body DE"] || ""),
      aboutBodyRu: String(f["About Body RU"] || ""),
      aboutBodyFr: String(f["About Body FR"] || ""),
      gallery: gallery.filter(Boolean),
    },
  });

  await Promise.all([
    cacheSet(env, cacheKey, body, FRESH_TTL),
    cacheSet(env, staleKey, body, STALE_TTL),
  ]);

  return body;
}

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const result = new Array(list.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      result[i] = await mapper(list[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), list.length) },
    () => worker()
  );

  await Promise.all(workers);
  return result;
}

async function durableImage(env, key, slot, item) {
  const src = String(item?.url || "").trim();
  if (!src) return "";

  const r2 = env.PRODUCT_IMAGES;
  const base = String(env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!r2 || !base) return src;

  const id = String(item?.id || slot);
  const ext = detectExt(item, src);
  const objectKey = `content/${sanitize(key)}/${sanitize(id)}.${ext}`;

  try {
    if (!await r2.head(objectKey)) {
      const rr = await fetch(src);
      if (!rr.ok) throw new Error(`Image fetch failed: ${rr.status}`);

      await r2.put(objectKey, await rr.arrayBuffer(), {
        httpMetadata: {
          contentType: rr.headers.get("content-type") || mime(ext),
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    }

    return `${base}/${objectKey}`;
  } catch (_) {
    // Airtable URL is a safe fallback if R2 is temporarily unavailable.
    return src;
  }
}

function contentResponse(body, cacheState) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Revalidate in the browser; shared edge caches may reuse for 60 seconds.
      // Old content is allowed only as an error fallback, never as normal SWR.
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-if-error=86400",
      "X-Cache": cacheState,
    },
  });
}

function detectExt(item, url) {
  const n = String(item?.filename || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (n) return norm(n);

  try {
    return norm(
      new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "jpg"
    );
  } catch (_) {
    return "jpg";
  }
}

function norm(x) {
  x = String(x || "").toLowerCase();
  if (x === "jpeg") x = "jpg";
  return ["jpg","png","webp","gif","avif"].includes(x) ? x : "jpg";
}

function mime(x) {
  return ({
    jpg:"image/jpeg",
    png:"image/png",
    webp:"image/webp",
    gif:"image/gif",
    avif:"image/avif",
  })[x] || "image/jpeg";
}

function sanitize(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function escapeFormula(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
    },
  });
}
