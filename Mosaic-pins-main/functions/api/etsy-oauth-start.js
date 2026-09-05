// functions/api/etsy-oauth-start.js
// Temporary OAuth helper for Etsy buyer-name diagnostics.
// Requests ONLY transactions_r. Does not write to Airtable/R2 or change Etsy sync.

const REDIRECT_URI = "https://mosaicpins.space/api/etsy-oauth-callback";
const SCOPE = "transactions_r";

export async function onRequestGet({ env }) {
  const clientId = String(env.ETSY_API_KEY || "").trim();
  if (!clientId) return text("Missing ETSY_API_KEY", 500);

  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  const challenge = await sha256Base64Url(verifier);

  const u = new URL("https://www.etsy.com/oauth/connect");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");

  const cookie = encodeURIComponent(JSON.stringify({ verifier, state, created: Date.now() }));
  return new Response(null, {
    status: 302,
    headers: {
      Location: u.toString(),
      "Set-Cookie": `etsy_oauth_tmp=${cookie}; Path=/api/etsy-oauth-callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function randomUrlSafe(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64Url(a);
}
async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}
function base64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function text(message, status = 200) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
