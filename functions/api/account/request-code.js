import { sendStoreEmail } from "../_email.js";

const CODE_TTL_SECONDS = 10 * 60;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ ok: false, error: "DB binding is not configured" }, 500);

    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);

    // Deliberately conservative validation. The browser can do friendlier UI later.
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Please enter a valid email address." }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const recent = await env.DB.prepare(
      `SELECT c.created_at
         FROM account_login_codes c
         JOIN account_users u ON u.id = c.user_id
        WHERE u.email = ?1 COLLATE NOCASE
          AND c.created_at > ?2
        ORDER BY c.created_at DESC
        LIMIT 1`
    ).bind(email, now - 60).first();

    if (recent) {
      // Do not reveal account state and do not spam the mailbox.
      return json({ ok: true, message: "If the email is valid, a sign-in code has been sent." });
    }

    let user = await env.DB.prepare(
      "SELECT id, email FROM account_users WHERE email = ?1 COLLATE NOCASE LIMIT 1"
    ).bind(email).first();

    if (!user) {
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO account_users (id, email, display_name, email_verified_at, created_at, updated_at)
         VALUES (?1, ?2, NULL, NULL, ?3, ?3)`
      ).bind(userId, email, now).run();
      user = { id: userId, email };
    }

    // Keep only a small amount of unused login-code state per user.
    await env.DB.prepare(
      "DELETE FROM account_login_codes WHERE user_id = ?1 AND (used_at IS NOT NULL OR expires_at < ?2)"
    ).bind(user.id, now).run();

    const code = randomSixDigitCode();
    const codeHash = await sha256(`${user.id}:${code}`);
    const codeId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO account_login_codes (id, user_id, code_hash, expires_at, used_at, created_at)
       VALUES (?1, ?2, ?3, ?4, NULL, ?5)`
    ).bind(codeId, user.id, codeHash, now + CODE_TTL_SECONDS, now).run();

    const store = String(env.STORE_NAME || "Mosaic Pins");
    const subject = `${store}: your sign-in code`;
    const text =
      `Your ${store} sign-in code is: ${code}\n\n` +
      `The code is valid for 10 minutes.\n\n` +
      `If you did not request this code, you can ignore this email.`;
    const html =
      `<div style="background:#0b0d11;padding:24px;font-family:Arial,sans-serif;color:#e9eef7;">` +
      `<div style="max-width:520px;margin:0 auto;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:#15181f;overflow:hidden;">` +
      `<div style="padding:18px;border-bottom:1px solid rgba(255,255,255,.08);"><b>🟢 ${escapeHtml(store)}</b></div>` +
      `<div style="padding:22px;"><div style="color:#a8b3c7;font-size:14px;">Your sign-in code</div>` +
      `<div style="font-size:32px;font-weight:900;letter-spacing:7px;margin:12px 0 18px;">${code}</div>` +
      `<div style="color:#a8b3c7;font-size:13px;line-height:1.5;">Valid for 10 minutes.<br>If you did not request this code, you can ignore this email.</div></div></div></div>`;

    try {
      // Login mail must never BCC the shop mailbox.
      await sendStoreEmail({ ...env, MAIL_BCC: "" }, { to: email, subject, text, html });
    } catch (mailError) {
      // Do not leave a usable code behind when delivery failed.
      await env.DB.prepare("DELETE FROM account_login_codes WHERE id = ?1").bind(codeId).run().catch(() => {});
      throw mailError;
    }

    return json({ ok: true, message: "If the email is valid, a sign-in code has been sent." });
  } catch (error) {
    console.error("account/request-code:", error);
    return json({ ok: false, error: "Unable to send sign-in code right now." }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function randomSixDigitCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
