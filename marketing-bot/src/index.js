export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "mosaic-marketing-bot"
      });
    }

    return new Response("Mosaic Pins Marketing Bot is online ✅", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
};
