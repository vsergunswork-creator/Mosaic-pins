// functions/api/checkout.js
// POST /api/checkout
// body: { currency: "EUR"|"USD", shippingCountry: "DE"|"US"|..., items: [{ pin: "G7N21g", qty: 1 }, ...] }

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

    // ✅ shipping country (ISO2)
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

    // --- ENV ---
    const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    const SITE_URL = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

    const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME; // Products
    const AIRTABLE_PIN_FIELD = env.AIRTABLE_PIN_FIELD || "PIN Code"; // ✅ configurable

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

    // ✅ guard (Airtable/Stripe sane limits)
    if (cartMap.size > 50) {
      return json({ ok: false, error: "Too many different items in cart (max 50)." }, 413, headers);
    }

    const pins = [...cartMap.keys()];

    // --- 1) Fetch products from Airtable by PIN Code (batched + offset) ---
    const records = await airtableFetchByPinsBatched({
      token: AIRTABLE_TOKEN,
      baseId: AIRTABLE_BASE_ID,
      table: AIRTABLE_TABLE_NAME,
      pins,
      pinField: AIRTABLE_PIN_FIELD,
      // ✅ only needed fields for speed
      fields: [AIRTABLE_PIN_FIELD, "Title", "Stock", "Price_EUR", "Price_USD", "Active"],
    });

    const byPin = new Map();
    for (const rec of records) {
      const f = rec.fields || {};
      const pin = String(f[AIRTABLE_PIN_FIELD] ?? "").trim();
      if (!pin) continue;

      const active = Boolean(f["Active"]);
      const stock = toInt(f["Stock"], 0);

      const priceEUR = asNumberOrNull(f["Price_EUR"]);
      const priceUSD = asNumberOrNull(f["Price_USD"]);
      const title = String(f["Title"] ?? pin);

      byPin.set(pin, {
        recordId: rec.id,
        pin,
        title,
        active,
        stock,
        priceEUR,
        priceUSD,
      });
    }

    // --- 2) Validate cart + build Stripe line_items ---
    const line_items = [];
    const metaItems = [];

    for (const pin of pins) {
      const qty = cartMap.get(pin);
      const p = byPin.get(pin);

      if (!p) return json({ ok: false, error: `Product not found: ${pin}` }, 404, headers);
      if (!p.active) return json({ ok: false, error: `Product is not active: ${pin}` }, 409, headers);
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
          unit_amount: moneyToCents(unit),
          product_data: { name: `${p.title} • ${p.pin}` },
        },
      });

      metaItems.push({ recordId: p.recordId, pin: p.pin, qty });
    }

    const itemsStr = JSON.stringify(metaItems);
    // Stripe metadata value limit is small, держим запас
    if (itemsStr.length > 450) {
      return json(
        {
          ok: false,
          error:
            "Cart is too large for checkout metadata. Reduce items (or store items in KV by session).",
        },
        413,
        headers
      );
    }

    // =========================
    // ✅ Shipping zones
    // =========================
    const EUROPE_COUNTRIES = [
      // EU
      "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
      // EEA + UK + CH
      "NO","IS","LI","GB","CH",
      // Europe nearby
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

    // ✅ allowed countries in Stripe
    let allowedCountries = [];
    if (zone === "DE") allowedCountries = ["DE"];
    else if (zone === "EU") allowedCountries = EUROPE_COUNTRIES;
    else allowedCountries = USCA_COUNTRIES;

    // =========================
    // ✅ Shipping prices per currency (YOUR TABLE)
    // =========================
    const SHIPPING_PRICES = {
      EUR: { DE: 6.0, EU: 14.5, USCA: 27.0 },
      USD: { DE: 8.0, EU: 16.0, USCA: 29.0 },
    };

    const shippingAmount = SHIPPING_PRICES?.[currency]?.[zone];
    if (!Number.isFinite(shippingAmount)) {
      return json({ ok: false, error: `Shipping price missing for ${zone} in ${currency}.` }, 500, headers);
    }

    const shippingName =
      zone === "DE" ? "Germany shipping (tracked)"
      : zone === "EU" ? "Europe shipping (tracked)"
      : "USA / Canada shipping (tracked)";

    const session = await stripeCreateCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      // ✅ Optional but good practice: idempotency key (avoid duplicates on retry)
      idempotencyKey: `mp_${hashText(`${currency}|${shippingCountry}|${itemsStr}`)}`,
      payload: {
        mode: "payment",
        line_items,

        // ✅ лучше так: success.html потом редиректит на index?success=1 (см. ниже)
        success_url: `${SITE_URL}/success.html`,
        cancel_url: `${SITE_URL}/canceled.html`,

        client_reference_id: `mp-${Date.now()}`,
        metadata: {
          currency,
          items: itemsStr,
          shippingCountry,
          shippingZone: zone,
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
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function escapeForFormula(value) {
  return String(value).replace(/"/g, '\\"');
}

/**
 * ✅ Airtable: batched OR + offset pagination
 * - formula length safe
 * - supports >100 records via offset
 */
async function airtableFetchByPinsBatched({ token, baseId, table, pins, pinField, fields = [] }) {
  const out = [];
  const batchSize = 25; // ✅ safe for formula length
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const batchRecords = await airtableFetchAll({
      token,
      baseId,
      table,
      filterByFormula: buildActivePinsFormula(batch, pinField),
      fields,
      pageSize: 100,
      maxPagesGuard: 20,
    });
    out.push(...batchRecords);
  }
  return out;
}

function buildActivePinsFormula(pins, pinField) {
  // AND( {Active}=TRUE(), OR({PIN Code}="...", {PIN Code}="...") )
  const or = pins.map((p) => `{${pinField}}="${escapeForFormula(p)}"`).join(",");
  const orFormula = pins.length ? `OR(${or})` : "FALSE()";
  return `AND({Active}=TRUE(), ${orFormula})`;
}

async function airtableFetchAll({
  token,
  baseId,
  table,
  filterByFormula,
  pageSize = 100,
  maxPagesGuard = 20,
  fields = [],
}) {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  let all = [];
  let offset = null;

  for (let page = 0; page < maxPagesGuard; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("pageSize", String(pageSize));
    if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
    if (offset) url.searchParams.set("offset", offset);
    for (const f of fields) url.searchParams.append("fields[]", f);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable fetch failed: ${r.status} ${JSON.stringify(data)}`);

    const records = Array.isArray(data.records) ? data.records : [];
    all = all.concat(records);

    offset = data.offset || null;
    if (!offset) break;
  }

  return all;
}

/**
 * Stripe session create (form-url-encoded)
 * + idempotency key support
 */
async function stripeCreateCheckoutSession({ secretKey, payload, idempotencyKey }) {
  const form = new URLSearchParams();

  form.set("mode", payload.mode);
  form.set("success_url", payload.success_url);
  form.set("cancel_url", payload.cancel_url);

  if (payload.client_reference_id) form.set("client_reference_id", String(payload.client_reference_id));

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

      if (srd.type) form.set(`shipping_options[${i}][shipping_rate_data][type]`, String(srd.type));
      if (srd.display_name) form.set(`shipping_options[${i}][shipping_rate_data][display_name]`, String(srd.display_name));

      if (srd.fixed_amount?.amount != null) {
        form.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`, String(srd.fixed_amount.amount));
      }
      if (srd.fixed_amount?.currency) {
        form.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][currency]`, String(srd.fixed_amount.currency));
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
  if (!r.ok) throw new Error(`Stripe error: ${data?.error?.message || r.statusText}`);
  return data;
}

/**
 * Small stable hash (NOT crypto) to make an idempotency key.
 * Enough for Stripe request de-dupe.
 */
function hashText(s) {
  s = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}