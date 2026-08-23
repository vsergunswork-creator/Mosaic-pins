Mosaic Pins — step24 MOBILE/DESKTOP SYNC CLEANUP

Base: Mosaic-pins-main(20260823-184542).zip

Changed:
- Shared mobile slide-menu behavior centralized in assets/css/ui-unify.css + assets/js/site-common.js.
- Mobile Shop control order is canonical: Search -> In stock -> Language/Currency -> Filters.
- Filters is a normal action button, not a duplicate hamburger.
- About / Reviews / Product mobile inner panels inherit the calmer approved desktop visual language.
- Mobile footer contract remains Privacy + Impressum with the full Mosaic Pins Space brand.
- Account page class is resolved centrally from URL.
- Old index-only step23j mobile ordering CSS removed to avoid future desktop/mobile divergence.
- Shared asset versions bumped to step24 on all primary pages.

Not changed:
- Checkout/payment logic
- Account backend / My Orders backend
- Reviews backend / upload logic
- Stripe / PayPal / DHL / transactional email logic
