// ✅ year in footer
    document.getElementById("year").textContent = new Date().getFullYear();

    // ✅ if user came from Stripe success/canceled — redirect to main
    (function(){
      const u = new URL(window.location.href);
      const ok = u.searchParams.get("success")==="1";
      const cn = u.searchParams.get("canceled")==="1";
      if(ok || cn){
        window.location.replace("/?" + (ok ? "success=1" : "canceled=1"));
      }
    })();
