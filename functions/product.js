// Legacy product URL compatibility.
// Old /product?pin=XXXX links are permanently consolidated into clean /p/XXXX URLs.
export function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const pin = String(url.searchParams.get("pin") || "").trim();
    if (!pin) return Response.redirect(`${url.origin}/`, 302);
    return Response.redirect(`${url.origin}/p/${encodeURIComponent(pin)}`, 301);
  } catch (_) {
    return Response.redirect("/", 302);
  }
}
