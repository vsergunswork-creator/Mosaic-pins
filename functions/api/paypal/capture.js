// functions/api/paypal/capture.js
// POST /api/paypal/capture
// body: { orderID:"..." }
// returns: { ok:true, capture: {...paypal response...} }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const mode = String(env.PAYPAL_MODE || "sandbox").toLowerCase();
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId || !secret) {
      return json({ ok: false, error: "PayPal env variables are missing" }, 500, headers);
    }

    const apiBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const body = await request.json().catch(() => ({}));
    const orderID = String(body.orderID || "").trim();

    if (!orderID) {
      return json({ ok: false, error: "Missing orderID" }, 400, headers);
    }

    // 1) access_token
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
      return json(
        { ok: false, error: "PayPal token error", details: tokenData },
        500,
        headers
      );
    }

    const accessToken = tokenData.access_token;

    // 2) CAPTURE order
    const capRes = await fetch(`${apiBase}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const capData = await capRes.json().catch(() => ({}));

    if (!capRes.ok) {
      return json(
        { ok: false, error: "Capture failed", details: capData },
        500,
        headers
      );
    }

    return json({ ok: true, capture: capData }, 200, headers);
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