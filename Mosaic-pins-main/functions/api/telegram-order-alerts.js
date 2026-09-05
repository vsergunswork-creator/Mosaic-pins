import { runTelegramPaidSweep } from "./_telegram.js";

// Authenticated fallback endpoint used by mosaic-notifications cron.
// Immediate Stripe/PayPal alerts are sent directly from the payment flows.
export async function onRequestGet(ctx) { return run(ctx); }
export async function onRequestPost(ctx) { return run(ctx); }

async function run({ request, env }) {
  const required = String(env.TELEGRAM_ALERTS_SECRET || env.ETSY_SYNC_SECRET || env.CRON_SECRET || "").trim();
  if (!required) return json({ ok: false, error: "TELEGRAM_ALERTS_SECRET/ETSY_SYNC_SECRET/CRON_SECRET is not set" }, 500);

  const url = new URL(request.url);
  const got = String(
    request.headers.get("x-telegram-alerts-secret") ||
    request.headers.get("x-cron-secret") ||
    url.searchParams.get("secret") ||
    ""
  ).trim();
  if (got !== required) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const telegram = await runTelegramPaidSweep(env, { maxRecords: 100 });
    return json({ ok: true, telegram });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
