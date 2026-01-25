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
    const orderID = String(body.orderID || body.orderId || "").trim();

    if (!orderID) {
      return json({ ok: false, error: "Missing orderID" }, 400);
    }

    const accessToken = await getAccessToken({ baseUrl, clientId, secret });

    const r = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return json(
        {
          ok: false,
          error: "PayPal capture failed",
          details: data,
        },
        502
      );
    }

    // можно вернуть статус и что нужно фронту
    return json({
      ok: true,
      id: data.id,
      status: data.status,
      data,
    });
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