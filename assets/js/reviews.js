// ✅ footer year
  (function(){
    const y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
  })();

  const API_REVIEWS  = "/api/reviews";
  const API_CHECKOUT = "/api/checkout";

  // PayPal endpoints (EXACT as About)
  const API_PP_CONFIG  = "/api/paypal/config";        // returns { clientId }
  const API_PP_CREATE  = "/api/paypal/create-order";  // returns { id }
  const API_PP_CAPTURE = "/api/paypal/capture";       // returns { ok }

  const CART_KEY = "mp_cart";

  // persisted settings (EXACT as About)
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

  // toast (same as About)
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
  function enforceCurrencyByShipping(){ return getCurrency(); }

  function setShipValue(v){
      v = String(v || "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(v)) return;
      if (elShipCountry) elShipCountry.value = v;
      try{ localStorage.setItem(MP_SHIP_KEY, v); }catch(_){}
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
      if (!/^[A-Z]{2}$/.test(ship)) return null;

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

      if (/^[A-Z]{2}$/.test(cc)) return cc;
        return null;
    }catch(_){ return null; }
  }

  // restore persisted shipping/currency (как в About)
  (function restoreSettings(){
    try{
            if (!localStorage.getItem(MP_CUR_KEY))  localStorage.setItem(MP_CUR_KEY, "USD");

      const savedShip = (localStorage.getItem(MP_SHIP_KEY) || "").toUpperCase();
      if (savedShip && /^[A-Z]{2}$/.test(savedShip) && elShipCountry){
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

  // auto detect shipping once (как в About)
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

  // UI selection -> ISO2 for API (same as About)
  function getShippingCountryISO2(){
      const v = String(elShipCountry?.value || "").trim().toUpperCase();
      return /^[A-Z]{2}$/.test(v) ? v : "";
    }

  if (elShipCountry){
    elShipCountry.addEventListener("change", () => {
      try{
        localStorage.setItem(MP_SHIP_KEY, String(elShipCountry.value || "").toUpperCase());
        localStorage.setItem(MP_USER_SET_KEY, "1");
      }catch(_){}
      enforceCurrencyByShipping();
      setCurrency(getCurrency());
      cacheSetShip(String(elShipCountry.value || "").toUpperCase());

      // shipping может сменить валюту → PayPal переинициализируем
      resetPayPalHard();

      renderCart();
      toast("Shipping", `Destination: ${elShipCountry.value}`);
    });
  }

  // cart drawer (same as About)
  function openCart(){
    elCartBack?.classList.add("show");
    elCartDrawer?.classList.add("show");
    document.body.style.overflow = "hidden";
    renderCart();
    maybeInitPayPal();
  }

  function closeCart(){
    // ✅ PayPal race fix: invalidate pending renders + close instance
    ppIsClosing = true;
    ppRenderSeq++;
    clearPayPalButtons();

    elCartBack?.classList.remove("show");
    elCartDrawer?.classList.remove("show");
    document.body.style.overflow = "";

    setTimeout(()=>{ ppIsClosing = false; }, 80);
  }

  elOpenCart?.addEventListener("click", openCart);
  elCloseCart?.addEventListener("click", closeCart);
  elCartBack?.addEventListener("click", closeCart);

  // ✅ Escape closes cart only if cart is open AND lightbox is NOT open (same logic)
  window.addEventListener("keydown", (e)=>{
    if (e.key !== "Escape") return;
    const lbOpen = document.getElementById("lightbox")?.classList.contains("show");
    const cartOpen = elCartDrawer?.classList.contains("show");
    if (cartOpen && !lbOpen) closeCart();
  });

  // =========================
  // PayPal integration (EXACT from About) + ✅ race fix
  // =========================
  let ppReady = false;
  let ppLoading = false;
  let ppRenderedForKey = "";

  // ✅ race-fix state
  let ppRenderSeq = 0;
  let ppIsClosing = false;

  function cartSnapshotKey(){
    const cart = readCart();
    const cur = getCurrency();
    const ship = String(elShipCountry?.value || "").toUpperCase();
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

  function clearPayPalButtons(){
    // ✅ close previous Buttons instance if exists
    try{
      if (window.__ppButtons && typeof window.__ppButtons.close === "function"){
        window.__ppButtons.close();
      }
    }catch(_){}
    try{ window.__ppButtons = null; }catch(_){}

    const wrap = document.getElementById("paypal-button-container");
    if (wrap) wrap.innerHTML = "";
  }

  // HARD reset: remove SDK script + window.paypal (important for currency changes)
  function resetPayPalHard(){
    ppReady = false;
    ppLoading = false;
    ppRenderedForKey = "";

    // ✅ invalidate renders + close instance
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
      if (ppIsClosing) return; // ✅ don't init while closing

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
    if (ppIsClosing) return;
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

    // ✅ sequence: invalidate stale renders
    const mySeq = ++ppRenderSeq;

    clearPayPalButtons();
    ppRenderedForKey = key;

    const instance = window.paypal.Buttons({
      style: { layout:"vertical", shape:"rect", label:"paypal", height: 44 },

      createOrder: async () => {
        const cartNow = readCart();
        if (!cartNow.length) throw new Error("Cart is empty");

        enforceCurrencyByShipping();
        setCurrency(getCurrency());

        const shippingCountry = getShippingCountryISO2();
        if (!shippingCountry || !window.MPShipping?.isReady?.()) {
          throw new Error("Please select a shipping country and wait for the DHL rate.");
        }

        const payload = {
          currency: getCurrency(),
          shippingCountry,
          items: cartNow.map(it => ({ pin: String(it.pin), qty: Number(it.qty) || 1 })),
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

    // ✅ store instance for close()
    try{ window.__ppButtons = instance; }catch(_){}

    instance.render("#paypal-button-container").then(() => {
      // ✅ if a newer render started or we're closing — close this one
      if (ppIsClosing || mySeq !== ppRenderSeq){
        try{ instance.close(); }catch(_){}
      }
    }).catch((e) => {
      if (!ppIsClosing) showPayPalNote(String(e?.message || e));
    });
  }

// ==========================
  // Cart logic (Stripe + PayPal) - EXACT from About
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
      document.getElementById("cartSubtotal") && (document.getElementById("cartSubtotal").textContent = "—");
        document.getElementById("cartShipping") && (document.getElementById("cartShipping").textContent = "—");
        elCartTotal.textContent = "—";
        window.MPShipping?.refresh(0, getCurrency());

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
    const subEl = document.getElementById("cartSubtotal");
      if (subEl) subEl.textContent = (cur==="EUR") ? `${sum.toFixed(2)} €` : `$${sum.toFixed(2)}`;
      window.MPShipping?.refresh(sum, cur);

    // init/render PayPal when cart visible
    maybeInitPayPal();
    renderPayPalButtonsIfNeeded();
  }

  elCartClear?.addEventListener("click", () => { clearCart(); toast("Cart", "Cleared"); });

  // Stripe checkout (same as About)
  async function startCheckout(){
    const cart = readCart();
    if (!cart.length) { toast("Checkout", "Cart is empty"); return; }

    enforceCurrencyByShipping();
    setCurrency(getCurrency());

    try{ localStorage.setItem(MP_SHIP_KEY, String(elShipCountry?.value || "").toUpperCase()); }catch(_){}

    const shippingCountry = getShippingCountryISO2();
    if (!shippingCountry || !window.MPShipping?.isReady?.()) {
      toast("Shipping", "Please select a shipping country and wait for the DHL rate.");
      return;
    }

    const payload = {
      currency: getCurrency(),
      shippingCountry,
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
  // ✅ Lightbox for review photos
  // ==========================
  const lbBack = document.getElementById("lightboxBack");
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbVideo = document.getElementById("lbVideo");
  const lbClose = document.getElementById("lbClose");
  const lbCounter = document.getElementById("lbCounter");

  function openPhoto(url){
    if (!url) return;
    if (lbVideo){ lbVideo.pause(); lbVideo.removeAttribute("src"); lbVideo.load(); lbVideo.style.display = "none"; }
    lbImg.style.display = "block";
    lbImg.src = url;
    lbCounter.textContent = "Photo";
    lbBack.classList.add("show");
    lb.classList.add("show");
    document.body.style.overflow = "hidden";
  }
  function openVideo(url){
    if (!url || !lbVideo) return;
    lbImg.removeAttribute("src");
    lbImg.style.display = "none";
    lbVideo.src = url;
    lbVideo.style.display = "block";
    lbCounter.textContent = "Video";
    lbBack.classList.add("show");
    lb.classList.add("show");
    document.body.style.overflow = "hidden";
  }
  function closePhoto(){
    if (lbVideo){ lbVideo.pause(); lbVideo.removeAttribute("src"); lbVideo.load(); lbVideo.style.display = "none"; }
    lbImg.style.display = "block";
    lbBack.classList.remove("show");
    lb.classList.remove("show");
    document.body.style.overflow = "";
  }
  lbClose.addEventListener("click", closePhoto);
  lbBack.addEventListener("click", closePhoto);

  window.addEventListener("keydown", (e)=>{
    if (lb.classList.contains("show") && e.key === "Escape") closePhoto();
  });

  // ==========================
  // ✅ Active state for LEFT sidebar ONLY
  // ==========================
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

  // ==========================
  // Reviews helpers (unchanged)
  // ==========================
  function starsText(r){
    r = Number(r)||0;
    let s = "";
    for (let i=1;i<=5;i++) s += (i<=r ? "★" : "☆");
    return s;
  }
  function starsEl(r){
    const div = document.createElement("div");
    div.className = "rStars";
    div.setAttribute("aria-label", `${r} stars`);
    div.textContent = starsText(r);
    return div;
  }

  const starsPick  = document.getElementById("starsPick");
  const ratingText = document.getElementById("ratingText");
  let rating = 5;

  function renderPicker(){
    if (!starsPick) return;
    starsPick.querySelectorAll("button.starBtn").forEach(x => x.remove());
    for (let i=1;i<=5;i++){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "starBtn" + (i<=rating ? " active" : "");
      b.textContent = "★";
      b.setAttribute("aria-label", `${i} stars`);
      b.addEventListener("click", () => {
        rating = i;
        if (ratingText) ratingText.textContent = `Selected: ${rating}/5`;
        renderPicker();
      });
      starsPick.insertBefore(b, ratingText);
    }
    if (ratingText) ratingText.textContent = `Selected: ${rating}/5`;
  }
  renderPicker();

  const elList    = document.getElementById("list");
  const heroMeta  = document.getElementById("heroMeta");
  const countHint = document.getElementById("countHint");

  const avgNum    = document.getElementById("avgNum");
  const avgStars  = document.getElementById("avgStars");
  const avgSub    = document.getElementById("avgSub");

  function fmtDate(value){
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  }

  function calcAverage(items){
    const arr = (items||[]).map(x => Number(x.rating)).filter(n => Number.isFinite(n) && n>=1 && n<=5);
    if (!arr.length) return { avg:null, count:0 };
    const sum = arr.reduce((a,b)=>a+b,0);
    return { avg: sum/arr.length, count: arr.length };
  }

  function reviewCard(r){
    const wrap = document.createElement("div");
    wrap.className = "review";

    const top = document.createElement("div");
    top.className = "rTop";

    const left = document.createElement("div");
    const name = document.createElement("p");
    name.className = "rName";
    name.textContent = r.name || "Anonymous";

    const date = document.createElement("div");
    date.className = "rDate";
    const country = (r.country ? ` • ${r.country}` : "");
    const source = String(r.source || "").trim().toLowerCase() === "etsy" ? " • Etsy" : "";
    date.textContent = `${fmtDate(r.createdAt || r.date || "")}${country}${source}`;

    left.appendChild(name);
    left.appendChild(date);

    const right = starsEl(r.rating || 0);

    top.appendChild(left);
    top.appendChild(right);

    const text = document.createElement("p");
    text.className = "rText";
    text.textContent = r.text || "";

    wrap.appendChild(top);
    wrap.appendChild(text);

    if (Array.isArray(r.photos) && r.photos.length){
      const ph = document.createElement("div");
      ph.className = "rPhotos";
      r.photos.slice(0, 12).forEach(url => {
        const box = document.createElement("div");
        box.className = "rPhoto";
        box.innerHTML = `<img src="${escapeHtml(url)}" alt="Photo" loading="lazy" />`;
        box.addEventListener("click", ()=> openPhoto(url));
        ph.appendChild(box);
      });
      wrap.appendChild(ph);
    }

    if (r.video){
      const videoThumb = document.createElement("button");
      videoThumb.className = "rVideoThumb";
      videoThumb.type = "button";
      videoThumb.setAttribute("aria-label", "Open review video");

      const preview = document.createElement("video");
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = "metadata";
      preview.src = r.video;

      const play = document.createElement("span");
      play.className = "rVideoPlay";
      play.textContent = "▶";

      videoThumb.appendChild(preview);
      videoThumb.appendChild(play);
      videoThumb.addEventListener("click", ()=> openVideo(r.video));
      wrap.appendChild(videoThumb);
    }

    return wrap;
  }

  async function loadReviews(){
    if (heroMeta) heroMeta.textContent = "Loading…";
    if (elList) elList.innerHTML = "";

    try{
      const r = await fetch(API_REVIEWS, { method:"GET", cache:"no-store" });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.error || "Failed to load reviews");

      const items = Array.isArray(data?.reviews) ? data.reviews : [];
      const { avg, count } = calcAverage(items);

      const total = items.length;

      if (heroMeta){
        heroMeta.textContent = total
          ? `Showing customer reviews.`
          : `No reviews yet. Be the first 🙂`;
      }
      if (countHint) countHint.textContent = total ? `${total} reviews` : "—";

      if (avg == null){
        if (avgNum) avgNum.textContent = "—";
        if (avgStars) avgStars.textContent = "—";
        if (avgSub) avgSub.textContent = "No ratings yet";
      } else {
        if (avgNum) avgNum.textContent = avg.toFixed(2);
        if (avgStars) avgStars.textContent = starsText(Math.round(avg));
        if (avgSub) avgSub.textContent = `${count} ratings`;
      }

      if (!items.length){
        if (elList){
          elList.innerHTML = `<div class="empty">No reviews yet. Be the first 🙂</div>`;
        }
        return;
      }

      items.sort((a,b) => {
        const ad = new Date(a.createdAt || a.date || 0).getTime() || 0;
        const bd = new Date(b.createdAt || b.date || 0).getTime() || 0;
        return bd - ad;
      });

      items.forEach(it => elList?.appendChild(reviewCard(it)));
    }catch(e){
      if (heroMeta) heroMeta.textContent = "Failed to load reviews.";
      if (elList){
        elList.innerHTML = `<div class="empty">Error: ${escapeHtml(String(e?.message || e))}</div>`;
      }
      toast("Reviews", String(e?.message || e));
    }
  }

  // ==========================
  // Submit review
  // ==========================
  const elName    = document.getElementById("name");
  const elCountry = document.getElementById("country");
  const elText    = document.getElementById("text");
  const elPhotos  = document.getElementById("photos");
  const elVideo   = document.getElementById("video");
  const elVideoChooseBtn = document.getElementById("videoChooseBtn");
  const elPhotoPreview = document.getElementById("photoPreview");
  const elSend    = document.getElementById("sendBtn");

  let photoPreviewUrls = [];

  function clearPhotoPreviewUrls(){
    photoPreviewUrls.forEach(url => {
      try{ URL.revokeObjectURL(url); }catch(_){}
    });
    photoPreviewUrls = [];
  }

  function renderPhotoPreview(){
    if (!elPhotoPreview) return;
    clearPhotoPreviewUrls();
    elPhotoPreview.innerHTML = "";

    const files = Array.from(elPhotos?.files || []).slice(0, 4);
    elPhotoPreview.classList.toggle("hasPhotos", files.length > 0);

    files.forEach(file => {
      const url = URL.createObjectURL(file);
      photoPreviewUrls.push(url);

      const item = document.createElement("div");
      item.className = "photoPreviewItem";

      const img = document.createElement("img");
      img.src = url;
      img.alt = "Selected review photo";

      const name = document.createElement("div");
      name.className = "photoPreviewName";
      name.textContent = file.name || "Photo";

      item.appendChild(img);
      item.appendChild(name);
      elPhotoPreview.appendChild(item);
    });
  }

  elPhotos?.addEventListener("change", renderPhotoPreview);

  function renderVideoPreview(){
    if (!elVideoPreview) return;
    const file = elVideo?.files?.[0] || null;
    elVideoPreview.classList.toggle("hasVideo", !!file);
    elVideoPreview.textContent = file ? `Selected: ${file.name}` : "";
  }
  elVideo?.addEventListener("change", renderVideoPreview);
  elVideoChooseBtn?.addEventListener("click", () => elVideo?.click());

  function validate(){
    const name = (elName?.value || "").trim();
    const text = (elText?.value || "").trim();
    if (name.length < 2) return "Name is too short";
    if (rating < 1 || rating > 5) return "Rating must be 1..5";
    if (text.length < 10) return "Text is too short (min 10 chars)";
    const photos = Array.from(elPhotos?.files || []);
    if (photos.length > 4) return "Please select up to 4 photos";
    for (const file of photos){
      if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return "Photos must be JPG, PNG or WebP";
      if (file.size > 8 * 1024 * 1024) return "Each photo must be 8 MB or smaller";
    }
    const video = elVideo?.files?.[0] || null;
    if (video){
      if (!["video/mp4","video/webm","video/quicktime"].includes(video.type)) return "Video must be MP4, WebM or MOV";
      if (video.size > 40 * 1024 * 1024) return "Video must be 40 MB or smaller";
    }
    return null;
  }

  async function sendReview(){
    const err = validate();
    if (err){ toast("Review", err); return; }

    const payload = new FormData();
    payload.append("name", (elName.value || "").trim());
    payload.append("country", (elCountry.value || "").trim());
    payload.append("rating", String(rating));
    payload.append("text", (elText.value || "").trim());
    payload.append("source", "site");
    const selectedPhotos = Array.from(elPhotos?.files || []);
    payload.append("photoCount", String(selectedPhotos.length));
    selectedPhotos.forEach(file => payload.append("photos", file, file.name));
    const selectedVideo = elVideo?.files?.[0] || null;
    payload.append("videoCount", selectedVideo ? "1" : "0");
    if (selectedVideo) payload.append("video", selectedVideo, selectedVideo.name);

    if (elSend){
      elSend.disabled = true;
      elSend.textContent = "Sending…";
    }

    try{
      const r = await fetch(API_REVIEWS, {
        method:"POST",
        body: payload,
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok || !data?.ok){
        throw new Error(data?.error || "Failed to send review");
      }

      toast("Review", "Published ✅ Thank you for your review!");
      if (elText) elText.value = "";
      if (elPhotos) elPhotos.value = "";
      if (elVideo) elVideo.value = "";
      renderPhotoPreview();
      renderVideoPreview();
      loadReviews();
    }catch(e){
      toast("Review", String(e?.message || e));
    }finally{
      if (elSend){
        elSend.disabled = false;
        elSend.textContent = "Send review";
      }
    }
  }

  elSend?.addEventListener("click", sendReview);

  elText?.addEventListener("keydown", (e)=>{
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendReview();
  });

  // init
  loadReviews();
