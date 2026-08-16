// ✅ year in footer
    (function(){
      const y = document.getElementById("year");
      if (y) y.textContent = String(new Date().getFullYear());
    })();

    // ✅ if user came from Stripe success/canceled — redirect to main
    (function(){
      const u = new URL(window.location.href);
      const ok = u.searchParams.get("success")==="1";
      const cn = u.searchParams.get("canceled")==="1";
      if(ok || cn){
        window.location.replace("/?" + (ok ? "success=1" : "canceled=1"));
      }
    })();

    // ✅ AUTO PRICES: based on saved mp_currency OR mp_ship_country
    // ✅ DEFAULT MUST BE AMERICA => US + USD (if user never selected anything)
    (function(){
      const MP_CUR_KEY  = "mp_currency";
      const MP_SHIP_KEY = "mp_ship_country";

      // ✅ DEFAULTS (America)
      const DEFAULT_CUR  = "USD";
      const DEFAULT_SHIP = "US";

      const SHIPPING = {
        EUR: { DE: 6.00, EU: 14.50, USCA: 27.00 },
        USD: { DE: 8.00, EU: 16.00, USCA: 29.00 },
      };

      function normalizeShip(v){
        v = String(v || "").toUpperCase();
        if (["DE","EU","US","CA"].includes(v)) return v;
        return DEFAULT_SHIP;
      }

      function normalizeCur(v){
        v = String(v || "").toUpperCase();
        if (v === "EUR" || v === "USD") return v;
        return DEFAULT_CUR;
      }

      // ✅ NEW RULE:
      // 1) If mp_currency exists -> use it
      // 2) else if mp_ship_country exists -> choose based on ship (US/CA => USD, else EUR)
      // 3) else -> default America USD
      function getCurrency(){
        const curSaved = normalizeCur(localStorage.getItem(MP_CUR_KEY));
        const curRaw = String(localStorage.getItem(MP_CUR_KEY) || "").toUpperCase();

        if (curRaw === "EUR" || curRaw === "USD") return curSaved;

        const shipRaw = localStorage.getItem(MP_SHIP_KEY);
        if (shipRaw){
          const ship = normalizeShip(shipRaw);
          if (ship === "US" || ship === "CA") return "USD";
          return "EUR";
        }

        return DEFAULT_CUR;
      }

      // ✅ write defaults into localStorage if empty (keeps all pages in sync)
      function ensureDefaults(){
        const shipRaw = String(localStorage.getItem(MP_SHIP_KEY) || "").toUpperCase();
        if (!shipRaw){
          try{ localStorage.setItem(MP_SHIP_KEY, DEFAULT_SHIP); }catch(_){}
        }

        const curRaw = String(localStorage.getItem(MP_CUR_KEY) || "").toUpperCase();
        if (!curRaw){
          try{ localStorage.setItem(MP_CUR_KEY, DEFAULT_CUR); }catch(_){}
        }
      }

      function fmt(cur, v){
        if (!Number.isFinite(v)) return "—";
        return cur === "EUR" ? `${v.toFixed(2)} €` : `$${v.toFixed(2)}`;
      }

      ensureDefaults();

      const cur = getCurrency();
      const p = SHIPPING[cur] || SHIPPING.USD;

      const pDE = document.getElementById("pDE");
      const pEU = document.getElementById("pEU");
      const pUSCA = document.getElementById("pUSCA");
      const hint = document.getElementById("priceHint");

      if (pDE) pDE.textContent = fmt(cur, p.DE);
      if (pEU) pEU.textContent = fmt(cur, p.EU);
      if (pUSCA) pUSCA.textContent = fmt(cur, p.USCA);
      if (hint) hint.textContent = `Prices shown in ${cur}`;
    })();
