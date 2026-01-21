// /settings.js
(function () {
  const MP_CUR_KEY = "mp_currency";
  const MP_SHIP_KEY = "mp_ship_country";

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }

  function normalizeCurrency(v) {
    v = String(v || "").toUpperCase();
    return (v === "USD" || v === "EUR") ? v : null;
  }

  function normalizeShip(v) {
    v = String(v || "").toUpperCase();
    return (["US","CA","DE","EU"].includes(v)) ? v : null;
  }

  function mustCurrencyForShip(ship) {
    ship = String(ship || "US").toUpperCase();
    return (ship === "US" || ship === "CA") ? "USD" : "EUR";
  }

  // EU -> any ISO2 inside EU so your backend detectZone() => "EU"
  function shipToISO2(ship) {
    ship = String(ship || "US").toUpperCase();
    if (ship === "US") return "US";
    if (ship === "CA") return "CA";
    if (ship === "EU") return "FR"; // keep your logic
    return "DE";
  }

  function init({ elCurrency, elShipCountry, toast }) {
    // 1) read saved
    const savedShip = normalizeShip(safeGet(MP_SHIP_KEY));
    const savedCur  = normalizeCurrency(safeGet(MP_CUR_KEY));

    // 2) pick defaults (America-first)
    const ship = savedShip || normalizeShip(elShipCountry?.value) || "US";
    const must = mustCurrencyForShip(ship);
    const cur  = savedCur || normalizeCurrency(elCurrency?.value) || must;

    // 3) apply to UI immediately
    if (elShipCountry) elShipCountry.value = ship;
    if (elCurrency) elCurrency.value = cur;

    // 4) enforce rule (US/CA => USD, DE/EU => EUR)
    function enforce() {
      const s = normalizeShip(elShipCountry?.value) || "US";
      const required = mustCurrencyForShip(s);

      const current = normalizeCurrency(elCurrency?.value) || required;
      if (current !== required) {
        if (elCurrency) elCurrency.value = required;
        safeSet(MP_CUR_KEY, required);
        toast && toast("Currency", `Auto set: ${required}`);
      }
      safeSet(MP_SHIP_KEY, s);
      return { ship: s, currency: required };
    }

    // 5) persist current
    safeSet(MP_SHIP_KEY, ship);
    safeSet(MP_CUR_KEY, normalizeCurrency(cur) || must);

    // 6) listeners
    if (elShipCountry) {
      elShipCountry.addEventListener("change", () => {
        enforce();
        toast && toast("Shipping", `Destination: ${elShipCountry.value}`);
      });
    }

    if (elCurrency) {
      elCurrency.addEventListener("change", () => {
        // user tried to change currency — enforce snaps it back if not allowed
        enforce();
      });
    }

    // run once
    enforce();

    function getCurrency() {
      return normalizeCurrency(elCurrency?.value) || mustCurrencyForShip(normalizeShip(elShipCountry?.value) || "US");
    }

    function getShip() {
      return normalizeShip(elShipCountry?.value) || "US";
    }

    function getShippingCountryISO2() {
      return shipToISO2(getShip());
    }

    return { getCurrency, getShip, enforce, getShippingCountryISO2 };
  }

  window.MPSettings = { init };
})();