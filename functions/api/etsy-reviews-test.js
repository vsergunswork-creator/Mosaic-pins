// functions/api/etsy-reviews-test.js
// Read-only diagnostic: resolve an Etsy shop and fetch a small sample of reviews.
// Does NOT write to Airtable or Etsy.

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
        return json({
          ok: false,
          stage: "shop_lookup",
          etsyStatus: sr.status,
          etsyError: safeEtsyError(sd),
        }, sr.status);
      }

      const candidates = Array.isArray(sd?.results) ? sd.results : [];
      if (!candidates.length) {
        return json({ ok: false, stage: "shop_lookup", error: "No Etsy shop found for that name" }, 404);
      }

      shop = candidates.find((x) => String(x?.shop_name || "").toLowerCase() === requestedShopName.toLowerCase()) || candidates[0];
      shopId = String(shop?.shop_id || "").trim();
      if (!shopId) return json({ ok: false, stage: "shop_lookup", error: "Etsy response had no shop_id" }, 502);
    }

    const reviewsUrl = new URL(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/reviews`);
    reviewsUrl.searchParams.set("limit", "10");
    reviewsUrl.searchParams.set("offset", "0");

    const rr = await fetch(reviewsUrl.toString(), { headers });
    const rd = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      return json({
        ok: false,
        stage: "reviews",
        shopId,
        etsyStatus: rr.status,
        etsyError: safeEtsyError(rd),
      }, rr.status);
    }

    const results = Array.isArray(rd?.results) ? rd.results : [];
    const sample = results.map((r) => ({
      reviewId: r?.review_id ?? null,
      transactionId: r?.transaction_id ?? null,
      listingId: r?.listing_id ?? null,
      rating: r?.rating ?? null,
      review: r?.review ?? "",
      language: r?.language ?? "",
      createdTimestamp: r?.created_timestamp ?? null,
      updatedTimestamp: r?.updated_timestamp ?? null,
      imageUrlFullxfull: r?.image_url_fullxfull ?? "",
    }));

    return json({
      ok: true,
      mode: "read-only",
      shop: shop ? { shopId: shop?.shop_id ?? Number(shopId), shopName: shop?.shop_name || requestedShopName } : { shopId: Number(shopId) },
      countReportedByEtsy: rd?.count ?? null,
      sampleCount: sample.length,
      reviews: sample,
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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
