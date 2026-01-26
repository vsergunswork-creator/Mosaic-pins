// functions/api/paypal/create-order.js
// POST /api/paypal/create-order
// body: {
//   currency: "EUR"|"USD",
//   shippingCountry: "US"|"CA"|"DE"|"FR"|... (ISO2),
//   items: [{ pin:"G10N11gt", qty:2 }, ...]
// }
// returns: { ok:true, id:"PAYPAL_ORDER_ID", total:"42.00", currency:"USD" }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const mode = normMode(env.PAYPAL_MODE);
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId || !secret) {
      return json({ ok: false, error: "PayPal env variables are missing" }, 500, headers);
    }

    const apiBase =
      mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    const body = await request.json().catch(() => ({}));
    const currency = normCurrency(body.currency);
    const shippingCountry = String(body.shippingCountry || "").toUpperCase().trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      return json({ ok: false, error: "Cart is empty" }, 400, headers);
    }

    // trusted products
    const products = await fetchProductsFromOrigin(request);
    const byPin = new Map(products.map(p => [String(p.pin ?? "").trim(), p]));

    // cents арифметика (чтобы PayPal breakdown совпадал идеально)
    let totalCents = 0;
    const ppItems = [];

    for (const it of items) {
      const pin = String(it?.pin || "").trim();
      let qty = Number(it?.qty || 1);

      if (!pin) return json({ ok: false, error: "Item pin is missing" }, 400, headers);
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;
      qty = Math.min(99, Math.floor(qty));

      const p = byPin.get(pin);
      if (!p) return json({ ok: false, error: `Unknown product pin: ${pin}` }, 400, headers);

      const stock = Number(p.stock ?? 0);
      if (!Number.isFinite(stock) || stock <= 0) {
        return json({ ok: false, error: `Sold out: ${pin}` }, 400, headers);
      }
      if (qty > stock) {
        return json(
          { ok: false, error: `Not enough stock for ${pin}. Available: ${stock}` },
          400,
          headers
        );
      }

      const unit = Number(p?.price?.[currency]);
      if (!Number.isFinite(unit) || unit <= 0) {
        return json({ ok: false, error: `Price missing for ${pin} in ${currency}` }, 500, headers);
      }

      const unitCents = Math.round(unit * 100);
      totalCents += unitCents * qty;

      ppItems.push({
        name: String(p.title || pin).slice(0, 127),
        quantity: String(qty),
        unit_amount: { currency_code: currency, value: (unitCents / 100).toFixed(2) },
        sku: pin,
        category: "PHYSICAL_GOODS",
      });
    }

    if (!(totalCents > 0)) {
      return json({ ok: false, error: "Total is invalid" }, 500, headers);
    }

    const totalStr = (totalCents / 100).toFixed(2);

    const accessToken = await getPayPalAccessToken(apiBase, clientId, secret);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "MOSAIC_PINS",
          description: "Mosaic Pins order",
          custom_id: shippingCountry || "NA",
          amount: {
            currency_code: currency,
            value: totalStr,
            breakdown: {
              item_total: { currency_code: currency, value: totalStr },
            },
          },
          items: ppItems,
        },
      ],
      application_context: {
        brand_name: "Mosaic Pins",
        // ✅ лучше для физ. товаров: PayPal возьмёт адрес из аккаунта покупателя
        shipping_preference: "GET_FROM_FILE",
        user_action: "PAY_NOW",
      },
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
      return json({ ok: false, error: "Create order failed", details: orderData }, 500, headers);
    }

    return json({ ok: true, id: orderData.id, total: totalStr, currency }, 200, headers);
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

function normMode(v) {
  const m = String(v || "sandbox").toLowerCase();
  return m === "live" ? "live" : "sandbox";
}

function normCurrency(v) {
  const c = String(v || "USD").toUpperCase();
  return c === "EUR" ? "EUR" : "USD";
}

async function getPayPalAccessToken(apiBase, clientId, secret) {
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
    throw new Error(tokenData?.error_description || "PayPal token error");
  }
  return tokenData.access_token;
}

async function fetchProductsFromOrigin(request) {
  const url = new URL(request.url);
  url.pathname = "/api/products";
  url.search = "";

  const r = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error("Products API is not reachable");

  return Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
}