(() => {
  // Older visits may have the language only in localStorage. The SEO pages are
  // rendered on the server from the cookie, so synchronize once and reload.
  try {
    const supported = new Set(["en","de","ru","fr"]);
    const saved = String(localStorage.getItem("mp_language") || "").toLowerCase();
    const serverLang = String(document.documentElement.lang || "en").toLowerCase();
    if (supported.has(saved) && saved !== serverLang && sessionStorage.getItem("mpGuideLangSync") !== "1") {
      document.cookie = `mp_language=${encodeURIComponent(saved)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      sessionStorage.setItem("mpGuideLangSync", "1");
      location.reload();
      return;
    }
    sessionStorage.removeItem("mpGuideLangSync");
  } catch (_) {}
})();
