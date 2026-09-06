const DEFAULT_ADMIN_EMAILS = ["support@mosaicpins.space", "v.sergun.work@gmail.com"];

export async function requireAdmin(request, env, { write = false } = {}) {
  if (!env?.DB) return { ok: false, response: json({ ok: false, error: "DB binding is not configured" }, 500) };

  if (write) {
    const expected = new URL(request.url).origin;
    const origin = String(request.headers.get("Origin") || "").trim();
    const adminHeader = String(request.headers.get("x-mp-admin") || "").trim();
    if (origin && origin !== expected) {
      return { ok: false, response: json({ ok: false, error: "Invalid request origin" }, 403) };
    }
    if (adminHeader !== "1") {
      return { ok: false, response: json({ ok: false, error: "Missing admin request header" }, 403) };
    }
  }

  const token = getCookie(request.headers.get("Cookie") || "", "mp_session");
  if (!token) return { ok: false, response: json({ ok: false, authenticated: false, admin: false }, 401) };

  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.display_name, u.email_verified_at
       FROM account_sessions AS s
       JOIN account_users AS u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires_at >= ?2
      LIMIT 1`
  ).bind(tokenHash, now).first();

  if (!session) return { ok: false, response: json({ ok: false, authenticated: false, admin: false }, 401) };

  const email = normalizeEmail(session.email);
  const allowed = allowedAdminEmails(env);
  if (!allowed.has(email)) {
    return { ok: false, response: json({ ok: false, authenticated: true, admin: false, error: "This account is not an administrator" }, 403) };
  }

  await env.DB.prepare("UPDATE account_sessions SET last_seen_at = ?1 WHERE id = ?2")
    .bind(now, session.session_id).run().catch(() => {});

  return {
    ok: true,
    user: { email: session.email, displayName: session.display_name || null },
  };
}

export function allowedAdminEmails(env) {
  const raw = String(env?.ADMIN_EMAILS || env?.ADMIN_EMAIL || "");
  const values = raw.split(/[;,\s]+/).map(normalizeEmail).filter(Boolean);
  for (const email of DEFAULT_ADMIN_EMAILS) {
    const normalized = normalizeEmail(email);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  }
  return new Set(values);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function getCookie(cookieHeader, name) {
  const prefix = `${name}=`;
  for (const part of String(cookieHeader || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
