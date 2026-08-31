# Mosaic Pins Space architecture

## 1. Product/catalog flow

Airtable `Products` is the only product source of truth.

`Browser -> /api/products -> Cloudflare KV cache -> Airtable`

- Catalog cache TTL: 3 minutes.
- No manual refresh URL is required.
- Checkout never trusts cached price or stock; it reads current products from Airtable.
- Product images are mirrored automatically from temporary Airtable attachment URLs to R2.
- When a payment changes stock, the product cache is invalidated automatically.

## 2. Stripe flow

1. Customer starts checkout.
2. `/api/checkout` validates current price, active state and stock in Airtable.
3. The validated cart is stored temporarily in KV. Stripe metadata contains only its short KV key, avoiding Stripe metadata size limits.
4. Stripe sends `checkout.session.completed` to `/api/stripe-webhook` (the old `/api/stripe-email-webhook` URL is a compatibility alias to the same handler).
5. Signature is verified.
6. Order is upserted in Airtable.
7. Stock is decremented once using KV idempotency markers and per-product locks.
8. Catalog cache is invalidated.
9. Customer paid-confirmation email is queued immediately.
10. If immediate email fails, the scheduled Notification Worker finds `Paid Email Sent != true` and retries automatically.

## 3. PayPal flow

1. `/api/paypal/create-order` validates current products/prices/stock.
2. `/api/paypal/capture` captures the payment.
3. Order is created/upserted in Airtable.
4. Stock is decremented once. PayPal uses the same per-product lock namespace as Stripe, reducing Stripe/PayPal stock races.
5. Catalog cache is invalidated.
6. Paid-confirmation email is queued immediately.
7. Notification Worker retries automatically if needed.

`PAYPAL_MODE` must be explicitly set to `live` or `sandbox`. Missing mode is an error; production readiness requires `live`.

## 4. Tracking/shipping email

You only enter `Tracking Number` in the Airtable `Orders` record.

Every 5 minutes the single `mosaic-notifications` Worker runs one combined Airtable query for:

- paid orders whose `Paid Email Sent` is unchecked;
- orders with a tracking number whose `Shipped Email Sent` is unchecked.

It sends the required email and marks the corresponding checkbox. No manual URL is required.

One combined query is used instead of two independent workers, reducing Airtable API usage.

## 5. Front-end organization

- HTML files contain page structure only.
- Page CSS lives under `assets/css/`.
- Page JavaScript lives under `assets/js/`.
- `assets/js/site-common.js` owns common footer-year and sidebar ordering/active-state behavior.
- Sidebar order is always: `Shop -> About -> Shipping -> Returns -> Reviews`.
- Canonical internal links use clean URLs such as `/about`, not mixed `.html` variants.
- Footer order is standardized on pages that contain a footer.

## 6. Removed legacy architecture

The following are no longer part of the live architecture:

- D1 product/content source of truth;
- `/api/sync-products`;
- `/api/sync-content`;
- separate paid-email and shipped-email cron workers;
- duplicated Stripe email implementation.

## 7. Reliability principles

- Airtable is the source of truth.
- Prices and stock are revalidated server-side at checkout.
- Payment webhooks are idempotent.
- Stripe and PayPal share stock lock keys.
- Email delivery has immediate attempt + scheduled fallback.
- Payment retries never intentionally clear an already-entered Tracking Number.
- `/api/system-check` exposes readiness booleans/statuses, never secret values.
