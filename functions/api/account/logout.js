export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB binding is not configured" }, 500);
    }

    const token = getCookie(request.headers.get("Cookie") || "", "mp_session");

    if (token) {
      const tokenHash = await sha256(token);

      await env.DB.prepare(
        `DELETE FROM account_sessions
          WHERE token_hash = ?1`
      ).bind(tokenHash).run();
    }

    const response = json({
      ok: true,
      authenticated: false
    });

    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;

  } catch (error) {
    console.error("account/logout:", error);

    return json({
      ok: false,
      error: "Unable to sign out right now."
    }, 500);
  }
}

export async function onRequestGet() {
  return json({
    ok: false,
    error: "Method not allowed"
  }, 405);
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
