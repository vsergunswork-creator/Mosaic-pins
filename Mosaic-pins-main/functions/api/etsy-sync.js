import { cacheDel } from "./_cache.js";

const DEFAULT_SHOP_ID = "60806077";
const ETSY_PAGE_SIZE = 100;
const AIRTABLE_PAGE_SIZE = 100;

export async function onRequestGet({ env, request }) {
  return runSync(env, request);
}

export async function onRequestPost({ env, request }) {
  return runSync(env, request);
}

async function runSync(env, request) {
  try {
    if (!authorized(env, request)) return json({ ok: false, error: "Unauthorized" }, 401);

    const etsyKey = String(env.ETSY_API_KEY || "").trim();
    const etsySecret = String(env.ETSY_SHARED_SECRET || "").trim();
    const airtableToken = String(env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();
    const shopId = String(env.ETSY_SHOP_ID || DEFAULT_SHOP_ID).trim();

    if (!etsyKey || !etsySecret) return json({ ok: false, error: "Missing Etsy API credentials" }, 500);
    if (!airtableToken || !baseId) return json({ ok: false, error: "Missing Airtable Reviews credentials" }, 500);
    if (!/^\d+$/.test(shopId)) return json({ ok: false, error: "Invalid Etsy shop id" }, 500);

    const etsyReviews = await fetchAllEtsyReviews(shopId, etsyKey, etsySecret);

    // Buyer names are private receipt data. Etsy OAuth access tokens expire after
    // about one hour, so obtain a fresh access token from the long-lived refresh
    // token on every sync run. The refresh token itself remains stored only as a
    // Cloudflare secret and is never returned by this endpoint.
    const oauthAccessToken = await refreshEtsyAccessToken(env, etsyKey);

    const airtableRecords = await fetchAllAirtableReviews(baseId, table, airtableToken);
    const etsyAirtable = airtableRecords.filter((rec) =>
      String(rec?.fields?.["Source"] || "").trim().toLowerCase() === "etsy"
    );

    const stableKeys = new Set(
      etsyAirtable.map((rec) => String(rec?.fields?.["Import Key"] || "").trim()).filter(Boolean)
    );

    // Historical imported records used export-generated keys. Keep matching them
    // by content/date so the initial 31 are never duplicated.
    const historical = etsyAirtable.filter((rec) =>
      !String(rec?.fields?.["Import Key"] || "").trim().startsWith("etsy-api-")
    );
    const pools = buildHistoricalPools(historical);
    const remainingById = new Map(historical.map((rec) => [rec.id, rec]));

    let existingStable = 0;
    let existingHistorical = 0;
    const newReviews = [];

    for (const review of etsyReviews) {
      const apiKey = etsyApiKey(review);
      if (stableKeys.has(apiKey)) {
        existingStable += 1;
        continue;
      }

      const exactKey = historicalMatchKey({
        text: review?.review,
        rating: review?.rating,
        date: dateFromUnix(review?.created_timestamp),
      });
      const exactQueue = pools.get(exactKey) || [];
      const exact = takeAvailable(exactQueue, remainingById);
      if (exact) {
        remainingById.delete(exact.id);
        existingHistorical += 1;
        continue;
      }

      const normalizedText = normalizeText(review?.review);
      const rating = Number(review?.rating || 0);
      const date = dateFromUnix(review?.created_timestamp);
      const candidates = [...remainingById.values()].filter((rec) => {
        const f = rec?.fields || {};
        return Number(f["Rating"] || 0) === rating &&
          normalizeText(f["Text"]) === normalizedText &&
          dayDifference(normalizeDate(f["Date"]), date) <= 1;
      });

      if (candidates.length === 1) {
        remainingById.delete(candidates[0].id);
        existingHistorical += 1;
        continue;
      }

      newReviews.push(review);
    }

    // Only new reviews need private receipt lookups, keeping Etsy API usage low.
    const newReviewsWithNames = [];
    for (const review of newReviews) {
      const buyerName = await fetchEtsyBuyerName(shopId, review?.transaction_id, etsyKey, etsySecret, oauthAccessToken);
      newReviewsWithNames.push({ review, buyerName });
    }

    const created = [];
    for (let i = 0; i < newReviewsWithNames.length; i += 10) {
      const batch = newReviewsWithNames.slice(i, i + 10);
      const records = batch.map(({ review, buyerName }) => ({ fields: fieldsForEtsyReview(review, buyerName) }));
      const made = await createAirtableRecords(baseId, table, airtableToken, records);
      created.push(...made);
    }

    if (created.length) {
      await cacheDel(env, "reviews:30:");
    }

    return json({
      ok: true,
      mode: "etsy-auto-sync",
      shopId: Number(shopId),
      etsyFetchedCount: etsyReviews.length,
      airtableEtsyCountBefore: etsyAirtable.length,
      existingStable,
      existingHistorical,
      createdCount: created.length,
      createdRecordIds: created.map((x) => x.id),
      unmatchedHistoricalCount: remainingById.size,
      buyerNamesEnabled: true,
      cacheInvalidated: created.length > 0,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e || "Server error") }, 500);
  }
}

function authorized(env, request) {
  const required = String(env.ETSY_SYNC_SECRET || "").trim();
  const url = new URL(request.url);
  const got = String(request.headers.get("x-etsy-sync-secret") || url.searchParams.get("secret") || "").trim();
  return Boolean(required) && got === required;
}

async function refreshEtsyAccessToken(env, clientId) {
  const kvKey = "etsy:oauth:refresh_token";

  // Prefer the latest refresh token saved in KV. The Cloudflare Secret remains
  // the bootstrap/fallback token, so an empty KV does not break production.
  let refreshToken = "";
  if (env.CACHE_KV) {
    try {
      refreshToken = String((await env.CACHE_KV.get(kvKey)) || "").trim();
    } catch (_) {
      // Fall back to the Secret if KV is temporarily unavailable.
    }
  }
  if (!refreshToken) refreshToken = String(env.ETSY_REFRESH_TOKEN || "").trim();
  if (!refreshToken) throw new Error("Missing ETSY_REFRESH_TOKEN");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const r = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Etsy OAuth refresh failed (${r.status}): ${safeError(d)}`);

  const accessToken = String(d?.access_token || "").trim();
  if (!accessToken) throw new Error("Etsy OAuth refresh returned no access token");

  // Etsy may return a refreshed refresh_token. Persist it for the next sync.
  // Never expose either token in the endpoint response.
  const nextRefreshToken = String(d?.refresh_token || "").trim();
  if (nextRefreshToken && env.CACHE_KV) {
    await env.CACHE_KV.put(kvKey, nextRefreshToken);
  }

  return accessToken;
}

async function fetchEtsyBuyerName(shopId, transactionId, key, secret, accessToken) {
  const txId = String(transactionId ?? "").trim();
  if (!/^\d+$/.test(txId)) return "";

  const headers = {
    "x-api-key": `${key}:${secret}`,
    Authorization: `Bearer ${accessToken}`,
  };

  const txUrl = `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/transactions/${encodeURIComponent(txId)}`;
  const tr = await fetch(txUrl, { headers });
  const td = await tr.json().catch(() => ({}));
  if (!tr.ok) throw new Error(`Etsy transaction failed (${tr.status}): ${safeError(td)}`);

  const receiptId = String(td?.receipt_id ?? "").trim();
  if (!/^\d+$/.test(receiptId)) return "";

  const receiptUrl = `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}`;
  const rr = await fetch(receiptUrl, { headers });
  const rd = await rr.json().catch(() => ({}));
  if (!rr.ok) throw new Error(`Etsy receipt failed (${rr.status}): ${safeError(rd)}`);

  return String(rd?.name || "").trim().slice(0, 80);
}

async function fetchAllEtsyReviews(shopId, key, secret) {
  const out = [];
  let offset = 0;
  let total = Infinity;
  const headers = { "x-api-key": `${key}:${secret}` };

  while (out.length < total) {
    const url = new URL(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/reviews`);
    url.searchParams.set("limit", String(ETSY_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const r = await fetch(url.toString(), { headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Etsy reviews failed (${r.status}): ${safeError(d)}`);
    const rows = Array.isArray(d?.results) ? d.results : [];
    total = Number.isFinite(Number(d?.count)) ? Number(d.count) : out.length + rows.length;
    out.push(...rows);
    if (!rows.length || rows.length < ETSY_PAGE_SIZE) break;
    offset += rows.length;
  }
  return out;
}

async function fetchAllAirtableReviews(baseId, table, token) {
  const out = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(AIRTABLE_PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable read failed (${r.status}): ${safeError(d)}`);
    out.push(...(Array.isArray(d?.records) ? d.records : []));
    offset = String(d?.offset || "");
  } while (offset);
  return out;
}

async function createAirtableRecords(baseId, table, token, records) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable create failed (${r.status}): ${safeError(d)}`);
  return Array.isArray(d?.records) ? d.records : [];
}

function fieldsForEtsyReview(review, buyerName = "") {
  const apiKey = etsyApiKey(review);
  const name = String(buyerName || review?.reviewer_name || review?.buyer_name || "Etsy customer").trim().slice(0, 80) || "Etsy customer";
  const fields = {
    "Name": name,
    "Rating": Number(review?.rating || 0),
    "Text": decodeHtmlEntities(review?.review).trim().slice(0, 2000),
    "Active": true,
    "Date": new Date(Number(review?.created_timestamp || 0) * 1000).toISOString(),
    "Source": "Etsy",
    "Source Review ID": apiKey,
    "Import Key": apiKey,
  };
  if (review?.transaction_id != null) fields["Source Order ID"] = String(review.transaction_id);
  return fields;
}

function buildHistoricalPools(records) {
  const pools = new Map();
  for (const rec of records) {
    const f = rec?.fields || {};
    const key = historicalMatchKey({ text: f["Text"], rating: f["Rating"], date: f["Date"] });
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(rec);
  }
  return pools;
}

function takeAvailable(queue, remainingById) {
  while (queue.length) {
    const rec = queue.shift();
    if (remainingById.has(rec.id)) return rec;
  }
  return null;
}

function historicalMatchKey({ text, rating, date }) {
  return [normalizeDate(date), String(Number(rating || 0)), normalizeText(text)].join("|");
}
function normalizeText(value) {
  return decodeHtmlEntities(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '\"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
function normalizeDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
function dateFromUnix(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : "";
}
function dayDifference(a, b) {
  const da = dateToUtcDay(a), db = dateToUtcDay(b);
  return da === null || db === null ? Infinity : Math.abs(da - db) / 86400000;
}
function dateToUtcDay(value) {
  const s = normalizeDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}
function etsyApiKey(review) {
  return `etsy-api-${String(review?.transaction_id ?? "").trim()}-${String(review?.listing_id ?? "").trim()}`;
}
function safeError(data) {
  if (!data || typeof data !== "object") return String(data || "Unknown error");
  return String(data?.error?.message || data?.error || data?.message || JSON.stringify(data));
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
