// functions/api/etsy-buyer-debug.js
// READ-ONLY diagnostic for Etsy review buyer-name investigation.
// Does NOT write to Airtable, R2, Etsy, or change the production sync.
// It intentionally returns only a small safe subset of transaction/receipt fields.

const DEFAULT_SHOP_ID = "60806077";

export async function onRequestGet({ env, request }) {
  try {
    const key = String(env.ETSY_API_KEY || "").trim();
    const secret = String(env.ETSY_SHARED_SECRET || "").trim();
    const accessToken = String(env.ETSY_ACCESS_TOKEN || "").trim();
    const shopId = String(env.ETSY_SHOP_ID || DEFAULT_SHOP_ID).trim();

    if (!key || !secret) {
      return json({ ok: false, error: "Missing ETSY_API_KEY or ETSY_SHARED_SECRET" }, 500);
    }
    if (!/^\d+$/.test(shopId)) {
      return json({ ok: false, error: "Invalid ETSY_SHOP_ID" }, 500);
    }

    const u = new URL(request.url);
    let transactionId = String(u.searchParams.get("transaction_id") || "").trim();

    const apiHeaders = { "x-api-key": `${key}:${secret}` };

    // If transaction_id was not supplied, use the newest Etsy review.
    let review = null;
    if (!transactionId) {
      const reviewsUrl = new URL(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/reviews`);
      reviewsUrl.searchParams.set("limit", "100");
      reviewsUrl.searchParams.set("offset", "0");

      const rr = await fetch(reviewsUrl.toString(), { headers: apiHeaders });
      const rd = await rr.json().catch(() => ({}));
      if (!rr.ok) {
        return json({
          ok: false,
          stage: "reviews",
          etsyStatus: rr.status,
          etsyError: safeError(rd),
        }, rr.status);
      }

      const rows = Array.isArray(rd?.results) ? rd.results : [];
      rows.sort((a, b) => Number(b?.created_timestamp || 0) - Number(a?.created_timestamp || 0));
      review = rows[0] || null;
      transactionId = String(review?.transaction_id || "").trim();
    }

    if (!transactionId || !/^\d+$/.test(transactionId)) {
      return json({
        ok: false,
        stage: "review",
        error: "No valid transaction_id found. You may pass ?transaction_id=NUMBER",
      }, 400);
    }

    const reviewDiagnostic = review ? {
      transactionId: review?.transaction_id ?? null,
      listingId: review?.listing_id ?? null,
      rating: review?.rating ?? null,
      createdTimestamp: review?.created_timestamp ?? null,
      reviewPreview: String(review?.review || "").slice(0, 180),
      rawFieldNames: Object.keys(review || {}).sort(),
      reviewerName: review?.reviewer_name ?? null,
      buyerName: review?.buyer_name ?? null,
      buyerUserId: review?.buyer_user_id ?? null,
    } : null;

    // Private transaction/receipt endpoints require OAuth transactions_r.
    // If no OAuth token is configured, stop here and report that clearly.
    if (!accessToken) {
      return json({
        ok: true,
        mode: "read-only-etsy-buyer-debug",
        shopId: Number(shopId),
        transactionId: Number(transactionId),
        review: reviewDiagnostic,
        oauth: {
          configured: false,
          nextStep: "Add an Etsy OAuth access token with transactions_r as ETSY_ACCESS_TOKEN, then run this endpoint again.",
        },
        writesPerformed: false,
      });
    }

    const authHeaders = {
      ...apiHeaders,
      Authorization: `Bearer ${accessToken}`,
    };

    const txUrl = `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/transactions/${encodeURIComponent(transactionId)}`;
    const tr = await fetch(txUrl, { headers: authHeaders });
    const td = await tr.json().catch(() => ({}));

    if (!tr.ok) {
      return json({
        ok: false,
        mode: "read-only-etsy-buyer-debug",
        stage: "transaction",
        shopId: Number(shopId),
        transactionId: Number(transactionId),
        review: reviewDiagnostic,
        oauth: { configured: true },
        etsyStatus: tr.status,
        etsyError: safeError(td),
        hint: tr.status === 403
          ? "The OAuth token likely does not include transactions_r."
          : "Check the OAuth token and Etsy permissions.",
        writesPerformed: false,
      }, tr.status);
    }

    const receiptId = td?.receipt_id ?? null;
    let receiptDiagnostic = null;

    if (receiptId) {
      const receiptUrl = `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}`;
      const pr = await fetch(receiptUrl, { headers: authHeaders });
      const pd = await pr.json().catch(() => ({}));

      if (pr.ok) {
        // Deliberately do NOT return email, address, phone, or payment details.
        receiptDiagnostic = {
          receiptId: pd?.receipt_id ?? receiptId,
          buyerUserId: pd?.buyer_user_id ?? null,
          name: pd?.name ?? null,
          status: pd?.status ?? null,
          createTimestamp: pd?.create_timestamp ?? pd?.created_timestamp ?? null,
          rawFieldNames: Object.keys(pd || {}).sort(),
        };
      } else {
        receiptDiagnostic = {
          receiptId,
          etsyStatus: pr.status,
          etsyError: safeError(pd),
        };
      }
    }

    return json({
      ok: true,
      mode: "read-only-etsy-buyer-debug",
      shopId: Number(shopId),
      transactionId: Number(transactionId),
      review: reviewDiagnostic,
      transaction: {
        transactionId: td?.transaction_id ?? Number(transactionId),
        receiptId: td?.receipt_id ?? null,
        buyerUserId: td?.buyer_user_id ?? null,
        title: td?.title ?? null,
        createdTimestamp: td?.created_timestamp ?? td?.create_timestamp ?? null,
        rawFieldNames: Object.keys(td || {}).sort(),
      },
      receipt: receiptDiagnostic,
      oauth: { configured: true },
      writesPerformed: false,
    });
  } catch (e) {
    return json({
      ok: false,
      error: "Server error",
      detail: String(e?.message || e || ""),
      writesPerformed: false,
    }, 500);
  }
}

function safeError(data) {
  if (!data || typeof data !== "object") return "Unknown Etsy error";
  return data.error || data.error_description || data.message || data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
