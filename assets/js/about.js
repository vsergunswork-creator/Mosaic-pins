// ✅ footer year
  (function(){
    const y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
  })();

  const API_CONTENT  = "/api/content?key=";
  const API_CHECKOUT = "/api/checkout";

  // PayPal endpoints (как в index)
  const API_PP_CONFIG  = "/api/paypal/config";        // returns { clientId }
  const API_PP_CREATE  = "/api/paypal/create-order";  // returns { id }
  const API_PP_CAPTURE = "/api/paypal/capture";       // returns capture result

  const CART_KEY = "mp_cart";

  // persisted settings (как в index)
  const MP_CUR_KEY  = "mp_currency";
  const MP_SHIP_KEY = "mp_ship_country";

  // user override + geo cache (7 days)
  const MP_USER_SET_KEY  = "mp_user_set_ship";
  const MP_GEO_CACHE_KEY = "mp_geo_cache";

  const EU_SET = new Set([
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
    "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"
  ]);

  function isEUCountry(code){
    code = String(code||"").toUpperCase();
    return EU_SET.has(code);
  }

  function readCart(){
    try{
      const raw = localStorage.getItem(CART_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(_){ return []; }
  }
  function writeCart(arr){ localStorage.setItem(CART_KEY, JSON.stringify(arr)); }
  function cartCount(){ return readCart().reduce((s,it)=>s+(Number(it?.qty)||0),0); }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[m]));
  }

  // toast
  const elToast = document.getElementById("toast");
  const elToastTitle = document.getElementById("toastTitle");
  const elToastMsg = document.getElementById("toastMsg");
  function toast(title, msg){
    elToastTitle.textContent = title;
    elToastMsg.textContent = msg;
    elToast.classList.add("show");
    setTimeout(()=> elToast.classList.remove("show"), 2600);
  }

  // UI refs
  const elCartBadge = document.getElementById("cartBadge");
  const elOpenCart = document.getElementById("openCart");
  const elCartBack = document.getElementById("cartBack");
  const elCartDrawer = document.getElementById("cartDrawer");
  const elCloseCart = document.getElementById("closeCart");
  const elCartBody = document.getElementById("cartBody");
  const elCartTotal = document.getElementById("cartTotal");
  const elCartCheckout = document.getElementById("cartCheckout");
  const elCartClear = document.getElementById("cartClear");

  const elShipCountry = document.getElementById("shipCountry");

  // PayPal UI
  const elPpWrap = document.getElementById("ppWrap");
  const elPpNote = document.getElementById("ppNote");

  function updateCartBadge(){ if (elCartBadge) elCartBadge.textContent = String(cartCount()); }

  function getCurrency(){
    const saved = (localStorage.getItem(MP_CUR_KEY) || "").toUpperCase();
    if (saved === "EUR" || saved === "USD") return saved;
    return "USD";
  }
  function setCurrency(cur){
    cur = String(cur || "USD").toUpperCase();
    if (cur !== "EUR" && cur !== "USD") cur = "USD";
    try{ localStorage.setItem(MP_CUR_KEY, cur); }catch(_){}
  }

  // hard rule: US/CA => USD, DE/EU => EUR
  function enforceCurrencyByShipping(){
    const ship = String(elShipCountry?.value || "US").toUpperCase();
    const must = (ship === "US" || ship === "CA") ? "USD" : "EUR";
    if (getCurrency() !== must) setCurrency(must);
  }

  function setShipValue(v){
    v = String(v || "US").toUpperCase();
    if (!["DE","EU","US","CA"].includes(v)) v = "US";
    if (elShipCountry) elShipCountry.value = v;
    try{ localStorage.setItem(MP_SHIP_KEY, v); }catch(_){}
    enforceCurrencyByShipping();
    setCurrency(getCurrency());
  }

  function userHasSetShipping(){
    try{ return localStorage.getItem(MP_USER_SET_KEY) === "1"; }catch(_){ return false; }
  }

  function cacheGetShip(){
    try{
      const raw = localStorage.getItem(MP_GEO_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.ship || !obj.ts) return null;

      const ts = Number(obj.ts);
      if (!Number.isFinite(ts)) return null;

      const age = Date.now() - ts;
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      if (age > maxAge) return null;

      const ship = String(obj.ship || "").toUpperCase();
      if (!["DE","EU","US","CA"].includes(ship)) return null;

      return ship;
    }catch(_){ return null; }
  }

  function cacheSetShip(ship){
    try{ localStorage.setItem(MP_GEO_CACHE_KEY, JSON.stringify({ ts: Date.now(), ship })); }catch(_){}
  }

  async function detectShipByIP(){
    try{
      const r = await fetch("https://ipwho.is/?fields=success,country_code", { cache: "no-store" });
      const j = await r.json().catch(()=>null);
      if (!j || j.success !== true) return null;

      const cc = String(j.country_code || "").toUpperCase();
      if (!cc) return null;

      if (cc === "DE") return "DE";
      if (cc === "US") return "US";
      if (cc === "CA") return "CA";
      if (isEUCountry(cc)) return "EU";
      return "US";
    }catch(_){ return null; }
  }

  // restore persisted shipping/currency (как в index)
  (function restoreSettings(){
    try{
      if (!localStorage.getItem(MP_SHIP_KEY)) localStorage.setItem(MP_SHIP_KEY, "US");
      if (!localStorage.getItem(MP_CUR_KEY))  localStorage.setItem(MP_CUR_KEY, "USD");

      const savedShip = (localStorage.getItem(MP_SHIP_KEY) || "US").toUpperCase();
      if (savedShip && ["DE","EU","US","CA"].includes(savedShip) && elShipCountry){
        elShipCountry.value = savedShip;
      }

      const savedCur = (localStorage.getItem(MP_CUR_KEY) || "USD").toUpperCase();
      if (savedCur && (savedCur === "EUR" || savedCur === "USD")){
        localStorage.setItem(MP_CUR_KEY, savedCur);
      }

      enforceCurrencyByShipping();
      setCurrency(getCurrency());
    }catch(_){}
  })();

  // auto detect shipping once (как в index)
  (async function autoDetectShippingOnce(){
    try{
      if (userHasSetShipping()) return;

      const cached = cacheGetShip();
      if (cached){ setShipValue(cached); return; }

      const detected = await detectShipByIP();
      if (!detected) return;

      setShipValue(detected);
      cacheSetShip(detected);
    }catch(_){}
  })();

  // UI selection -> ISO2 for API
  function getShippingCountryISO2(){
    const v = String(elShipCountry?.value || "US").toUpperCase();
    if (v === "US") return "US";
    if (v === "CA") return "CA";
    if (v === "EU") return "FR"; // EU bucket
    return "DE";
  }

  if (elShipCountry){
    elShipCountry.addEventListener("change", () => {
      try{
        localStorage.setItem(MP_SHIP_KEY, String(elShipCountry.value || "US").toUpperCase());
        localStorage.setItem(MP_USER_SET_KEY, "1");
      }catch(_){}
      enforceCurrencyByShipping();
      setCurrency(getCurrency());
      cacheSetShip(String(elShipCountry.value || "US").toUpperCase());

      // shipping может сменить валюту → PayPal переинициализируем
      resetPayPalHard();

      renderCart();
      toast("Shipping", `Destination: ${elShipCountry.value}`);
    });
  }

  // cart drawer
  function openCart(){
    elCartBack?.classList.add("show");
    elCartDrawer?.classList.add("show");
    document.body.style.overflow = "hidden";
    renderCart();
    maybeInitPayPal();
  }
  function closeCart(){
    elCartBack?.classList.remove("show");
    elCartDrawer?.classList.remove("show");
    document.body.style.overflow = "";
  }

  elOpenCart?.addEventListener("click", openCart);
  elCloseCart?.addEventListener("click", closeCart);
  elCartBack?.addEventListener("click", closeCart);

  // ✅ Escape closes cart only if cart is open AND lightbox is NOT open
  window.addEventListener("keydown", (e)=>{
    if (e.key !== "Escape") return;
    const lbOpen = document.getElementById("lightbox")?.classList.contains("show");
    const cartOpen = elCartDrawer?.classList.contains("show");
    if (cartOpen && !lbOpen) closeCart();
  });

  // =========================
  // PayPal integration (ONLY PayPal button, disable cards+sepa)
  // =========================
  let ppReady = false;
  let ppLoading = false;
  let ppRenderedForKey = "";

  /* ✅ FIX race: keep instance + global render sequence */
  let ppButtons = null;
  let ppRenderSeq = 0;

  function cartSnapshotKey(){
    const cart = readCart();
    const cur = getCurrency();
    const ship = String(elShipCountry?.value || "US").toUpperCase();
    const itemsKey = cart.map(it => `${String(it.pin)}:${Number(it.qty)||1}`).sort().join("|");
    return `${cur}|${ship}|${itemsKey}`;
  }

  function showPayPalNote(msg){
    if (!elPpNote) return;
    elPpNote.textContent = String(msg || "");
    elPpNote.style.display = msg ? "block" : "none";
  }

  async function fetchPayPalClientId(){
    const r = await fetch(API_PP_CONFIG, { method:"GET", cache:"no-store" });
    const j = await r.json().catch(()=>null);
    if (!r.ok || !j?.clientId) throw new Error(j?.error || "PayPal config error");
    return String(j.clientId);
  }

  function safeClose(btns){
    try{
      if (btns && typeof btns.close === "function") btns.close();
    }catch(_){}
  }

  function clearPayPalButtons(){
    // ✅ FIX: close old instance before wiping DOM
    safeClose(ppButtons);
    ppButtons = null;

    const wrap = document.getElementById("paypal-button-container");
    if (wrap) wrap.innerHTML = "";
  }

  // HARD reset: remove SDK script + window.paypal (important for currency changes)
  function resetPayPalHard(){
    ppReady = false;
    ppLoading = false;
    ppRenderedForKey = "";

    // bump seq to cancel any pending render microtasks
    ppRenderSeq++;

    try{ clearPayPalButtons(); }catch(_){}
    try{ showPayPalNote(""); }catch(_){}

    try{
      const old = document.getElementById("pp-sdk");
      if (old && old.parentNode){
        old.parentNode.removeChild(old);
      }
    }catch(_){}

    try{ delete window.paypal; }catch(_){}
    try{ window.paypal = undefined; }catch(_){}

    // recreate placeholder
    try{
      const s = document.createElement("script");
      s.id = "pp-sdk";
      s.setAttribute("data-loaded","0");
      document.body.appendChild(s);
    }catch(_){}
  }

  function loadPayPalSDK(clientId){
    return new Promise((resolve, reject) => {
      try{
        if (window.paypal && typeof window.paypal.Buttons === "function"){
          resolve(true);
          return;
        }

        const s = document.getElementById("pp-sdk");
        if (!s) throw new Error("pp-sdk tag missing");

        const cur = getCurrency();

        const url =
          "https://www.paypal.com/sdk/js" +
          `?client-id=${encodeURIComponent(clientId)}` +
          `&currency=${encodeURIComponent(cur)}` +
          `&intent=capture` +
          `&components=buttons` +
          `&disable-funding=card,sepa,ideal,bancontact,sofort,giropay,eps,mybank,p24,venmo`;

        if (s.src && s.src === url){
          const t0 = Date.now();
          const tick = () => {
            if (window.paypal && typeof window.paypal.Buttons === "function") return resolve(true);
            if (Date.now() - t0 > 12000) return reject(new Error("PayPal SDK timeout"));
            setTimeout(tick, 120);
          };
          tick();
          return;
        }

        if (s.src && s.src !== url){
          resetPayPalHard();
          return loadPayPalSDK(clientId).then(resolve).catch(reject);
        }

        s.onload = () => resolve(true);
        s.onerror = () => reject(new Error("PayPal SDK failed to load"));
        s.src = url;
        s.setAttribute("data-loaded","1");
      }catch(e){
        reject(e);
      }
    });
  }

  async function maybeInitPayPal(){
    try{
      const cart = readCart();
      if (!cart.length){
        if (elPpWrap) elPpWrap.style.display = "none";
        return;
      }
      if (elPpWrap) elPpWrap.style.display = "flex";

      enforceCurrencyByShipping();
      setCurrency(getCurrency());

      if (ppReady){
        renderPayPalButtonsIfNeeded();
        return;
      }
      if (ppLoading) return;

      ppLoading = true;
      showPayPalNote("PayPal is loading…");

      const clientId = await fetchPayPalClientId();
      await loadPayPalSDK(clientId);

      ppReady = true;
      ppLoading = false;

      showPayPalNote("");
      renderPayPalButtonsIfNeeded();
    }catch(e){
      ppLoading = false;
      ppReady = false;
      showPayPalNote(`PayPal unavailable: ${String(e?.message || e)}`);
    }
  }

  function renderPayPalButtonsIfNeeded(){
    if (!ppReady) return;
    if (!window.paypal || typeof window.paypal.Buttons !== "function") return;

    const cart = readCart();
    if (!cart.length){
      clearPayPalButtons();
      ppRenderedForKey = "";
      return;
    }

    const key = cartSnapshotKey();
    if (key === ppRenderedForKey) return;

    ppRenderedForKey = key;

    /* ✅ FIX race: seq + close + render in microtask */
    const mySeq = ++ppRenderSeq;

    safeClose(ppButtons);
    ppButtons = null;

    Promise.resolve().then(() => {
      if (mySeq !== ppRenderSeq) return;

      const cartNow = readCart();
      if (!cartNow.length){
        clearPayPalButtons();
        ppRenderedForKey = "";
        return;
      }

      const wrap = document.getElementById("paypal-button-container");
      if (!wrap) return;
      wrap.innerHTML = "";

      ppButtons = window.paypal.Buttons({
        style: { layout:"vertical", shape:"rect", label:"paypal", height: 44 },

        createOrder: async () => {
          const cartNow2 = readCart();
          if (!cartNow2.length) throw new Error("Cart is empty");

          enforceCurrencyByShipping();
          setCurrency(getCurrency());

          const payload = {
            currency: getCurrency(),
            shippingCountry: getShippingCountryISO2(),
            items: cartNow2.map(it => ({ pin: String(it.pin), qty: Number(it.qty) || 1 })),
          };

          const r = await fetch(API_PP_CREATE, {
            method: "POST",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify(payload),
          });

          const data = await r.json().catch(()=>({}));
          if (!r.ok || !data?.id) throw new Error(data?.error || "PayPal create order failed");
          return data.id;
        },

        onApprove: async (data) => {
          try{
            const orderID = data?.orderID;
            if (!orderID) throw new Error("Missing orderID");

            const r = await fetch(API_PP_CAPTURE, {
              method: "POST",
              headers: { "Content-Type":"application/json" },
              body: JSON.stringify({ orderID }),
            });

            const j = await r.json().catch(()=>({}));
            if (!r.ok || !j?.ok) throw new Error(j?.error || "Capture failed");

            writeCart([]);
            updateCartBadge();
            renderCart();
            toast("PayPal", "Payment success ✅");
          }catch(e){
            toast("PayPal", String(e?.message || e));
          }
        },

        onCancel: () => toast("PayPal", "Canceled"),
        onError: (err) => toast("PayPal", String(err?.message || err || "PayPal error")),
      });

      try{
        ppButtons.render("#paypal-button-container");
      }catch(_){}
    });
  }

  // ==========================
  // Cart logic (Stripe + PayPal) - same behavior as index
  // ==========================
  function setCartQty(pin, qty){
    const cart = readCart();
    const idx = cart.findIndex(x => String(x.pin) === String(pin));
    if (idx < 0) return;

    const stock = Number(cart[idx].stock ?? 0);
    qty = Number(qty);
    if (!Number.isFinite(qty)) qty = 1;
    qty = Math.max(1, qty);
    if (stock > 0) qty = Math.min(stock, qty);

    cart[idx].qty = qty;
    writeCart(cart);
    updateCartBadge();
    renderCart();

    ppRenderedForKey = "";
    renderPayPalButtonsIfNeeded();
  }

  function removeFromCart(pin){
    const cart = readCart().filter(x => String(x.pin) !== String(pin));
    writeCart(cart);
    updateCartBadge();
    renderCart();

    ppRenderedForKey = "";
    renderPayPalButtonsIfNeeded();
  }

  function clearCart(){
    writeCart([]);
    updateCartBadge();
    renderCart();

    ppRenderedForKey = "";
    renderPayPalButtonsIfNeeded();
  }

  function cartTotal(){
    const cur = getCurrency();
    const cart = readCart();
    let sum = 0;
    for (const it of cart){
      const unit = Number(it?.price?.[cur]);
      if (Number.isFinite(unit)) sum += unit * (Number(it?.qty)||0);
    }
    return sum;
  }

  function renderCart(){
    if (!elCartBody || !elCartTotal || !elCartCheckout) return;

    const cart = readCart();

    // show/hide PayPal "button"
    if (elPpWrap) elPpWrap.style.display = cart.length ? "flex" : "none";

    // enable/disable action buttons
    if (elCartCheckout) elCartCheckout.disabled = !cart.length;
    if (elCartClear) elCartClear.disabled = !cart.length;

    if (!cart.length){
      elCartBody.innerHTML = `<div class="cartEmpty">Your cart is empty.</div>`;
      elCartTotal.textContent = "—";

      clearPayPalButtons();
      ppRenderedForKey = "";
      return;
    }

    const cur = getCurrency();

    elCartBody.innerHTML = cart.map(it => {
      const img = it.image
        ? `<img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.title)}" />`
        : `<span>—</span>`;

      const unit = it?.price?.[cur];
      const unitText = (typeof unit === "number")
        ? (cur==="EUR" ? `${unit.toFixed(2)} €` : `${unit.toFixed(2)} $`)
        : "—";

      return `
        <div class="cartItem" data-pin="${escapeHtml(String(it.pin || ""))}">
          <div class="cartImg">${img}</div>
          <div>
            <p class="cartName">${escapeHtml(it.title || it.pin)}</p>
            <div class="cartMeta">${escapeHtml(it.pin)} • ${unitText}</div>
            <div class="cartRow">
              <div class="cartQty">
                <button type="button" data-act="minus">−</button>
                <input value="${escapeHtml(String(it.qty || 1))}" inputmode="numeric" />
                <button type="button" data-act="plus">+</button>
              </div>
              <button class="cartRemove" type="button" data-act="remove">✕</button>
            </div>
            <div class="cartMeta" style="margin-top:8px;">Stock: ${escapeHtml(it.stock ?? "—")}</div>
          </div>
        </div>
      `;
    }).join("");

    [...elCartBody.querySelectorAll(".cartItem")].forEach(row => {
      const pin = row.getAttribute("data-pin");
      const input = row.querySelector("input");

      row.querySelector('button[data-act="minus"]')?.addEventListener("click", () => setCartQty(pin, Number(input.value) - 1));
      row.querySelector('button[data-act="plus"]')?.addEventListener("click",  () => setCartQty(pin, Number(input.value) + 1));

      input?.addEventListener("input", () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        setCartQty(pin, v);
      });

      row.querySelector('button[data-act="remove"]')?.addEventListener("click", () => removeFromCart(pin));
    });

    const sum = cartTotal();
    elCartTotal.textContent = (cur==="EUR") ? `${sum.toFixed(2)} €` : `${sum.toFixed(2)} $`;

    // init/render PayPal when cart visible
    maybeInitPayPal();
    renderPayPalButtonsIfNeeded();
  }

  elCartClear?.addEventListener("click", () => { clearCart(); toast("Cart", "Cleared"); });

  // Stripe checkout
  async function startCheckout(){
    const cart = readCart();
    if (!cart.length) { toast("Checkout", "Cart is empty"); return; }

    enforceCurrencyByShipping();
    setCurrency(getCurrency());

    try{ localStorage.setItem(MP_SHIP_KEY, String(elShipCountry?.value || "US").toUpperCase()); }catch(_){}

    const payload = {
      currency: getCurrency(),
      shippingCountry: getShippingCountryISO2(),
      items: cart.map(it => ({ pin: String(it.pin), qty: Number(it.qty) || 1 })),
    };

    if (elCartCheckout){
      elCartCheckout.disabled = true;
      elCartCheckout.textContent = "Redirecting…";
    }

    try{
      const r = await fetch(API_CHECKOUT, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(()=>({}));
      if (!r.ok || !data?.ok || !data?.url){
        throw new Error(data?.error || "Checkout failed");
      }

      window.location.href = data.url;
    }catch(e){
      toast("Checkout", String(e?.message || e));
      if (elCartCheckout){
        elCartCheckout.disabled = false;
        elCartCheckout.textContent = "Checkout";
      }
    }finally{
      if (elCartCheckout && !elCartCheckout.disabled) elCartCheckout.textContent = "Checkout";
    }
  }
  elCartCheckout?.addEventListener("click", startCheckout);

  // initial cart state
  updateCartBadge();
  renderCart();

  // enforce currency on first load too
  enforceCurrencyByShipping();
  setCurrency(getCurrency());

  // ==========================
  // Airtable content load (original)
  // ==========================
  const hero = document.getElementById("hero");
  const heroImg = document.getElementById("heroImg");
  const heroTitle = document.getElementById("heroTitle");
  const heroSubtitle = document.getElementById("heroSubtitle");
  const aboutBody = document.getElementById("aboutBody");
  const topTitle = document.getElementById("topTitle");
  const topSub = document.getElementById("topSub");

  const track = document.getElementById("track");
  const dots = document.getElementById("dots");
  const galHint = document.getElementById("galHint");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const viewport = document.getElementById("viewport");

  // Lightbox refs
  const lbBack = document.getElementById("lightboxBack");
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbClose = document.getElementById("lbClose");
  const lbPrev = document.getElementById("lbPrev");
  const lbNext = document.getElementById("lbNext");
  const lbCounter = document.getElementById("lbCounter");

  let gallery = [];
  let index = 0;
  let stepPx = 0;

  function setHeroBg(url){
    if (!url) return;
    heroImg.style.backgroundImage = `url("${url}")`;
  }

  async function fetchContent(key){
    const r = await fetch(API_CONTENT + encodeURIComponent(key), { cache:"no-store" });
    const data = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(data?.error || "Content load failed");
    return data?.content || null;
  }

  async function loadAbout(){
    try{
      let c = await fetchContent("about").catch(()=>null);
      if (!c) c = await fetchContent("About");
      if (!c) throw new Error("Not found");

      topTitle.textContent = "About";
      topSub.textContent = c.heroTitle ? c.heroTitle : "Mosaic Pins Space";

      heroTitle.textContent = c.heroTitle || "Mosaic Pins Space";
      heroSubtitle.textContent = c.heroSubtitle || "";
      aboutBody.textContent = c.aboutBody || "";

      setHeroBg(c.heroImage);

      if (window.matchMedia("(max-width: 980px)").matches) {
        const w = Number(c.heroImageWidth || 0);
        const h = Number(c.heroImageHeight || 0);
        hero.style.aspectRatio = (w > 0 && h > 0) ? `${w} / ${h}` : "16 / 7";
      }

      gallery = Array.isArray(c.gallery) ? c.gallery.filter(Boolean) : [];
      galHint.textContent = gallery.length ? `${gallery.length} photos` : "No photos";

      buildCarousel();
    }catch(e){
      heroSubtitle.textContent = "Failed to load content.";
      aboutBody.textContent = "Please check /api/content?key=about and Airtable permissions.";
      toast("About", String(e?.message || e));
    }
  }

  function buildCarousel(){
    track.innerHTML = "";
    dots.innerHTML = "";
    index = Math.min(index, Math.max(0, gallery.length - 1));

    if (!gallery.length){
      track.innerHTML = `<div style="color:var(--muted); padding:10px;">No gallery images.</div>`;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    gallery.forEach((url, i) => {
      const div = document.createElement("div");
      div.className = "slide";
      div.setAttribute("data-i", String(i));
      div.innerHTML = `<img src="${url}" alt="Gallery ${i+1}" loading="lazy" />`;
      div.addEventListener("click", () => openLightbox(i));
      track.appendChild(div);

      const d = document.createElement("button");
      d.type = "button";
      d.className = "dotBtn";
      d.setAttribute("aria-label", `Go to ${i+1}`);
      d.addEventListener("click", (e) => { e.stopPropagation(); goTo(i); });
      dots.appendChild(d);
    });

    measureStep();
    applyCarousel();
    updateBtns();
    updateDots();
    updateCenterClass();
  }

  function measureStep(){
    const first = track.querySelector(".slide");
    if (!first) return;
    const slideW = first.getBoundingClientRect().width;
    const styles = getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap || "14") || 14;
    stepPx = slideW + gap;
  }

  function applyCarousel(){
    if (!gallery.length) return;
    const offset = Math.max(0, index - 1) * stepPx;
    track.style.transform = `translateX(${-offset}px)`;
    updateCenterClass();
    updateDots();
    updateBtns();
  }

  function updateCenterClass(){
    const slides = [...track.querySelectorAll(".slide")];
    slides.forEach(s => s.classList.remove("is-center"));
    const center = slides[index];
    if (center) center.classList.add("is-center");
  }

  function updateDots(){
    const ds = [...dots.querySelectorAll(".dotBtn")];
    ds.forEach((d,i)=> d.classList.toggle("active", i === index));
  }

  function updateBtns(){
    prevBtn.disabled = (index <= 0);
    nextBtn.disabled = (index >= gallery.length - 1);
  }

  function goTo(i){
    index = Math.max(0, Math.min(gallery.length - 1, i));
    applyCarousel();
  }
  function prev(){ goTo(index - 1); }
  function next(){ goTo(index + 1); }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  (function enableSwipe(){
    let startX = 0;
    let dx = 0;
    let dragging = false;

    viewport.addEventListener("touchstart", (e)=>{
      if (!e.touches?.length) return;
      dragging = true;
      startX = e.touches[0].clientX;
      dx = 0;
    }, {passive:true});

    viewport.addEventListener("touchmove", (e)=>{
      if (!dragging || !e.touches?.length) return;
      dx = e.touches[0].clientX - startX;
    }, {passive:true});

    viewport.addEventListener("touchend", ()=>{
      if (!dragging) return;
      dragging = false;
      if (Math.abs(dx) < 30) return;
      if (dx > 0) prev(); else next();
    }, {passive:true});
  })();

  function openLightbox(i){
    if (!gallery.length) return;
    index = Math.max(0, Math.min(gallery.length - 1, Number(i)||0));
    applyCarousel();
    renderLightbox();
    lbBack.classList.add("show");
    lb.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox(){
    lbBack.classList.remove("show");
    lb.classList.remove("show");
    document.body.style.overflow = "";
  }

  function renderLightbox(){
    const url = gallery[index];
    if (url) lbImg.src = url;
    lbCounter.textContent = gallery.length ? `${index + 1} / ${gallery.length}` : "—";
    lbPrev.disabled = (index <= 0);
    lbNext.disabled = (index >= gallery.length - 1);
  }

  function lbPrevFn(){
    if (index <= 0) return;
    index--;
    applyCarousel();
    renderLightbox();
  }
  function lbNextFn(){
    if (index >= gallery.length - 1) return;
    index++;
    applyCarousel();
    renderLightbox();
  }

  lbClose.addEventListener("click", closeLightbox);
  lbBack.addEventListener("click", closeLightbox);
  lbPrev.addEventListener("click", lbPrevFn);
  lbNext.addEventListener("click", lbNextFn);

  window.addEventListener("keydown", (e)=>{
    if (lb.classList.contains("show")){
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lbPrevFn();
      if (e.key === "ArrowRight") lbNextFn();
    } else {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
  });

  window.addEventListener("resize", ()=>{
    measureStep();
    applyCarousel();

    if (window.matchMedia("(max-width: 980px)").matches) {
      if (!hero.style.aspectRatio) hero.style.aspectRatio = "16 / 7";
    } else {
      hero.style.aspectRatio = "";
    }
  });

  // ✅ Active state for LEFT sidebar ONLY (privacy/impressum removed from sidebar)
  (function navActive(){
    const path = (window.location.pathname || "/").toLowerCase();

    const idsDesktop = ["navShop","navAbout","navShipping","navReturns","navReviews"];
    idsDesktop.forEach(id => document.getElementById(id)?.classList.remove("active"));

    const set = (id) => document.getElementById(id)?.classList.add("active");

    if (path.startsWith("/shipping")) { set("navShipping"); }
    else if (path.startsWith("/returns")) { set("navReturns"); }
    else if (path.startsWith("/reviews")) { set("navReviews"); }
    else if (path.startsWith("/about")) { set("navAbout"); }
    else { set("navShop"); }
  })();

  // init
  loadAbout();

  // init (как было у Вас)
  updateCartBadge();
  renderCart();
  loadAbout();
