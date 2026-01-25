// functions/api/paypal/create-order.js
export function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: corsHeaders(ctx.request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "USD").toUpperCase(); // USD/EUR
    const shippingCountry = String(body.shippingCountry || "US").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!["USD", "EUR"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, headers);
    }
    if (!shippingCountry || shippingCountry.length !== 2) {
      return json({ ok: false, error: "shippingCountry ISO2 required" }, 400, headers);
    }
    if (!items.length) return json({ ok: false, error: "Cart is empty" }, 400, headers);

    const base = env.PAYPAL_ENV === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

    const token = await paypalGetAccessToken(base, env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET);

    // ВАЖНО: чтобы не менять логику, можно пока слать итоги, без itemization.
    // Но лучше делать breakdown (items + shipping). Я оставлю коротко и надёжно:
    const total = Number(body.total); // передадим из фронта (cartTotal + shipping)
    if (!Number.isFinite(total) || total <= 0) {
      return json({ ok: false, error: "total is required" }, 400, headers);
    }

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: total.toFixed(2),
        }
      }],
      application_context: {
        shipping_preference: "GET_FROM_FILE",
        user_action: "PAY_NOW",
      }
    };

    const r = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ ok: false, error: data?.message || "PayPal create order failed", raw: data }, 500, headers);
    }

    return json({ ok: true, orderID: data.id }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, corsHeaders(ctx.request));
  }
}

async function paypalGetAccessToken(base, clientId, secret) {
  if (!clientId || !secret) throw new Error("PAYPAL_CLIENT_ID/SECRET missing");

  const auth = btoa(`${clientId}:${secret}`);
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal token error: ${data?.error_description || r.statusText}`);
  return data.access_token;
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" }
    : { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
