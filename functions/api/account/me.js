export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB binding is not configured" }, 500);
    }

    const token = getCookie(request.headers.get("Cookie") || "", "mp_session");

    if (!token) {
      return json({ ok: true, authenticated: false });
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenHash = await sha256(token);

    const session = await env.DB.prepare(
      `SELECT
         s.id AS session_id,
         s.expires_at AS session_expires_at,
         u.id AS user_id,
         u.email AS email,
         u.display_name AS display_name,
         u.email_verified_at AS email_verified_at
       FROM account_sessions AS s
       JOIN account_users AS u ON u.id = s.user_id
       WHERE s.token_hash = ?1
         AND s.expires_at >= ?2
       LIMIT 1`
    ).bind(tokenHash, now).first();

    if (!session) {
      const response = json({ ok: true, authenticated: false });
      response.headers.append("Set-Cookie", clearSessionCookie());
      return response;
    }

    // Best-effort activity timestamp; authentication should not fail if this write does.
    await env.DB.prepare(
      `UPDATE account_sessions
          SET last_seen_at = ?1
        WHERE id = ?2`
    ).bind(now, session.session_id).run().catch(() => {});

    return json({
      ok: true,
      authenticated: true,
      user: {
        email: session.email,
        displayName: session.display_name || null,
        emailVerified: Boolean(session.email_verified_at)
      }
    });

  } catch (error) {
    console.error("account/me:", error);
    return json({
      ok: false,
      error: "Unable to read account session right now."
    }, 500);
  }
}

export async function onRequestPost() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}

function getCookie(cookieHeader, name) {
  const prefix = `${name}=`;

  for (const part of cookieHeader.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      return item.slice(prefix.length);
    }
  }

  return "";
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clearSessionCookie() {
  return [
    "mp_session=",
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
