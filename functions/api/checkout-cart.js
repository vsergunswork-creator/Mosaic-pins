export async function onRequestPost({ env, request }) {
  try {
    // Required env
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const body = await request.json().catch(() => ({}));
    const currency = (body.currency || "EUR").toUpperCase();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!["EUR","USD"].includes(currency)) return json({ error: "Unsupported currency" }, 400);
    if (!items.length) return json({ error: "Empty cart" }, 400);

    // Load active products from Airtable (one time)
    const products = await loadProductsFromAirtable(env);

    // Build Stripe line_items using price_data (no need to create Stripe Price IDs)
    const line_items = [];
    for (const it of items) {
      const pin = String(it.pin || "").trim();
      const qty = Math.floor(Number(it.quantity || 0));
      if (!pin || qty <= 0) continue;

      const p = products.get(pin);
      if (!p) return json({ error: `Product not found: ${pin}` }, 404);

      const stock = Number(p.stock || 0);
      if (stock <= 0) return json({ error: `Sold out: ${pin}` }, 400);
      if (qty > stock) return json({ error: `Not enough stock for ${pin}. Max: ${stock}` }, 400);

      const unit = currency === "EUR" ? p.price_eur : p.price_usd;
      const unit_amount = toCents(unit);
      if (!Number.isFinite(unit_amount) || unit_amount <= 0) {
        return json({ error: `Missing price for ${pin} in ${currency}` }, 400);
      }

      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: p.title ? `${p.title} • ${p.pin}` : p.pin,
            description: p.diameter ? `Ø ${p.diameter} mm` : undefined,
            images: (p.images && p.images.length) ? [p.images[0]] : undefined,
          },
          unit_amount,
        },
        quantity: qty,
      });
    }

    if (!line_items.length) return json({ error: "No valid items" }, 400);

    const origin = new URL(request.url).origin;
    const success_url = `${origin}/?success=1`;
    const cancel_url = `${origin}/?canceled=1`;

    // Create Stripe Checkout Session (REST API)
    const session = await stripeCreateCheckoutSession(env.STRIPE_SECRET_KEY, {
      mode: "payment",
      success_url,
      cancel_url,
      line_items,
      // Later we can add shipping_address_collection, shipping_options, etc.
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
}

async function loadProductsFromAirtable(env){
  const apiUrl = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`);
  apiUrl.searchParams.set("filterByFormula", "{Active}=TRUE()");
  apiUrl.searchParams.set("pageSize", "100");

  const r = await fetch(apiUrl.toString(), {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Airtable error: ${JSON.stringify(data)}`);

  const map = new Map();
  for (const rec of (data.records || [])) {
    const f = rec.fields || {};
    const pin = String(f["PIN Code"] || "").trim();
    if (!pin) continue;

    const images = Array.isArray(f["Images"]) ? f["Images"].map(x => x?.url).filter(Boolean) : [];

    map.set(pin, {
      pin,
      title: f["Title"] ?? "",
      diameter: f["Diameter"] ?? null,
      stock: Number(f["Stock"] ?? 0),
      price_eur: f["Price_EUR"],
      price_usd: f["Price_USD"],
      images,
    });
  }
  return map;
}

function toCents(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

async function stripeCreateCheckoutSession(secretKey, payload){
  const form = new URLSearchParams();
  form.set("mode", payload.mode);
  form.set("success_url", payload.success_url);
  form.set("cancel_url", payload.cancel_url);

  payload.line_items.forEach((li, i) => {
    form.set(`line_items[${i}][quantity]`, String(li.quantity));

    const pd = li.price_data;
    form.set(`line_items[${i}][price_data][currency]`, pd.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(pd.unit_amount));

    const prod = pd.product_data || {};
    form.set(`line_items[${i}][price_data][product_data][name]`, prod.name || "Item");

    if (prod.description) form.set(`line_items[${i}][price_data][product_data][description]`, prod.description);
    if (Array.isArray(prod.images) && prod.images[0]) {
      form.set(`line_items[${i}][price_data][product_data][images][0]`, prod.images[0]);
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

  const data = await r.json();
  if (!r.ok) throw new Error(`Stripe error: ${JSON.stringify(data)}`);
  return data;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}