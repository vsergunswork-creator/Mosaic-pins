import { findProductRecordsByPins, normalizeAirtableProduct } from "./_airtable-products.js";
import { getDhlTracked2kgQuote } from "./_dhl-shipping.js";

// functions/api/checkout.js
// POST /api/checkout
// body: { currency: "EUR"|"USD", shippingCountry: "DE"|"US"|..., items: [{ pin: "G7N21g", qty: 1 }, ...] }
// Airtable source-of-truth version (checkout always validates fresh stock/prices)

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = {
    ...corsHeaders(request),
    "Cache-Control": "no-store",
  };

  try {
    const body = await request.json().catch(() => ({}));
    const currency = String(body.currency || "EUR").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];
    const shippingCountry = String(body.shippingCountry || "").trim().toUpperCase();

    if (!["EUR", "USD"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400, headers);
    }

    if (!shippingCountry || shippingCountry.length !== 2) {
      return json(
        { ok: false, error: "shippingCountry is required (ISO2, e.g. DE, US, CA)" },
        400,
        headers
      );
    }

    const STRIPE_SECRET_KEY = String(env.STRIPE_SECRET_KEY || "").trim();
    const SITE_URL = String(env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

    if (!STRIPE_SECRET_KEY) {
      return json({ ok: false, error: "STRIPE_SECRET_KEY is not set" }, 500, headers);
    }
    if (!env.STRIPE_EVENTS_KV) {
      return json({ ok: false, error: "STRIPE_EVENTS_KV binding is not set" }, 500, headers);
    }

    // --- normalize cart ---
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

    if (cartMap.size > 50) {
      return json({ ok: false, error: "Too many different items in cart (max 50)." }, 413, headers);
    }

    const pins = [...cartMap.keys()];

    // --- load current products directly from Airtable ---
    // Checkout intentionally bypasses catalog cache so price/stock can never be stale.
    const airtableRecords = await findProductRecordsByPins(env, pins);
    const byPin = new Map();
    for (const rec of airtableRecords) {
      const p = await normalizeAirtableProduct(env, rec);
      if (!p) continue;
      byPin.set(p.pin, {
        recordId: p.recordId,
        pin: p.pin,
        title: p.title,
        image: Array.isArray(p.images) && p.images.length ? String(p.images[0] || "") : "",
        diameter: Number.isFinite(Number(p.diameter)) ? Number(p.diameter) : null,
        stock: Number(p.stock || 0),
        active: p.active === true,
        priceEUR: p.price?.EUR,
        priceUSD: p.price?.USD,
      });
    }

    // --- validate cart + build Stripe line items ---
    const line_items = [];
    const metaItems = [];

    for (const pin of pins) {
      const qty = cartMap.get(pin);
      const p = byPin.get(pin);

      if (!p) {
        return json({ ok: false, error: `Product not found: ${pin}` }, 404, headers);
      }

      if (!p.active) {
        return json({ ok: false, error: `Product is not active: ${pin}` }, 409, headers);
      }

      if (!(p.stock > 0)) {
        return json({ ok: false, error: `Sold out: ${pin}` }, 409, headers);
      }

      if (qty > p.stock) {
        return json(
          { ok: false, error: `Not enough stock for ${pin}. Available: ${p.stock}` },
          409,
          headers
        );
      }

      const unit = currency === "EUR" ? p.priceEUR : p.priceUSD;
      if (!Number.isFinite(unit) || unit <= 0) {
        return json({ ok: false, error: `Missing price for ${pin} (${currency})` }, 500, headers);
      }

      line_items.push({
        quantity: qty,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: moneyToCents(unit),
          product_data: {
            name: `${p.title} • ${p.pin}`,
          },
        },
      });

      metaItems.push({
        recordId: p.recordId,
        pin: p.pin,
        title: p.title,
        image: p.image,
        diameter: p.diameter,
        qty,
        unitPrice: unit,
        currency,
      });
    }

    // Stripe metadata values are intentionally small. Store the validated cart in KV and
    // put only a short lookup key into the Checkout Session. This removes the old cart-size limit.
    const itemsStr = JSON.stringify(metaItems);
    const checkoutId = crypto.randomUUID();
    const cartKey = `checkout_cart:${checkoutId}`;
    await env.STRIPE_EVENTS_KV.put(cartKey, itemsStr, { expirationTtl: 7 * 24 * 60 * 60 });

    // =========================
    // DHL tracked shipping (2 kg)
    // =========================
    const shippingQuote = await getDhlTracked2kgQuote(env, shippingCountry, currency);
    const shippingAmount = Number(shippingQuote.price);
    if (!Number.isFinite(shippingAmount) || shippingAmount <= 0) {
      return json({ ok: false, error: "DHL shipping quote is unavailable." }, 503, headers);
    }

    // Security: Stripe only allows the exact country used for the server-side DHL quote.
    const allowedCountries = [shippingCountry];
    const shippingName = `${shippingQuote.service} • tracked`;

    const session = await stripeCreateCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      idempotencyKey: `mp_${checkoutId}`,
      payload: {
        mode: "payment",
        line_items,
        success_url: `${SITE_URL}/success`,
        cancel_url: `${SITE_URL}/cancel`,
        client_reference_id: `mp-${Date.now()}`,
        metadata: {
          currency,
          checkoutId,
          cartKey,
          shippingCountry,
          shippingService: shippingQuote.service,
          shippingProductNumber: shippingQuote.productNumber || "",
          shippingBaseEUR: String(shippingQuote.basePriceEUR),
        },
        shipping_address_collection: { allowed_countries: allowedCountries },
        phone_number_collection: { enabled: true },
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: {
                amount: moneyToCents(shippingAmount),
                currency: currency.toLowerCase(),
              },
              display_name: shippingName,
            },
          },
        ],
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

function moneyToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function asNumberOrNull(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

async function stripeCreateCheckoutSession({ secretKey, payload, idempotencyKey }) {
  const form = new URLSearchParams();

  form.set("mode", payload.mode);
  form.set("success_url", payload.success_url);
  form.set("cancel_url", payload.cancel_url);

  if (payload.client_reference_id) {
    form.set("client_reference_id", String(payload.client_reference_id));
  }

  if (payload.metadata) {
    for (const [k, v] of Object.entries(payload.metadata)) {
      if (v == null) continue;
      form.set(`metadata[${k}]`, String(v));
    }
  }

  if (payload.shipping_address_collection?.allowed_countries?.length) {
    payload.shipping_address_collection.allowed_countries.forEach((cc, i) => {
      form.set(`shipping_address_collection[allowed_countries][${i}]`, String(cc));
    });
  }

  if (payload.phone_number_collection?.enabled) {
    form.set(`phone_number_collection[enabled]`, "true");
  }

  if (Array.isArray(payload.shipping_options) && payload.shipping_options.length) {
    payload.shipping_options.forEach((opt, i) => {
      const srd = opt?.shipping_rate_data;
      if (!srd) return;

      if (srd.type) {
        form.set(`shipping_options[${i}][shipping_rate_data][type]`, String(srd.type));
      }
      if (srd.display_name) {
        form.set(`shipping_options[${i}][shipping_rate_data][display_name]`, String(srd.display_name));
      }
      if (srd.fixed_amount?.amount != null) {
        form.set(
          `shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`,
          String(srd.fixed_amount.amount)
        );
      }
      if (srd.fixed_amount?.currency) {
        form.set(
          `shipping_options[${i}][shipping_rate_data][fixed_amount][currency]`,
          String(srd.fixed_amount.currency)
        );
      }
    });
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
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form.toString(),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Stripe error: ${data?.error?.message || r.statusText}`);
  }
  return data;
}

function hashText(s) {
  s = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
