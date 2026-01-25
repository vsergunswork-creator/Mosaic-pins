// /functions/api/paypal/create-order.js
// POST /api/paypal/create-order
// body: { currency:"EUR"|"USD", shippingCountry:"DE"|"US"|..., items:[{pin,qty},...] }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "USD").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];

    const shippingCountry = String(body.shippingCountry || "").trim().toUpperCase();
    if (!["EUR", "USD"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, headers);
    }
    if (!shippingCountry || shippingCountry.length !== 2) {
      return json({ ok: false, error: "shippingCountry is required (ISO2, e.g. DE, US, CA)" }, 400, headers);
    }

    // --- ENV ---
    const PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = env.PAYPAL_CLIENT_SECRET;
    const PAYPAL_ENV = String(env.PAYPAL_ENV || "sandbox").toLowerCase(); // sandbox|live

    const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME;

    if (!PAYPAL_CLIENT_ID) return json({ ok: false, error: "PAYPAL_CLIENT_ID is not set" }, 500, headers);
    if (!PAYPAL_CLIENT_SECRET) return json({ ok: false, error: "PAYPAL_CLIENT_SECRET is not set" }, 500, headers);

    if (!AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN is not set" }, 500, headers);
    if (!AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID is not set" }, 500, headers);
    if (!AIRTABLE_TABLE_NAME) return json({ ok: false, error: "AIRTABLE_TABLE_NAME is not set" }, 500, headers);

    // --- normalize cart (sum qty by pin) ---
    const cartMap = new Map();
    for (const it of items) {
      const pin = String(it?.pin || "").trim();
      let qty = Math.floor(Number(it?.qty || 0));
      if (!pin) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty > 99) qty = 99;
      cartMap.set(pin, (cartMap.get(pin) || 0) + qty);
    }

    if (!cartMap.size) {
      return json({ ok: false, error: "Cart is empty" }, 400, headers);
    }

    const pins = [...cartMap.keys()];

    // --- 1) Fetch products from Airtable by PIN Code ---
    const records = await airtableFetchByPins({
      token: AIRTABLE_TOKEN,
      baseId: AIRTABLE_BASE_ID,
      table: AIRTABLE_TABLE_NAME,
      pins,
    });

    const byPin = new Map();
    for (const rec of records) {
      const f = rec.fields || {};
      const pin = String(f["PIN Code"] ?? "").trim();
      if (!pin) continue;

      const stock = Number(f["Stock"] ?? 0);
      const priceEUR = Number(f["Price_EUR"]);
      const priceUSD = Number(f["Price_USD"]);
      const title = String(f["Title"] ?? pin);

      byPin.set(pin, {
        recordId: rec.id,
        pin,
        title,
        stock: Number.isFinite(stock) ? stock : 0,
        priceEUR: Number.isFinite(priceEUR) ? priceEUR : null,
        priceUSD: Number.isFinite(priceUSD) ? priceUSD : null,
      });
    }

    // --- 2) Validate cart + build PayPal items + compute totals ---
    const paypalItems = [];
    const metaItems = [];

    let itemsTotal = 0;

    for (const pin of pins) {
      const qty = cartMap.get(pin);
      const p = byPin.get(pin);

      if (!p) return json({ ok: false, error: `Product not found: ${pin}` }, 404, headers);
      if (!(p.stock > 0)) return json({ ok: false, error: `Sold out: ${pin}` }, 409, headers);
      if (qty > p.stock) {
        return json({ ok: false, error: `Not enough stock for ${pin}. Available: ${p.stock}` }, 409, headers);
      }

      const unit = currency === "EUR" ? p.priceEUR : p.priceUSD;
      if (!Number.isFinite(unit) || unit <= 0) {
        return json({ ok: false, error: `Missing price for ${pin} (${currency})` }, 500, headers);
      }

      itemsTotal += unit * qty;

      paypalItems.push({
        name: `${p.title} • ${p.pin}`,
        unit_amount: { currency_code: currency, value: money2(unit) },
        quantity: String(qty),
        category: "PHYSICAL_GOODS",
      });

      metaItems.push({ recordId: p.recordId, pin: p.pin, qty });
    }

    // =========================
    // ✅ Shipping zones (same as your Stripe table)
    // =========================
    const EUROPE_COUNTRIES = [
      "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
      "NO","IS","LI","GB","CH",
      "AL","BA","ME","MK","RS","MD","UA",
    ];
    const USCA_COUNTRIES = ["US", "CA"];

    function detectZone(cc) {
      if (cc === "DE") return "DE";
      if (USCA_COUNTRIES.includes(cc)) return "USCA";
      if (EUROPE_COUNTRIES.includes(cc)) return "EU";
      return "UNSUPPORTED";
    }

    const zone = detectZone(shippingCountry);
    if (zone === "UNSUPPORTED") {
      return json({ ok: false, error: `Shipping is not available to ${shippingCountry}.` }, 400, headers);
    }

    const SHIPPING_PRICES = {
      EUR: { DE: 6.0, EU: 14.5, USCA: 27.0 },
      USD: { DE: 8.0, EU: 16.0, USCA: 29.0 },
    };

    const shippingAmount = SHIPPING_PRICES?.[currency]?.[zone];
    if (!Number.isFinite(shippingAmount)) {
      return json({ ok: false, error: `Shipping price missing for ${zone} in ${currency}.` }, 500, headers);
    }

    const grandTotal = itemsTotal + shippingAmount;

    // meta for later capture (send back to frontend; it will forward to capture)
    const meta = JSON.stringify({
      currency,
      shippingCountry,
      shippingZone: zone,
      items: metaItems,
    });

    if (meta.length > 1800) {
      return json(
        { ok: false, error: "Cart is too large for PayPal metadata. Reduce items (or store in KV by orderId)." },
        413,
        headers
      );
    }

    // --- PayPal access token ---
    const accessToken = await paypalGetAccessToken({
      clientId: PAYPAL_CLIENT_ID,
      clientSecret: PAYPAL_CLIENT_SECRET,
      env: PAYPAL_ENV,
    });

    const baseUrl =
      PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    // --- Create PayPal order ---
    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `mp-${Date.now()}`,
          description: "Mosaic Pins order",
          items: paypalItems,
          amount: {
            currency_code: currency,
            value: money2(grandTotal),
            breakdown: {
              item_total: { currency_code: currency, value: money2(itemsTotal) },
              shipping: { currency_code: currency, value: money2(shippingAmount) },
            },
          },
        },
      ],
      application_context: {
        user_action: "PAY_NOW",
        shipping_preference: "GET_FROM_FILE",
      },
    };

    const r = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.id) {
      throw new Error(`PayPal create-order failed: ${data?.message || r.statusText}`);
    }

    return json({ ok: true, orderId: data.id, meta }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

// ---------------- Helpers ----------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function money2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

async function paypalGetAccessToken({ clientId, clientSecret, env }) {
  const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const basic = btoa(`${clientId}:${clientSecret}`);

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.access_token) {
    throw new Error(`PayPal token error: ${data?.error_description || r.statusText}`);
  }
  return data.access_token;
}

async function airtableFetchByPins({ token, baseId, table, pins }) {
  const or = pins.map((p) => `{PIN Code}="${String(p).replace(/"/g, '\\"')}"`).join(",");
  const formula = pins.length ? `OR(${or})` : "FALSE()";

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("pageSize", "100");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable fetch failed: ${r.status} ${JSON.stringify(data)}`);

  return Array.isArray(data.records) ? data.records : [];
}