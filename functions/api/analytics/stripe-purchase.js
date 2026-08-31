// GET /api/analytics/stripe-purchase?session_id=cs_...
// Returns only non-PII purchase data for a verified paid Stripe Checkout Session.
// Used by success.js to send a deduplicated purchase event to the Google tag.

export async function onRequestGet({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  };

  try {
    const url = new URL(request.url);
    const sessionId = String(url.searchParams.get("session_id") || "").trim();
    if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid session_id" }), { status: 400, headers });
    }

    const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
    if (!secretKey) {
      return new Response(JSON.stringify({ ok: false, error: "Stripe is not configured" }), { status: 500, headers });
    }

    const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    const session = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Stripe session lookup failed" }), { status: 400, headers });
    }

    if (String(session.payment_status || "").toLowerCase() !== "paid") {
      return new Response(JSON.stringify({ ok: false, error: "Payment is not paid" }), { status: 409, headers });
    }

    const lineRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=100`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    const lineData = await lineRes.json().catch(() => ({}));
    const rawItems = lineRes.ok && Array.isArray(lineData?.data) ? lineData.data : [];

    const currency = String(session.currency || "EUR").toUpperCase();
    const items = rawItems.map((line) => {
      const quantity = Math.max(1, Number(line?.quantity || 1) || 1);
      const name = String(line?.description || "Mosaic Pin").trim();
      const parts = name.split("•").map((s) => s.trim()).filter(Boolean);
      const pin = parts.length > 1 ? parts[parts.length - 1] : name;
      const amountTotal = Number(line?.amount_total);
      const item = {
        item_id: pin,
        item_name: parts.length > 1 ? parts.slice(0, -1).join(" • ") : name,
        quantity
      };
      if (Number.isFinite(amountTotal) && quantity > 0) item.price = Number((amountTotal / 100 / quantity).toFixed(2));
      return item;
    });

    const amountTotal = Number(session.amount_total);
    const shippingTotal = Number(session?.total_details?.amount_shipping);
    const transactionId = String(session.payment_intent || session.id || sessionId);

    return new Response(JSON.stringify({
      ok: true,
      purchase: {
        transaction_id: transactionId,
        value: Number.isFinite(amountTotal) ? Number((amountTotal / 100).toFixed(2)) : 0,
        currency,
        shipping: Number.isFinite(shippingTotal) ? Number((shippingTotal / 100).toFixed(2)) : 0,
        items
      }
    }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), { status: 500, headers });
  }
}
