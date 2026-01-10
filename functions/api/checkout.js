// functions/api/checkout.js
// POST /api/checkout
// body: { currency: "EUR"|"USD", items: [{ pin: "G7N21g", qty: 1 }, ...] }

export async function onRequestPost({ env, request }) {
  // --- CORS ---
  const origin = request.headers.get("Origin") || "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    must(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
    must(env.AIRTABLE_TOKEN, "AIRTABLE_TOKEN");
    must(env.AIRTABLE_BASE_ID, "AIRTABLE_BASE_ID");
    must(env.AIRTABLE_TABLE_NAME, "AIRTABLE_TABLE_NAME");

    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "EUR").toUpperCase();
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!["EUR", "USD"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, corsHeaders);
    }
    if (!rawItems.length) {
      return json({ ok: false, error: "Cart is empty" }, 400, corsHeaders);
    }

    // normalize cart: merge same pins, accept qty OR quantity
    const cartMap = new Map(); // pin -> qty
    for (const it of rawItems) {
      const pin = String(it?.pin || "").trim();
      let qty = it?.qty ?? it?.quantity ?? 0;
      qty = Math.floor(Number(qty));
      if (!pin) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty > 99) qty = 99;
      cartMap.set(pin, (cartMap.get(pin) || 0) + qty);
    }
    if (!cartMap.size) return json({ ok: false, error: "Cart is empty" }, 400, corsHeaders);

    const pins = [...cartMap.keys()];

    // fetch products from Airtable by pins (Active=TRUE())
    const records = await airtableFetchByPins({
      token: env.AIRTABLE_TOKEN,
      baseId: env.AIRTABLE_BASE_ID,
      table: env.AIRTABLE_TABLE_NAME,
      pinField: env.AIRTABLE_PIN_FIELD || "PIN Code",
      pins,
    });

    const byPin = new Map();
    for (const rec of records) {
      const f = rec.fields || {};
      const pin = String(f[env.AIRTABLE_PIN_FIELD || "PIN Code"] ?? "").trim();
      if (!pin) continue;

      byPin.set(pin, {
        recordId: rec.id,
        pin,
        title: String(f["Title"] ?? pin),
        stock: toInt(f["Stock"], 0),
        priceEUR: asNumberOrNull(f["Price_EUR"]),
        priceUSD: asNumberOrNull(f["Price_USD"]),
        image: firstImageUrl(f["Images"]),
        diameter: f["Diameter"] ?? null,
      });
    }

    const line_items = [];
    const metaItems = []; // [{recordId, pin, qty}]

    for (const pin of pins) {
      const qty = cartMap.get(pin);
      const p = byPin.get(pin);

      if (!p) return json({ ok: false, error: `Product not found: ${pin}` }, 404, corsHeaders);
      if (!(p.stock > 0)) return json({ ok: false, error: `Sold out: ${pin}` }, 409, corsHeaders);
      if (qty > p.stock) {
        return json({ ok: false, error: `Not enough stock for ${pin}. Available: ${p.stock}` }, 409, corsHeaders);
      }

      const unit = currency === "EUR" ? p.priceEUR : p.priceUSD;
      if (!Number.isFinite(unit) || unit <= 0) {
        return json({ ok: false, error: `Missing price for ${pin} (${currency})` }, 500, corsHeaders);
      }

      line_items.push({
        quantity: qty,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(unit * 100),
          product_data: {
            name: `${p.title} • ${p.pin}`,
            description: p.diameter != null ? `Ø ${p.diameter} mm` : undefined,
            images: p.image ? [p.image] : undefined,
          },
        },
      });

      metaItems.push({ recordId: p.recordId, pin: p.pin, qty });
    }

    const siteOrigin = new URL(request.url).origin;
    const successUrl = (env.SITE_SUCCESS_URL || `${siteOrigin}/?success=1`);
    const cancelUrl = (env.SITE_CANCEL_URL || `${siteOrigin}/?canceled=1`);

    const session = await stripeCreateCheckoutSession({
      secretKey: env.STRIPE_SECRET_KEY,
      payload: {
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items,
        metadata: {
          // Stripe metadata только строки:
          items: JSON.stringify(metaItems),
        },
      },
    });

    return json({ ok: true, url: session.url }, 200, corsHeaders);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, corsHeaders);
  }
}

// -------- helpers --------

function must(v, name) {
  if (!v) throw new Error(`${name} is not set`);
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function asNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function firstImageUrl(v) {
  if (!Array.isArray(v)) return null;
  const u = v?.[0]?.url;
  return u ? String(u) : null;
}

async function airtableFetchByPins({ token, baseId, table, pinField, pins }) {
  // ⚠️ Для корзины обычно мало позиций — формула OR ок.
  // + фильтруем Active=TRUE()
  const or = pins
    .map((p) => `{${pinField}}="${String(p).replace(/"/g, '\\"')}"`)
    .join(",");

  const formula = `AND({Active}=TRUE(), OR(${or}))`;

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

    const desc = li.price_data.product_data.description;
    if (desc) form.set(`line_items[${i}][price_data][product_data][description]`, String(desc));

    const img0 = li.price_data.product_data.images?.[0];
    if (img0) form.set(`line_items[${i}][price_data][product_data][images][0]`, String(img0));
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