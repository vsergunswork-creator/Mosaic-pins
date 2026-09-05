import { allowedAdminEmails, json, requireAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  return json({ ok: true, authenticated: true, admin: true, user: auth.user, defaultAdminEmail: [...allowedAdminEmails(env)][0] });
}

export async function onRequestPost() { return json({ ok: false, error: "Method not allowed" }, 405); }
