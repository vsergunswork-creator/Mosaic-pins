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
      .mp-locale-controls{display:flex;align-items:center;gap:7px;flex:0 0 auto}
      .mp-locale-control{height:38px;min-width:78px;border:1px solid rgba(255,255,255,.13);border-radius:10px;background:rgba(12,17,24,.78);color:var(--text,#eef2f7);padding:0 30px 0 11px;font:800 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.15px;outline:none;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 5px 16px rgba(0,0,0,.12);transition:border-color .15s ease,background .15s ease,box-shadow .15s ease;appearance:auto;color-scheme:dark}
      .mp-locale-control:hover,.mp-locale-control:focus{border-color:rgba(34,197,94,.62);background:rgba(16,24,32,.94);box-shadow:0 0 0 2px rgba(34,197,94,.08)}
      .mp-language-control{min-width:72px}
      .mp-locale-controls .currency{height:38px;min-width:82px;border-radius:10px!important;padding:0 26px 0 11px!important;background:rgba(12,17,24,.78)!important;border:1px solid rgba(255,255,255,.13)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 5px 16px rgba(0,0,0,.12)!important;font-weight:800!important;font-size:12px!important;color:var(--text,#eef2f7)!important;color-scheme:dark}
      .mp-locale-controls .currency:hover,.mp-locale-controls .currency:focus{border-color:rgba(34,197,94,.62)!important;background:rgba(16,24,32,.94)!important;box-shadow:0 0 0 2px rgba(34,197,94,.08)!important}
      .mp-floating-language{position:fixed;right:18px;top:16px;z-index:9999;padding:5px;border-radius:13px;background:rgba(8,12,18,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08)}
      @media(max-width:700px){.mp-locale-controls{gap:6px}.mp-locale-control,.mp-locale-controls .currency{height:36px;min-width:68px;font-size:11px}.mp-floating-language{right:10px;top:10px}}
    `;
    document.head.appendChild(style);
  }

  function setupControls(){
    injectStyles();
    if (document.getElementById("language")) return;

    const language = document.createElement("select");
    language.id = "language";
    language.className = "mp-locale-control mp-language-control";
    language.title = "Language";
    language.setAttribute("aria-label", "Language");
    language.setAttribute("translate", "no");
    language.innerHTML = `
      <option value="en">🌐 EN</option>
      <option value="de">🌐 DE</option>
      <option value="ru">🌐 RU</option>
      <option value="fr">🌐 FR</option>`;
    language.value = lang;
    language.addEventListener("change", () => {
      try { localStorage.setItem(LANG_KEY, language.value); } catch (_) {}
      location.reload();
    });

    const currency = document.getElementById("currency");
    if (currency && currency.parentNode) {
      const group = document.createElement("div");
      group.className = "mp-locale-controls";
      currency.parentNode.insertBefore(group, currency);
      group.appendChild(language);
      group.appendChild(currency);
      currency.setAttribute("translate", "no");
    } else {
      const group = document.createElement("div");
      group.className = "mp-locale-controls mp-floating-language";
      group.appendChild(language);
      document.body.appendChild(group);
    }
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

  setupControls();
  wireTranslations();
})();
