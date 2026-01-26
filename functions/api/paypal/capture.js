// functions/api/paypal/capture.js
// POST /api/paypal/capture
// body: { orderID:"..." }
// returns: { ok:true, status:"COMPLETED", orderID:"...", captureId:"...", amount:{value,currency_code}, raw?:... }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const mode = normMode(env.PAYPAL_MODE);
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId || !secret) {
      return json({ ok: false, error: "PayPal env variables are missing" }, 500, headers);
    }

    const apiBase =
      mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    const body = await request.json().catch(() => ({}));
    const orderID = String(body.orderID || "").trim();

    if (!orderID) {
      return json({ ok: false, error: "Missing orderID" }, 400, headers);
    }

    const accessToken = await getPayPalAccessToken(apiBase, clientId, secret);

    // ✅ idempotency key (чтобы повторный POST не делал “вторую попытку”)
    // можно стабильно: orderID + "-capture"
    const requestId = `cap-${orderID}`;

    const capRes = await fetch(
      `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
        },
      }
    );

    const capData = await capRes.json().catch(() => ({}));

    // ❗️PayPal иногда возвращает 422/400 если уже captured/invalid state.
    // Это не “серверная 500”, это бизнес-ошибка → отдаём как есть.
    if (!capRes.ok) {
      const issue = capData?.details?.[0]?.issue || "";
      const msg =
        capData?.message ||
        capData?.name ||
        "Capture failed";

      // Если заказ уже в состоянии COMPLETED / CAPTURED — можно считать успехом
      // Иногда PayPal в этом случае советует сделать GET order и проверить статус,
      // но на практике часто достаточно вернуть 409 “already captured”.
      if (
        issue === "ORDER_ALREADY_CAPTURED" ||
        issue === "ORDER_CANNOT_BE_CAPTURED" // бывает при уже завершенном
      ) {
        return json(
          { ok: false, error: "Already captured or not capturable", details: capData },
          409,
          headers
        );
      }

      return json({ ok: false, error: msg, details: capData }, 400, headers);
    }

    // ✅ Проверяем статус
    const status = String(capData?.status || "").toUpperCase();

    // Достаём capture info (если есть)
    const pu0 = capData?.purchase_units?.[0];
    const cap0 = pu0?.payments?.captures?.[0];

    const captureId = cap0?.id || null;
    const amount = cap0?.amount || pu0?.amount || null;
    const captureStatus = String(cap0?.status || "").toUpperCase();

    // В реальности успех — когда COMPLETED
    const isCompleted = status === "COMPLETED" || captureStatus === "COMPLETED";

    if (!isCompleted) {
      // например, PENDING — лучше явно вернуть ошибку, чтобы Вы увидели
      return json(
        {
          ok: false,
          error: `Capture not completed (status=${status || "?"}, capture=${captureStatus || "?"})`,
          details: capData,
        },
        400,
        headers
      );
    }

    return json(
      {
        ok: true,
        status: status || "COMPLETED",
        orderID,
        captureId,
        amount, // { value, currency_code }
      },
      200,
      headers
    );
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

// -------- helpers --------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function normMode(v) {
  const m = String(v || "sandbox").toLowerCase();
  return m === "live" ? "live" : "sandbox";
}

async function getPayPalAccessToken(apiBase, clientId, secret) {
  const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData?.error_description || "PayPal token error");
  }
  return tokenData.access_token;
}