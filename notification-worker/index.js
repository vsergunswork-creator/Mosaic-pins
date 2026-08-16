// One scheduled worker for both customer email flows.
// Paid emails are attempted immediately by Stripe/PayPal and retried here if necessary.
// Shipping emails are sent when a Tracking Number appears in Airtable.
import { runNotificationSweep } from "../functions/api/_notifications.js";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runNotificationSweep(env, { maxRecords: 25 }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/run") {
      return json({ ok: true, info: "Notification worker is active. Use /run?secret=... for a manual check." });
    }
    const required = String(env.CRON_SECRET || "").trim();
    const got = String(url.searchParams.get("secret") || request.headers.get("x-cron-secret") || "").trim();
    if (!required || got !== required) return json({ ok: false, error: "Unauthorized" }, 401);
    try {
      return json({ ok: true, ...(await runNotificationSweep(env, { maxRecords: 25 })) });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
