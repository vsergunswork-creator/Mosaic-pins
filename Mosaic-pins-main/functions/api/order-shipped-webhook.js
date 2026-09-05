// Compatibility/manual endpoint for shipping notifications.
// The scheduled notification worker is the normal path; this endpoint is useful for an authenticated manual retry.
import { runShippedSweep } from "./_notifications.js";

export async function onRequestGet(ctx) { return run(ctx); }
export async function onRequestPost(ctx) { return run(ctx); }

async function run({ request, env }) {
  const required = String(env.CRON_SECRET || "").trim();
  if (required) {
    const url = new URL(request.url);
    const got = String(request.headers.get("x-cron-secret") || url.searchParams.get("secret") || "").trim();
    if (got !== required) return json({ ok: false, error: "Unauthorized" }, 401);
  }
  try {
    const shipped = await runShippedSweep(env, { maxRecords: 25 });
    return json({ ok: true, shipped });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
