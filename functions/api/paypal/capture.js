// POST /api/paypal/capture
// Captures PayPal payment, creates Airtable Orders record and decrements Airtable stock exactly once.

import { findProductRecordsByPins, decrementAirtableStock, invalidateProductCache } from "../_airtable-products.js";
import { sendPaidEmailForRecord } from "../_notifications.js";

export function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = {
    ...corsHeaders(request),
    "Cache-Control": "no-store",
  };

  try {
    const mode = requirePayPalMode(env);

    const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();

    if (!clientId || !secret) {
      return json(
        {
          ok: false,
          error: "PayPal credentials are missing",
        },
        500,
        headers
      );
    }

    if (
      !env.AIRTABLE_TOKEN ||
      !env.AIRTABLE_BASE_ID ||
      !env.AIRTABLE_TABLE_NAME
    ) {
      return json(
        {
          ok: false,
          error: "Airtable env variables are missing",
        },
        500,
        headers
      );
    }

    if (!env.STRIPE_EVENTS_KV) {
      return json(
        {
          ok: false,
          error:
            "STRIPE_EVENTS_KV binding is required for payment idempotency",
        },
        500,
        headers
      );
    }

    const body = await request.json().catch(() => ({}));
    const orderID = String(body.orderID || "").trim();

    if (!orderID) {
      return json(
        {
          ok: false,
          error: "Missing orderID",
        },
        400,
        headers
      );
    }

    const DONE_KEY = `paypal_order_finalized:${orderID}`;

    if (await env.STRIPE_EVENTS_KV.get(DONE_KEY)) {
      return json(
        {
          ok: true,
          status: "COMPLETED",
          orderID,
          alreadyFinalized: true,
        },
        200,
        headers
      );
    }

    const apiBase =
      mode === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const accessToken = await getPayPalAccessToken(
      apiBase,
      clientId,
      secret
    );

    let orderData;

    const capRes = await fetch(
      `${apiBase}/v2/checkout/orders/${encodeURIComponent(
        orderID
      )}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `cap-${orderID}`,
        },
      }
    );

    const capData = await capRes.json().catch(() => ({}));

    if (capRes.ok) {
      // PayPal capture response can omit the original items/SKUs.
      // Fetch the complete order before Airtable/stock finalization.
      const getRes = await fetch(
        `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderID)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      orderData = await getRes.json().catch(() => ({}));

      if (!getRes.ok) {
        return json(
          {
            ok: false,
            error:
              "PayPal payment captured, but unable to read full PayPal order",
            details: orderData,
          },
          500,
          headers
        );
      }
    } else {
      const issue = String(
        capData?.details?.[0]?.issue || ""
      );

      if (
        ![
          "ORDER_ALREADY_CAPTURED",
          "ORDER_CANNOT_BE_CAPTURED",
        ].includes(issue)
      ) {
        return json(
          {
            ok: false,
            error:
              capData?.message ||
              capData?.name ||
              "Capture failed",
            details: capData,
          },
          400,
          headers
        );
      }

      // Browser may retry after a lost response.
      // Read PayPal order and finish local finalization safely.
      const getRes = await fetch(
        `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderID)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      orderData = await getRes.json().catch(() => ({}));

      if (!getRes.ok) {
        return json(
          {
            ok: false,
            error:
              "Unable to verify already captured PayPal order",
            details: orderData,
          },
          400,
          headers
        );
      }
    }

    const pu = orderData?.purchase_units?.[0] || {};
    const capture = pu?.payments?.captures?.[0] || {};

    const status = String(
      orderData?.status || capture?.status || ""
    ).toUpperCase();

    if (
      status !== "COMPLETED" &&
      String(capture?.status || "").toUpperCase() !==
        "COMPLETED"
    ) {
      return json(
        {
          ok: false,
          error: `PayPal payment is not completed (${
            status || "unknown"
          })`,
        },
        409,
        headers
      );
    }

    const rawItems = Array.isArray(pu.items)
      ? pu.items
      : [];

    const itemMap = new Map();

    for (const it of rawItems) {
      const pin = String(it?.sku || "").trim();
      const qty = Math.floor(
        Number(it?.quantity || 0)
      );

      if (
        pin &&
        Number.isFinite(qty) &&
        qty > 0
      ) {
        itemMap.set(
          pin,
          (itemMap.get(pin) || 0) + qty
        );
      }
    }

    if (!itemMap.size) {
      throw new Error(
        "PayPal order has no valid product SKUs"
      );
    }

    const recs = await findProductRecordsByPins(
      env,
      [...itemMap.keys()]
    );

    const byPin = new Map();

    const pinField = String(
      env.AIRTABLE_PIN_FIELD || "PIN Code"
    );

    for (const rec of recs) {
      const pin = String(
        rec?.fields?.[pinField] || ""
      ).trim();

      if (pin) {
        byPin.set(pin, rec);
      }
    }

    for (const pin of itemMap.keys()) {
      if (!byPin.has(pin)) {
        throw new Error(
          `Airtable product not found for PayPal item ${pin}`
        );
      }
    }

    const LOCK_KEY = `paypal_lock:${orderID}`;

    const lock = await acquireLock(
      env.STRIPE_EVENTS_KV,
      LOCK_KEY
    );

    if (!lock) {
      return json(
        {
          ok: false,
          error:
            "Payment finalization busy, retry",
        },
        503,
        headers
      );
    }

    try {
      if (
        await env.STRIPE_EVENTS_KV.get(
          DONE_KEY
        )
      ) {
        return json(
          {
            ok: true,
            status: "COMPLETED",
            orderID,
            alreadyFinalized: true,
          },
          200,
          headers
        );
      }

      const payer = orderData?.payer || {};
      const shipping = pu?.shipping || {};
      const addr = shipping?.address || {};

      const customerName = String(
        shipping?.name?.full_name ||
          [
            payer?.name?.given_name,
            payer?.name?.surname,
          ]
            .filter(Boolean)
            .join(" ") ||
          ""
      ).trim();

      const customerEmail = String(
        payer?.email_address || ""
      ).trim();

      const phone = String(
        payer?.phone?.phone_number
          ?.national_number || ""
      ).trim();

      const line1 = String(
        addr?.address_line_1 || ""
      ).trim();

      const line2 = String(
        addr?.address_line_2 || ""
      ).trim();

      const city = String(
        addr?.admin_area_2 || ""
      ).trim();

      const state = String(
        addr?.admin_area_1 || ""
      ).trim();

      const postal = String(
        addr?.postal_code || ""
      ).trim();

      const country = String(
        addr?.country_code || ""
      ).trim();

      const cityLine = [
        country,
        [postal, city]
          .filter(Boolean)
          .join(" "),
      ]
        .filter(Boolean)
        .join(", ");

      const shippingAddress = [
        cityLine,
        [line1, line2]
          .filter(Boolean)
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n");

      const amountObj =
        capture?.amount || pu?.amount || {};

      const amountTotal = Number(
        amountObj?.value || 0
      );

      const currency = String(
        amountObj?.currency_code || "EUR"
      ).toUpperCase();

      const createdAt = String(
        capture?.create_time ||
          orderData?.create_time ||
          new Date().toISOString()
      );

      const productIds = [
        ...itemMap.keys(),
      ].map((pin) => byPin.get(pin).id);

      const totalQty = [
        ...itemMap.values(),
      ].reduce((a, b) => a + b, 0);

      const ORDERS = String(
        env.AIRTABLE_ORDERS_TABLE_NAME ||
          env.AIRTABLE_ORDERS_TABLE ||
          "Orders"
      );

      const existing =
        await findOrderByOrderId(
          env,
          ORDERS,
          orderID
        );

      const fields = {
        "Order ID": orderID,
        Products: productIds,
        Quantity: totalQty,
        Currency: currency,
        "Order Status": "paid",
        "Refund Status": "not_refunded",
        "Customer Name": customerName,
        "Shipping Address": shippingAddress,
        "Shipping Country": country,
        "Shipping City": city,
        "Shipping Postal Code": postal,
        "Shipping State/Region": state,
        "Customer Email": customerEmail,
        Telefon: phone,
        "Created At": createdAt,
        "Amount Total":
          Number.isFinite(amountTotal)
            ? amountTotal
            : 0,
      };

      const savedOrder = existing?.id
        ? await patchAirtableRecord(
            env,
            ORDERS,
            existing.id,
            fields
          )
        : await createAirtableRecord(
            env,
            ORDERS,
            {
              ...fields,
              "Tracking Number": "",
            }
          );

      for (const [pin, qty] of itemMap) {
        const recordId =
          byPin.get(pin).id;

        const itemDoneKey =
          `paypal_stock_done:${orderID}:${recordId}`;

        if (
          await env.STRIPE_EVENTS_KV.get(
            itemDoneKey
          )
        ) {
          continue;
        }

        const productLockKey =
          `lock:${recordId}`;

        const productLock =
          await acquireLock(
            env.STRIPE_EVENTS_KV,
            productLockKey
          );

        if (!productLock) {
          throw new Error(
            `Stock lock busy for ${pin}; retry finalization`
          );
        }

        try {
          if (
            !(
              await env.STRIPE_EVENTS_KV.get(
                itemDoneKey
              )
            )
          ) {
            await decrementAirtableStock(
              env,
              recordId,
              qty
            );

            await env.STRIPE_EVENTS_KV.put(
              itemDoneKey,
              "1",
              {
                expirationTtl:
                  90 * 24 * 60 * 60,
              }
            );
          }
        } finally {
          await releaseLock(
            env.STRIPE_EVENTS_KV,
            productLockKey,
            productLock
          );
        }
      }

      await invalidateProductCache(env);

      await env.STRIPE_EVENTS_KV.put(
        DONE_KEY,
        "1",
        {
          expirationTtl:
            90 * 24 * 60 * 60,
        }
      );

      const emailJob =
        sendPaidEmailForRecord(
          env,
          savedOrder
        ).catch((e) =>
          console.error(
            "Immediate PayPal paid-email failed; cron will retry",
            e
          )
        );

      if (ctx.waitUntil) {
        ctx.waitUntil(emailJob);
      }

      return json(
        {
          ok: true,
          status: "COMPLETED",
          orderID,
          captureId:
            capture?.id || null,
          amount: amountObj,
          orderSaved: true,
          stockUpdated: true,
          email: "queued",
        },
        200,
        headers
      );
    } finally {
      await releaseLock(
        env.STRIPE_EVENTS_KV,
        LOCK_KEY,
        lock
      );
    }
  } catch (e) {
    return json(
      {
        ok: false,
        error: String(
          e?.message || e
        ),
      },
      500,
      headers
    );
  }
}

function requirePayPalMode(env) {
  const m = String(
    env.PAYPAL_MODE || ""
  )
    .trim()
    .toLowerCase();

  if (
    !["live", "sandbox"].includes(m)
  ) {
    throw new Error(
      "PAYPAL_MODE must be explicitly set to live or sandbox"
    );
  }

  return m;
}

async function getPayPalAccessToken(
  apiBase,
  id,
  secret
) {
  const r = await fetch(
    `${apiBase}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(
          `${id}:${secret}`
        )}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const d = await r
    .json()
    .catch(() => ({}));

  if (!r.ok || !d.access_token) {
    throw new Error(
      d?.error_description ||
        "PayPal token error"
    );
  }

  return d.access_token;
}

async function findOrderByOrderId(
  env,
  table,
  orderID
) {
  const u = new URL(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(
      table
    )}`
  );

  u.searchParams.set(
    "filterByFormula",
    `{Order ID}='${String(
      orderID
    )
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")}'`
  );

  u.searchParams.set(
    "maxRecords",
    "1"
  );

  const r = await fetch(u, {
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    },
  });

  const d = await r
    .json()
    .catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      `Airtable order lookup failed ${r.status}: ${JSON.stringify(
        d
      )}`
    );
  }

  return d?.records?.[0] || null;
}

async function createAirtableRecord(
  env,
  table,
  fields
) {
  const r = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(
      table
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        fields,
      }),
    }
  );

  const d = await r
    .json()
    .catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      `Airtable order create failed ${r.status}: ${JSON.stringify(
        d
      )}`
    );
  }

  return d;
}

async function patchAirtableRecord(
  env,
  table,
  id,
  fields
) {
  const r = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(
      table
    )}/${id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        fields,
      }),
    }
  );

  const d = await r
    .json()
    .catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      `Airtable order update failed ${r.status}: ${JSON.stringify(
        d
      )}`
    );
  }

  return d;
}

async function acquireLock(kv, key) {
  const token =
    `${Date.now()}-${Math.random()}`;

  for (let i = 0; i < 12; i++) {
    if (!(await kv.get(key))) {
      await kv.put(key, token, {
        expirationTtl: 120,
      });

      if (
        (await kv.get(key)) === token
      ) {
        return token;
      }
    }

    await new Promise((r) =>
      setTimeout(
        r,
        150 + Math.random() * 100
      )
    );
  }

  return null;
}

async function releaseLock(
  kv,
  key,
  token
) {
  try {
    if (
      (await kv.get(key)) === token
    ) {
      await kv.delete(key);
    }
  } catch (_) {}
}

function corsHeaders(request) {
  const o =
    request.headers.get("Origin");

  return {
    "Access-Control-Allow-Origin":
      o || "*",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type",
    ...(o ? { Vary: "Origin" } : {}),
  };
}

function json(
  obj,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(obj),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...headers,
      },
    }
  );
}
