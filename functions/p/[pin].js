export function onRequestGet({ params, request }) {
  try {
    const pinRaw = params?.pin;
    const pin = (pinRaw == null ? "" : String(pinRaw)).trim();

    // base URL from request (works on Pages)
    const url = new URL(request.url);

    if (!pin) {
      return Response.redirect(`${url.origin}/`, 302);
    }

    // IMPORTANT: у Вас страница товара по /product (без .html)
    const target = `${url.origin}/product?pin=${encodeURIComponent(pin)}`;
    return Response.redirect(target, 302);
  } catch (e) {
    // Если даже тут что-то сломалось — не 1101, а просто на главную
    return Response.redirect("/", 302);
  }
}