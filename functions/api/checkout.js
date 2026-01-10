// functions/api/checkout.js
// POST /api/checkout
// body: { currency: "EUR"|"USD", items: [{ pin: "G7N21g", qty: 1 }, ...] }

export async function onRequestPost(ctx) {
  try {
    const { request, env } = ctx;

    // --- CORS (чтобы запросы работали нормально) ---
    const origin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    };

    // preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "EUR").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!["EUR", "USD"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, corsHeaders);
    }
    if (!items.length) {
      return json({ ok: false, error: "Cart is empty" }, 400, corsHeaders);
    }

    // нормализация корзины (суммируем qty по pin)
    const cartMap = new Map();
    for (const it of items) {
      const pin = String(it?.pin || "").trim();
      const qty = Number(it?.qty || 0);
      if (!pin) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      cartMap.set(pin, (cartMap.get(pin) || 0) + Math.floor(qty));
    }
    if (!cartMap.size) {
      return json({ ok: false, error: "Cart is empty" }, 400, corsHeaders);
    }

    const pins = [...cartMap.keys()];

    // --- ENV ---
    const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    const SITE_URL = (env.SITE_URL || "").replace(/\/$/, "");
    const AIRTABLE_API_KEY = env.AIRTABLE_API_KEY;
    const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE = env.AIRTABLE_TABLE || env.AIRTABLE_TABLE_NAME || "Products";

    if (!STRIPE_SECRET_KEY || !SITE_URL || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE) {
      return json(
        { ok: false, error: "Server env is not configured (Stripe/Airtable/SITE_URL)" },
        500,
        corsHeaders
      );
    }

    // --- 1) Берём товары из Airtable по PIN Code ---
    const records = await airtableFetchByPins({
      apiKey: AIRTABLE_API_KEY,
      baseId: AIRTABLE_BASE_ID,
      table: AIRTABLE_TABLE,
      pins,
    });

    // byPin: pin -> { recordId, title, stock, priceEUR, priceUSD }
    const byPin = new Map();
    for (const rec of records) {
      const fields = rec.fields || {};
      const pin = String(fields["PIN Code"] ?? "").trim();
      if (!pin) continue;

      const stock = Number(fields.Stock ?? 0);
      const priceEUR = Number(fields.Price_EUR);
      const priceUSD = Number(fields.Price_USD);

      const title = String(fields.Title ?? fields.title ?? fields.Name ?? fields.name ?? pin);

      byPin.set(pin, {
        recordId: rec.id,
        pin,
        title,
        stock: Number.isFinite(stock) ? stock : 0,
        priceEUR: Number.isFinite(priceEUR) ? priceEUR : null,
        priceUSD: Number.isFinite(priceUSD) ? priceUSD : null,
      });
    }

    // --- 2) Валидация корзины и формирование line_items для Stripe ---
    const line_items = [];
    const orderItemsForMeta = []; // для webhook: [{recordId, pin, qty}...]

    for (const pin of pins) {
      const qty = cartMap.get(pin);
      const p = byPin.get(pin);

      if (!p) {
        return json({ ok: false, error: `Product not found: ${pin}` }, 404, corsHeaders);
      }
      if (!(p.stock > 0)) {
        return json({ ok: false, error: `Sold out: ${pin}` }, 409, corsHeaders);
      }
      if (qty > p.stock) {
        return json({ ok: false, error: `Not enough stock for ${pin}. Available: ${p.stock}` }, 409, corsHeaders);
      }

      const unit = currency === "EUR" ? p.priceEUR : p.priceUSD;
      if (typeof unit !== "number" || !Number.isFinite(unit)) {
        return json({ ok: false, error: `Missing price for ${pin} (${currency})` }, 500, corsHeaders);
      }

      line_items.push({
        quantity: qty,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(unit * 100), // евро/доллар -> центы
          product_data: {
            name: p.title,
            metadata: { pin: p.pin },
          },
        },
      });

      orderItemsForMeta.push({ recordId: p.recordId, pin: p.pin, qty });
    }

    // --- 3) Создаём Stripe Checkout Session ---
    const session = await stripeCreateCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      payload: {
        mode: "payment",
        line_items,
        success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/cancel.html`,
        // ВАЖНО: всё нужное для списания стока храним в metadata
        metadata: {
          currency,
          items: JSON.stringify(orderItemsForMeta),
        },
      },
    });

    return json({ ok: true, url: session.url }, 200, corsHeaders);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
  }
}

// ---------------- Helpers ----------------

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

// Airtable: берём записи по PIN Code через filterByFormula
async function airtableFetchByPins({ apiKey, baseId, table, pins }) {
  // OR({PIN Code}="X",{PIN Code}="Y")
  const or = pins
    .map((p) => `{PIN Code}="${String(p).replace(/"/g, '\\"')}"`)
    .join(",");
  const formula = pins.length ? `OR(${or})` : "FALSE()";

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("pageSize", "100");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Airtable fetch failed: ${r.status} ${t}`);
  }

  const data = await r.json();
  return Array.isArray(data.records) ? data.records : [];
}

// Stripe create session (без SDK, через fetch)
async function stripeCreateCheckoutSession({ secretKey, payload }) {
  const form = new URLSearchParams();

  // mode
  form.set("mode", payload.mode);

  // urls
  form.set("success_url", payload.success_url);
  form.set("cancel_url", payload.cancel_url);

  // metadata
  if (payload.metadata) {
    for (const [k, v] of Object.entries(payload.metadata)) {
      form.set(`metadata[${k}]`, String(v));
    }
  }

  // line_items
  (payload.line_items || []).forEach((li, i) => {
    form.set(`line_items[${i}][quantity]`, String(li.quantity));
    form.set(`line_items[${i}][price_data][currency]`, li.price_data.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(li.price_data.unit_amount));
    form.set(`line_items[${i}][price_data][product_data][name]`, li.price_data.product_data.name);

    const md = li.price_data.product_data.metadata || {};
    for (const [k, v] of Object.entries(md)) {
      form.set(`line_items[${i}][price_data][product_data][metadata][${k}]`, String(v));
    }
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
  if (!r.ok) {
    throw new Error(`Stripe error: ${data?.error?.message || r.statusText}`);
  }
  return data;
}