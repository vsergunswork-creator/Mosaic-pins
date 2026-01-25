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
      return json(
        {
          ok: false,
          error: "PayPal env variables are missing",
          hint:
            "Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_MODE in Cloudflare Pages (Production + Preview).",
        },
        500,
        headers
      );
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

    // 1) Get access_token
    const basic = base64(`${clientId}:${secret}`);

    const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });

    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok || !tokenData.access_token) {
      return json(
        {
          ok: false,
          error: "PayPal token error",
          status: tokenRes.status,
          details: tokenData,
        },
        500,
        headers
      );
    }

    const accessToken = tokenData.access_token;

    // 2) Capture order
    const capRes = await fetch(`${apiBase}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const capData = await capRes.json().catch(() => ({}));

    if (!capRes.ok) {
      return json(
        {
          ok: false,
          error: "Capture failed",
          status: capRes.status,
          details: capData,
        },
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
  const allowOrigin = origin || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: origin ? "Origin" : undefined,
  };
}

function json(obj, status = 200, headers = {}) {
  // чистим undefined из headers (Cloudflare иногда ругается)
  const clean = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) clean[k] = v;
  }

  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...clean },
  });
}

// Cloudflare-safe base64 (без проблем с btoa)
function base64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}