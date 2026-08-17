// Shared lightweight settings helper.
// Shipping country is an ISO-2 destination and no longer forces a currency.
(function () {
  const MP_CUR_KEY = "mp_currency";
  const MP_SHIP_KEY = "mp_ship_country";

  function safeGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function safeSet(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }
  function normalizeCurrency(v) {
    v = String(v || "").toUpperCase();
    return (v === "USD" || v === "EUR") ? v : null;
  }
  function normalizeShip(v) {
    v = String(v || "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : null;
  }

  function init({ elCurrency, elShipCountry, toast } = {}) {
    const savedCur = normalizeCurrency(safeGet(MP_CUR_KEY));
    const savedShip = normalizeShip(safeGet(MP_SHIP_KEY));
    const cur = savedCur || normalizeCurrency(elCurrency?.value) || "USD";

    if (elCurrency) elCurrency.value = cur;
    if (elShipCountry && savedShip) elShipCountry.value = savedShip;
    safeSet(MP_CUR_KEY, cur);

    if (elCurrency) {
      elCurrency.addEventListener("change", () => {
        const next = normalizeCurrency(elCurrency.value) || "USD";
        elCurrency.value = next;
        safeSet(MP_CUR_KEY, next);
      });
    }
    if (elShipCountry) {
      elShipCountry.addEventListener("change", () => {
        const next = normalizeShip(elShipCountry.value);
        if (next) safeSet(MP_SHIP_KEY, next);
        toast && toast("Shipping", next ? `Destination: ${next}` : "Choose a shipping country");
      });
    }

    return {
      getCurrency: () => normalizeCurrency(elCurrency?.value) || normalizeCurrency(safeGet(MP_CUR_KEY)) || "USD",
      getShip: () => normalizeShip(elShipCountry?.value) || normalizeShip(safeGet(MP_SHIP_KEY)) || "",
      enforce: () => null,
      getShippingCountryISO2: () => normalizeShip(elShipCountry?.value) || "",
    };
  }

  window.MPSettings = { init };
})();
