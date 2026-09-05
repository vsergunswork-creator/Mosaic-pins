import { getDhlShippingCountries } from "../_dhl-shipping.js";

export async function onRequestGet({ env }) {
  try {
    const countries = await getDhlShippingCountries(env);
    return json({ ok: true, countries }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 503);
  }
}

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
