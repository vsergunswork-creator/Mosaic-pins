// functions/api/paypal/config.js
// GET /api/paypal/config
// returns: { ok:true, clientId:"...", mode:"sandbox|live", currency:"USD" }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const mode = String(env.PAYPAL_MODE || "sandbox").toLowerCase();
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId) {
      return json({ ok: false, error: "PAYPAL_CLIENT_ID is not set" }, 500, headers);
    }
    if (!secret) {
      return json({ ok: false, error: "PAYPAL_CLIENT_SECRET is not set" }, 500, headers);
    }

    if (!["sandbox", "live"].includes(mode)) {
      return json({ ok: false, error: "PAYPAL_MODE must be sandbox or live" }, 500, headers);
    }

    // можно фиксировать валюту или сделать умнее (зависит от Вашего UI)
    const currency = "USD";

    return json(
      {
        ok: true,
        clientId,
        mode,
        currency,
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
    "Vary": "Origin",
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}