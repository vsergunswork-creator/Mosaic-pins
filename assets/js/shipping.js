// Footer year only. Shipping prices are calculated live in the cart via DHL.
(function(){
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
