# Mosaic Pins — production deployment checklist

Use this file after the Airtable Team upgrade.

## A. Airtable fields

### Products table
Required by the current storefront:
- `PIN Code`
- `Title`
- `Description`
- `Type`
- `Diameter`
- `Color`
- `Materials`
- `Stock`
- `Price_EUR`
- `Price_USD`
- `Images`
- `Active`

### Orders table
Required:
- `Order ID`
- `Products` (linked Products records)
- `Quantity`
- `Currency`
- `Order Status`
- `Refund Status`
- `Customer Name`
- `Customer Email`
- `Telefon`
- `Shipping Address`
- `Shipping Country`
- `Shipping City`
- `Shipping Postal Code`
- `Shipping State/Region`
- `Tracking Number`
- `Created At`
- `Amount Total`
- `Stripe Session ID`
- `Payment Intent ID`
- `Paid Email Sent` (checkbox)
- `Shipped Email Sent` (checkbox)
- `OrderCode` if you want the short friendly order code shown in emails

Optional:
- `Carrier` (set `AIRTABLE_CARRIER_FIELD=Carrier` if added). Without it shipping email displays `DPD / DHL`.

## B. Cloudflare Pages variables/secrets

Verify production environment has:

### Airtable
- `AIRTABLE_TOKEN` — secret
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_NAME` — Products table name
- `AIRTABLE_ORDERS_TABLE_NAME=Orders`
- `AIRTABLE_CONTENT_TABLE_NAME=SiteContent` if About content is in Airtable
- `AIRTABLE_REVIEWS_TABLE` / `AIRTABLE_TOKEN_REVIEWS` only if your existing reviews endpoint uses separate settings

### Stripe
- `STRIPE_SECRET_KEY` — LIVE secret in production
- `STRIPE_WEBHOOK_SECRET` — secret for the production webhook endpoint
- `SITE_URL=https://mosaicpins.space`

Production Stripe webhook should point to:
- `https://mosaicpins.space/api/stripe-webhook`

The legacy `/api/stripe-email-webhook` path is kept as a compatibility alias, but use the canonical URL above.

### PayPal
- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID` — LIVE client id
- `PAYPAL_CLIENT_SECRET` — LIVE secret

Do not deploy production with `PAYPAL_MODE=sandbox`.

### Email
- `STORE_NAME=Mosaic Pins`
- `MAIL_FROM=support@mosaicpins.space`
- `MAIL_REPLY_TO=mosaicpinsspace@gmail.com`
- `MAIL_BCC=mosaicpinsspace@gmail.com` (optional; useful as your own copy/notification)
- `MAILCHANNELS_API_KEY` if your MailChannels account requires it

### Cloudflare bindings
- `STRIPE_EVENTS_KV` — required
- `PRODUCT_IMAGES` — R2 binding
- `R2_PUBLIC_BASE_URL` — public base URL for the R2 bucket/custom domain

### Optional/manual endpoint protection
- `CRON_SECRET` — strong random secret

## C. Deploy Pages

1. Commit this version to GitHub `main`.
2. Wait for Cloudflare Pages production deployment.
3. Open:
   `https://mosaicpins.space/api/system-check`
4. In production, readiness should report:
   - `ok: true`
   - both Airtable tables reachable (`200`)
   - Stripe secrets present
   - PayPal credentials present
   - `paypalMode: "live"`
   - `paypalLive: true`
   - mail settings present
   - KV and R2 bindings present

## D. Replace the old two cron workers with one

New worker: `notification-worker/`

Deploy from the repository root with Wrangler using its config, or through the Cloudflare Worker UI/build pipeline.

The Worker needs these secrets/environment values too:
- secret: `AIRTABLE_TOKEN`
- secret: `CRON_SECRET`
- secret: `MAILCHANNELS_API_KEY` only if required
- the non-secret values in `notification-worker/wrangler.toml`

After the new `mosaic-notifications` Worker is active, DISABLE the old scheduled workers:
- `mosaic-paid-check`
- `mosaic-ship-check`

Do not leave all three cron schedules active long term.

The new worker runs every 5 minutes and uses one combined Airtable list query per run.

## E. Test before opening the store

### 1. Catalog
- Add/change a product in Airtable.
- Do NOT call any sync URL.
- Verify the change appears automatically within the catalog cache window (normally <= 3 minutes).

### 2. Stripe live test
Use a small real purchase:
- payment succeeds;
- one Orders record appears;
- correct Products links and quantity;
- stock decreases once;
- customer confirmation email arrives;
- `Paid Email Sent` becomes checked.

### 3. PayPal live test
Repeat with PayPal:
- payment succeeds;
- order appears;
- stock decreases once;
- confirmation email arrives;
- no Sandbox branding/endpoint is used.

### 4. Tracking email
On one test order enter `Tracking Number` in Airtable.
- no manual URL;
- within <= 5 minutes shipping email arrives;
- `Shipped Email Sent` becomes checked.

### 5. Regression checks
- Shop, About, Shipping, Returns, Reviews navigation stays in the same order on every page.
- Cart works from Shop/About/Reviews/Product.
- Stripe cancel returns to `/cancel`.
- Product image/gallery works.
- Mobile menu/cart works.

Only after all tests pass should Cloudflare Access protection be removed/opened to customers.
