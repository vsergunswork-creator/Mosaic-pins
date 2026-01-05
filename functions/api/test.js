export async function onRequest() {
  return new Response(
    JSON.stringify({ status: "ok", message: "Functions work" }),
    {
      headers: { "Content-Type": "application/json" }
    }
  );
}
