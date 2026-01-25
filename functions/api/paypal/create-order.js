// functions/api/paypal/create-order.js
// POST /api/paypal/create-order
// body: { items:[{title,qty,price}], currency:"USD" }
// returns: { ok:true, id:"ORDER_ID" }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const mode = String(env.PAYPAL_MODE || "sandbox").toLowerCase();
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId || !secret) {
      return json({ ok: false, error: "PayPal env variables are missing" }, 500, headers);
    }

    const apiBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const body = await request.json().catch(() => ({}));

    const currency = String(body.currency || "USD").toUpperCase();

    // items может быть пустой — тогда создаём order на 1 USD (для теста)
    const items = Array.isArray(body.items) ? body.items : [];

    let total = 0;
    for (const it of items) {
      const qty = Number(it.qty || 1);
      const price = Number(it.price || 0);
      if (Number.isFinite(qty) && Number.isFinite(price)) {
        total += qty * price;
      }
    }

    // если вдруг ничего нет — делаем тестовую сумму
    if (!Number.isFinite(total) || total <= 0) total = 1;

    // 1) берем access_token
    const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok || !tokenData.access_token) {
      return json(
        { ok: false, error: "PayPal token error", details: tokenData },
        500,
        headers
      );
    }

    const accessToken = tokenData.access_token;

    // 2) создаём order
    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: total.toFixed(2),
          },
        },
      ],
    };

    const orderRes = await fetch(`${apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    const orderData = await orderRes.json().catch(() => ({}));

    if (!orderRes.ok || !orderData.id) {
      return json(
        { ok: false, error: "Create order failed", details: orderData },
        500,
        headers
      );
    }

    return json({ ok: true, id: orderData.id }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

// -------- helpers --------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}