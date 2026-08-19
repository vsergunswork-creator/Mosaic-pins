// functions/api/etsy-reviews-test.js
// Read-only diagnostic: resolve an Etsy shop, fetch ALL reviews via pagination,
// and report which reviews contain an official Etsy review image.
// Does NOT write to Airtable, R2, or Etsy.

export async function onRequestGet({ env, request }) {
  try {
    const key = String(env.ETSY_API_KEY || "").trim();
    const secret = String(env.ETSY_SHARED_SECRET || "").trim();
    if (!key || !secret) {
      return json({ ok: false, error: "Missing ETSY_API_KEY or ETSY_SHARED_SECRET" }, 500);
    }

    const url = new URL(request.url);
    const requestedShopId = String(url.searchParams.get("shop_id") || "").trim();
    const requestedShopName = String(url.searchParams.get("shop") || "").trim();
    const headers = { "x-api-key": `${key}:${secret}` };

    let shopId = requestedShopId;
    let shop = null;

    if (!shopId) {
      if (!requestedShopName) {
        return json({
          ok: false,
          error: "Provide ?shop=YOUR_ETSY_SHOP_NAME or ?shop_id=NUMERIC_SHOP_ID"
        }, 400);
      }

      const shopUrl = new URL("https://openapi.etsy.com/v3/application/shops");
      shopUrl.searchParams.set("shop_name", requestedShopName);

      const sr = await fetch(shopUrl.toString(), { headers });
      const sd = await sr.json().catch(() => ({}));
      if (!sr.ok) {
        return json({ ok: false, stage: "shop_lookup", etsyStatus: sr.status, etsyError: safeEtsyError(sd) }, sr.status);
      }

      const candidates = Array.isArray(sd?.results) ? sd.results : [];
      if (!candidates.length) {
        return json({ ok: false, stage: "shop_lookup", error: "No Etsy shop found for that name" }, 404);
      }

      shop = candidates.find((x) => String(x?.shop_name || "").toLowerCase() === requestedShopName.toLowerCase()) || candidates[0];
      shopId = String(shop?.shop_id || "").trim();
      if (!shopId) return json({ ok: false, stage: "shop_lookup", error: "Etsy response had no shop_id" }, 502);
    }

    const limit = 100;
    let offset = 0;
    let reportedCount = null;
    const all = [];

    // Etsy currently reports only 31 reviews for this shop, but paginate defensively.
    for (let page = 0; page < 20; page++) {
      const reviewsUrl = new URL(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/reviews`);
      reviewsUrl.searchParams.set("limit", String(limit));
      reviewsUrl.searchParams.set("offset", String(offset));

      const rr = await fetch(reviewsUrl.toString(), { headers });
      const rd = await rr.json().catch(() => ({}));
      if (!rr.ok) {
        return json({ ok: false, stage: "reviews", shopId, offset, etsyStatus: rr.status, etsyError: safeEtsyError(rd) }, rr.status);
      }

      if (reportedCount == null && Number.isFinite(Number(rd?.count))) reportedCount = Number(rd.count);
      const batch = Array.isArray(rd?.results) ? rd.results : [];
      all.push(...batch);

      if (!batch.length || batch.length < limit || (reportedCount != null && all.length >= reportedCount)) break;
      offset += batch.length;
    }

    const normalized = all.map((r) => ({
      reviewId: r?.review_id ?? null,
      transactionId: r?.transaction_id ?? null,
      listingId: r?.listing_id ?? null,
      rating: r?.rating ?? null,
      review: r?.review ?? "",
      language: r?.language ?? "",
      createdTimestamp: r?.created_timestamp ?? null,
      updatedTimestamp: r?.updated_timestamp ?? null,
      imageUrlFullxfull: String(r?.image_url_fullxfull || "").trim(),
    }));

    const withImages = normalized.filter((r) => r.imageUrlFullxfull);

    return json({
      ok: true,
      mode: "read-only-all-reviews-image-scan",
      shop: shop ? { shopId: shop?.shop_id ?? Number(shopId), shopName: shop?.shop_name || requestedShopName } : { shopId: Number(shopId) },
      countReportedByEtsy: reportedCount,
      fetchedCount: normalized.length,
      reviewsWithImages: withImages.length,
      reviewsWithoutImages: normalized.length - withImages.length,
      images: withImages.map((r) => ({
        transactionId: r.transactionId,
        listingId: r.listingId,
        rating: r.rating,
        createdTimestamp: r.createdTimestamp,
        imageUrlFullxfull: r.imageUrlFullxfull,
        reviewPreview: r.review.slice(0, 160),
      })),
      // Compact identity scan helps us plan de-duplication without dumping all review text.
      reviewKeys: normalized.map((r) => ({
        reviewId: r.reviewId,
        transactionId: r.transactionId,
        listingId: r.listingId,
        hasImage: Boolean(r.imageUrlFullxfull),
      })),
    });
  } catch (e) {
    return json({ ok: false, error: "Server error", detail: String(e?.message || e || "") }, 500);
  }
}

function safeEtsyError(data) {
  if (!data || typeof data !== "object") return "Unknown Etsy error";
  return data.error || data.error_description || data.message || data;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
