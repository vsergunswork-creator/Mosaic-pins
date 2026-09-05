// functions/api/etsy-oauth-callback.js
// Temporary OAuth callback for Etsy buyer-name diagnostics.
// Exchanges the one-time authorization code for tokens.
// Does not write tokens anywhere; shows them once so the owner can add them to Cloudflare secrets.

const REDIRECT_URI = "https://mosaicpins.space/api/etsy-oauth-callback";

export async function onRequestGet({ env, request }) {
  try {
    const clientId = String(env.ETSY_API_KEY || "").trim();
    if (!clientId) return page("OAuth error", "Missing ETSY_API_KEY.", 500);

    const url = new URL(request.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return page("Etsy authorization cancelled", `${oauthError}: ${url.searchParams.get("error_description") || ""}`, 400);
    }

    const code = String(url.searchParams.get("code") || "");
    const returnedState = String(url.searchParams.get("state") || "");
    if (!code || !returnedState) return page("OAuth error", "Missing code or state.", 400);

    const cookies = parseCookies(request.headers.get("Cookie") || "");
    let saved;
    try { saved = JSON.parse(decodeURIComponent(cookies.etsy_oauth_tmp || "")); }
    catch { return page("OAuth error", "Temporary OAuth cookie is missing or invalid. Start again.", 400); }

    if (!saved?.verifier || !saved?.state || saved.state !== returnedState) {
      return page("OAuth error", "State check failed. Start again.", 400);
    }
    if (Date.now() - Number(saved.created || 0) > 10 * 60 * 1000) {
      return page("OAuth error", "OAuth request expired. Start again.", 400);
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: saved.verifier,
    });

    const r = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return page("Token exchange failed", `${r.status}: ${data.error_description || data.error || "Unknown Etsy error"}`, r.status);
    }

    const access = String(data.access_token || "");
    const refresh = String(data.refresh_token || "");
    const scope = String(data.scope || "");

    return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Etsy OAuth success</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 18px;line-height:1.5}code,textarea{font-family:ui-monospace,monospace}textarea{width:100%;min-height:105px;box-sizing:border-box}h1{font-size:24px}.ok{color:#087830}.warn{background:#fff3cd;padding:12px;border-radius:10px}</style></head>
<body>
<h1 class="ok">Etsy OAuth successful</h1>
<p>Granted scope: <strong>${esc(scope)}</strong></p>
<p>Access token expires in about ${Number(data.expires_in || 3600)} seconds.</p>
<div class="warn"><strong>Keep these tokens private.</strong> Do not send screenshots containing them.</div>
<h2>ETSY_ACCESS_TOKEN</h2><textarea readonly>${esc(access)}</textarea>
<h2>ETSY_REFRESH_TOKEN</h2><textarea readonly>${esc(refresh)}</textarea>
<p>For the current buyer-name test, add <strong>ETSY_ACCESS_TOKEN</strong> as a secret in the <strong>mosaic-pinsspace</strong> Pages project, redeploy, then open <code>/api/etsy-buyer-debug</code>.</p>
</body></html>`, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": "etsy_oauth_tmp=; Path=/api/etsy-oauth-callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      },
    });
  } catch (e) {
    return page("OAuth error", String(e?.message || e || "Unknown error"), 500);
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function page(title, message, status) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:system-ui;padding:24px"><h1>${esc(title)}</h1><p>${esc(message)}</p></body>`, {
    status,
    headers: { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store", "Referrer-Policy":"no-referrer" }
  });
}
