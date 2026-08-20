// One scheduled worker for customer email flows + Etsy review sync.
// Paid/shipped email behavior is unchanged. Etsy sync is isolated: if it fails,
// notification email processing still completes normally.
import { runNotificationSweep } from "../functions/api/_notifications.js";

const ETSY_SYNC_URL = "https://mosaicpins.space/api/etsy-sync";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledJobs(env));
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
      return json({ ok: true, ...(await runScheduledJobs(env)) });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  },
};

async function runScheduledJobs(env) {
  const notifications = await runNotificationSweep(env, { maxRecords: 25 });
  let etsySync = { ok: false, skipped: true };
  try {
    const secret = String(env.CRON_SECRET || "").trim();
    if (secret) {
      const r = await fetch(ETSY_SYNC_URL, {
        method: "POST",
        headers: { "x-cron-secret": secret },
      });
      const data = await r.json().catch(() => ({}));
      etsySync = { httpStatus: r.status, ...data };
    }
  } catch (e) {
    etsySync = { ok: false, error: String(e?.message || e) };
  }
  return { notifications, etsySync };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
