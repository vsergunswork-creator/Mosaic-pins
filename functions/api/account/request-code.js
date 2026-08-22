const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB binding is not configured" }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const code = String(body?.code || "").trim();

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Invalid email or code." }, 400);
    }

    if (!/^\d{6}$/.test(code)) {
      return json({ ok: false, error: "Invalid email or code." }, 400);
    }

    const now = Math.floor(Date.now() / 1000);

    const user = await env.DB.prepare(
      `SELECT id, email, display_name, email_verified_at
         FROM account_users
        WHERE email = ?1 COLLATE NOCASE
        LIMIT 1`
    ).bind(email).first();

    if (!user) {
      return json({ ok: false, error: "Invalid email or code." }, 401);
    }

    const codeHash = await sha256(`${user.id}:${code}`);

    const loginCode = await env.DB.prepare(
      `SELECT id
         FROM account_login_codes
        WHERE user_id = ?1
          AND code_hash = ?2
          AND used_at IS NULL
          AND expires_at >= ?3
        ORDER BY created_at DESC
        LIMIT 1`
    ).bind(user.id, codeHash, now).first();

    if (!loginCode) {
      return json({ ok: false, error: "Invalid or expired code." }, 401);
    }

    const sessionId = crypto.randomUUID();
    const sessionToken = randomToken(32);
    const sessionHash = await sha256(sessionToken);
    const sessionExpiresAt = now + SESSION_TTL_SECONDS;

    // Mark the one-time code as used, verify the email, and create the session.
    // D1 batch keeps these writes together as one logical step.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE account_login_codes
            SET used_at = ?1
          WHERE id = ?2
            AND used_at IS NULL`
      ).bind(now, loginCode.id),

      env.DB.prepare(
        `UPDATE account_users
            SET email_verified_at = COALESCE(email_verified_at, ?1),
                updated_at = ?1
          WHERE id = ?2`
      ).bind(now, user.id),

      env.DB.prepare(
        `INSERT INTO account_sessions
         (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
      ).bind(
        sessionId,
        user.id,
        sessionHash,
        sessionExpiresAt,
        now
      )
    ]);

    // Remove expired sessions after successful login.
    await env.DB.prepare(
      `DELETE FROM account_sessions
        WHERE expires_at < ?1`
    ).bind(now).run().catch(() => {});

    const response = json({
      ok: true,
      authenticated: true,
      user: {
        email: user.email,
        displayName: user.display_name || null
      }
    });

    response.headers.append(
      "Set-Cookie",
      buildSessionCookie(sessionToken, SESSION_TTL_SECONDS)
    );

    return response;

  } catch (error) {
    console.error("account/verify-code:", error);

    return json({
      ok: false,
      error: "Unable to verify sign-in code right now."
    }, 500);
  }
}

export async function onRequestGet() {
  return json({
    ok: false,
    error: "Method not allowed"
  }, 405);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function randomToken(bytesLength) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSessionCookie(token, maxAge) {
  return [
    `mp_session=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
