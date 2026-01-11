// functions/api/checkout.js
// POST /api/checkout
// body: { currency: "EUR"|"USD", items: [{ pin: "G7N21g", qty: 1 }, ...] }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  const headers = corsHeaders(request);

  try {
    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "EUR").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!["EUR", "USD"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, headers);
    }

    // --- ENV ---
    const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    const SITE_URL = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

    const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME;

    if (!STRIPE_SECRET_KEY) return json({ ok: false, error: "STRIPE_SECRET_KEY is not set" }, 500, headers);
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

    // --- 2) Validate cart + build Stripe line_items ---
    const line_items = [];
    const metaItems = []; // for webhook stock update

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

      line_items.push({
        quantity: qty,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(unit * 100),
          product_data: {
            name: `${p.title} • ${p.pin}`,
          },
        },
      });

      metaItems.push({ recordId: p.recordId, pin: p.pin, qty });
    }

    // ⚠️ Важно: Stripe metadata ограничена (≈500 символов на значение).
    // Если у Вас корзина может быть очень большой, лучше хранить items в KV по session.id.
    const session = await stripeCreateCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      payload: {
        mode: "payment",
        line_items,
        success_url: `${SITE_URL}/success.html`,
        cancel_url: `${SITE_URL}/canceled.html`,
        metadata: {
          currency,
          items: JSON.stringify(metaItems),
        },
      },
    });

    return json({ ok: true, url: session.url }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

// ---------------- Helpers ----------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  // Если запрос без Origin (например curl/server-to-server) — можно разрешить всем без credentials.
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }

  // Браузерный запрос — отражаем origin
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    // Credentials включайте ТОЛЬКО если реально используете cookies.
    // Если не используете cookies — лучше вообще убрать эту строку.
    // "Access-Control-Allow-Credentials": "true",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
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

async function stripeCreateCheckoutSession({ secretKey, payload }) {
  const form = new URLSearchParams();

  form.set("mode", payload.mode);
  form.set("success_url", payload.success_url);
  form.set("cancel_url", payload.cancel_url);

  if (payload.metadata) {
    for (const [k, v] of Object.entries(payload.metadata)) {
      if (v == null) continue;
      form.set(`metadata[${k}]`, String(v));
    }
  }

  (payload.line_items || []).forEach((li, i) => {
    form.set(`line_items[${i}][quantity]`, String(li.quantity));
    form.set(`line_items[${i}][price_data][currency]`, li.price_data.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(li.price_data.unit_amount));
    form.set(`line_items[${i}][price_data][product_data][name]`, li.price_data.product_data.name);
  });

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe error: ${data?.error?.message || r.statusText}`);
  return data;
}