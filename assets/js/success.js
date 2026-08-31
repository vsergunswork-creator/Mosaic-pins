(async function () {
  try {
    const params = new URLSearchParams(location.search);
    const sessionId = String(params.get("session_id") || "").trim();
    if (sessionId && window.MPGoogle?.purchase) {
      const response = await fetch(`/api/analytics/stripe-purchase?session_id=${encodeURIComponent(sessionId)}`, {
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok && data?.purchase) {
        window.MPGoogle.purchase(data.purchase);
        // Give the queued tag command a brief moment before navigation.
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  } catch (_) {}

  // Clear the cart only after the verified purchase event has been prepared.
  // This is order cleanup, not a remove_from_cart action.
  try { window.MPGoogle?.suppressNextCartTracking?.(); } catch (_) {}
  try { localStorage.setItem("mp_cart", "[]"); } catch (_) {}

  setTimeout(() => {
    location.replace("/?success=1");
  }, 500);
})();
