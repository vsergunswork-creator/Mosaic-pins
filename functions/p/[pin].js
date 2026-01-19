export async function onRequestGet({ params }) {
  const pin = (params?.pin || "").trim();
  const target = pin ? `/product?pin=${encodeURIComponent(pin)}` : `/`;
  return Response.redirect(target, 302);
}