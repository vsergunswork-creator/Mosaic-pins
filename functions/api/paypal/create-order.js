// POST /api/paypal/create-order
// Airtable source-of-truth. Fresh price/stock validation on every order creation.

import { findProductRecordsByPins, normalizeAirtableProduct } from "../_airtable-products.js";
import { getDhlTracked2kgQuote } from "../_dhl-shipping.js";

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost({ request, env }) {
  const headers = { ...corsHeaders(request), "Cache-Control": "no-store" };
  try {
    const mode = requirePayPalMode(env);
    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
    if (!clientId || !secret) return json({ ok: false, error: "PayPal credentials are missing" }, 500, headers);

    const body = await request.json().catch(() => ({}));
    const currency = normCurrency(body.currency);
    const shippingCountry = String(body.shippingCountry || "").toUpperCase().trim();
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!shippingCountry || shippingCountry.length !== 2) return json({ ok: false, error: "shippingCountry is required" }, 400, headers);

    const cart = new Map();
    for (const it of rawItems) {
      const pin = String(it?.pin || "").trim();
      let qty = Math.floor(Number(it?.qty || 0));
      if (!pin || !Number.isFinite(qty) || qty <= 0) continue;
      qty = Math.min(99, qty);
      cart.set(pin, (cart.get(pin) || 0) + qty);
    }
    if (!cart.size) return json({ ok: false, error: "Cart is empty" }, 400, headers);
    if (cart.size > 50) return json({ ok: false, error: "Too many different items" }, 413, headers);

    const pins = [...cart.keys()];
    const recs = await findProductRecordsByPins(env, pins);
    const byPin = new Map();
    for (const rec of recs) {
      const p = await normalizeAirtableProduct(env, rec);
      if (p) byPin.set(p.pin, p);
    }

    let itemTotalCents = 0;
    const ppItems = [];
    for (const pin of pins) {
      const qty = cart.get(pin);
      const p = byPin.get(pin);
      if (!p) return json({ ok: false, error: `Product not found: ${pin}` }, 404, headers);
      if (!p.active) return json({ ok: false, error: `Product is not active: ${pin}` }, 409, headers);
      if (qty > Number(p.stock || 0)) return json({ ok: false, error: `Not enough stock for ${pin}. Available: ${p.stock}` }, 409, headers);
      const unit = Number(p.price?.[currency]);
      if (!Number.isFinite(unit) || unit <= 0) return json({ ok: false, error: `Price missing for ${pin} (${currency})` }, 500, headers);
      const unitCents = Math.round(unit * 100);
      itemTotalCents += unitCents * qty;
      ppItems.push({
        name: String(p.title || pin).slice(0, 127),
        quantity: String(qty),
        unit_amount: { currency_code: currency, value: cents(unitCents) },
        sku: pin,
        category: "PHYSICAL_GOODS",
      });
    }

    const shippingQuote = await getDhlTracked2kgQuote(env, shippingCountry, currency);
    const shippingCents = Math.round(Number(shippingQuote.price) * 100);
    if (!Number.isFinite(shippingCents) || shippingCents <= 0) {
      return json({ ok: false, error: "DHL shipping quote is unavailable." }, 503, headers);
    }
    const totalCents = itemTotalCents + shippingCents;

    const apiBase = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const accessToken = await getPayPalAccessToken(apiBase, clientId, secret);

    const payload = {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "MOSAIC_PINS",
        description: "Mosaic Pins order",
        custom_id: shippingCountry,
        amount: {
          currency_code: currency,
          value: cents(totalCents),
          breakdown: {
            item_total: { currency_code: currency, value: cents(itemTotalCents) },
            shipping: { currency_code: currency, value: cents(shippingCents) },
          },
        },
        items: ppItems,
      }],
      application_context: {
        brand_name: "Mosaic Pins",
        shipping_preference: "GET_FROM_FILE",
        user_action: "PAY_NOW",
      },
    };

    const orderRes = await fetch(`${apiBase}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "PayPal-Request-Id": `create-${hashText(`${currency}|${shippingCountry}|${JSON.stringify([...cart])}|${Date.now() >> 14}`)}` },
      body: JSON.stringify(payload),
    });
    const orderData = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !orderData.id) return json({ ok: false, error: "Create PayPal order failed", details: orderData }, 500, headers);

    return json({ ok: true, id: orderData.id, total: cents(totalCents), currency, mode }, 200, headers);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500, headers);
  }
}

function requirePayPalMode(env) { const m = String(env.PAYPAL_MODE || "").toLowerCase().trim(); if (!['live','sandbox'].includes(m)) throw new Error('PAYPAL_MODE must be explicitly set to live or sandbox'); return m; }
function normCurrency(v) { const c = String(v || "USD").toUpperCase(); return c === "EUR" ? "EUR" : "USD"; }
function cents(n) { return (Number(n) / 100).toFixed(2); }
function hashText(s) { let h=2166136261; for (let i=0;i<s.length;i++) { h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(16); }
function corsHeaders(request) { const origin=request.headers.get('Origin'); return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', ...(origin?{Vary:'Origin'}:{}) }; }
function json(obj,status=200,headers={}) { return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}}); }
async function getPayPalAccessToken(apiBase,clientId,secret) { const r=await fetch(`${apiBase}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${btoa(`${clientId}:${secret}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'}); const d=await r.json().catch(()=>({})); if(!r.ok||!d.access_token) throw new Error(d?.error_description||'PayPal token error'); return d.access_token; }
