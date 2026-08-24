// footer year
    document.getElementById("year").textContent = String(new Date().getFullYear());

    const API_PRODUCTS = "/api/products";
    const API_CHECKOUT = "/api/checkout";

    // PayPal endpoints
    const API_PP_CONFIG  = "/api/paypal/config";       // returns { clientId }
    const API_PP_CREATE  = "/api/paypal/create-order"; // returns { id }
    const API_PP_CAPTURE = "/api/paypal/capture";      // returns capture result

    const CART_KEY = "mp_cart";

    // persisted settings
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

    let products = [];
    let filtered = [];

    const selectedDiameters = new Set();
    let diameterMap = new Map();

// refs
    const elGrid = document.getElementById("grid");
    const elQ = document.getElementById("q");
    const elStock = document.getElementById("inStockOnly");
    const elCurrency = document.getElementById("currency");
    const elShipCountry = document.getElementById("shipCountry");
    const elSbCount = document.getElementById("sbCount");

    const elDiaCount = document.getElementById("diaCount");
    const elDiameters = document.getElementById("diameters");
    const elSelectedWrap = document.getElementById("selectedWrap");
    const elSelectedList = document.getElementById("selectedList");
    const elClearDiameters = document.getElementById("clearDiameters");

    const elOpenFilters = document.getElementById("openFilters");
    const elFiltersBadge = document.getElementById("filtersBadge");
    const elSheetBack = document.getElementById("sheetBack");
    const elSheet = document.getElementById("sheet");
    const elCloseFilters = document.getElementById("closeFilters");
    const elMDiaCount = document.getElementById("mDiaCount");
    const elMDiameters = document.getElementById("mDiameters");
    const elMSelectedWrap = document.getElementById("mSelectedWrap");
    const elMSelectedList = document.getElementById("mSelectedList");
    const elMClearDiameters = document.getElementById("mClearDiameters");

    const elOpenCart = document.getElementById("openCart");
    const elCartBadge = document.getElementById("cartBadge");
    const elCartBack = document.getElementById("cartBack");
    const elCartDrawer = document.getElementById("cartDrawer");
    const elCloseCart = document.getElementById("closeCart");
    const elCartBody = document.getElementById("cartBody");
    const elCartTotal = document.getElementById("cartTotal");

    const elCartCheckout = document.getElementById("cartCheckout");
    const elCartClear = document.getElementById("cartClear");

    // PayPal
    const elPpWrap = document.getElementById("ppWrap");
    const elPpNote = document.getElementById("ppNote");

    const elToast = document.getElementById("toast");
    const elToastTitle = document.getElementById("toastTitle");
    const elToastMsg = document.getElementById("toastMsg");

    function toast(title, msg){
      elToastTitle.textContent = title;
      elToastMsg.textContent = msg;
      elToast.classList.add("show");
      setTimeout(()=> elToast.classList.remove("show"), 2600);
    }

    function escapeHtml(s){
      return String(s||"").replace(/[&<>"']/g, m => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
      }[m]));
    }

    function getCurrency(){
      const saved = (localStorage.getItem(MP_CUR_KEY) || "").toUpperCase();
      if (saved === "EUR" || saved === "USD") return saved;
      return "USD";
    }
    function setCurrency(cur){
      cur = String(cur || "USD").toUpperCase();
      if (cur !== "EUR" && cur !== "USD") cur = "USD";
      try{ localStorage.setItem(MP_CUR_KEY, cur); }catch(_){}
      if (elCurrency) elCurrency.value = cur;
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

    // restore persisted selects
    (function restoreSettings(){
      try{
                if (!localStorage.getItem(MP_CUR_KEY))  localStorage.setItem(MP_CUR_KEY, "USD");

        const savedShip = (localStorage.getItem(MP_SHIP_KEY) || "").toUpperCase();
        if (savedShip && /^[A-Z]{2}$/.test(savedShip) && elShipCountry){
          elShipCountry.value = savedShip;
        }

        const savedCur = (localStorage.getItem(MP_CUR_KEY) || "USD").toUpperCase();
        if (savedCur && (savedCur === "EUR" || savedCur === "USD") && elCurrency){
          elCurrency.value = savedCur;
        }

        enforceCurrencyByShipping();
        setCurrency(getCurrency());
      }catch(_){}
    })();

    // auto detect shipping once
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
      const v = String(elShipCountry?.value || "").trim().toUpperCase();
      return /^[A-Z]{2}$/.test(v) ? v : "";
    }

    if (elCurrency){
      elCurrency.addEventListener("change", () => {
        setCurrency(elCurrency.value);
        enforceCurrencyByShipping();

        // PayPal SDK currency-bound → если валюта изменилась, переинициализируем SDK
        resetPayPalHard();

        render();
        renderCart();
      });
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

        render();
        renderCart();
        toast("Shipping", `Destination: ${elShipCountry.value}`);
      });
    }

    function priceText(priceObj){
      const cur = getCurrency();
      const v = priceObj?.[cur];
      if (typeof v !== "number") return cur === "EUR" ? "— €" : "— $";
      return cur === "EUR" ? `${v.toFixed(2)} €` : `${v.toFixed(2)} $`;
    }

    // sheet/cart open-close
    function openSheet(){
      elSheetBack.classList.add("show");
      elSheet.classList.add("show");
      document.body.style.overflow = "hidden";
    }
    function closeSheet(){
      elSheetBack.classList.remove("show");
      elSheet.classList.remove("show");
      document.body.style.overflow = "";
    }
    elOpenFilters.addEventListener("click", openSheet);
    elCloseFilters.addEventListener("click", closeSheet);
    elSheetBack.addEventListener("click", closeSheet);

    function openCart(){
      elCartBack.classList.add("show");
      elCartDrawer.classList.add("show");
      document.body.style.overflow = "hidden";
      renderCart();
      maybeInitPayPal();
    }
    function closeCart(){
      elCartBack.classList.remove("show");
      elCartDrawer.classList.remove("show");
      document.body.style.overflow = "";
    }
    elOpenCart.addEventListener("click", openCart);
    elCloseCart.addEventListener("click", closeCart);
    elCartBack.addEventListener("click", closeCart);

    window.addEventListener("keydown", (e)=>{
      if (e.key !== "Escape") return;
      if (elCartDrawer.classList.contains("show")) closeCart();
      if (elSheet.classList.contains("show")) closeSheet();
    });

    function updateCartBadge(){ elCartBadge.textContent = String(cartCount()); }

    // =========================
    // PayPal integration (ONLY PayPal button, disable cards+sepa)
    // =========================
    let ppReady = false;
    let ppLoading = false;
    let ppRenderedForKey = "";

    // ✅ FIX: держим один инстанс и защищаемся от двойного render
    let ppButtonsInstance = null;
    let ppRenderSeq = 0;

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

    // HARD reset: remove SDK script + window.paypal (important for currency changes)
    function resetPayPalHard(){
      ppReady = false;
      ppLoading = false;
      ppRenderedForKey = "";
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

          // ONLY PayPal funding (disable cards etc)
          const url =
            "https://www.paypal.com/sdk/js" +
            `?client-id=${encodeURIComponent(clientId)}` +
            `&currency=${encodeURIComponent(cur)}` +
            `&intent=capture` +
            `&components=buttons` +
            `&disable-funding=card,sepa,ideal,bancontact,sofort,giropay,eps,mybank,p24,venmo`;

          // same src → wait
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

          // different src → hard reset then load again
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

        // enforce currency BEFORE sdk load
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

    // ✅ FIX: безопасная очистка + close предыдущего инстанса
    function clearPayPalButtons(){
      try{
        if (ppButtonsInstance && typeof ppButtonsInstance.close === "function"){
          ppButtonsInstance.close();
        }
      }catch(_){}
      ppButtonsInstance = null;

      const wrap = document.getElementById("paypal-button-container");
      if (wrap) wrap.innerHTML = "";
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

      clearPayPalButtons();
      ppRenderedForKey = key;

      const mySeq = ++ppRenderSeq;

      ppButtonsInstance = window.paypal.Buttons({
        // ✅ style под нашу кнопку: прямоугольник, высота 44
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
            loadProducts();
          }catch(e){
            toast("PayPal", String(e?.message || e));
          }
        },

        onCancel: () => toast("PayPal", "Canceled"),
        onError: (err) => toast("PayPal", String(err?.message || err || "PayPal error")),
      });

      // ✅ если пока готовили кнопку — корзина поменялась, не рендерим старую
      if (mySeq !== ppRenderSeq) return;

      ppButtonsInstance.render("#paypal-button-container");
    }

    // =========================
    // Cart logic (Stripe + PayPal)
    // =========================

    function addToCartFromProduct(p, qty){
      qty = Number(qty);
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;

      const stock = Number(p.stock ?? 0);
      if (stock <= 0){ toast("Cart", "Sold out"); return; }

      const cart = readCart();
      const idx = cart.findIndex(x => String(x.pin) === String(p.pin));

      if (idx >= 0){
        const next = Math.min(stock, (Number(cart[idx].qty)||0) + qty);
        cart[idx].qty = next;
        cart[idx].stock = stock;
        cart[idx].title = p.title;
        cart[idx].image = (p.images && p.images[0]) ? p.images[0] : (cart[idx].image || "");
        cart[idx].price = p.price || cart[idx].price || {};
      } else {
        cart.push({
          pin: String(p.pin),
          qty: Math.min(stock, qty),
          title: String(p.title || p.pin),
          image: (p.images && p.images[0]) ? p.images[0] : "",
          price: p.price || {},
          stock: stock
        });
      }

      writeCart(cart);
      updateCartBadge();
      renderCart();
      toast("Cart", "Added ✅");

      ppRenderedForKey = "";
      renderPayPalButtonsIfNeeded();
    }

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

        row.querySelector('button[data-act="minus"]').addEventListener("click", () => setCartQty(pin, Number(input.value) - 1));
        row.querySelector('button[data-act="plus"]').addEventListener("click",  () => setCartQty(pin, Number(input.value) + 1));

        input.addEventListener("input", () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          setCartQty(pin, v);
        });

        row.querySelector('button[data-act="remove"]').addEventListener("click", () => removeFromCart(pin));
      });

      const sum = cartTotal();
      const subEl = document.getElementById("cartSubtotal");
      if (subEl) subEl.textContent = (cur==="EUR") ? `${sum.toFixed(2)} €` : `$${sum.toFixed(2)}`;
      window.MPShipping?.refresh(sum, cur);

      // init/render PayPal when cart visible
      maybeInitPayPal();
      renderPayPalButtonsIfNeeded();
    }

    // Clear cart button
    elCartClear.addEventListener("click", () => { clearCart(); toast("Cart", "Cleared"); });

    // Stripe checkout
    async function startCheckout(){
      const cart = readCart();
      if (!cart.length) { toast("Checkout", "Cart is empty"); return; }

      enforceCurrencyByShipping();
      setCurrency(getCurrency());

      try{ localStorage.setItem(MP_SHIP_KEY, String(elShipCountry.value || "").toUpperCase()); }catch(_){}

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

      elCartCheckout.disabled = true;
      elCartCheckout.textContent = "Redirecting…";

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
        elCartCheckout.disabled = false;
        elCartCheckout.textContent = "Pay by card";
      }finally{
        // restore text when coming back without redirect
        if (!elCartCheckout.disabled) elCartCheckout.textContent = "Pay by card";
      }
    }
    elCartCheckout.addEventListener("click", startCheckout);

    function parseDiameter(raw){
      if (raw == null) return { key:null, num:null, display:null, note:null, raw:null };

      if (typeof raw === "number" && Number.isFinite(raw)){
        const s = String(raw);
        return { key: s, num: raw, display: s.replace(".",","), note:null, raw:s };
      }

      const str = String(raw).trim();
      if (!str) return { key:null, num:null, display:null, note:null, raw:str };

      const noteMatch = str.match(/\(([^)]+)\)/);
      const note = noteMatch ? noteMatch[1].trim() : null;

      const m = str.match(/(\d+(?:[.,]\d+)?)/);
      if (!m) return { key: str, num:null, display:str, note: note, raw:str };

      const captured = m[1];
      const key = captured.replace(",",".");
      const num = parseFloat(key);
      const display = captured.replace(".",",");

      return { key, num: (Number.isFinite(num) ? num : null), display, note, raw: str };
    }

    function diameterLabelByKey(key){
      const info = diameterMap.get(key);
      if (!info) return key;
      return info.display || key;
    }

    function updateSelectedUI(){
      const arr = [...selectedDiameters].map(k => ({ k, n: (diameterMap.get(k)?.num ?? Infinity) }))
        .sort((a,b)=>a.n-b.n)
        .map(x => x.k);

      // Diameter badge = count of IN-STOCK PRODUCT MODELS, never stock quantity.
      // "All" means every catalog product card with Stock > 0. With one or more
      // diameter filters selected, count only in-stock product cards in those diameters.
      const inStockProducts = products.filter(p => Number(p.stock || 0) > 0);
      const diameterProductCount = selectedDiameters.size === 0
        ? inStockProducts.length
        : inStockProducts.filter(p => p.diameterKey && selectedDiameters.has(p.diameterKey)).length;
      const diameterCountLabel = String(diameterProductCount);
      elDiaCount.textContent = diameterCountLabel;
      elMDiaCount.textContent = diameterCountLabel;
      elFiltersBadge.textContent = diameterCountLabel;

      const text = (arr.length ? arr.map(k => `Ø${diameterLabelByKey(k)}`).join(", ") : "—");

      if (arr.length === 0){
        elSelectedWrap.style.display = "none";
        elSelectedList.textContent = "—";
      } else {
        elSelectedWrap.style.display = "block";
        elSelectedList.textContent = text;
      }

      if (arr.length === 0){
        elMSelectedWrap.style.display = "none";
        elMSelectedList.textContent = "—";
      } else {
        elMSelectedWrap.style.display = "block";
        elMSelectedList.textContent = text;
      }
    }

    function applyFilters(){
      const q = (elQ.value || "").trim().toLowerCase();
      const inStockOnly = elStock.checked;

      filtered = products.filter(p => {
        if (selectedDiameters.size > 0) {
          if (!p.diameterKey || !selectedDiameters.has(p.diameterKey)) return false;
        }
        if (inStockOnly && !(Number(p.stock||0) > 0)) return false;

        if (!q) return true;
        const hay = `${p.pin} ${p.title} ${(p.materials||[]).join(" ")} ${(p.color||"")} ${(p.diameterRaw||"")}`.toLowerCase();
        return hay.includes(q);
      });

      render();
    }

    function cardTemplate(p){
      const img = (p.images && p.images[0]) ? `<img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.title)}" />` : "";
      const soldOut = !(Number(p.stock||0) > 0);

      const diaText = p.diameterDisplay ? p.diameterDisplay : (p.diameterNum != null ? String(p.diameterNum).replace(".",",") : "—");

      return `
        <div class="card" data-open="${escapeHtml(String(p.pin))}">
          <div class="thumb">
            ${img}
            <div class="badge ${soldOut ? "sold" : ""}">${soldOut ? "Sold out" : `In stock: ${escapeHtml(p.stock)}`}</div>
          </div>
          <div class="meta">
            <p class="name">${escapeHtml(p.title)} <span style="color:var(--muted); font-weight:700;">• ${escapeHtml(p.pin)}</span></p>
            <div class="card-chips">
              ${(p.materials || []).map(m => `<span class="card-chip">${escapeHtml(m)}</span>`).join("")}
              ${p.color ? `<span class="card-chip">Color: ${escapeHtml(p.color)}</span>` : ""}
              ${diaText && diaText !== "—" ? `<span class="card-chip">Ø ${escapeHtml(diaText)} mm</span>` : ""}
            </div>
            <div class="row">
              <div>
                <div class="price">${priceText(p.price)}</div>
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn2" ${soldOut ? "disabled" : ""} data-add="${escapeHtml(p.pin)}" title="Add to cart" type="button">＋</button>
                <button class="btn" data-openbuy="${escapeHtml(p.pin)}" type="button">View</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function render(){
      elSbCount.textContent = `${filtered.length} items`;
      elGrid.innerHTML = filtered.map(cardTemplate).join("");

      [...document.querySelectorAll("button[data-add]")].forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pin = btn.getAttribute("data-add");
          const p = products.find(x => String(x.pin) === String(pin));
          if (!p) return;
          addToCartFromProduct(p, 1);
        });
      });

      [...document.querySelectorAll("button[data-openbuy]")].forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pin = btn.getAttribute("data-openbuy");
          window.location.href = `/product?pin=${encodeURIComponent(pin)}`;
        });
      });

      [...document.querySelectorAll(".card[data-open]")].forEach(card => {
        card.addEventListener("click", () => {
          const pin = card.getAttribute("data-open");
          window.location.href = `/product?pin=${encodeURIComponent(pin)}`;
        });
      });
    }

    function normalizeProducts(data){
      const arr = Array.isArray(data) ? data : (data.products || []);
      return arr.map(x => {
        const pin = x.pin || x.pin_code || x.PIN || x["PIN Code"] || "—";
        const title = x.title || x.name || "Untitled";
        const description = x.description || "";
        // Prefer the exact raw Airtable Diameter value returned by the API.
        // Fall back to the normalized numeric value for older responses.
        const diameterRaw = (x.diameterRaw ?? x.diameter ?? x.diameter_mm ?? x["Diameter"] ?? null);

        const dia = parseDiameter(diameterRaw);

        return {
          pin,
          title,
          description,
          diameterRaw: diameterRaw == null ? "" : String(diameterRaw),
          diameterKey: dia.key,
          diameterNum: dia.num,
          diameterDisplay: dia.display,
          diameterNote: dia.note,

          materials: x.materials || x["Materials"] || [],
          color: x.color || x["Color"] || "",
          stock: (x.stock ?? x["Stock"] ?? 0),
          images: x.images || x["Images"] || [],
          price: x.price || { EUR: x.price_eur, USD: x.price_usd },
        };
      });
    }

    function buildDiameterLists(){
      diameterMap = new Map();

      for (const p of products){
        if (!p.diameterKey) continue;
        if (!diameterMap.has(p.diameterKey)){
          diameterMap.set(p.diameterKey, {
            key: p.diameterKey,
            num: p.diameterNum,
            display: p.diameterDisplay || p.diameterKey.replace(".",","),
            note: p.diameterNote || null
          });
        }
      }

      const diameters = [...diameterMap.values()].sort((a,b)=>{
        const an = (a.num == null ? -Infinity : a.num);
        const bn = (b.num == null ? -Infinity : b.num);
        if (an !== bn) return bn - an;
        return String(a.display).localeCompare(String(b.display));
      });

      const buildInto = (container) => {
        container.innerHTML = "";

        const makeItem = ({label, sub, valueKey, isAll=false}) => {
          const div = document.createElement("div");
          const active = isAll ? (selectedDiameters.size === 0) : selectedDiameters.has(valueKey);
          div.className = "item" + (active ? " active" : "");
          div.innerHTML = `${escapeHtml(label)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}`;

          div.addEventListener("click", () => {
            if (isAll) selectedDiameters.clear();
            else {
              if (selectedDiameters.has(valueKey)) selectedDiameters.delete(valueKey);
              else selectedDiameters.add(valueKey);
            }
            updateSelectedUI();
            buildDiameterLists();
            applyFilters();
          });

          return div;
        };

        container.appendChild(makeItem({ label:"All", sub:"Any size", valueKey:null, isAll:true }));

        for (const d of diameters){
          const sub = d.note || "";
          container.appendChild(makeItem({ label:`Ø ${d.display}`, sub, valueKey:d.key }));
        }
      };

      buildInto(elDiameters);
      buildInto(elMDiameters);
      updateSelectedUI();
    }

    function clearDiameters(){
      selectedDiameters.clear();
      updateSelectedUI();
      buildDiameterLists();
      applyFilters();
    }
    elClearDiameters.addEventListener("click", (e) => { e.preventDefault(); clearDiameters(); });
    elMClearDiameters.addEventListener("click", (e) => { e.preventDefault(); clearDiameters(); });

    async function loadProducts(){
      try{
        const r = await fetch(API_PRODUCTS, { method:"GET", cache:"no-store" });
        if (r.ok){
          const data = await r.json();
          products = normalizeProducts(data);
          buildDiameterLists();
          applyFilters();

          // refresh cart items with latest product data
          const cart = readCart();
          if (cart.length){
            const next = cart.map(it => {
              const p = products.find(x => String(x.pin) === String(it.pin));
              if (!p) return it;
              return {
                ...it,
                title: p.title,
                image: (p.images && p.images[0]) ? p.images[0] : (it.image || ""),
                price: p.price || it.price || {},
                stock: Number(p.stock ?? it.stock ?? 0)
              };
            });
            writeCart(next);
          }

          updateCartBadge();
          renderCart();

          ppRenderedForKey = "";
          renderPayPalButtonsIfNeeded();
          return;
        }
      }catch(_){
        toast("Error", "Products API is not reachable");
      }

      products = [];
      buildDiameterLists();
      applyFilters();
      updateCartBadge();
      renderCart();

      ppRenderedForKey = "";
      renderPayPalButtonsIfNeeded();
    }

    elQ.addEventListener("input", applyFilters);
    elStock.addEventListener("change", applyFilters);

    window.addEventListener("resize", () => { if (window.innerWidth > 980) closeSheet(); });

    // initial
    updateCartBadge();
    renderCart();
    loadProducts();

    // enforce currency on first load too
    enforceCurrencyByShipping();
    setCurrency(getCurrency());

    (function handleReturn(){
      const u = new URL(window.location.href);

      if (u.searchParams.get("success") === "1"){
        writeCart([]);
        updateCartBadge();
        renderCart();
        toast("Payment", "Success ✅ Stock обновится из Airtable");

        u.searchParams.delete("success");
        history.replaceState({}, "", u.toString());
        loadProducts();
      }

      if (u.searchParams.get("canceled") === "1"){
        toast("Payment", "Canceled");
        u.searchParams.delete("canceled");
        history.replaceState({}, "", u.toString());
      }
    })();

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
