// ---- product block 1 ----
(function(){
  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();

var ppReady = false;
var ppLoading = false;

var ppCartRenderedForKey = "";
var ppOneRenderedForKey  = "";

var ppCartButtons = null;
var ppOneButtons  = null;
var ppRenderSeq   = 0;

/* ==========================================================
   CORE: storage + settings + cart render + Stripe + PayPal CART
========================================================== */

const API_PRODUCT   = "/api/product";
const API_CHECKOUT  = "/api/checkout";

const API_PP_CONFIG  = "/api/paypal/config";
const API_PP_CREATE  = "/api/paypal/create-order";
const API_PP_CAPTURE = "/api/paypal/capture";

const CART_KEY    = "mp_cart";
const MP_CUR_KEY  = "mp_currency";
const MP_SHIP_KEY = "mp_ship_country";

const DEFAULT_SHIP = "";
const DEFAULT_CUR  = "USD";

const el = (id) => document.getElementById(id);

const elCurrency    = el("currency");
const elShipCountry = el("shipCountry");

const elOpenCart     = el("openCart");
const elCartBack     = el("cartBack");
const elCartDrawer   = el("cartDrawer");
const elCloseCart    = el("closeCart");
const elCartBody     = el("cartBody");
const elCartTotal    = el("cartTotal");
const elCartCheckout = el("cartCheckout");
const elCartClear    = el("cartClear");

const elPpWrap = el("ppWrap");
const elPpNote = el("ppNote");

const toastEl    = el("toast");
const toastTitle = el("toastTitle");
const toastMsg   = el("toastMsg");

function toast(title, msg){
  if (!toastEl || !toastTitle || !toastMsg) return;

  toastTitle.textContent = String(title || "Notice");
  toastMsg.textContent   = String(msg || "");

  toastEl.classList.add("show");

  clearTimeout(toastEl.__t);

  toastEl.__t = setTimeout(()=>{
    toastEl.classList.remove("show");
  }, 2600);
}

function isMobile(){
  return window.matchMedia &&
         window.matchMedia("(max-width: 980px)").matches;
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

/* ==========================
   Cart storage
========================== */

function sanitizeCart(raw){
  if (!Array.isArray(raw)) return [];

  const out = [];

  for (const it of raw){

    if (!it || typeof it !== "object") continue;

    const pin = String(it.pin || "").trim();

    if (!pin) continue;

    const qty = Number(it.qty);

    const cleanQty =
      Number.isFinite(qty)
        ? Math.max(1, Math.floor(qty))
        : 1;

    out.push({
      pin,
      qty: cleanQty,
      title: String(it.title || pin),
      image: String(it.image || ""),
      price:
        (it.price && typeof it.price === "object")
          ? it.price
          : {},
      stock:
        (it.stock == null)
          ? undefined
          : it.stock
    });
  }

  return out;
}

function readCart(){

  try{

    const raw = localStorage.getItem(CART_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    const clean = sanitizeCart(parsed);

    if (JSON.stringify(clean) !== JSON.stringify(parsed)){
      localStorage.setItem(
        CART_KEY,
        JSON.stringify(clean)
      );
    }

    return clean;

  }catch(_){

    return [];
  }
}

function writeCart(arr){

  try{
    localStorage.setItem(
      CART_KEY,
      JSON.stringify(sanitizeCart(arr))
    );
  }catch(_){}
}

function cartCount(){

  return readCart().reduce(
    (s,it)=> s + (Number(it?.qty)||0),
    0
  );
}

function updateCartBadge(){

  const badge = el("cartBadge");

  if (badge){
    badge.textContent = String(cartCount());
  }
}

/* ==========================
   Currency + Shipping
========================== */

function mustCurrencyByShip(ship){

  ship = String(ship || DEFAULT_SHIP).toUpperCase();

  return (ship === "US" || ship === "CA")
    ? "USD"
    : "EUR";
}

function getCurrency(){

  const saved =
    (localStorage.getItem(MP_CUR_KEY) || "")
      .toUpperCase();

  if (saved === "EUR" || saved === "USD"){
    return saved;
  }

  return String(
    elCurrency?.value || DEFAULT_CUR
  ).toUpperCase();
}

function setCurrency(cur){

  cur =
    String(cur || DEFAULT_CUR)
      .toUpperCase();

  if (cur !== "EUR" && cur !== "USD"){
    cur = DEFAULT_CUR;
  }

  try{
    localStorage.setItem(
      MP_CUR_KEY,
      cur
    );
  }catch(_){}

  if (elCurrency){
    elCurrency.value = cur;
  }
}

function enforceCurrencyByShipping(){
  return getCurrency();
}

function getShippingCountryISO2(){

  const v =
    String(elShipCountry?.value || "")
      .trim()
      .toUpperCase();

  return /^[A-Z]{2}$/.test(v)
    ? v
    : "";
}

(function restoreSettings(){

  try{

    const shipSaved =
      (localStorage.getItem(MP_SHIP_KEY) || "")
        .toUpperCase();

    const curSaved =
      (localStorage.getItem(MP_CUR_KEY) || "")
        .toUpperCase();

    if (
      shipSaved &&
      /^[A-Z]{2}$/.test(shipSaved) &&
      elShipCountry
    ){
      elShipCountry.value = shipSaved;
    }

    if (
      curSaved &&
      (curSaved === "EUR" || curSaved === "USD") &&
      elCurrency
    ){
      elCurrency.value = curSaved;
    }else{
      setCurrency(DEFAULT_CUR);
    }

    enforceCurrencyByShipping();
    setCurrency(getCurrency());

  }catch(_){}
})();

var currentProduct = null;

function priceText(priceObj){

  const cur = getCurrency();

  const v = priceObj?.[cur];

  if (typeof v !== "number"){
    return cur === "EUR"
      ? "— €"
      : "— $";
  }

  return cur === "EUR"
    ? `${v.toFixed(2)} €`
    : `${v.toFixed(2)} $`;
}

function refreshPriceUI(){

  if (currentProduct){

    const p = el("price");

    if (p){
      p.textContent =
        priceText(currentProduct.price);
    }
  }
}

function clampQty(q, max){

  q = Number(q);

  if (!Number.isFinite(q)){
    q = 1;
  }

  if (q < 1){
    q = 1;
  }

  if (max >= 1 && q > max){
    q = max;
  }

  return q;
}

/* ==========================
   PayPal helpers
========================== */

async function fetchPayPalClientId(){

  const r = await fetch(
    API_PP_CONFIG,
    {
      method:"GET",
      cache:"no-store"
    }
  );

  const j =
    await r.json().catch(()=>null);

  if (!r.ok || !j?.clientId){
    throw new Error(
      j?.error || "PayPal config error"
    );
  }

  return String(j.clientId);
}

function showPayPalCartNote(msg){

  if (!elPpNote) return;

  elPpNote.textContent =
    String(msg || "");

  elPpNote.style.display =
    msg
      ? "block"
      : "none";
}

function safeClose(btns){

  try{

    if (
      btns &&
      typeof btns.close === "function"
    ){
      btns.close();
    }

  }catch(_){}
}

function clearPayPalCartButtons(){

  safeClose(ppCartButtons);

  ppCartButtons = null;

  const wrap =
    document.getElementById(
      "paypal-cart-container"
    );

  if (wrap){
    wrap.innerHTML = "";
  }
}

function clearPayPalOneButtons(){

  safeClose(ppOneButtons);

  ppOneButtons = null;

  const wrap =
    document.getElementById(
      "paypal-one-container"
    );

  if (wrap){
    wrap.innerHTML = "";
  }
}

function resetPayPalHard(){

  ppReady = false;
  ppLoading = false;

  ppCartRenderedForKey = "";
  ppOneRenderedForKey  = "";

  try{
    clearPayPalCartButtons();
  }catch(_){}

  try{
    clearPayPalOneButtons();
  }catch(_){}

  try{
    showPayPalCartNote("");
  }catch(_){}

  const oneNote = el("ppOneNote");

  if (oneNote){
    oneNote.textContent = "";
    oneNote.style.display = "none";
  }

  try{

    const old =
      document.getElementById("pp-sdk");

    if (
      old &&
      old.parentNode
    ){
      old.parentNode.removeChild(old);
    }

  }catch(_){}

  try{
    delete window.paypal;
  }catch(_){}

  try{
    window.paypal = undefined;
  }catch(_){}

  try{

    const s =
      document.createElement("script");

    s.id = "pp-sdk";

    s.setAttribute(
      "data-loaded",
      "0"
    );

    document.body.appendChild(s);

  }catch(_){}
}

function loadPayPalSDK(clientId){

  return new Promise(
    (resolve, reject) => {

      try{

        if (
          window.paypal &&
          typeof window.paypal.Buttons === "function"
        ){
          resolve(true);
          return;
        }

        const s =
          document.getElementById("pp-sdk");

        if (!s){
          throw new Error(
            "pp-sdk tag missing"
          );
        }

        const cur = getCurrency();

        const url =
          "https://www.paypal.com/sdk/js" +
          `?client-id=${encodeURIComponent(clientId)}` +
          `&currency=${encodeURIComponent(cur)}` +
          `&intent=capture` +
          `&components=buttons` +
          `&disable-funding=card,sepa,ideal,bancontact,sofort,giropay,eps,mybank,p24,venmo`;

        if (
          s.src &&
          s.src === url
        ){

          const t0 = Date.now();

          const tick = () => {

            if (
              window.paypal &&
              typeof window.paypal.Buttons === "function"
            ){
              return resolve(true);
            }

            if (
              Date.now() - t0 > 12000
            ){
              return reject(
                new Error("PayPal SDK timeout")
              );
            }

            setTimeout(
              tick,
              120
            );
          };

          tick();
          return;
        }

        if (
          s.src &&
          s.src !== url
        ){

          resetPayPalHard();

          fetchPayPalClientId()
            .then(loadPayPalSDK)
            .then(resolve)
            .catch(reject);

          return;
        }

        s.onload = () =>
          resolve(true);

        s.onerror = () =>
          reject(
            new Error(
              "PayPal SDK failed to load"
            )
          );

        s.src = url;

        s.setAttribute(
          "data-loaded",
          "1"
        );

      }catch(e){

        reject(e);
      }
    }
  );
}

/* ==========================
   Currency change
========================== */

if (elCurrency){

  elCurrency.addEventListener(
    "change",
    () => {

      // Save the selected currency first.
      setCurrency(elCurrency.value);

      // PayPal SDK is currency-specific. Reload this same product page
      // so PayPal starts cleanly in the newly selected EUR/USD currency.
      window.location.reload();
    }
  );
}

if (elShipCountry){

  elShipCountry.addEventListener(
    "change",
    () => {

      try{
        localStorage.setItem(
          MP_SHIP_KEY,
          String(
            elShipCountry.value ||
            DEFAULT_SHIP
          ).toUpperCase()
        );
      }catch(_){}

      enforceCurrencyByShipping();

      resetPayPalHard();

      renderCart();
      refreshPriceUI();
      updateCartBadge();

      toast(
        "Shipping",
        `Destination: ${elShipCountry.value}`
      );
    }
  );
}

/* ==========================
   Cart drawer
========================== */

function openCart(){

  elCartBack?.classList.add("show");
  elCartDrawer?.classList.add("show");

  if (!isMobile()){
    document.body.style.overflow =
      "hidden";
  }

  renderCart();
  updateCartBadge();

  setTimeout(
    () => {
      maybeInitPayPalCart();
    },
    180
  );
}

function closeCart(){

  elCartBack?.classList.remove("show");
  elCartDrawer?.classList.remove("show");

  document.body.style.overflow = "";
}

elOpenCart?.addEventListener(
  "click",
  openCart
);

elCloseCart?.addEventListener(
  "click",
  closeCart
);

elCartBack?.addEventListener(
  "click",
  closeCart
);

window.addEventListener(
  "keydown",
  (e)=>{

    if (e.key !== "Escape"){
      return;
    }

    if (
      elCartDrawer?.classList.contains("show")
    ){
      closeCart();
    }
  }
);

/* ==========================
   Cart math
========================== */

function cartTotal(){

  const cur = getCurrency();

  const cart = readCart();

  let sum = 0;

  for (const it of cart){

    const unit =
      Number(it?.price?.[cur]);

    if (Number.isFinite(unit)){
      sum +=
        unit *
        (Number(it?.qty)||0);
    }
  }

  return sum;
}

function priceTextFromItem(
  it,
  cur
){

  const unit =
    it?.price?.[cur];

  if (typeof unit !== "number"){
    return "—";
  }

  return cur === "EUR"
    ? `${unit.toFixed(2)} €`
    : `${unit.toFixed(2)} $`;
}

function setCartQty(
  pin,
  qty
){

  const cart = readCart();

  const idx =
    cart.findIndex(
      x =>
        String(x.pin) ===
        String(pin)
    );

  if (idx < 0){
    return;
  }

  const stock =
    Number(
      cart[idx].stock ?? 0
    );

  qty = Number(qty);

  if (!Number.isFinite(qty)){
    qty = 1;
  }

  qty =
    Math.max(
      1,
      qty
    );

  if (stock > 0){
    qty =
      Math.min(
        stock,
        qty
      );
  }

  cart[idx].qty = qty;

  writeCart(cart);
  updateCartBadge();
  renderCart();

  ppCartRenderedForKey = "";

  renderPayPalCartIfNeeded();
}

function removeFromCart(pin){

  const cart =
    readCart().filter(
      x =>
        String(x.pin) !==
        String(pin)
    );

  writeCart(cart);
  updateCartBadge();
  renderCart();

  ppCartRenderedForKey = "";

  renderPayPalCartIfNeeded();
}

function clearCart(){

  writeCart([]);

  updateCartBadge();
  renderCart();

  ppCartRenderedForKey = "";

  renderPayPalCartIfNeeded();
}

function renderCart(){

  if (
    !elCartBody ||
    !elCartTotal ||
    !elCartCheckout
  ){
    return;
  }

  const cart = readCart();

  const cur = getCurrency();

  if (elPpWrap){
    elPpWrap.style.display =
      cart.length
        ? "flex"
        : "none";
  }

  if (elPpNote){

    if (!cart.length){

      elPpNote.style.display =
        "none";

      elPpNote.textContent =
        "";

    }else{

      const shouldShow =
        ppLoading ||
        !ppReady;

      elPpNote.style.display =
        shouldShow
          ? "block"
          : "none";

      elPpNote.textContent =
        shouldShow
          ? "PayPal is loading…"
          : "";
    }
  }

  elCartCheckout.disabled =
    !cart.length;

  elCartClear.disabled =
    !cart.length;

  if (!cart.length){

    elCartBody.innerHTML =
      `<div class="cartEmpty">
        Your cart is empty.
       </div>`;

    const subtotal =
      document.getElementById(
        "cartSubtotal"
      );

    const shipping =
      document.getElementById(
        "cartShipping"
      );

    if (subtotal){
      subtotal.textContent = "—";
    }

    if (shipping){
      shipping.textContent = "—";
    }

    elCartTotal.textContent = "—";

    window.MPShipping?.refresh(
      0,
      cur
    );

    clearPayPalCartButtons();

    ppCartRenderedForKey = "";

    return;
  }

  elCartBody.innerHTML =
    cart.map(it => {

      const img =
        it.image
          ? `<img
              src="${escapeHtml(it.image)}"
              alt="${escapeHtml(it.title)}"
            />`
          : `<span>—</span>`;

      const unitText =
        priceTextFromItem(
          it,
          cur
        );

      return `
        <div
          class="cartItem"
          data-pin="${escapeHtml(String(it.pin || ""))}"
        >

          <div class="cartImg">
            ${img}
          </div>

          <div>

            <p class="cartName">
              ${escapeHtml(it.title || it.pin)}
            </p>

            <div class="cartMeta">
              ${escapeHtml(it.pin)}
              •
              ${unitText}
            </div>

            <div class="cartRow">

              <div class="cartQty">

                <button
                  type="button"
                  data-act="minus"
                >
                  −
                </button>

                <input
                  value="${escapeHtml(String(it.qty || 1))}"
                  inputmode="numeric"
                />

                <button
                  type="button"
                  data-act="plus"
                >
                  +
                </button>

              </div>

              <button
                class="cartRemove"
                type="button"
                data-act="remove"
              >
                ✕
              </button>

            </div>

            <div
              class="cartMeta"
              style="margin-top:8px;"
            >
              Stock:
              ${escapeHtml(it.stock ?? "—")}
            </div>

          </div>
        </div>
      `;
    }).join("");

  [
    ...elCartBody.querySelectorAll(
      ".cartItem"
    )
  ].forEach(row => {

    const pin =
      row.getAttribute(
        "data-pin"
      ) || "";

    const input =
      row.querySelector(
        "input"
      );

    row.querySelector(
      'button[data-act="minus"]'
    )?.addEventListener(
      "click",
      () =>
        setCartQty(
          pin,
          Number(input?.value) - 1
        )
    );

    row.querySelector(
      'button[data-act="plus"]'
    )?.addEventListener(
      "click",
      () =>
        setCartQty(
          pin,
          Number(input?.value) + 1
        )
    );

    input?.addEventListener(
      "input",
      () => {

        const v =
          Number(input.value);

        if (!Number.isFinite(v)){
          return;
        }

        setCartQty(
          pin,
          v
        );
      }
    );

    row.querySelector(
      'button[data-act="remove"]'
    )?.addEventListener(
      "click",
      () =>
        removeFromCart(pin)
    );
  });

  const sum = cartTotal();

  const subEl =
    document.getElementById(
      "cartSubtotal"
    );

  if (subEl){

    subEl.textContent =
      cur === "EUR"
        ? `${sum.toFixed(2)} €`
        : `$${sum.toFixed(2)}`;
  }

  window.MPShipping?.refresh(
    sum,
    cur
  );

  setTimeout(
    () => {

      maybeInitPayPalCart();

      renderPayPalCartIfNeeded();
    },
    0
  );
}

elCartClear?.addEventListener(
  "click",
  () => {

    clearCart();

    toast(
      "Cart",
      "Cleared"
    );
  }
);

/* ==========================
   Stripe checkout
========================== */

async function startCheckout(){

  const cart = readCart();

  if (!cart.length){

    toast(
      "Checkout",
      "Cart is empty"
    );

    return;
  }

  try{
    localStorage.setItem(
      MP_SHIP_KEY,
      String(
        elShipCountry?.value || ""
      ).toUpperCase()
    );
  }catch(_){}

  enforceCurrencyByShipping();

  const shippingCountry =
    getShippingCountryISO2();

  if (
    !shippingCountry ||
    !window.MPShipping?.isReady?.()
  ){

    toast(
      "Shipping",
      "Please select a shipping country and wait for the DHL rate."
    );

    return;
  }

  const payload = {

    currency:
      getCurrency(),

    shippingCountry,

    items:
      cart.map(
        it => ({
          pin:
            String(it.pin),

          qty:
            Number(it.qty) || 1
        })
      )
  };

  if (elCartCheckout){

    elCartCheckout.disabled =
      true;

    elCartCheckout.textContent =
      "Redirecting…";
  }

  try{

    const r =
      await fetch(
        API_CHECKOUT,
        {
          method:"POST",

          headers:{
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(payload)
        }
      );

    const data =
      await r.json()
        .catch(()=>({}));

    if (
      !r.ok ||
      !data?.ok ||
      !data?.url
    ){
      throw new Error(
        data?.error ||
        "Checkout failed"
      );
    }

    window.location.href =
      data.url;

  }catch(e){

    toast(
      "Checkout",
      String(e?.message || e)
    );

    if (elCartCheckout){

      elCartCheckout.disabled =
        false;

      elCartCheckout.textContent =
        "Pay by card";
    }

  }finally{

    if (
      elCartCheckout &&
      !elCartCheckout.disabled
    ){
      elCartCheckout.textContent =
        "Pay by card";
    }
  }
}

elCartCheckout?.addEventListener(
  "click",
  startCheckout
);

/* ==========================
   PayPal CART
========================== */

function cartSnapshotKey(){

  const cart = readCart();

  const cur = getCurrency();

  const ship =
    String(
      elShipCountry?.value || ""
    ).toUpperCase();

  const itemsKey =
    cart
      .map(
        it =>
          `${String(it.pin)}:${Number(it.qty)||1}`
      )
      .sort()
      .join("|");

  return `${cur}|${ship}|${itemsKey}`;
}

async function maybeInitPayPalCart(){

  try{

    const cartOpen =
      elCartDrawer
        ?.classList
        .contains("show");

    const cart =
      readCart();

    if (!cartOpen){
      return;
    }

    if (!cart.length){

      if (elPpWrap){
        elPpWrap.style.display =
          "none";
      }

      clearPayPalCartButtons();

      ppCartRenderedForKey = "";

      return;
    }

    if (elPpWrap){
      elPpWrap.style.display =
        "flex";
    }

    enforceCurrencyByShipping();
    setCurrency(getCurrency());

    if (ppReady){

      renderPayPalCartIfNeeded();

      return;
    }

    if (ppLoading){
      return;
    }

    ppLoading = true;

    showPayPalCartNote(
      "PayPal is loading…"
    );

    const clientId =
      await fetchPayPalClientId();

    await loadPayPalSDK(
      clientId
    );

    ppReady = true;
    ppLoading = false;

    showPayPalCartNote("");

    renderPayPalCartIfNeeded();

  }catch(e){

    ppLoading = false;
    ppReady = false;

    showPayPalCartNote(
      `PayPal unavailable: ${
        String(e?.message || e)
      }`
    );
  }
}

function renderPayPalCartIfNeeded(){

  if (!ppReady){
    return;
  }

  if (
    !window.paypal ||
    typeof window.paypal.Buttons !== "function"
  ){
    return;
  }

  const cartOpen =
    elCartDrawer
      ?.classList
      .contains("show");

  if (!cartOpen){
    return;
  }

  const cart = readCart();

  if (!cart.length){

    clearPayPalCartButtons();

    ppCartRenderedForKey = "";

    return;
  }

  if (
    elPpWrap &&
    getComputedStyle(elPpWrap).display === "none"
  ){
    return;
  }

  const key =
    cartSnapshotKey();

  if (
    key ===
    ppCartRenderedForKey
  ){
    return;
  }

  ppCartRenderedForKey =
    key;

  const mySeq =
    ++ppRenderSeq;

  safeClose(
    ppCartButtons
  );

  ppCartButtons = null;

  Promise.resolve().then(
    () => {

      if (
        mySeq !==
        ppRenderSeq
      ){
        return;
      }

      const wrap =
        document.getElementById(
          "paypal-cart-container"
        );

      if (!wrap){
        return;
      }

      wrap.innerHTML = "";

      ppCartButtons =
        window.paypal.Buttons({

          style:{
            layout:"vertical",
            shape:"rect",
            label:"paypal",
            height:44
          },

          createOrder:
            async () => {

              const cartNow =
                readCart();

              if (!cartNow.length){
                throw new Error(
                  "Cart is empty"
                );
              }

              enforceCurrencyByShipping();
              setCurrency(getCurrency());

              const shippingCountry =
                getShippingCountryISO2();

              if (
                !shippingCountry ||
                !window.MPShipping?.isReady?.()
              ){
                throw new Error(
                  "Please select a shipping country and wait for the DHL rate."
                );
              }

              const payload = {

                currency:
                  getCurrency(),

                shippingCountry,

                items:
                  cartNow.map(
                    it => ({
                      pin:
                        String(it.pin),

                      qty:
                        Number(it.qty) || 1
                    })
                  )
              };

              const r =
                await fetch(
                  API_PP_CREATE,
                  {
                    method:"POST",

                    headers:{
                      "Content-Type":
                        "application/json"
                    },

                    body:
                      JSON.stringify(payload)
                  }
                );

              const data =
                await r.json()
                  .catch(()=>({}));

              if (
                !r.ok ||
                !data?.id
              ){
                throw new Error(
                  data?.error ||
                  "PayPal create order failed"
                );
              }

              return data.id;
            },

          onApprove:
            async (data) => {

              try{

                const orderID =
                  data?.orderID;

                if (!orderID){
                  throw new Error(
                    "Missing orderID"
                  );
                }

                const r =
                  await fetch(
                    API_PP_CAPTURE,
                    {
                      method:"POST",

                      headers:{
                        "Content-Type":
                          "application/json"
                      },

                      body:
                        JSON.stringify({
                          orderID
                        })
                    }
                  );

                const j =
                  await r.json()
                    .catch(()=>({}));

                if (
                  !r.ok ||
                  !j?.ok
                ){
                  throw new Error(
                    j?.error ||
                    "Capture failed"
                  );
                }

                writeCart([]);

                updateCartBadge();
                renderCart();

                toast(
                  "PayPal",
                  "Payment success ✅"
                );

                closeCart();

              }catch(e){

                toast(
                  "PayPal",
                  String(
                    e?.message || e
                  )
                );
              }
            },

          onCancel: () =>
            toast(
              "PayPal",
              "Canceled"
            ),

          onError: (err) =>
            toast(
              "PayPal",
              String(
                err?.message ||
                err ||
                "PayPal error"
              )
            )
        });

      try{

        ppCartButtons.render(
          "#paypal-cart-container"
        );

      }catch(_){}
    }
  );
}

/* Boot */

updateCartBadge();
enforceCurrencyByShipping();
setCurrency(getCurrency());
renderCart();

/* ==========================================================
   Airtable text -> HTML
========================================================== */

function mdInlineToHtml(line){

  let s =
    escapeHtml(line);

  s =
    s.replace(
      /\*\*(.+?)\*\*/g,
      "<strong>$1</strong>"
    );

  s =
    s.replace(
      /(^|[^*])\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
      "$1<em>$2</em>"
    );

  s =
    s.replace(
      /__(.+?)__/g,
      "<u>$1</u>"
    );

  s =
    s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      `<a href="$2"
          target="_blank"
          rel="noopener"
          style="color:inherit;
                 text-decoration:underline;
                 opacity:.95;">
         $1
       </a>`
    );

  return s;
}

function airtableTextToHtml(raw){

  const text =
    String(raw || "")
      .replace(/\r\n/g, "\n")
      .trim();

  if (!text){
    return "";
  }

  const lines =
    text.split("\n");

  let html = "";
  let inList = false;

  const closeList = () => {

    if (inList){

      html += "</ul>";

      inList = false;
    }
  };

  for (
    let i = 0;
    i < lines.length;
    i++
  ){

    const line =
      lines[i].trimEnd();

    if (!line.trim()){

      closeList();

      html +=
        "<div style='height:10px'></div>";

      continue;
    }

    if (
      line.startsWith("# ")
    ){

      closeList();

      html +=
        `<h3 style="
          margin:14px 0 8px;
          font-size:14px;
          letter-spacing:.2px;
        ">
          ${
            mdInlineToHtml(
              line.slice(2).trim()
            )
          }
        </h3>`;

      continue;
    }

    const isBullet =
      line.trim().startsWith("- ") ||
      line.trim().startsWith("• ");

    if (isBullet){

      if (!inList){

        html +=
          "<ul style='margin:10px 0 0 18px; padding:0; display:grid; gap:6px;'>";

        inList = true;
      }

      const item =
        line
          .trim()
          .replace(/^(- |• )/, "");

      html +=
        `<li style="
          color:var(--muted);
          font-size:13px;
          line-height:1.55;
        ">
          ${mdInlineToHtml(item)}
        </li>`;

      continue;
    }

    closeList();

    html +=
      `<p style="
        margin:0 0 10px;
        color:var(--muted);
        font-size:13px;
        line-height:1.65;
      ">
        ${mdInlineToHtml(line)}
      </p>`;
  }

  closeList();

  return html;
}

/* ==========================================================
   PayPal ONE item
========================================================== */

function oneSnapshotKey(){

  const p =
    currentProduct;

  if (!p){
    return "";
  }

  const cur =
    getCurrency();

  const ship =
    String(
      elShipCountry?.value || ""
    ).toUpperCase();

  const qty =
    Number(
      el("qty")?.value || 1
    ) || 1;

  return `${cur}|${ship}|${String(p.pin)}|${qty}`;
}

async function maybeInitPayPalOne(){

  const p =
    currentProduct;

  if (!p){
    return;
  }

  const stock =
    Number(p.stock || 0);

  if (stock <= 0){
    return;
  }

  const wrap =
    el("ppOneWrap");

  const note =
    el("ppOneNote");

  if (!wrap){
    return;
  }

  if (
    getComputedStyle(wrap).display ===
    "none"
  ){
    return;
  }

  enforceCurrencyByShipping();
  setCurrency(getCurrency());

  if (
    !ppReady &&
    !ppLoading
  ){

    try{

      ppLoading = true;

      if (note){

        note.textContent =
          "PayPal is loading…";

        note.style.display =
          "block";
      }

      const clientId =
        await fetchPayPalClientId();

      await loadPayPalSDK(
        clientId
      );

      ppReady = true;
      ppLoading = false;

    }catch(e){

      ppLoading = false;
      ppReady = false;

      if (note){

        note.textContent =
          `PayPal unavailable: ${
            String(e?.message || e)
          }`;

        note.style.display =
          "block";
      }

      return;
    }

  }else if (ppLoading){

    return;
  }

  if (
    !window.paypal ||
    typeof window.paypal.Buttons !==
      "function"
  ){
    return;
  }

  const key =
    oneSnapshotKey();

  if (
    key ===
    ppOneRenderedForKey
  ){
    return;
  }

  ppOneRenderedForKey =
    key;

  const mySeq =
    ++ppRenderSeq;

  safeClose(
    ppOneButtons
  );

  ppOneButtons = null;

  Promise.resolve().then(
    () => {

      if (
        mySeq !==
        ppRenderSeq
      ){
        return;
      }

      const wrapEl =
        document.getElementById(
          "paypal-one-container"
        );

      if (!wrapEl){
        return;
      }

      wrapEl.innerHTML = "";

      if (note){

        note.textContent = "";

        note.style.display =
          "none";
      }

      ppOneButtons =
        window.paypal.Buttons({

          style:{
            layout:"horizontal",
            tagline:false,
            height:44
          },

          createOrder:
            async () => {

              enforceCurrencyByShipping();
              setCurrency(getCurrency());

              const qtyInput =
                el("qty");

              const q =
                clampQty(
                  qtyInput?.value || 1,
                  Number(p.stock || 0)
                );

              const payload = {

                currency:
                  getCurrency(),

                shippingCountry:
                  getShippingCountryISO2(),

                items:[
                  {
                    pin:
                      String(p.pin),

                    qty:
                      Number(q) || 1
                  }
                ]
              };

              const r =
                await fetch(
                  API_PP_CREATE,
                  {
                    method:"POST",

                    headers:{
                      "Content-Type":
                        "application/json"
                    },

                    body:
                      JSON.stringify(payload)
                  }
                );

              const data =
                await r.json()
                  .catch(()=>({}));

              if (
                !r.ok ||
                !data?.id
              ){
                throw new Error(
                  data?.error ||
                  "PayPal create order failed"
                );
              }

              return data.id;
            },

          onApprove:
            async (data) => {

              try{

                const orderID =
                  data?.orderID;

                if (!orderID){

                  throw new Error(
                    "Missing orderID"
                  );
                }

                const r =
                  await fetch(
                    API_PP_CAPTURE,
                    {
                      method:"POST",

                      headers:{
                        "Content-Type":
                          "application/json"
                      },

                      body:
                        JSON.stringify({
                          orderID
                        })
                    }
                  );

                const j =
                  await r.json()
                    .catch(()=>({}));

                if (
                  !r.ok ||
                  !j?.ok
                ){
                  throw new Error(
                    j?.error ||
                    "Capture failed"
                  );
                }

                toast(
                  "PayPal",
                  "Payment success ✅"
                );

                if (j?.redirectUrl){
                  window.location.href =
                    j.redirectUrl;
                }

              }catch(e){

                toast(
                  "PayPal",
                  String(
                    e?.message || e
                  )
                );
              }
            },

          onCancel: () =>
            toast(
              "PayPal",
              "Canceled"
            ),

          onError: (err) =>
            toast(
              "PayPal",
              String(
                err?.message ||
                err ||
                "PayPal error"
              )
            )
        });

      try{

        ppOneButtons.render(
          "#paypal-one-container"
        );

      }catch(_){}
    }
  );
}

(function wireQtyForPayPalOne(){

  const qtyInput =
    el("qty");

  if (!qtyInput){
    return;
  }

  let t;

  qtyInput.addEventListener(
    "input",
    () => {

      clearTimeout(t);

      t =
        setTimeout(
          () => {

            ppOneRenderedForKey =
              "";

            maybeInitPayPalOne();
          },
          120
        );
    }
  );
})();

/* ==========================================================
   Carousel + Product load
========================================================== */

const hero =
  el("hero");

const heroInner =
  el("heroInner");

const carousel =
  el("carousel");

const prevBtn =
  el("prevBtn");

const nextBtn =
  el("nextBtn");

const counter =
  el("counter");

let currentIndex = 0;
let imagesState = [];
let carouselWired = false;

function getPinFromUrl(){

  const u =
    new URL(
      window.location.href
    );

  const qPin =
    (
      u.searchParams.get("pin") ||
      ""
    ).trim();

  if (qPin){
    return qPin;
  }

  const parts =
    u.pathname
      .split("/")
      .filter(Boolean);

  if (
    parts[0] === "p" &&
    parts[1]
  ){
    return decodeURIComponent(
      parts[1]
    ).trim();
  }

  return "";
}

function updateNav(){

  const n =
    imagesState.length;

  const hasMany =
    n > 1;

  if (counter){

    counter.style.display =
      n >= 2
        ? "block"
        : "none";

    counter.textContent =
      `${Math.min(currentIndex+1, n)} / ${n}`;
  }

  if (prevBtn){

    prevBtn.disabled =
      !hasMany ||
      currentIndex <= 0;
  }

  if (nextBtn){

    nextBtn.disabled =
      !hasMany ||
      currentIndex >= n - 1;
  }
}

function syncThumbs(){

  const thumbs =
    el("thumbs");

  if (!thumbs){
    return;
  }

  thumbs
    .querySelectorAll(".t")
    .forEach(
      t =>
        t.classList.remove(
          "active"
        )
    );

  const active =
    thumbs.querySelector(
      `.t[data-idx="${currentIndex}"]`
    );

  if (active){
    active.classList.add(
      "active"
    );
  }
}

function scrollToIndex(
  idx,
  smooth = true
){

  const n =
    imagesState.length;

  if (
    !n ||
    !carousel
  ){
    return;
  }

  currentIndex =
    Math.max(
      0,
      Math.min(
        idx,
        n - 1
      )
    );

  const x =
    carousel.clientWidth *
    currentIndex;

  carousel.scrollTo({
    left:x,
    behavior:
      smooth
        ? "smooth"
        : "auto"
  });

  syncThumbs();
  updateNav();
}

function detectIndexFromScroll(){

  if (!carousel){
    return;
  }

  const w =
    carousel.clientWidth || 1;

  const idx =
    Math.round(
      carousel.scrollLeft / w
    );

  const n =
    imagesState.length;

  const clamped =
    Math.max(
      0,
      Math.min(
        idx,
        Math.max(
          0,
          n - 1
        )
      )
    );

  if (
    clamped !==
    currentIndex
  ){

    currentIndex =
      clamped;

    syncThumbs();
  }

  updateNav();
}

function buildCarousel(
  images,
  title
){

  imagesState =
    images.slice();

  currentIndex = 0;

  if (!carousel){
    return;
  }

  carousel.innerHTML = "";

  if (!imagesState.length){

    carousel.innerHTML =
      `<div class="heroEmpty">
        No image
       </div>`;

    updateNav();

    return;
  }

  imagesState.forEach(
    (u) => {

      const s =
        document.createElement(
          "div"
        );

      s.className =
        "slide";

      s.innerHTML =
        `<img
          src="${escapeHtml(u)}"
          alt="${escapeHtml(title)}"
          draggable="false"
        />`;

      carousel.appendChild(s);
    }
  );

  requestAnimationFrame(
    () =>
      scrollToIndex(
        0,
        false
      )
  );
}

function renderThumbs(
  images,
  title
){

  const thumbs =
    el("thumbs");

  if (!thumbs){
    return;
  }

  thumbs.innerHTML = "";

  images.forEach(
    (u, idx) => {

      const d =
        document.createElement(
          "div"
        );

      d.className =
        "t" +
        (idx === 0
          ? " active"
          : "");

      d.dataset.idx =
        String(idx);

      d.innerHTML =
        `<img
          src="${escapeHtml(u)}"
          alt="${escapeHtml(title)}"
          draggable="false"
        />`;

      d.addEventListener(
        "click",
        () =>
          scrollToIndex(idx)
      );

      thumbs.appendChild(d);
    }
  );
}

function enableDragScroll(){

  if (!carousel){
    return;
  }

  let active = false;
  let locked = false;

  let startX = 0;
  let startY = 0;

  let lastX = 0;

  let pointerId = null;

  const THRESH = 6;

  const onDown = (e) => {

    if (
      e.pointerType === "mouse" &&
      e.button !== 0
    ){
      return;
    }

    active = true;
    locked = false;

    pointerId =
      e.pointerId;

    startX =
      e.clientX;

    startY =
      e.clientY;

    lastX =
      e.clientX;

    try{
      carousel.setPointerCapture(
        pointerId
      );
    }catch(_){}
  };

  const onMove = (e) => {

    if (
      !active ||
      pointerId == null
    ){
      return;
    }

    if (
      e.pointerId !==
      pointerId
    ){
      return;
    }

    const dx =
      e.clientX - startX;

    const dy =
      e.clientY - startY;

    if (!locked){

      if (
        Math.abs(dx) < THRESH &&
        Math.abs(dy) < THRESH
      ){
        return;
      }

      if (
        Math.abs(dy) >
        Math.abs(dx)
      ){

        active = false;
        pointerId = null;

        try{
          carousel.releasePointerCapture(
            e.pointerId
          );
        }catch(_){}

        return;
      }

      locked = true;

      carousel.classList.add(
        "dragging"
      );
    }

    if (locked){

      e.preventDefault();

      const ddx =
        e.clientX - lastX;

      lastX =
        e.clientX;

      carousel.scrollLeft -=
        ddx;
    }
  };

  const onUp = () => {

    const wasLocked =
      locked;

    active = false;
    locked = false;
    pointerId = null;

    carousel.classList.remove(
      "dragging"
    );

    if (wasLocked){

      detectIndexFromScroll();

      scrollToIndex(
        currentIndex
      );
    }
  };

  carousel.addEventListener(
    "pointerdown",
    onDown,
    { passive:true }
  );

  carousel.addEventListener(
    "pointermove",
    onMove,
    { passive:false }
  );

  carousel.addEventListener(
    "pointerup",
    onUp,
    { passive:true }
  );

  carousel.addEventListener(
    "pointercancel",
    onUp,
    { passive:true }
  );

  carousel.addEventListener(
    "lostpointercapture",
    onUp,
    { passive:true }
  );
}

function wireCarouselOnce(){

  if (carouselWired){
    return;
  }

  carouselWired = true;

  prevBtn?.addEventListener(
    "click",
    () =>
      scrollToIndex(
        currentIndex - 1
      )
  );

  nextBtn?.addEventListener(
    "click",
    () =>
      scrollToIndex(
        currentIndex + 1
      )
  );

  let t;

  carousel?.addEventListener(
    "scroll",
    () => {

      clearTimeout(t);

      t =
        setTimeout(
          detectIndexFromScroll,
          80
        );
    }
  );

  enableDragScroll();

  window.addEventListener(
    "resize",
    () =>
      scrollToIndex(
        currentIndex,
        false
      )
  );
}

function setupParallax(){

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

  if (
    reduceMotion ||
    !hero ||
    !heroInner
  ){
    return;
  }

  const target = {
    x:0,
    y:0,
    rx:0,
    ry:0,
    s:1.02
  };

  const curr = {
    x:0,
    y:0,
    rx:0,
    ry:0,
    s:1.02
  };

  function apply(){

    const k = 0.12;

    curr.x +=
      (target.x - curr.x) *
      k;

    curr.y +=
      (target.y - curr.y) *
      k;

    curr.rx +=
      (target.rx - curr.rx) *
      k;

    curr.ry +=
      (target.ry - curr.ry) *
      k;

    heroInner.style.transform =
      `translate3d(${curr.x}px, ${curr.y}px, 0)
       rotateX(${curr.rx}deg)
       rotateY(${curr.ry}deg)
       scale(${target.s})`;

    requestAnimationFrame(
      apply
    );
  }

  requestAnimationFrame(
    apply
  );

  function reset(){

    target.x = 0;
    target.y = 0;
    target.rx = 0;
    target.ry = 0;
  }

  hero.addEventListener(
    "mousemove",
    (e) => {

      const r =
        hero.getBoundingClientRect();

      const nx =
        (
          e.clientX -
          r.left
        ) /
        r.width -
        0.5;

      const ny =
        (
          e.clientY -
          r.top
        ) /
        r.height -
        0.5;

      const maxMove = 6;
      const maxTilt = 2.0;

      target.x =
        nx *
        maxMove;

      target.y =
        ny *
        maxMove;

      target.rx =
        (-ny) *
        maxTilt;

      target.ry =
        nx *
        maxTilt;
    }
  );

  hero.addEventListener(
    "mouseleave",
    reset
  );
}

function addToCart(
  p,
  qty
){

  qty = Number(qty);

  if (
    !Number.isFinite(qty) ||
    qty <= 0
  ){
    qty = 1;
  }

  const stock =
    Number(
      p.stock ?? 0
    );

  if (stock <= 0){

    toast(
      "Cart",
      "Sold out"
    );

    return;
  }

  const cart =
    readCart();

  const idx =
    cart.findIndex(
      x =>
        String(x.pin) ===
        String(p.pin)
    );

  if (idx >= 0){

    const next =
      Math.min(
        stock,
        (Number(cart[idx].qty)||0)
        + qty
      );

    cart[idx].qty =
      next;

    cart[idx].stock =
      stock;

    cart[idx].title =
      p.title;

    cart[idx].image =
      (
        p.images &&
        p.images[0]
      )
        ? p.images[0]
        : (
            cart[idx].image ||
            ""
          );

    cart[idx].price =
      p.price ||
      cart[idx].price ||
      {};

  }else{

    cart.push({

      pin:
        String(p.pin),

      qty:
        Math.min(
          stock,
          qty
        ),

      title:
        String(
          p.title ||
          p.pin
        ),

      image:
        (
          p.images &&
          p.images[0]
        )
          ? p.images[0]
          : "",

      price:
        p.price || {},

      stock
    });
  }

  writeCart(cart);

  updateCartBadge();

  if (
    elCartDrawer
      ?.classList
      .contains("show")
  ){

    renderCart();

    ppCartRenderedForKey = "";

    setTimeout(
      () =>
        maybeInitPayPalCart(),
      0
    );
  }

  toast(
    "Cart",
    "Added ✅"
  );
}

async function buyNowOneItemStripe(
  p,
  qty
){

  enforceCurrencyByShipping();

  try{

    localStorage.setItem(
      MP_SHIP_KEY,
      String(
        elShipCountry?.value || ""
      ).toUpperCase()
    );

  }catch(_){}

  const payload = {

    currency:
      getCurrency(),

    shippingCountry:
      getShippingCountryISO2(),

    items:[
      {
        pin:
          String(p.pin),

        qty:
          Number(qty) || 1
      }
    ]
  };

  const r =
    await fetch(
      API_CHECKOUT,
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );

  const data =
    await r.json()
      .catch(()=>({}));

  if (
    !r.ok ||
    !data?.ok ||
    !data?.url
  ){
    throw new Error(
      data?.error ||
      "Checkout failed"
    );
  }

  window.location.href =
    data.url;
}

async function loadProduct(){

  updateCartBadge();

  enforceCurrencyByShipping();

  setCurrency(
    getCurrency()
  );

  const pin =
    getPinFromUrl();

  if (!pin){

    window.location.replace("/");

    return;
  }

  let r;
  let data;

  try{

    r =
      await fetch(
        `${API_PRODUCT}?pin=${encodeURIComponent(pin)}`,
        {
          cache:"no-store"
        }
      );

    data =
      await r.json()
        .catch(()=>({}));

  }catch(_){

    el("hTitle").textContent =
      "Network error";

    el("hSub").textContent =
      "API is not reachable";

    toast(
      "Error",
      "Product API is not reachable"
    );

    return;
  }

  if (!r.ok){

    el("hTitle").textContent =
      "Not found";

    el("hSub").textContent =
      data?.error ||
      "Product not found";

    return;
  }

  const p =
    data.product;

  currentProduct =
    p;

  document.title =
    `${p.title} • Mosaic Pins`;

  el("hTitle").textContent =
    p.title;

  el("hSub").textContent =
    `${p.pin} • Ø ${p.diameter ?? "—"} mm`;

  el("kicker").textContent =
    p.type
      ? String(p.type)
      : "";

  el("title").textContent =
    p.title;

  const d =
    (p.description || "")
      .trim();

  const descEl =
    el("desc");

  if (descEl){

    if (
      /<[a-z][\s\S]*>/i.test(d)
    ){
      descEl.innerHTML = d;
    }else{
      descEl.innerHTML =
        airtableTextToHtml(d);
    }
  }

  const chips = [];

  (p.materials || [])
    .forEach(
      m =>
        chips.push(m)
    );

  if (p.color){
    chips.push(
      `Color: ${p.color}`
    );
  }

  if (p.diameter != null){
    chips.push(
      `Ø ${p.diameter} mm`
    );
  }

  el("chips").innerHTML =
    chips
      .map(
        c =>
          `<span class="chip">
            ${escapeHtml(c)}
           </span>`
      )
      .join("");

  const images =
    Array.isArray(p.images)
      ? p.images
      : [];

  buildCarousel(
    images,
    p.title
  );

  renderThumbs(
    images,
    p.title
  );

  wireCarouselOnce();
  updateNav();

  const stock =
    Number(
      p.stock || 0
    );

  const badge =
    el("stockBadge");

  const buyBtn =
    el("buyBtn");

  const addBtn =
    el("addBtn");

  const qtyInput =
    el("qty");

  const paypalDirectBtn =
    el("paypalDirectBtn");

  if (stock > 0){

    badge.textContent =
      `In stock: ${stock}`;

    badge.classList.remove(
      "sold"
    );

    buyBtn.disabled =
      false;

    addBtn.disabled =
      false;

    if (paypalDirectBtn){
      paypalDirectBtn.disabled = false;
    }

  }else{

    badge.textContent =
      "Sold out";

    badge.classList.add(
      "sold"
    );

    buyBtn.disabled =
      true;

    addBtn.disabled =
      true;

    if (paypalDirectBtn){
      paypalDirectBtn.disabled = true;
    }
  }

  qtyInput.value = "1";

  const setQty = (v) => {

    qtyInput.value =
      String(
        clampQty(
          v,
          stock
        )
      );
  };

  el("minus").onclick =
    () =>
      setQty(
        Number(qtyInput.value) - 1
      );

  el("plus").onclick =
    () =>
      setQty(
        Number(qtyInput.value) + 1
      );

  qtyInput.oninput =
    () =>
      setQty(
        qtyInput.value
      );

  el("price").textContent =
    priceText(p.price);

  refreshPriceUI();

  addBtn.onclick = () => {

    const quantity =
      clampQty(
        qtyInput.value,
        stock
      );

    if (stock <= 0){
      return;
    }

    addToCart(
      p,
      quantity
    );
  };

  buyBtn.onclick = () => {

    const quantity =
      clampQty(
        qtyInput.value,
        stock
      );

    if (stock <= 0){
      return;
    }

    addToCart(
      p,
      quantity
    );

    openCart();

    toast(
      "Checkout",
      "Choose your shipping country in the cart."
    );
  };

  /*
   * Product-page PayPal button intentionally opens the cart first.
   * Shipping country and the server-side DHL rate are confirmed there
   * before the real PayPal SDK button can be used.
   */
  if (paypalDirectBtn){
    paypalDirectBtn.onclick = () => {
      const quantity =
        clampQty(
          qtyInput.value,
          stock
        );

      if (stock <= 0){
        return;
      }

      addToCart(
        p,
        quantity
      );

      openCart();

      toast(
        "PayPal",
        "Confirm your shipping country, then continue with PayPal."
      );
    };
  }

  setupParallax();
}

(function init(){

  updateCartBadge();

  renderCart();

  enforceCurrencyByShipping();

  setCurrency(
    getCurrency()
  );

  loadProduct();
})();
