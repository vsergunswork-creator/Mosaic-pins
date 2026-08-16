// ✅ очищаем корзину
    try { localStorage.setItem("mp_cart", "[]"); } catch(e) {}

    // ✅ возвращаем на главную с флагом, чтобы index.html показал toast + обновил stock
    setTimeout(() => {
      location.replace("/?success=1");
    }, 400);
