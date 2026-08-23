// functions/api/reviews.js
// SAFE version (cache + fallback, но сохраняем вашу логику)

import { cacheGet, cacheSet, cacheDel } from "./_cache.js";
import { verifyPurchaseForRequest } from "./account/verified-purchase.js";

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

    let purchaseByReviewId = new Map();
    try {
      purchaseByReviewId = await loadReviewPurchaseSnapshots(env, records);
    } catch (purchaseError) {
      console.error("reviews purchase snapshot read failed", purchaseError);
    }

    const reviews = records.map((rec) => {
      const f = rec.fields || {};

      const avatarUrl = Array.isArray(f["Avatar"]) ? (f["Avatar"][0]?.url || "") : "";
      const photosUrls = Array.isArray(f["Photos"])
        ? f["Photos"].map((x) => x?.url).filter(Boolean)
        : [];
      const videoUrl = Array.isArray(f["Video"]) ? (f["Video"][0]?.url || "") : "";

      return {
        id: rec.id,
        name: String(f["Name"] || ""),
        rating: Number(f["Rating"] || 0),
        text: String(f["Text"] || ""),
        country: String(f["Country"] || ""),
        date: String(f["Date"] || ""),
        source: String(f["Source"] || ""),
        sourceOrderId: String(f["Source Order ID"] || ""),
        sourceReviewId: String(f["Source Review ID"] || ""),
        avatar: avatarUrl,
        photos: photosUrls,
        video: videoUrl,
        purchase: purchaseByReviewId.get(rec.id) || null,
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

// ---------------- POST ----------------
export async function onRequestPost({ env, request }) {
  const uploadedKeys = [];
  try {
    const token = (env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    const baseId = (env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    if (!token || !baseId) return json({ error: "Reviews disabled" }, 500);

    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    let body = {};
    let photos = [];
    let video = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      body = {
        website: form.get("website"),
        name: form.get("name"),
        text: form.get("text"),
        rating: form.get("rating"),
        country: form.get("country"),
        photoCount: form.get("photoCount"),
        videoCount: form.get("videoCount"),
        purchasePin: form.get("purchasePin"),
        purchaseOrderId: form.get("purchaseOrderId"),
      };
      photos = [];
      for (const [key, value] of form.entries()) {
        if (!value || typeof value.arrayBuffer !== "function" || Number(value.size || 0) <= 0) continue;

        if (key === "photos") {
          photos.push(value);
        } else if (key === "video" && !video) {
          video = value;
        }
      }
    } else {
      body = await request.json().catch(() => ({}));
    }

    if (String(body?.website || "").trim()) return json({ ok: true }, 200);

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

    const purchasePin = String(body?.purchasePin || "").trim();
    const purchaseOrderId = String(body?.purchaseOrderId || "").trim();
    let linkedPurchase = null;

    if (purchasePin || purchaseOrderId) {
      if (!purchasePin || !purchaseOrderId) {
        return json({ error: "Incomplete purchase review reference" }, 400);
      }

      const verification = await verifyPurchaseForRequest({
        request,
        env,
        pin: purchasePin,
        orderId: purchaseOrderId,
      });

      if (!verification?.verifiedPurchase || !verification?.purchase) {
        return json({ error: "This purchased item could not be verified for your account" }, 403);
      }

      linkedPurchase = verification.purchase;
    }

    const expectedPhotoCount = clampInt(body?.photoCount, 0, 4, 0);
    if (expectedPhotoCount > 0 && photos.length !== expectedPhotoCount) {
      return json({
        error: `Photo upload transport failed — selected ${expectedPhotoCount}, received ${photos.length}. Please try again.`
      }, 400);
    }

    if (photos.length > 4) return json({ error: "Up to 4 photos are allowed" }, 400);

    const expectedVideoCount = clampInt(body?.videoCount, 0, 1, 0);
    const receivedVideoCount = video ? 1 : 0;
    if (expectedVideoCount !== receivedVideoCount) {
      return json({
        error: `Video upload transport failed — selected ${expectedVideoCount}, received ${receivedVideoCount}. Please try again.`
      }, 400);
    }

    const allowed = new Map([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ]);
    for (const file of photos) {
      if (!allowed.has(String(file.type || "").toLowerCase())) return json({ error: "Photos must be JPG, PNG or WebP" }, 400);
      if (file.size > 8 * 1024 * 1024) return json({ error: "Each photo must be 8 MB or smaller" }, 400);
    }

    const allowedVideos = new Map([
      ["video/mp4", "mp4"],
      ["video/webm", "webm"],
      ["video/quicktime", "mov"],
    ]);
    if (video) {
      const videoType = String(video.type || "").toLowerCase();
      if (!allowedVideos.has(videoType)) return json({ error: "Video must be MP4, WebM or MOV" }, 400);
      if (video.size > 40 * 1024 * 1024) return json({ error: "Video must be 40 MB or smaller" }, 400);
    }

    const publicBase = String(env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    if ((photos.length || video) && (!env.PRODUCT_IMAGES || !publicBase)) return json({ error: "Media uploads are unavailable" }, 503);

    const photoUrls = [];
    let videoUrl = "";
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

    for (const file of photos) {
      const type = String(file.type || "").toLowerCase();
      const ext = allowed.get(type);
      const key = `reviews/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
      await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
      });
      uploadedKeys.push(key);
      photoUrls.push(`${publicBase}/${key}`);
    }

    if (video) {
      const type = String(video.type || "").toLowerCase();
      const ext = allowedVideos.get(type);
      const key = `reviews/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
      await env.PRODUCT_IMAGES.put(key, await video.arrayBuffer(), {
        httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
      });
      uploadedKeys.push(key);
      videoUrl = `${publicBase}/${key}`;
    }

    const fields = {
      "Name": name,
      "Rating": rating,
      "Text": text,
      "Active": true,
      "Date": now.toISOString(),
    };
    if (country) fields["Country"] = country;
    if (linkedPurchase) {
      fields["Source Order ID"] = String(linkedPurchase.orderId || "");
      fields["Import Key"] = makePurchaseImportKey(linkedPurchase.orderKey, linkedPurchase.pin);
    }
    if (photoUrls.length) fields["Photos"] = photoUrls.map((url) => ({ url }));
    if (videoUrl) fields["Video"] = [{ url: videoUrl }];

    const apiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] }),
    });

    if (!r.ok) {
      const airtableError = await r.json().catch(() => ({}));
      await cleanupUploads(env, uploadedKeys);

      // Return Airtable's safe error type/message so production tests reveal
      // the exact schema/permission problem instead of a generic failure.
      const type = String(airtableError?.error?.type || "").trim();
      const message = String(airtableError?.error?.message || "").trim();
      const detail = [type, message].filter(Boolean).join(": ");

      return json({
        error: detail ? `Airtable create failed — ${detail}` : `Airtable create failed (HTTP ${r.status})`,
      }, r.status >= 400 && r.status < 600 ? r.status : 400);
    }

    // The Reviews page requests the default first page (limit=30, no offset).
    // Clear that short-lived cache immediately after publishing so the new
    // review is visible on the next load instead of waiting up to 60 seconds.
    await cacheDel(env, "reviews:30:");

    return json({
      ok: true,
      status: "published",
      photos: photoUrls.length,
      photosReceived: photos.length,
      video: videoUrl ? 1 : 0,
      videoReceived: receivedVideoCount,
      purchaseLinked: !!linkedPurchase,
    });
  } catch (e) {
    await cleanupUploads(env, uploadedKeys);
    return json({ error: "Server error" }, 500);
  }
}


const PURCHASE_IMPORT_PREFIX = "site-purchase:v1:";

function makePurchaseImportKey(orderKey, pin) {
  return `${PURCHASE_IMPORT_PREFIX}${encodeURIComponent(String(orderKey || ""))}:${encodeURIComponent(String(pin || ""))}`;
}

function parsePurchaseImportKey(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith(PURCHASE_IMPORT_PREFIX)) return null;

  const rest = raw.slice(PURCHASE_IMPORT_PREFIX.length);
  const splitAt = rest.indexOf(":");
  if (splitAt <= 0 || splitAt >= rest.length - 1) return null;

  try {
    const orderKey = decodeURIComponent(rest.slice(0, splitAt));
    const pin = decodeURIComponent(rest.slice(splitAt + 1));
    if (!orderKey || !pin) return null;
    return { orderKey, pin };
  } catch (_) {
    return null;
  }
}

async function loadReviewPurchaseSnapshots(env, records = []) {
  const out = new Map();
  if (!env?.DB || !Array.isArray(records) || !records.length) return out;

  const refs = records
    .map((record) => ({
      reviewId: String(record?.id || ""),
      ref: parsePurchaseImportKey(record?.fields?.["Import Key"]),
    }))
    .filter((item) => item.reviewId && item.ref);

  if (!refs.length) return out;

  const orderKeys = [...new Set(refs.map((item) => item.ref.orderKey))];
  const placeholders = orderKeys.map((_, index) => `?${index + 1}`).join(",");

  const response = await env.DB.prepare(
    `SELECT order_key, pin, title, image, diameter ` +
    `FROM order_item_snapshots ` +
    `WHERE order_key IN (${placeholders})`
  ).bind(...orderKeys).all();

  const snapshotByKey = new Map();
  for (const row of Array.isArray(response?.results) ? response.results : []) {
    const key = purchaseSnapshotMapKey(row?.order_key, row?.pin);
    if (key && !snapshotByKey.has(key)) snapshotByKey.set(key, row);
  }

  for (const item of refs) {
    const row = snapshotByKey.get(purchaseSnapshotMapKey(item.ref.orderKey, item.ref.pin));
    if (!row) continue;

    out.set(item.reviewId, {
      pin: String(row.pin || item.ref.pin || ""),
      title: String(row.title || row.pin || item.ref.pin || ""),
      image: String(row.image || ""),
      diameter: finiteNumberOrNull(row.diameter),
    });
  }

  return out;
}

function purchaseSnapshotMapKey(orderKey, pin) {
  const order = String(orderKey || "").trim();
  const productPin = String(pin || "").trim().toLowerCase();
  return order && productPin ? `${order}\u0000${productPin}` : "";
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function cleanupUploads(env, keys) {
  if (!env?.PRODUCT_IMAGES || !Array.isArray(keys) || !keys.length) return;
  await Promise.all(keys.map((key) => env.PRODUCT_IMAGES.delete(key).catch(() => {})));
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