// functions/api/etsy-test.js
// Read-only Etsy Open API connectivity test. Does not write to Etsy or Airtable.

export async function onRequestGet({ env }) {
  try {
    const key = String(env.ETSY_API_KEY || "").trim();
    const secret = String(env.ETSY_SHARED_SECRET || "").trim();

    if (!key || !secret) {
      return json({ ok: false, error: "Missing ETSY_API_KEY or ETSY_SHARED_SECRET" }, 500);
    }

    const r = await fetch("https://api.etsy.com/v3/application/openapi-ping", {
      method: "GET",
      headers: { "x-api-key": `${key}:${secret}` },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return json({
        ok: false,
        etsyStatus: r.status,
        error: String(data?.error || data?.message || "Etsy API request failed"),
      }, r.status >= 400 && r.status < 600 ? r.status : 502);
    }

    return json({
      ok: true,
      etsyStatus: r.status,
      applicationId: data?.application_id ?? null,
      message: "Etsy API key is active",
    });
  } catch (e) {
    return json({ ok: false, error: "Etsy API test failed" }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
