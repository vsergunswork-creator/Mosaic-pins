// functions/api/etsy-sync-test.js
// READ-ONLY Etsy -> Airtable matching diagnostic.
// It does NOT create or update any Airtable records.
// Purpose: verify that the 31 historical Etsy reviews already imported into
// Airtable can be matched one-for-one before enabling production sync.

export async function onRequestGet({ env, request }) {
  try {
    const etsyKey = String(env.ETSY_API_KEY || "").trim();
    const etsySecret = String(env.ETSY_SHARED_SECRET || "").trim();
    const airtableToken = String(env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || "").trim();
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews").trim();

    if (!etsyKey || !etsySecret) {
      return json({ ok: false, error: "Missing Etsy API credentials" }, 500);
    }
    if (!airtableToken || !baseId) {
      return json({ ok: false, error: "Missing Airtable Reviews credentials" }, 500);
    }

    const reqUrl = new URL(request.url);
    const shopId = String(
      reqUrl.searchParams.get("shop_id") || env.ETSY_SHOP_ID || "60806077"
    ).trim();

    if (!/^\d+$/.test(shopId)) {
      return json({ ok: false, error: "Invalid Etsy shop_id" }, 400);
    }

    const etsyHeaders = { "x-api-key": `${etsyKey}:${etsySecret}` };

    // 1) Fetch all Etsy reviews for this shop (current shop has 31; API limit allows 100).
    const reviewsUrl = new URL(
      `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/reviews`
    );
    reviewsUrl.searchParams.set("limit", "100");
    reviewsUrl.searchParams.set("offset", "0");

    const er = await fetch(reviewsUrl.toString(), { headers: etsyHeaders });
    const ed = await er.json().catch(() => ({}));
    if (!er.ok) {
      return json({
        ok: false,
        stage: "etsy_reviews",
        etsyStatus: er.status,
        etsyError: safeError(ed),
      }, er.status);
    }

    const etsyReviews = Array.isArray(ed?.results) ? ed.results : [];

    // 2) Fetch all existing Etsy-sourced Reviews from Airtable.
    const airtableUrl = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
    );
    airtableUrl.searchParams.set("pageSize", "100");

    const ar = await fetch(airtableUrl.toString(), {
      headers: { Authorization: `Bearer ${airtableToken}` },
    });
    const ad = await ar.json().catch(() => ({}));
    if (!ar.ok) {
      return json({
        ok: false,
        stage: "airtable_reviews",
        airtableStatus: ar.status,
        airtableError: safeError(ad),
      }, ar.status);
    }

    const allAirtableRecords = Array.isArray(ad?.records) ? ad.records : [];
    const airtableRecords = allAirtableRecords.filter((rec) =>
      String(rec?.fields?.["Source"] || "").trim().toLowerCase() === "etsy"
    );

    // Build queues, not a Set: several Etsy purchases contain multiple reviews
    // with identical text/rating/date. Consuming one record at a time prevents
    // those legitimate repeated reviews from being mistaken for duplicates.
    const pools = new Map();
    for (const rec of airtableRecords) {
      const f = rec?.fields || {};
      const key = historicalMatchKey({
        text: f["Text"],
        rating: f["Rating"],
        date: f["Date"],
      });
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push({
        recordId: rec.id,
        name: String(f["Name"] || ""),
        importKey: String(f["Import Key"] || ""),
        sourceOrderId: String(f["Source Order ID"] || ""),
      });
    }

    let matchedExisting = 0;
    const matches = [];
    const pendingEtsy = [];

    // Pass 1: strict date + rating + normalized text match.
    for (const review of etsyReviews) {
      const date = dateFromUnix(review?.created_timestamp);
      const key = historicalMatchKey({
        text: review?.review,
        rating: review?.rating,
        date,
      });
      const queue = pools.get(key) || [];
      const existing = queue.shift() || null;

      const summary = {
        apiKey: etsyApiKey(review),
        transactionId: review?.transaction_id ?? null,
        listingId: review?.listing_id ?? null,
        rating: Number(review?.rating || 0),
        date,
      };

      if (existing) {
        matchedExisting += 1;
        matches.push({
          ...summary,
          matchMode: "exact",
          airtableRecordId: existing.recordId,
          airtableName: existing.name,
          currentImportKey: existing.importKey,
        });
      } else {
        pendingEtsy.push({
          review,
          summary,
          normalizedText: normalizeText(review?.review),
          rating: Number(review?.rating || 0),
          date,
        });
      }
    }

    // Flatten only records left unmatched after strict matching.
    const remainingHistorical = [];
    for (const queue of pools.values()) {
      for (const left of queue) remainingHistorical.push(left);
    }

    // Add normalized comparison data to the remaining Airtable records.
    const airtableById = new Map(
      allAirtableRecords.map((rec) => [rec.id, rec?.fields || {}])
    );
    for (const item of remainingHistorical) {
      const f = airtableById.get(item.recordId) || {};
      item.normalizedText = normalizeText(f["Text"]);
      item.rating = Number(f["Rating"] || 0);
      item.date = normalizeDate(f["Date"]);
    }

    // Pass 2: tolerate a one-calendar-day date shift ONLY when text and rating
    // are identical and there is exactly one possible historical candidate.
    // This covers Etsy export/API timezone date differences without creating
    // ambiguous matches for repeated identical reviews.
    const consumedHistoricalIds = new Set();
    const wouldCreate = [];

    for (const pending of pendingEtsy) {
      const candidates = remainingHistorical.filter((item) =>
        !consumedHistoricalIds.has(item.recordId) &&
        item.rating === pending.rating &&
        item.normalizedText === pending.normalizedText &&
        dayDifference(item.date, pending.date) <= 1
      );

      if (candidates.length === 1) {
        const existing = candidates[0];
        consumedHistoricalIds.add(existing.recordId);
        matchedExisting += 1;
        matches.push({
          ...pending.summary,
          matchMode: "same-text-rating-date±1d",
          airtableRecordId: existing.recordId,
          airtableName: existing.name,
          currentImportKey: existing.importKey,
          airtableDate: existing.date,
        });
      } else {
        wouldCreate.push({
          ...pending.summary,
          review: String(pending.review?.review || "").slice(0, 240),
          candidateCountWithinOneDay: candidates.length,
        });
      }
    }

    const unmatchedHistorical = remainingHistorical
      .filter((item) => !consumedHistoricalIds.has(item.recordId))
      .map(({ normalizedText, rating, date, ...item }) => item);

    return json({
      ok: true,
      mode: "read-only-sync-check",
      writesPerformed: 0,
      shopId: Number(shopId),
      etsyReportedCount: Number(ed?.count ?? etsyReviews.length),
      etsyFetchedCount: etsyReviews.length,
      airtableEtsyCount: airtableRecords.length,
      matchedExisting,
      wouldCreateCount: wouldCreate.length,
      unmatchedHistoricalCount: unmatchedHistorical.length,
      readyForApply:
        etsyReviews.length > 0 &&
        wouldCreate.length === 0 &&
        unmatchedHistorical.length === 0,
      wouldCreate,
      unmatchedHistorical,
      // Small sample proves which historical records were paired without
      // flooding the response with all 31 entries.
      matchSample: matches.slice(0, 8),
    });
  } catch (e) {
    return json({
      ok: false,
      error: "Server error",
      detail: String(e?.message || e || ""),
    }, 500);
  }
}

function historicalMatchKey({ text, rating, date }) {
  return [
    normalizeDate(date),
    String(Number(rating || 0)),
    normalizeText(text),
  ].join("|");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}


function dayDifference(a, b) {
  const da = dateToUtcDay(a);
  const db = dateToUtcDay(b);
  if (da === null || db === null) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86400000;
}

function dateToUtcDay(value) {
  const s = normalizeDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function dateFromUnix(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function etsyApiKey(review) {
  const transactionId = String(review?.transaction_id ?? "").trim();
  const listingId = String(review?.listing_id ?? "").trim();
  return `etsy-api-${transactionId}-${listingId}`;
}

function safeError(data) {
  if (!data || typeof data !== "object") return "Unknown error";
  return data?.error?.message || data?.error || data?.message || data;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
