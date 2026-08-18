(() => {
  const LANG_KEY = "mp_language";
  const SUPPORTED = ["en", "de", "ru", "fr"];

  const TEXT = {
    de: {
      "Shop":"Shop","About":"Über uns","Shipping":"Versand","Returns":"Rückgabe","Reviews":"Bewertungen",
      "Filters":"Filter","Cart":"Warenkorb","In stock":"Auf Lager","Selected":"Ausgewählt","Clear":"Löschen",
      "Diameter (Ø)":"Durchmesser (Ø)","Shipping country":"Versandland","Subtotal":"Zwischensumme","Total":"Gesamt",
      "Checkout":"Mit Karte zahlen","Clear cart":"Warenkorb leeren","PayPal is loading…":"PayPal wird geladen…",
      "Your cart is empty.":"Dein Warenkorb ist leer.","Add to cart":"In den Warenkorb","Pay by card":"Mit Karte zahlen",
      "Quantity":"Menge","Loading…":"Wird geladen…","No image":"Kein Bild","Product":"Produkt","Notice":"Hinweis",
      "Sold out":"Ausverkauft","Buy":"Kaufen","All":"Alle","Any size":"Alle Größen","Exact":"Exakt",
      "Privacy Policy":"Datenschutz","Impressum":"Impressum","Support":"Support",
      "Choose a destination to calculate DHL tracked shipping.":"Wähle ein Versandland, um den DHL-Versand mit Sendungsverfolgung zu berechnen.",
      "Loading DHL countries…":"DHL-Länder werden geladen…","Add an item to calculate shipping.":"Lege einen Artikel in den Warenkorb, um den Versand zu berechnen.",
      "Please select a shipping country and wait for the DHL rate.":"Bitte wähle ein Versandland und warte auf den DHL-Tarif.",
      "High-quality handcrafted mosaic pins for knife handles":"Hochwertige handgefertigte Mosaik-Pins für Messergriffe"
    },
    ru: {
      "Shop":"Магазин","About":"О нас","Shipping":"Доставка","Returns":"Возврат","Reviews":"Отзывы",
      "Filters":"Фильтры","Cart":"Корзина","In stock":"В наличии","Selected":"Выбрано","Clear":"Очистить",
      "Diameter (Ø)":"Диаметр (Ø)","Shipping country":"Страна доставки","Subtotal":"Товары","Total":"Итого",
      "Checkout":"Оплатить картой","Clear cart":"Очистить корзину","PayPal is loading…":"PayPal загружается…",
      "Your cart is empty.":"Корзина пуста.","Add to cart":"Добавить в корзину","Pay by card":"Оплатить картой",
      "Quantity":"Количество","Loading…":"Загрузка…","No image":"Нет изображения","Product":"Товар","Notice":"Сообщение",
      "Sold out":"Нет в наличии","Buy":"Купить","All":"Все","Any size":"Любой размер","Exact":"Точно",
      "Privacy Policy":"Конфиденциальность","Impressum":"Реквизиты","Support":"Поддержка",
      "Choose a destination to calculate DHL tracked shipping.":"Выберите страну, чтобы рассчитать доставку DHL с отслеживанием.",
      "Loading DHL countries…":"Загрузка стран DHL…","Add an item to calculate shipping.":"Добавьте товар, чтобы рассчитать доставку.",
      "Please select a shipping country and wait for the DHL rate.":"Выберите страну доставки и дождитесь расчёта DHL.",
      "High-quality handcrafted mosaic pins for knife handles":"Высококачественные мозаичные пины ручной работы для рукоятей ножей"
    },
    fr: {
      "Shop":"Boutique","About":"À propos","Shipping":"Livraison","Returns":"Retours","Reviews":"Avis",
      "Filters":"Filtres","Cart":"Panier","In stock":"En stock","Selected":"Sélectionné","Clear":"Effacer",
      "Diameter (Ø)":"Diamètre (Ø)","Shipping country":"Pays de livraison","Subtotal":"Sous-total","Total":"Total",
      "Checkout":"Payer par carte","Clear cart":"Vider le panier","PayPal is loading…":"Chargement de PayPal…",
      "Your cart is empty.":"Votre panier est vide.","Add to cart":"Ajouter au panier","Pay by card":"Payer par carte",
      "Quantity":"Quantité","Loading…":"Chargement…","No image":"Aucune image","Product":"Produit","Notice":"Information",
      "Sold out":"Épuisé","Buy":"Acheter","All":"Tous","Any size":"Toutes tailles","Exact":"Exact",
      "Privacy Policy":"Confidentialité","Impressum":"Mentions légales","Support":"Support",
      "Choose a destination to calculate DHL tracked shipping.":"Choisissez un pays pour calculer la livraison DHL avec suivi.",
      "Loading DHL countries…":"Chargement des pays DHL…","Add an item to calculate shipping.":"Ajoutez un article pour calculer la livraison.",
      "Please select a shipping country and wait for the DHL rate.":"Choisissez un pays de livraison et attendez le tarif DHL.",
      "High-quality handcrafted mosaic pins for knife handles":"Pins mosaïque artisanaux de haute qualité pour manches de couteaux"
    }
  };

  function getLang(){
    try {
      const saved = String(localStorage.getItem(LANG_KEY) || "").toLowerCase();
      if (SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    return "en";
  }

  const lang = getLang();
  document.documentElement.lang = lang;

  function injectStyles(){
    if (document.getElementById("mp-locale-style")) return;
    const style = document.createElement("style");
    style.id = "mp-locale-style";
    style.textContent = `
      .mp-locale-controls{
        display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;
        padding:3px;border:1px solid rgba(255,255,255,.10);border-radius:11px;
        background:rgba(8,13,19,.58);box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 7px 20px rgba(0,0,0,.12);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)
      }
      .mp-locale-control,
      .mp-locale-controls .currency{
        box-sizing:border-box;height:36px;min-width:70px;margin:0!important;
        border:1px solid rgba(255,255,255,.07)!important;border-radius:8px!important;
        background-color:rgba(255,255,255,.045)!important;color:var(--text,#eef2f7)!important;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aeb8c5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")!important;
        background-repeat:no-repeat!important;background-position:right 9px center!important;background-size:14px 14px!important;
        padding:0 30px 0 11px!important;font:800 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;
        letter-spacing:.12px!important;outline:none!important;cursor:pointer!important;
        box-shadow:none!important;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease!important;
        -webkit-appearance:none!important;appearance:none!important;color-scheme:dark
      }
      .mp-language-control{min-width:68px}
      .mp-locale-controls .currency{min-width:88px}
      .mp-locale-control:hover,.mp-locale-control:focus,
      .mp-locale-controls .currency:hover,.mp-locale-controls .currency:focus{
        border-color:rgba(34,197,94,.52)!important;background-color:rgba(34,197,94,.085)!important;
        box-shadow:0 0 0 2px rgba(34,197,94,.055)!important
      }
      .mp-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto}
      .mp-top-actions>.btn,.mp-top-actions>.backBtn{margin:0}
      .mp-floating-language{position:fixed;right:14px;top:14px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.22)}

      /* About / Reviews / other cart pages: keep Cart + language + currency on one clean row. */
      @media(max-width:980px){
        .topbar{gap:10px}
        .top-right{
          width:100%!important;display:flex!important;align-items:center!important;
          grid-template-columns:none!important;gap:8px!important;flex-wrap:nowrap!important
        }
        .top-right>.cartBtn{
          width:auto!important;min-width:0!important;flex:1 1 auto!important;
          justify-content:center!important;min-height:42px!important;height:42px!important;
          padding:0 13px!important;border-radius:10px!important
        }
        .top-right>.mp-locale-controls{flex:0 0 auto!important}
        .mp-locale-controls{gap:5px;padding:3px;border-radius:10px}
        .mp-locale-control,.mp-locale-controls .currency{
          height:36px;min-width:66px;padding-left:10px!important;padding-right:27px!important;font-size:11px!important
        }
        .mp-locale-controls .currency{min-width:82px}
      }
      @media(max-width:520px){
        .top-right{grid-template-columns:none!important}
        .top-right>.cartBtn{font-size:14px!important}
        .mp-locale-control{min-width:62px}
        .mp-locale-controls .currency{min-width:78px}
      }


      /* Shop + Product only: polished compact mobile header controls. */
      @media(max-width:980px){
        body.mp-page-shop .topbar,
        body.mp-page-product .topbar{padding-bottom:10px!important}

        body.mp-page-shop .top-right{
          width:100%!important;display:grid!important;
          grid-template-columns:auto 1fr auto!important;
          align-items:center!important;gap:7px!important
        }
        body.mp-page-shop .top-right>.filtersBtn{
          grid-column:1!important;width:auto!important;min-width:44px!important;height:40px!important;
          padding:0 11px!important;border-radius:9px!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.cartBtn{
          grid-column:2!important;width:100%!important;height:40px!important;min-height:40px!important;
          padding:0 10px!important;border-radius:9px!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.toggle{
          grid-column:1 / 3!important;grid-row:2!important;width:100%!important;height:38px!important;
          min-height:38px!important;margin:0!important;padding:0 11px!important;border-radius:9px!important;
          display:flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important
        }
        body.mp-page-shop .top-right>.mp-locale-controls{
          grid-column:3!important;grid-row:1 / 3!important;align-self:stretch!important;
          display:grid!important;grid-template-columns:1fr!important;gap:5px!important;padding:3px!important
        }
        body.mp-page-shop .top-right>.mp-locale-controls .mp-locale-control,
        body.mp-page-shop .top-right>.mp-locale-controls .currency{
          height:35px!important;min-width:78px!important
        }

        body.mp-page-product .topRight{
          width:100%!important;display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:nowrap!important
        }
        body.mp-page-product .topRight>.cartBtn{
          flex:1 1 auto!important;width:auto!important;height:42px!important;min-height:42px!important;
          justify-content:center!important;padding:0 12px!important;border-radius:9px!important
        }
        body.mp-page-product .topRight>.mp-locale-controls{flex:0 0 auto!important}
        body.mp-page-product .topRight>.mp-locale-controls .mp-locale-control,
        body.mp-page-product .topRight>.mp-locale-controls .currency{height:36px!important}
      }
      @media(max-width:520px){
        body.mp-page-shop .top-right{gap:6px!important}
        body.mp-page-shop .top-right>.filtersBtn{font-size:0!important;width:42px!important;padding:0!important}
        body.mp-page-shop .top-right>.filtersBtn::before{content:"☰";font-size:16px!important}
        body.mp-page-shop .top-right>.filtersBtn .filtersBadge{font-size:10px!important;margin-left:3px!important}
        body.mp-page-shop .top-right>.mp-locale-controls .mp-locale-control,
        body.mp-page-shop .top-right>.mp-locale-controls .currency{min-width:76px!important;font-size:11px!important}
        body.mp-page-product .topRight>.mp-locale-controls .mp-locale-control{min-width:62px!important}
        body.mp-page-product .topRight>.mp-locale-controls .currency{min-width:78px!important}
      }

      /* Legal/info pages: compact back button and language selector share one row. */
      @media(max-width:980px){
        .mp-top-actions{
          width:100%!important;display:flex!important;align-items:center!important;
          justify-content:space-between!important;gap:8px!important;flex-wrap:nowrap!important
        }
        .mp-top-actions>.backBtn,
        .mp-top-actions>.btn.backBtn{
          order:1!important;width:auto!important;flex:1 1 auto!important;
          min-height:42px!important;height:42px!important;padding:0 14px!important;
          border-radius:10px!important;box-shadow:0 8px 18px rgba(34,197,94,.14)!important
        }
        .mp-top-actions>.mp-locale-controls{order:2!important;flex:0 0 auto!important}
      }
    `;
    document.head.appendChild(style);
  }

  function buildLanguageControl(){
    const language = document.createElement("select");
    language.id = "language";
    language.className = "mp-locale-control mp-language-control";
    language.title = "Language";
    language.setAttribute("aria-label", "Language");
    language.setAttribute("translate", "no");
    language.innerHTML = `
      <option value="en">EN</option>
      <option value="de">DE</option>
      <option value="ru">RU</option>
      <option value="fr">FR</option>`;
    language.value = lang;
    language.addEventListener("change", () => {
      try { localStorage.setItem(LANG_KEY, language.value); } catch (_) {}
      location.reload();
    });
    return language;
  }

  function setupControls(){
    injectStyles();
    if (document.getElementById("language")) return;

    const language = buildLanguageControl();
    const currency = document.getElementById("currency");
    const localeGroup = document.createElement("div");
    localeGroup.className = "mp-locale-controls";
    localeGroup.setAttribute("translate", "no");
    localeGroup.appendChild(language);

    if (currency && currency.parentNode) {
      currency.setAttribute("translate", "no");
      currency.setAttribute("aria-label", "Currency");
      currency.parentNode.insertBefore(localeGroup, currency);
      localeGroup.appendChild(currency);
      return;
    }

    // Informational/legal pages have no currency. Keep the language control
    // inside the real top bar instead of floating over the page.
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      const back = topbar.querySelector(".backBtn");
      if (back) {
        const actions = document.createElement("div");
        actions.className = "mp-top-actions";
        topbar.insertBefore(actions, back);
        actions.appendChild(localeGroup);
        actions.appendChild(back);
      } else {
        const right = topbar.querySelector(".top-right,.topRight");
        if (right) right.appendChild(localeGroup);
        else topbar.appendChild(localeGroup);
      }
      return;
    }

    localeGroup.classList.add("mp-floating-language");
    document.body.appendChild(localeGroup);
  }

  const dict = TEXT[lang] || {};

  function translatePlainText(text){
    if (lang === "en") return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    if (dict[trimmed]) return text.replace(trimmed, dict[trimmed]);

    let m = trimmed.match(/^In stock:\s*(\d+)$/i);
    if (m) {
      const base = lang === "de" ? "Auf Lager" : lang === "ru" ? "В наличии" : "En stock";
      return text.replace(trimmed, `${base}: ${m[1]}`);
    }
    m = trimmed.match(/^(\d+)\s+items?$/i);
    if (m) {
      const word = lang === "de" ? "Artikel" : lang === "ru" ? "товаров" : "articles";
      return text.replace(trimmed, `${m[1]} ${word}`);
    }
    return text;
  }

  function translateElement(el){
    if (!(el instanceof Element)) return;
    if (el.closest("#language") || el.matches("script,style,option")) return;

    const attrs = ["title", "placeholder", "aria-label"];
    for (const attr of attrs) {
      const v = el.getAttribute(attr);
      if (v && dict[v]) el.setAttribute(attr, dict[v]);
    }

    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const next = translatePlainText(node.nodeValue || "");
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    }
  }

  function translateTree(root=document.body){
    if (lang === "en" || !root) return;
    if (root instanceof Element) translateElement(root);
    root.querySelectorAll?.("*").forEach(translateElement);
  }

  function wireTranslations(){
    translateTree(document.body);
    if (lang === "en" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const node = mutation.target;
          const next = translatePlainText(node.nodeValue || "");
          if (next !== node.nodeValue) node.nodeValue = next;
        }
        for (const added of mutation.addedNodes || []) {
          if (added.nodeType === Node.TEXT_NODE) {
            const next = translatePlainText(added.nodeValue || "");
            if (next !== added.nodeValue) added.nodeValue = next;
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            translateTree(added);
          }
        }
      }
    });
    observer.observe(document.body, {subtree:true, childList:true, characterData:true});
  }

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const order = [
    ["Shop", "/"], ["About", "/about"], ["Shipping", "/shipping"],
    ["Returns", "/returns"], ["Reviews", "/reviews"]
  ];
  const nav = document.querySelector(".sidebar .sb-nav, .sidebar .nav, .sidebar nav");
  if (nav) {
    const links = new Map([...nav.querySelectorAll("a.nav-item")].map(a => [a.textContent.trim(), a]));
    for (const [label, href] of order) {
      const a = links.get(label);
      if (a) { a.href = href; nav.appendChild(a); }
    }
    const path = location.pathname.replace(/\.html$/, "") || "/";
    for (const a of nav.querySelectorAll("a.nav-item")) {
      const target = new URL(a.href, location.origin).pathname.replace(/\.html$/, "") || "/";
      a.classList.toggle("active", target === path || (path.startsWith("/p/") && target === "/") || (path === "/product" && target === "/"));
    }
  }

  {
    const path = location.pathname.replace(/\.html$/, "") || "/";
    if (path === "/" || path === "/index") document.body.classList.add("mp-page-shop");
    if (path === "/product" || path.startsWith("/p/")) document.body.classList.add("mp-page-product");
  }

  setupControls();
  wireTranslations();
})();
