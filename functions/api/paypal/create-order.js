export async function onRequestPost({ request, env }) {
  try {
    const mode = (env.PAYPAL_MODE || "sandbox").toLowerCase();
    const baseUrl =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const clientId = env.PAYPAL_CLIENT_ID || "";
    const secret = env.PAYPAL_CLIENT_SECRET || "";

    if (!clientId || !secret) {
      return json(
        { ok: false, error: "PayPal env vars missing (CLIENT_ID/SECRET)" },
        500
      );
    }

    const body = await request.json().catch(() => ({}));

    // ожидаем хотя бы сумму и валюту (без этого order не создать)
    // можно передавать из фронта:
    // { currency:"USD", total: 20.00, items:[...], shippingCountry:"DE" }
    const currency = String(body.currency || "").toUpperCase();
    const total = Number(body.total);

    if (!["USD", "EUR"].includes(currency)) {
      return json({ ok: false, error: "Invalid currency" }, 400);
    }
    if (!Number.isFinite(total) || total <= 0) {
      return json({ ok: false, error: "Invalid total" }, 400);
    }

    // PayPal требует строку с 2 знаками
    const value = total.toFixed(2);

    const accessToken = await getAccessToken({ baseUrl, clientId, secret });

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value,
          },
        },
      ],
    };

    const r = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return json(
        {
          ok: false,
          error: "PayPal create order failed",
          details: data,
        },
        502
      );
    }

    return json({ ok: true, id: data.id, data });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

async function getAccessToken({ baseUrl, clientId, secret }) {
  const basic = btoa(`${clientId}:${secret}`);

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok || !data.access_token) {
    throw new Error("Failed to get PayPal access token");
  }

  return data.access_token;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}