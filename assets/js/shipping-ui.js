(() => {
  const SHIP_KEY = "mp_ship_country";
  const USER_SET_SHIP_KEY = "mp_user_set_ship";
  const GEO_CACHE_KEY = "mp_geo_cache";

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

    if (!Number.isFinite(v)) {
      return "—";
    }

    return cur === "USD"
      ? `$${v.toFixed(2)}`
      : `${v.toFixed(2)} €`;
  }

  function selectedCountry() {
    const v = String(elCountry.value || "")
      .trim()
      .toUpperCase();

    return /^[A-Z]{2}$/.test(v)
      ? v
      : "";
  }

  function userSelectedCountry() {
    try {
      return localStorage.getItem(USER_SET_SHIP_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function geoDetectedCountry() {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);

      if (!raw) {
        return "";
      }

      const obj = JSON.parse(raw);

      const ship = String(obj?.ship || "")
        .trim()
        .toUpperCase();

      return /^[A-Z]{2}$/.test(ship)
        ? ship
        : "";
    } catch (_) {
      return "";
    }
  }

  function isAutoDetectedCountry() {
    const current = selectedCountry();

    if (!current) {
      return false;
    }

    if (userSelectedCountry()) {
      return false;
    }

    const geo = geoDetectedCountry();

    return !!geo && geo === current;
  }

  function shippingServiceText(q) {
    const service =
      `${q?.service || "DHL Paket"} · tracked · up to ${Number(q?.maxWeightKg || 2)} kg`;

    if (isAutoDetectedCountry()) {
      return `${service} · Detected automatically — change if needed.`;
    }

    return service;
  }

  function subtotalFromCartDom() {
    const cartBody =
      document.getElementById("cartBody");

    if (
      !cartBody ||
      !cartBody.querySelector(".cartItem")
    ) {
      return 0;
    }

    const raw = String(
      elSubtotal?.textContent || ""
    )
      .replace(/[^0-9,.-]/g, "")
      .replace(",", ".");

    const n = Number(raw);

    return Number.isFinite(n) && n > 0
      ? n
      : 0;
  }

  function keepRealCartSubtotal(subtotal) {
    const requested =
      Number(subtotal) || 0;

    const domSubtotal =
      subtotalFromCartDom();

    return domSubtotal > 0
      ? domSubtotal
      : requested;
  }

  function setPaymentReady(ready) {
    const hasItems =
      lastSubtotal > 0;

    if (elCheckout) {
      elCheckout.disabled =
        !(hasItems && ready);
    }

    if (elPpWrap) {
      elPpWrap.style.pointerEvents =
        (hasItems && ready)
          ? "auto"
          : "none";

      elPpWrap.style.opacity =
        (hasItems && ready)
          ? "1"
          : ".45";
    }
  }

  function resetQuoteUi() {
    lastQuote = null;

    if (elShipping) {
      elShipping.textContent = "—";
    }

    if (elService) {
      elService.textContent =
        "Choose a destination to calculate DHL tracked shipping.";
    }

    if (elTotal) {
      elTotal.textContent = "—";
    }

    setPaymentReady(false);
  }

  async function refresh(
    subtotal = lastSubtotal,
    currency = lastCurrency
  ) {
    lastSubtotal =
      keepRealCartSubtotal(subtotal);

    lastCurrency =
      String(currency || "EUR").toUpperCase() === "USD"
        ? "USD"
        : "EUR";

    if (elSubtotal) {
      elSubtotal.textContent =
        lastSubtotal > 0
          ? money(lastSubtotal, lastCurrency)
          : "—";
    }

    if (!(lastSubtotal > 0)) {
      lastQuote = null;

      if (elShipping) {
        elShipping.textContent = "—";
      }

      if (elTotal) {
        elTotal.textContent = "—";
      }

      if (elService) {
        elService.textContent =
          "Add an item to calculate shipping.";
      }

      setPaymentReady(false);

      return null;
    }

    const country =
      selectedCountry();

    if (!country) {
      resetQuoteUi();
      return null;
    }

    const mySeq =
      ++seq;

    lastQuote = null;

    if (elShipping) {
      elShipping.textContent =
        "Calculating…";
    }

    if (elTotal) {
      elTotal.textContent = "—";
    }

    if (elService) {
      elService.textContent =
        isAutoDetectedCountry()
          ? "Checking DHL rate… Country detected automatically — change if needed."
          : "Checking current DHL tracked rate…";
    }

    setPaymentReady(false);

    try {
      const r = await fetch(
        `/api/shipping/quote?country=${encodeURIComponent(country)}&currency=${encodeURIComponent(lastCurrency)}`,
        {
          cache: "no-store",
        }
      );

      const q =
        await r.json().catch(() => ({}));

      if (mySeq !== seq) {
        return null;
      }

      if (!r.ok || !q?.ok) {
        throw new Error(
          q?.error ||
          "DHL shipping rate unavailable"
        );
      }

      lastQuote = q;

      if (elShipping) {
        elShipping.textContent =
          money(q.price, lastCurrency);
      }

      if (elTotal) {
        elTotal.textContent =
          money(
            lastSubtotal +
            Number(q.price || 0),
            lastCurrency
          );
      }

      if (elService) {
        elService.textContent =
          shippingServiceText(q);
      }

      setPaymentReady(true);

      window.dispatchEvent(
        new CustomEvent(
          "mp-shipping-quote",
          {
            detail: q
          }
        )
      );

      return q;

    } catch (e) {
      if (mySeq !== seq) {
        return null;
      }

      lastQuote = null;

      if (elShipping) {
        elShipping.textContent =
          "Unavailable";
      }

      if (elTotal) {
        elTotal.textContent = "—";
      }

      if (elService) {
        elService.textContent =
          String(e?.message || e);
      }

      setPaymentReady(false);

      return null;
    }
  }

  async function loadCountries() {
    const saved = (() => {
      try {
        const v =
          String(
            localStorage.getItem(SHIP_KEY) || ""
          ).toUpperCase();

        return /^[A-Z]{2}$/.test(v)
          ? v
          : "";
      } catch (_) {
        return "";
      }
    })();

    const current =
      selectedCountry() || saved;

    try {
      const r = await fetch(
        "/api/shipping/countries",
        {
          cache: "no-store"
        }
      );

      const d =
        await r.json().catch(() => ({}));

      if (
        !r.ok ||
        !d?.ok ||
        !Array.isArray(d.countries)
      ) {
        throw new Error(
          d?.error ||
          "Countries unavailable"
        );
      }

      const dn =
        typeof Intl !== "undefined" &&
        Intl.DisplayNames
          ? new Intl.DisplayNames(
              ["en"],
              {
                type: "region"
              }
            )
          : null;

      const rows =
        d.countries
          .filter(
            x =>
              /^[A-Z]{2}$/.test(
                String(x || "")
              )
          )
          .map(
            code => ({
              code,
              name:
                dn?.of(code) ||
                code
            })
          )
          .sort(
            (a, b) =>
              a.name.localeCompare(
                b.name
              )
          );

      elCountry.innerHTML =
        `<option value="">Select shipping country…</option>` +
        rows
          .map(
            x =>
              `<option value="${x.code}">${escapeHtml(x.name)} (${x.code})</option>`
          )
          .join("");

      if (
        current &&
        rows.some(
          x => x.code === current
        )
      ) {
        elCountry.value =
          current;
      } else {
        elCountry.value = "";
      }

    } catch (e) {
      elCountry.innerHTML =
        `<option value="">DHL countries unavailable</option>`;

      if (elService) {
        elService.textContent =
          String(e?.message || e);
      }

      setPaymentReady(false);
    }

    await refresh(
      keepRealCartSubtotal(lastSubtotal),
      lastCurrency
    );

    setTimeout(
      () =>
        refresh(
          keepRealCartSubtotal(lastSubtotal),
          lastCurrency
        ),
      0
    );
  }

  elCountry.addEventListener(
    "change",
    () => {
      const cc =
        selectedCountry();

      try {
        if (cc) {
          localStorage.setItem(
            SHIP_KEY,
            cc
          );
        } else {
          localStorage.removeItem(
            SHIP_KEY
          );
        }

        /*
         * From this point the customer has
         * explicitly chosen the destination.
         * Do not show the auto-detected message.
         */
        localStorage.setItem(
          USER_SET_SHIP_KEY,
          "1"
        );

      } catch (_) {}

      refresh();
    }
  );

  function escapeHtml(s) {
    return String(s || "")
      .replace(
        /[&<>"']/g,
        m => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[m])
      );
  }

  const cartBody =
    document.getElementById(
      "cartBody"
    );

  if (
    cartBody &&
    typeof MutationObserver !==
      "undefined"
  ) {
    const observer =
      new MutationObserver(
        () => {
          const domSubtotal =
            subtotalFromCartDom();

          if (
            domSubtotal > 0 &&
            Math.abs(
              domSubtotal -
              lastSubtotal
            ) > 0.0001
          ) {
            refresh(
              domSubtotal,
              lastCurrency
            );
          }
        }
      );

    observer.observe(
      cartBody,
      {
        childList: true,
        subtree: true
      }
    );
  }

  window.MPShipping = {
    refresh,
    getCountry:
      selectedCountry,
    getQuote:
      () => lastQuote,
    isReady:
      () => !!lastQuote,
  };

  loadCountries();
})();
