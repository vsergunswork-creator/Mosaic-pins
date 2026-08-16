// ✅ чтобы index.html показал toast "Canceled"
    setTimeout(() => {
      location.replace("/?canceled=1");
    }, 200);
