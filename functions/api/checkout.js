export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1) Берём данные из запроса
    const body = await request.json().catch(() => ({}));
    const priceId = body.priceId;
    const quantity = Number(body.quantity || 1);

    if (!priceId || typeof priceId !== "string") {
      return json({ error: "Missing priceId" }, 400);
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return json({ error: "Invalid quantity" }, 400);
    }

    // 2) Обязательные env-переменные
    if (!env.STRIPE_SECRET_KEY) {
      return json({ error: "STRIPE_SECRET_KEY is not set" }, 500);
    }

    // Если у Вас уже есть эти переменные — отлично.
    // Если нет — можно поставить временно, например: https://mosaicpins.space/success и /cancel
    const successUrl = env.SITE_SUCCESS_URL || "https://mosaicpins.space/success";
    const cancelUrl = env.SITE_CANCEL_URL || "https://mosaicpins.space/cancel";

    // 3) Готовим запрос к Stripe
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.append("payment_method_types[]", "card");

    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);

    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", String(quantity));

    // (опционально) попросить адрес доставки:
    // params.append("shipping_address_collection[allowed_countries][]", "DE");
    // params.append("shipping_address_collection[allowed_countries][]", "LV");

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await resp.json();

    if (!resp.ok) {
      // Stripe вернёт error.message
      return json({ error: data?.error?.message || "Stripe error", details: data }, 400);
    }

    return json({ url: data.url });
  } catch (e) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Если фронт и API на одном домене — CORS не нужен.
      // Но оставим мягко:
      "Access-Control-Allow-Origin": "*",
    },
  });
}
