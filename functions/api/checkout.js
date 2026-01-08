export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json().catch(() => ({}));
    const pin = (body.pin || "").trim();
    const quantity = Number(body.quantity || 1);
    const currency = String(body.currency || "EUR").toUpperCase();

    if (!pin) return json({ error: "Missing pin" }, 400);
    if (!["EUR","USD"].includes(currency)) return json({ error: "Unsupported currency" }, 400);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return json({ error: "Invalid quantity" }, 400);
    }

    // обязательные секреты/переменные
    if (!env.STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);
    if (!env.AIRTABLE_TOKEN) return json({ error: "AIRTABLE_TOKEN is not set" }, 500);
    if (!env.AIRTABLE_BASE_ID) return json({ error: "AIRTABLE_BASE_ID is not set" }, 500);
    if (!env.AIRTABLE_TABLE_NAME) return json({ error: "AIRTABLE_TABLE_NAME is not set" }, 500);

    const pinField = env.AIRTABLE_PIN_FIELD || "PIN Code";
    const successUrl = env.SITE_SUCCESS_URL || "https://mosaicpins.space/success.html";
    const cancelUrl = env.SITE_CANCEL_URL || "https://mosaicpins.space/cancel.html";

    // ✅ Названия полей Price ID (лучше задать явно в env)
    // Например:
    // STRIPE_PRICE_FIELD_EUR="Stripe Price ID EUR"
    // STRIPE_PRICE_FIELD_USD="Stripe Price ID USD"
    const PRICE_FIELD_EUR = env.STRIPE_PRICE_FIELD_EUR || "Stripe Price ID EUR";
    const PRICE_FIELD_USD = env.STRIPE_PRICE_FIELD_USD || "Stripe Price ID USD";

    // 1) Ищем запись в Airtable по PIN
    const formula = `{${pinField}}="${escapeForFormula(pin)}"`;
    const airtableUrl =
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}` +
      `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;

    const aResp = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    const aData = await aResp.json();

    if (!aResp.ok) {
      return json({ error: "Airtable error", details: aData }, 400);
    }

    const record = aData?.records?.[0];
    if (!record) return json({ error: "PIN not found" }, 404);

    const fields = record.fields || {};
    const active = fields["Active"];
    if (active === false) return json({ error: "Product is inactive" }, 403);

    // 2) Берём Price ID по валюте (с fallback на популярные варианты названий)
    const priceId = pickPriceId(fields, currency, {
      eur: PRICE_FIELD_EUR,
      usd: PRICE_FIELD_USD,
    });

    if (!priceId) {
      return json({
        error: `Missing Stripe Price ID for ${currency} in Airtable record`,
        hint: `Set env STRIPE_PRICE_FIELD_EUR / STRIPE_PRICE_FIELD_USD or rename Airtable fields`,
      }, 400);
    }

    // 3) Создаём Stripe Checkout Session
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);

    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", String(quantity));

    const sResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const sData = await sResp.json();

    if (!sResp.ok) {
      return json({ error: sData?.error?.message || "Stripe error", details: sData }, 400);
    }

    return json({ url: sData.url, pin, currency, recordId: record.id });
  } catch (e) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}

function pickPriceId(fields, currency, cfg){
  // 1) Prefer env-configured exact field names:
  const direct = (currency === "EUR") ? fields[cfg.eur] : fields[cfg.usd];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  // 2) Fallback common naming patterns:
  const candidates = currency === "EUR"
    ? ["Stripe Price ID EUR","Stripe Price ID (EUR)","Stripe Price EUR","Stripe Price ID - EUR","Stripe Price ID_EUR","Stripe Price ID"]
    : ["Stripe Price ID USD","Stripe Price ID (USD)","Stripe Price USD","Stripe Price ID - USD","Stripe Price ID_USD","Stripe Price ID"];

  for (const k of candidates){
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function escapeForFormula(value) {
  return String(value).replace(/"/g, '\\"');
}