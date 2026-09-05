/*
 * Mosaic Pins Space - Google tag + Consent Mode v2 + ecommerce event bridge.
 *
 * Google Ads tag ID is public by design (it is present in page source).
 * Google Ads Purchase conversion is configured below.
 * Keep the send_to value in sync with the Purchase conversion action in Google Ads.
 */
(function () {
  "use strict";

  const GOOGLE_TAG_ID = "AW-18408562897";
  const PURCHASE_CONVERSION_SEND_TO = "AW-18408562897/GWKtCL7Jl-ccENHB8clE";
  const CONSENT_KEY = "mp_google_consent_v1";
  const CART_KEY = "mp_cart";
  const LANG_KEY = "mp_language";
  const VERSION = 1;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  // Consent Mode v2: deny optional storage until a visitor makes a choice.
  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });
  window.gtag("set", "ads_data_redaction", true);
  window.gtag("set", "url_passthrough", true);

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function safeLocalGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeLocalSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function normalizeSavedConsent(raw) {
    const value = safeJsonParse(raw || "", null);
    if (!value || value.version !== VERSION) return null;
    return {
      analytics: value.analytics === true,
      ads: value.ads === true,
      version: VERSION,
      updatedAt: Number(value.updatedAt || 0) || Date.now()
    };
  }

  function consentPayload(choice) {
    return {
      analytics_storage: choice.analytics ? "granted" : "denied",
      ad_storage: choice.ads ? "granted" : "denied",
      ad_user_data: choice.ads ? "granted" : "denied",
      ad_personalization: choice.ads ? "granted" : "denied"
    };
  }

  let currentConsent = normalizeSavedConsent(safeLocalGet(CONSENT_KEY));
  if (currentConsent) {
    window.gtag("consent", "update", consentPayload(currentConsent));
  }

  // Load the Google tag once. With denied consent it may send limited cookieless
  // measurement signals, but optional Google storage remains blocked.
  const tagScript = document.createElement("script");
  tagScript.async = true;
  tagScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_TAG_ID)}`;
  tagScript.dataset.mpGoogleTag = "1";
  document.head.appendChild(tagScript);

  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_TAG_ID, {
    send_page_view: true,
    allow_google_signals: true
  });

  function getLanguage() {
    const lang = String(safeLocalGet(LANG_KEY) || "en").toLowerCase().slice(0, 2);
    return ["en", "de", "ru", "fr"].includes(lang) ? lang : "en";
  }

  const COPY = {
    en: {
      title: "Privacy choices",
      body: "We use optional Google measurement and advertising technologies to understand visits, cart activity, checkouts and purchases, and to measure advertising performance. Optional Google storage stays off until you choose.",
      necessary: "Necessary site functions",
      necessaryNote: "Always active for core shop, language, account and security functions.",
      analytics: "Analytics",
      analyticsNote: "Helps us understand how the shop is used.",
      ads: "Advertising measurement",
      adsNote: "Helps measure Google Ads performance and future remarketing features.",
      accept: "Accept all",
      reject: "Reject optional",
      settings: "Settings",
      save: "Save choices",
      back: "Back",
      privacy: "Privacy Policy",
      reopen: "Cookie settings"
    },
    de: {
      title: "Datenschutzauswahl",
      body: "Wir verwenden optionale Google-Technologien für Messung und Werbung, um Besuche, Warenkorbaktivitäten, Checkouts und Käufe sowie die Werbeleistung zu verstehen. Optionale Google-Speicherung bleibt deaktiviert, bis du dich entscheidest.",
      necessary: "Notwendige Website-Funktionen",
      necessaryNote: "Immer aktiv für Shop, Sprache, Konto und Sicherheitsfunktionen.",
      analytics: "Analyse",
      analyticsNote: "Hilft uns zu verstehen, wie der Shop genutzt wird.",
      ads: "Werbemessung",
      adsNote: "Hilft bei der Messung von Google-Ads-Leistung und zukünftigen Remarketing-Funktionen.",
      accept: "Alle akzeptieren",
      reject: "Optionale ablehnen",
      settings: "Einstellungen",
      save: "Auswahl speichern",
      back: "Zurück",
      privacy: "Datenschutzerklärung",
      reopen: "Cookie-Einstellungen"
    },
    ru: {
      title: "Настройки конфиденциальности",
      body: "Мы используем необязательные технологии Google для измерения посещений, действий с корзиной, оформления и покупок, а также эффективности рекламы. Необязательное хранение Google остаётся отключённым, пока вы не сделаете выбор.",
      necessary: "Необходимые функции сайта",
      necessaryNote: "Всегда активны для магазина, языка, аккаунта и функций безопасности.",
      analytics: "Аналитика",
      analyticsNote: "Помогает понять, как используется магазин.",
      ads: "Измерение рекламы",
      adsNote: "Помогает измерять эффективность Google Ads и будущих функций ремаркетинга.",
      accept: "Принять всё",
      reject: "Отклонить необязательное",
      settings: "Настроить",
      save: "Сохранить выбор",
      back: "Назад",
      privacy: "Политика конфиденциальности",
      reopen: "Настройки cookies"
    },
    fr: {
      title: "Choix de confidentialité",
      body: "Nous utilisons des technologies Google facultatives de mesure et de publicité pour comprendre les visites, le panier, le paiement et les achats, ainsi que les performances publicitaires. Le stockage Google facultatif reste désactivé jusqu’à votre choix.",
      necessary: "Fonctions nécessaires du site",
      necessaryNote: "Toujours actives pour la boutique, la langue, le compte et la sécurité.",
      analytics: "Analyse",
      analyticsNote: "Nous aide à comprendre comment la boutique est utilisée.",
      ads: "Mesure publicitaire",
      adsNote: "Aide à mesurer les performances Google Ads et les futures fonctions de remarketing.",
      accept: "Tout accepter",
      reject: "Refuser les options",
      settings: "Paramètres",
      save: "Enregistrer",
      back: "Retour",
      privacy: "Politique de confidentialité",
      reopen: "Paramètres des cookies"
    }
  };

  function applyConsent(choice, persist) {
    currentConsent = {
      analytics: choice.analytics === true,
      ads: choice.ads === true,
      version: VERSION,
      updatedAt: Date.now()
    };
    window.gtag("consent", "update", consentPayload(currentConsent));
    if (persist) safeLocalSet(CONSENT_KEY, JSON.stringify(currentConsent));
    closePanel();
  }

  function ensureStyles() {
    if (document.getElementById("mp-google-consent-style")) return;
    const style = document.createElement("style");
    style.id = "mp-google-consent-style";
    style.textContent = `
      #mpConsentOverlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.48);display:flex;align-items:flex-end;justify-content:center;padding:18px;box-sizing:border-box}
      #mpConsentOverlay[hidden]{display:none!important}
      #mpConsentCard{width:min(680px,100%);max-height:min(82vh,760px);overflow:auto;background:#10151d;color:#eef2f7;border:1px solid rgba(255,255,255,.14);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.45);padding:20px;font:500 15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      #mpConsentCard h2{margin:0 0 8px;font-size:21px;line-height:1.2;color:#fff}
      #mpConsentCard p{margin:0;color:#aeb9ca}
      .mpConsentMain,.mpConsentSettings{display:block}
      .mpConsentSettings[hidden],.mpConsentMain[hidden]{display:none!important}
      .mpConsentActions{display:flex;gap:9px;flex-wrap:wrap;justify-content:center;margin-top:18px}
      .mpConsentBtn{appearance:none;border:1px solid rgba(255,255,255,.16);background:#1c2532;color:#eef2f7;border-radius:11px;padding:11px 14px;font-weight:800;cursor:pointer;min-height:44px}
      .mpConsentBtn.primary{background:#22c55e;border-color:#22c55e;color:#07110a}
      .mpConsentBtn:hover{filter:brightness(1.06)}
      .mpConsentPrivacy{display:inline-block;margin-top:13px;color:#9fc4ff;text-decoration:underline;text-underline-offset:2px}
      .mpConsentRow{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.09)}
      .mpConsentRow:last-of-type{border-bottom:0}
      .mpConsentRow strong{display:block;color:#fff;margin-bottom:2px}
      .mpConsentRow small{display:block;color:#9ca9bb;font-size:13px;line-height:1.35}
      .mpConsentSwitch{width:48px;height:27px;position:relative;display:inline-block}
      .mpConsentSwitch input{opacity:0;width:0;height:0}
      .mpConsentSlider{position:absolute;inset:0;border-radius:999px;background:#4b5563;transition:.15s}
      .mpConsentSlider:before{content:"";position:absolute;width:21px;height:21px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s}
      .mpConsentSwitch input:checked+.mpConsentSlider{background:#22c55e}
      .mpConsentSwitch input:checked+.mpConsentSlider:before{transform:translateX(21px)}
      .mpConsentSwitch input:disabled+.mpConsentSlider{opacity:.65}
      @media(max-width:560px){#mpConsentOverlay{padding:10px}#mpConsentCard{padding:17px;border-radius:15px}.mpConsentActions{display:grid;grid-template-columns:1fr}.mpConsentBtn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let overlay = document.getElementById("mpConsentOverlay");
    if (overlay) return overlay;
    ensureStyles();
    const lang = getLanguage();
    const c = COPY[lang];
    overlay = document.createElement("div");
    overlay.id = "mpConsentOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div id="mpConsentCard" role="dialog" aria-modal="true" aria-labelledby="mpConsentTitle">
        <div class="mpConsentMain">
          <h2 id="mpConsentTitle"></h2>
          <p class="mpConsentBody"></p>
          <div class="mpConsentActions">
            <button type="button" class="mpConsentBtn primary" data-mp-consent="accept"></button>
            <button type="button" class="mpConsentBtn" data-mp-consent="reject"></button>
            <button type="button" class="mpConsentBtn" data-mp-consent="settings"></button>
          </div>
          <a class="mpConsentPrivacy" href="/privacy"></a>
        </div>
        <div class="mpConsentSettings" hidden>
          <h2 class="mpConsentSettingsTitle"></h2>
          <div class="mpConsentRow">
            <div><strong class="mpNecessaryTitle"></strong><small class="mpNecessaryNote"></small></div>
            <label class="mpConsentSwitch"><input type="checkbox" checked disabled><span class="mpConsentSlider"></span></label>
          </div>
          <div class="mpConsentRow">
            <div><strong class="mpAnalyticsTitle"></strong><small class="mpAnalyticsNote"></small></div>
            <label class="mpConsentSwitch"><input id="mpConsentAnalytics" type="checkbox"><span class="mpConsentSlider"></span></label>
          </div>
          <div class="mpConsentRow">
            <div><strong class="mpAdsTitle"></strong><small class="mpAdsNote"></small></div>
            <label class="mpConsentSwitch"><input id="mpConsentAds" type="checkbox"><span class="mpConsentSlider"></span></label>
          </div>
          <div class="mpConsentActions">
            <button type="button" class="mpConsentBtn primary" data-mp-consent="save"></button>
            <button type="button" class="mpConsentBtn" data-mp-consent="back"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector("#mpConsentTitle").textContent = c.title;
    overlay.querySelector(".mpConsentBody").textContent = c.body;
    overlay.querySelector('[data-mp-consent="accept"]').textContent = c.accept;
    overlay.querySelector('[data-mp-consent="reject"]').textContent = c.reject;
    overlay.querySelector('[data-mp-consent="settings"]').textContent = c.settings;
    overlay.querySelector(".mpConsentPrivacy").textContent = c.privacy;
    overlay.querySelector(".mpConsentSettingsTitle").textContent = c.title;
    overlay.querySelector(".mpNecessaryTitle").textContent = c.necessary;
    overlay.querySelector(".mpNecessaryNote").textContent = c.necessaryNote;
    overlay.querySelector(".mpAnalyticsTitle").textContent = c.analytics;
    overlay.querySelector(".mpAnalyticsNote").textContent = c.analyticsNote;
    overlay.querySelector(".mpAdsTitle").textContent = c.ads;
    overlay.querySelector(".mpAdsNote").textContent = c.adsNote;
    overlay.querySelector('[data-mp-consent="save"]').textContent = c.save;
    overlay.querySelector('[data-mp-consent="back"]').textContent = c.back;

    overlay.addEventListener("click", (event) => {
      const action = event.target?.closest?.("[data-mp-consent]")?.getAttribute("data-mp-consent");
      if (!action) return;
      if (action === "accept") return applyConsent({ analytics: true, ads: true }, true);
      if (action === "reject") return applyConsent({ analytics: false, ads: false }, true);
      if (action === "settings") return showSettings();
      if (action === "back") return showMain();
      if (action === "save") {
        const analytics = overlay.querySelector("#mpConsentAnalytics")?.checked === true;
        const ads = overlay.querySelector("#mpConsentAds")?.checked === true;
        return applyConsent({ analytics, ads }, true);
      }
    });
    return overlay;
  }

  function showMain() {
    const overlay = ensurePanel();
    overlay.querySelector(".mpConsentMain").hidden = false;
    overlay.querySelector(".mpConsentSettings").hidden = true;
  }

  function showSettings() {
    const overlay = ensurePanel();
    const saved = currentConsent || { analytics: false, ads: false };
    overlay.querySelector("#mpConsentAnalytics").checked = saved.analytics === true;
    overlay.querySelector("#mpConsentAds").checked = saved.ads === true;
    overlay.querySelector(".mpConsentMain").hidden = true;
    overlay.querySelector(".mpConsentSettings").hidden = false;
  }

  function openPanel(settingsFirst) {
    const overlay = ensurePanel();
    overlay.hidden = false;
    if (settingsFirst) showSettings(); else showMain();
  }

  function closePanel() {
    const overlay = document.getElementById("mpConsentOverlay");
    if (overlay) overlay.hidden = true;
  }

  function appendSettingsLink() {
    const footer = document.querySelector(".footerLinks");
    if (!footer || footer.querySelector("[data-mp-cookie-settings]")) return;

    // Use the same <a> element as the existing footer links so Cookie settings
    // inherits each page's footer pill styling exactly, including after a
    // saved consent choice when the consent dialog itself is not opened.
    const link = document.createElement("a");
    link.href = "#";
    link.dataset.mpCookieSettings = "1";
    link.textContent = COPY[getLanguage()].reopen;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openPanel(true);
    });
    footer.appendChild(link);
  }

  function fillPrivacySection() {
    const node = document.getElementById("mpGooglePrivacy");
    if (!node) return;
    const lang = getLanguage();
    const blocks = {
      en: `<h3>7. Optional analytics and advertising technologies</h3><p>With your consent, this site uses the Google tag and Google Consent Mode v2 to measure visits, cart activity, checkouts and purchases and to evaluate Google Ads performance. Optional Google storage is denied by default and is enabled only according to your choice. When storage is denied, Google may still receive limited cookieless measurement signals. You can change or withdraw your choice at any time using <b>Cookie settings</b> in the footer.</p><p>Google may process data outside the EU/EEA. Where required, transfers are handled under the safeguards provided by Google and applicable data-protection law.</p>`,
      de: `<h3>7. Optionale Analyse- und Werbetechnologien</h3><p>Mit deiner Einwilligung verwendet diese Website den Google-Tag und Google Consent Mode v2, um Besuche, Warenkorbaktivitäten, Checkouts und Käufe zu messen und die Leistung von Google Ads auszuwerten. Optionale Google-Speicherung ist standardmäßig abgelehnt und wird nur entsprechend deiner Auswahl aktiviert. Wenn Speicherung abgelehnt ist, kann Google weiterhin begrenzte cookielose Messsignale erhalten. Du kannst deine Auswahl jederzeit über <b>Cookie-Einstellungen</b> im Footer ändern oder widerrufen.</p><p>Google kann Daten außerhalb der EU/des EWR verarbeiten. Soweit erforderlich, erfolgen Übermittlungen unter den von Google bereitgestellten Garantien und dem anwendbaren Datenschutzrecht.</p>`,
      ru: `<h3>7. Необязательные технологии аналитики и рекламы</h3><p>С вашего согласия сайт использует Google tag и Google Consent Mode v2 для измерения посещений, действий с корзиной, оформления заказов и покупок, а также эффективности Google Ads. Необязательное хранение Google по умолчанию запрещено и включается только в соответствии с вашим выбором. Когда хранение запрещено, Google всё равно может получать ограниченные сигналы измерения без cookies. Изменить или отозвать выбор можно в любое время через <b>Настройки cookies</b> в нижней части сайта.</p><p>Google может обрабатывать данные за пределами ЕС/ЕЭЗ. Когда это требуется, передача осуществляется с использованием гарантий Google и в соответствии с применимым законодательством о защите данных.</p>`,
      fr: `<h3>7. Technologies facultatives d’analyse et de publicité</h3><p>Avec votre consentement, ce site utilise le tag Google et Google Consent Mode v2 pour mesurer les visites, l’activité du panier, les paiements et les achats, ainsi que les performances Google Ads. Le stockage Google facultatif est refusé par défaut et n’est activé que selon votre choix. Lorsque le stockage est refusé, Google peut encore recevoir des signaux de mesure limités sans cookies. Vous pouvez modifier ou retirer votre choix à tout moment via <b>Paramètres des cookies</b> dans le pied de page.</p><p>Google peut traiter des données en dehors de l’UE/EEE. Lorsque cela est nécessaire, les transferts reposent sur les garanties proposées par Google et le droit applicable en matière de protection des données.</p>`
    };
    node.innerHTML = blocks[lang] || blocks.en;
  }

  function parseCart(raw) {
    const value = safeJsonParse(raw || "[]", []);
    return Array.isArray(value) ? value : [];
  }

  function currentCurrency() {
    const c = String(safeLocalGet("mp_currency") || "USD").toUpperCase();
    return c === "EUR" ? "EUR" : "USD";
  }

  function cartItemToGoogle(item, quantityOverride) {
    const currency = currentCurrency();
    const qty = Math.max(1, Number(quantityOverride ?? item?.qty ?? 1) || 1);
    const price = Number(item?.price?.[currency]);
    const result = {
      item_id: String(item?.pin || ""),
      item_name: String(item?.title || item?.pin || "Mosaic Pin"),
      quantity: qty
    };
    if (Number.isFinite(price)) result.price = price;
    return result;
  }

  function cartToGoogleItems(cart) {
    return (Array.isArray(cart) ? cart : []).map((item) => cartItemToGoogle(item));
  }

  function cartValue(cart) {
    const currency = currentCurrency();
    return (Array.isArray(cart) ? cart : []).reduce((sum, item) => {
      const price = Number(item?.price?.[currency]);
      const qty = Number(item?.qty || 0);
      return sum + (Number.isFinite(price) && Number.isFinite(qty) ? price * qty : 0);
    }, 0);
  }

  function event(name, params) {
    try { window.gtag("event", name, params || {}); } catch (_) {}
  }

  let suppressNextCartMutation = false;

  function suppressNextCartTracking() {
    suppressNextCartMutation = true;
  }

  function trackBeginCheckout() {
    const cart = parseCart(safeLocalGet(CART_KEY));
    if (!cart.length) return;
    const currency = currentCurrency();
    const signature = `${currency}:${cart.map((x) => `${x?.pin}:${x?.qty}`).join("|")}`;
    try {
      const key = "mp_begin_checkout_signature";
      const prev = safeJsonParse(sessionStorage.getItem(key) || "", null);
      if (prev && prev.signature === signature && Date.now() - Number(prev.ts || 0) < 60000) return;
      sessionStorage.setItem(key, JSON.stringify({ signature, ts: Date.now() }));
    } catch (_) {}
    event("begin_checkout", {
      currency,
      value: Number(cartValue(cart).toFixed(2)),
      items: cartToGoogleItems(cart)
    });
  }

  function trackPurchase(data) {
    const transactionId = String(data?.transaction_id || "").trim();
    const value = Number(data?.value);
    const currency = String(data?.currency || currentCurrency()).toUpperCase();
    if (!transactionId || !Number.isFinite(value) || value < 0) return false;

    const dedupeKey = `mp_purchase_sent:${transactionId}`;
    if (safeLocalGet(dedupeKey) === "1") return false;

    const params = {
      transaction_id: transactionId,
      value: Number(value.toFixed(2)),
      currency: currency === "EUR" ? "EUR" : "USD",
      items: Array.isArray(data?.items) ? data.items : []
    };
    if (Number.isFinite(Number(data?.shipping))) params.shipping = Number(Number(data.shipping).toFixed(2));
    event("purchase", params);

    if (PURCHASE_CONVERSION_SEND_TO) {
      event("conversion", {
        send_to: PURCHASE_CONVERSION_SEND_TO,
        value: params.value,
        currency: params.currency,
        transaction_id: params.transaction_id
      });
    }

    safeLocalSet(dedupeKey, "1");
    return true;
  }

  // Observe cart changes at the storage boundary, so all existing shop pages are covered
  // without changing their cart implementation.
  try {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      let before = null;
      const shouldTrack = key === CART_KEY && this === window.localStorage;
      if (shouldTrack) before = parseCart(this.getItem(key));
      const result = originalSetItem.call(this, key, value);
      if (shouldTrack) {
        const after = parseCart(String(value || "[]"));
        if (suppressNextCartMutation) {
          suppressNextCartMutation = false;
          return result;
        }
        const beforeMap = new Map(before.map((x) => [String(x?.pin || ""), Number(x?.qty || 0)]));
        const afterMap = new Map(after.map((x) => [String(x?.pin || ""), Number(x?.qty || 0)]));
        const currency = currentCurrency();

        for (const item of after) {
          const pin = String(item?.pin || "");
          const delta = Number(afterMap.get(pin) || 0) - Number(beforeMap.get(pin) || 0);
          if (delta > 0) {
            const price = Number(item?.price?.[currency]);
            event("add_to_cart", {
              currency,
              value: Number.isFinite(price) ? Number((price * delta).toFixed(2)) : undefined,
              items: [cartItemToGoogle(item, delta)]
            });
          }
        }
        for (const item of before) {
          const pin = String(item?.pin || "");
          const delta = Number(beforeMap.get(pin) || 0) - Number(afterMap.get(pin) || 0);
          if (delta > 0) {
            const price = Number(item?.price?.[currency]);
            event("remove_from_cart", {
              currency,
              value: Number.isFinite(price) ? Number((price * delta).toFixed(2)) : undefined,
              items: [cartItemToGoogle(item, delta)]
            });
          }
        }
      }
      return result;
    };
  } catch (_) {}

  // Observe the existing checkout APIs. This covers Stripe and PayPal buttons on every
  // page that uses the common checkout endpoints.
  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      let url = "";
      try { url = typeof input === "string" ? input : String(input?.url || ""); } catch (_) {}
      const path = (() => { try { return new URL(url, location.href).pathname; } catch (_) { return url; } })();
      if (path === "/api/checkout" || path === "/api/paypal/create-order") trackBeginCheckout();

      const response = await originalFetch(input, init);

      if (path === "/api/paypal/capture" && response?.ok) {
        // The existing PayPal UI clears mp_cart immediately after a successful capture.
        // Do not misclassify that cleanup as a remove_from_cart ecommerce action.
        suppressNextCartTracking();
        try {
          response.clone().json().then((json) => {
            if (!json?.ok || String(json?.status || "").toUpperCase() !== "COMPLETED") return;
            const amountValue = Number(json?.amount?.value);
            const currency = String(json?.amount?.currency_code || currentCurrency()).toUpperCase();
            const cart = parseCart(safeLocalGet(CART_KEY));
            trackPurchase({
              transaction_id: String(json?.captureId || json?.orderID || ""),
              value: amountValue,
              currency,
              items: cartToGoogleItems(cart)
            });
          }).catch(() => {});
        } catch (_) {}
      }
      return response;
    };
  } catch (_) {}

  function trackProductView() {
    const match = location.pathname.match(/^\/p\/([^/?#]+)/i);
    if (!match) return;
    let pin = "";
    try { pin = decodeURIComponent(match[1]); } catch (_) { pin = match[1]; }
    if (!pin) return;
    setTimeout(() => {
      const title = String(document.getElementById("title")?.textContent || document.getElementById("hTitle")?.textContent || pin).trim();
      const priceText = String(document.getElementById("price")?.textContent || "");
      const numeric = Number(priceText.replace(/[^0-9,.-]/g, "").replace(",", "."));
      const currency = /€/.test(priceText) ? "EUR" : /\$/.test(priceText) ? "USD" : currentCurrency();
      const params = {
        currency,
        items: [{ item_id: pin, item_name: title || pin, quantity: 1 }]
      };
      if (Number.isFinite(numeric)) {
        params.value = numeric;
        params.items[0].price = numeric;
      }
      event("view_item", params);
    }, 900);
  }

  window.MPGoogle = {
    tagId: GOOGLE_TAG_ID,
    event,
    beginCheckout: trackBeginCheckout,
    purchase: trackPurchase,
    suppressNextCartTracking,
    getConsent: () => currentConsent ? { ...currentConsent } : null,
    openConsent: () => openPanel(true)
  };

  document.addEventListener("DOMContentLoaded", () => {
    appendSettingsLink();
    fillPrivacySection();
    trackProductView();
    if (!currentConsent) openPanel(false);
  }, { once: true });
})();
