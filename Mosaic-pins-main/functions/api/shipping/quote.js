import { getDhlTracked2kgQuote } from "../_dhl-shipping.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const country = String(url.searchParams.get("country") || "").trim().toUpperCase();
  const currency = String(url.searchParams.get("currency") || "EUR").trim().toUpperCase();

  try {
    const quote = await getDhlTracked2kgQuote(env, country, currency);
    return json({ ok: true, ...quote }, 200);
  } catch (e) {
    const status = e?.code === "DHL_NO_TRACKED_2KG" ? 404 : 503;
    return json({ ok: false, error: String(e?.message || e) }, status);
  }
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
