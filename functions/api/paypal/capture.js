// /functions/api/paypal/capture.js
// POST /api/paypal/capture
// body: { orderId: "...", meta: "..." }

export function onRequestOptions(ctx) {
  const { request } = ctx;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = corsHeaders(request);

  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId || "").trim();
    const metaStr = String(body.meta || "").trim();

    if (!orderId) return json({ ok: false, error: "orderId is required" }, 400, headers);

    const PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = env.PAYPAL_CLIENT_SECRET;
    const PAYPAL_ENV = String(env.PAYPAL_ENV || "sandbox").toLowerCase(); // sandbox|live

    const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME;

    if (!PAYPAL_CLIENT_ID) return json({ ok: false, error: "PAYPAL_CLIENT_ID is not set" }, 500, headers);
    if (!PAYPAL_CLIENT_SECRET) return json({ ok: false, error: "PAYPAL_CLIENT_SECRET is not set" }, 500, headers);

    if (!AIRTABLE_TOKEN) return json({ ok: false, error: "AIRTABLE_TOKEN is not set" }, 500, headers);
    if (!AIRTABLE_BASE_ID) return json({ ok: false, error: "AIRTABLE_BASE_ID is not set" }, 500, headers);
    if (!AIRTABLE_TABLE_NAME) return json({ ok: false, error: "AIRTABLE_TABLE_NAME is not set" }, 500, headers);

    const accessToken = await paypalGetAccessToken({
      clientId: PAYPAL_CLIENT_ID,
      clientSecret: PAYPAL_CLIENT_SECRET,
      env: PAYPAL_ENV,
    });

    const baseUrl =
      PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    // 1) CAPTURE
    const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(`PayPal capture failed: ${data?.message || r.statusText}`);
    }

    const status = String(data?.status || "UNKNOWN");

    // 2) If payment completed -> decrement stock in Airtable
    if (status === "COMPLETED" && metaStr) {
      let meta = null;
      try {
        meta = JSON.parse(metaStr);
      } catch (_) {
        meta = null;
      }

      const items = Array.isArray(meta?.items) ? meta.items : [];
      if (items.length) {
        await airtableDecrementStock({
          token: AIRTABLE_TOKEN,
          baseId: AIRTABLE_BASE_ID,
          table: AIRTABLE_TABLE_NAME,
          items,
        });
      }
    }

    return json({ ok: true, status }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

// ---------------- Helpers ----------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function paypalGetAccessToken({ clientId, clientSecret, env }) {
  const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const basic = btoa(`${clientId}:${clientSecret}`);

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.access_token) {
    throw new Error(`PayPal token error: ${data?.error_description || r.statusText}`);
  }
  return data.access_token;
}

// Decrement Airtable Stock safely
async function airtableDecrementStock({ token, baseId, table, items }) {
  // items: [{ recordId, pin, qty }, ...]
  const need = new Map();

  for (const it of items) {
    const recordId = String(it?.recordId || "").trim();
    const qty = Math.floor(Number(it?.qty || 0));
    if (!recordId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    need.set(recordId, (need.get(recordId) || 0) + qty);
  }

  const recordIds = [...need.keys()];
  if (!recordIds.length) return;

  // read current stock per record id
  const current = new Map();

  for (const rid of recordIds) {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${rid}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable read failed: ${r.status} ${JSON.stringify(j)}`);

    const stock = Number(j?.fields?.["Stock"] ?? 0);
    current.set(rid, Number.isFinite(stock) ? stock : 0);
  }

  // build updates
  const updates = [];
  for (const [rid, dec] of need.entries()) {
    const cur = current.get(rid) ?? 0;
    const next = Math.max(0, cur - dec);
    updates.push({ id: rid, fields: { Stock: next } });
  }

  if (!updates.length) return;

  // batch patch
  const url2 = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const r2 = await fetch(url2, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records: updates }),
  });

  const j2 = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error(`Airtable patch failed: ${r2.status} ${JSON.stringify(j2)}`);
}