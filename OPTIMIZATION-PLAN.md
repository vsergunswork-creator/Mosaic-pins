# Mosaic Pins optimization plan — completed

## Goal
Keep Airtable as the single source of truth, restore full payment/order/email automation, remove manual sync work, and make the codebase safer to maintain.

## Completed

1. **Airtable-first backend**
   - Products/content read from Airtable.
   - D1 sync endpoints removed.
   - Automatic KV cache remains only as a performance layer.

2. **Automatic stock management**
   - Stripe and PayPal validate fresh Airtable stock before checkout/capture.
   - Payment finalization decrements Airtable stock once.
   - Stripe and PayPal share per-product KV lock keys to reduce cross-provider race conditions.
   - Product cache invalidates after stock changes.

3. **Stripe hardening**
   - Validated cart data is stored in KV instead of large Stripe metadata.
   - Removes the old ~450-character cart metadata limitation.
   - Unique checkout idempotency key per checkout attempt.
   - Legacy Stripe email-webhook URL routes to the canonical Stripe webhook implementation.

4. **Order safety**
   - Payment retries/upserts do not erase an existing Tracking Number.
   - Existing email-sent checkboxes are preserved by PATCH updates.

5. **Email architecture**
   - One shared MailChannels transport/template module.
   - Paid email attempted immediately after successful Stripe/PayPal finalization.
   - If immediate delivery fails, scheduled worker retries automatically.
   - Tracking email is automatic after a Tracking Number is entered in Airtable.

6. **Cron/API usage optimization**
   - Replaced two cron workers with one `mosaic-notifications` worker.
   - One combined Airtable query checks both paid and shipped notifications every 5 minutes.

7. **Front-end cleanup**
   - Large inline CSS moved to `assets/css/`.
   - Large inline JavaScript moved to `assets/js/`.
   - Product page scripts combined into one page module.
   - Common navigation/footer behavior lives in `site-common.js`.
   - Internal links use canonical clean URLs.
   - Sidebar order is consistent on all pages.
   - Footer order standardized where a footer exists.

8. **Routing/security**
   - Removed broad SPA fallback that returned the home page for unknown URLs.
   - Added conservative security headers without a risky CSP that could break Stripe/PayPal.

9. **Production readiness**
   - `/api/system-check` now checks both Airtable tables, mail variables, Stripe, PayPal, KV and R2.
   - Production check explicitly fails while PayPal is still in Sandbox.
   - Deployment/test instructions updated in `DEPLOY-TOMORROW.md`.

## Intentionally not over-generalized
Page-specific storefront JS still stays in separate page modules (`index.js`, `about.js`, `reviews.js`, `product.js`). These pages have different DOM structures and behavior. Forcing them into one giant generic component immediately before a production launch would increase regression risk without improving customer-facing reliability. The shared/global concerns were centralized; page-specific behavior remains page-specific.
