(() => {
  const SHIP_KEY = "mp_ship_country";
  const elCountry = document.getElementById("shipCountry");
  const elSubtotal = document.getElementById("cartSubtotal");
  const elShipping = document.getElementById("cartShipping");
  const elTotal = document.getElementById("cartTotal");
  const elService = document.getElementById("shippingService");
  const elCheckout = document.getElementById("cartCheckout");
  const elPpWrap = document.getElementById("ppWrap");

  if (!elCountry) return;

  let lastSubtotal = 0;
  let lastCurrency = "EUR";
  let lastQuote = null;
  let seq = 0;

  function money(n, cur) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return cur === "USD" ? `$${v.toFixed(2)}` : `${v.toFixed(2)} €`;
  }

  function selectedCountry() {
    const v = String(elCountry.value || "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : "";
  }

  function setPaymentReady(ready) {
    const hasItems = lastSubtotal > 0;
    if (elCheckout) elCheckout.disabled = !(hasItems && ready);
    if (elPpWrap) {
      elPpWrap.style.pointerEvents = (hasItems && ready) ? "auto" : "none";
      elPpWrap.style.opacity = (hasItems && ready) ? "1" : ".45";
    }
  }

  function resetQuoteUi() {
    lastQuote = null;
    if (elShipping) elShipping.textContent = "—";
    if (elService) elService.textContent = "Choose a destination to calculate DHL tracked shipping.";
    if (elTotal) elTotal.textContent = lastSubtotal > 0 ? "—" : "—";
    setPaymentReady(false);
  }

  async function refresh(subtotal = lastSubtotal, currency = lastCurrency) {
    lastSubtotal = Number(subtotal) || 0;
    lastCurrency = String(currency || "EUR").toUpperCase() === "USD" ? "USD" : "EUR";

    if (elSubtotal) elSubtotal.textContent = lastSubtotal > 0 ? money(lastSubtotal, lastCurrency) : "—";

    if (!(lastSubtotal > 0)) {
      lastQuote = null;
      if (elShipping) elShipping.textContent = "—";
      if (elTotal) elTotal.textContent = "—";
      if (elService) elService.textContent = "Add an item to calculate shipping.";
      setPaymentReady(false);
      return null;
    }

    const country = selectedCountry();
    if (!country) {
      resetQuoteUi();
      return null;
    }

    const mySeq = ++seq;
    lastQuote = null;
    if (elShipping) elShipping.textContent = "Calculating…";
    if (elTotal) elTotal.textContent = "—";
    if (elService) elService.textContent = "Checking current DHL tracked rate…";
    setPaymentReady(false);

    try {
      const r = await fetch(`/api/shipping/quote?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(lastCurrency)}`, {
        cache: "no-store",
      });
      const q = await r.json().catch(() => ({}));
      if (mySeq !== seq) return null;
      if (!r.ok || !q?.ok) throw new Error(q?.error || "DHL shipping rate unavailable");

      lastQuote = q;
      if (elShipping) elShipping.textContent = money(q.price, lastCurrency);
      if (elTotal) elTotal.textContent = money(lastSubtotal + Number(q.price || 0), lastCurrency);
      if (elService) {
        elService.textContent = `${q.service || "DHL Paket"} · tracked · up to ${Number(q.maxWeightKg || 2)} kg`;
      }
      setPaymentReady(true);
      window.dispatchEvent(new CustomEvent("mp-shipping-quote", { detail: q }));
      return q;
    } catch (e) {
      if (mySeq !== seq) return null;
      lastQuote = null;
      if (elShipping) elShipping.textContent = "Unavailable";
      if (elTotal) elTotal.textContent = "—";
      if (elService) elService.textContent = String(e?.message || e);
      setPaymentReady(false);
      return null;
    }
  }

  async function loadCountries() {
    const saved = (() => {
      try {
        const v = String(localStorage.getItem(SHIP_KEY) || "").toUpperCase();
        return /^[A-Z]{2}$/.test(v) ? v : "";
      } catch (_) { return ""; }
    })();

    const current = selectedCountry() || saved;
    try {
      const r = await fetch("/api/shipping/countries", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok || !Array.isArray(d.countries)) throw new Error(d?.error || "Countries unavailable");

      const dn = typeof Intl !== "undefined" && Intl.DisplayNames
        ? new Intl.DisplayNames(["en"], { type: "region" })
        : null;

      const rows = d.countries
        .filter(x => /^[A-Z]{2}$/.test(String(x || "")))
        .map(code => ({ code, name: dn?.of(code) || code }))
        .sort((a,b) => a.name.localeCompare(b.name));

      elCountry.innerHTML = `<option value="">Select shipping country…</option>` +
        rows.map(x => `<option value="${x.code}">${escapeHtml(x.name)} (${x.code})</option>`).join("");

      if (current && rows.some(x => x.code === current)) elCountry.value = current;
      else elCountry.value = "";
    } catch (e) {
      // Keep checkout safe: no country list means no payment.
      elCountry.innerHTML = `<option value="">DHL countries unavailable</option>`;
      if (elService) elService.textContent = String(e?.message || e);
      setPaymentReady(false);
    }

    await refresh();
  }

  elCountry.addEventListener("change", () => {
    const cc = selectedCountry();
    try {
      if (cc) localStorage.setItem(SHIP_KEY, cc);
      else localStorage.removeItem(SHIP_KEY);
      localStorage.setItem("mp_user_set_ship", "1");
    } catch (_) {}
    refresh();
  });

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, m => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[m]));
  }

  window.MPShipping = {
    refresh,
    getCountry: selectedCountry,
    getQuote: () => lastQuote,
    isReady: () => !!lastQuote,
  };

  loadCountries();
})();
