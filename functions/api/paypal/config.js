export async function onRequestGet({ env }) {
  const mode = (env.PAYPAL_MODE || "sandbox").toLowerCase();
  const clientId = env.PAYPAL_CLIENT_ID || "";

  if (!clientId) {
    return json(
      { ok: false, error: "Missing PAYPAL_CLIENT_ID" },
      500
    );
  }

  return json({
    ok: true,
    mode,
    clientId,
    // на всякий случай можно отдавать базовый URL
    baseUrl:
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com",
  });
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