# Mosaic Pins — production deployment checklist

Updated: 16.08.2026

Use this checklist after the Airtable Team upgrade.

---

## A. Airtable

### Products table

Required fields:

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

Required fields:

- `Order ID`
- `Products`
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
- `Paid Email Sent`
- `Shipped Email Sent`
- `OrderCode`

Optional:

- `Carrier`

If `Carrier` is not present, the shipping email displays:
`DPD / DHL`

### TODO after Airtable Team upgrade

- Verify Products API works again.
- Verify Orders API works again.
- Confirm Airtable no longer returns:
  `429 PUBLIC_API_BILLING_LIMIT_EXCEEDED`

---

## B. Cloudflare Pages — production configuration

### Airtable

Configured:

- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_NAME`
- `AIRTABLE_ORDERS_TABLE_NAME=Orders`
- Airtable content/reviews variables where required

### Stripe

Production must have:

- `STRIPE_SECRET_KEY` — LIVE
- `STRIPE_WEBHOOK_SECRET`
- `SITE_URL=https://mosaicpins.space`

Production webhook:

`https://mosaicpins.space/api/stripe-webhook`

Legacy compatibility endpoint:

`/api/stripe-email-webhook`

### PayPal

Configured for LIVE:

- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID` — LIVE Business Client ID
- `PAYPAL_CLIENT_SECRET` — LIVE Business Secret

DO NOT switch production back to Sandbox.

### Email

Configured:

- `STORE_NAME=Mosaic Pins`
- `MAIL_FROM=support@mosaicpins.space`
- `MAIL_REPLY_TO=mosaicpinsspace@gmail.com`
- `MAIL_BCC=mosaicpinsspace@gmail.com`
- `MAILCHANNELS_API_KEY`

A new MailChannels API key was created for the new notification system.
The old exposed MailChannels key was deleted.

### Cloudflare bindings

Required:

- `STRIPE_EVENTS_KV`
- `PRODUCT_IMAGES`
- `R2_PUBLIC_BASE_URL`

---

## C. New notification Worker

New Worker:

`mosaic-notifications`

Status:

- Deployed successfully
- Production variables configured
- Secrets configured
- Observability / Logs enabled
- Cron Trigger configured
- Worker successfully reaches Airtable
- Current Airtable response is 429 because the Airtable API billing limit is exhausted

### Worker secrets

Configured:

- `AIRTABLE_TOKEN`
- `MAILCHANNELS_API_KEY`
- `CRON_SECRET`

### Worker purpose

One Worker now handles BOTH email flows:

1. Paid order email
2. Shipping / Tracking Number email

The same notification system is used for orders paid through:

- Stripe
- PayPal

The payment provider updates/creates the order in Airtable.
The notification Worker processes the Airtable order state.

### Cron schedule

Current production schedule:

`0 * * * *`

This means:

**Once per hour**

The previous `*/5 * * * *` schedule was intentionally changed because
checking Airtable every 5 minutes consumed too many Airtable API requests.

The combined Worker normally makes one Airtable list request per scheduled
check when there are no notifications to process.

IMPORTANT:

Because the Worker currently runs once per hour, a Tracking Number email
may take up to approximately one hour to be sent.

---

## D. Old notification Workers

Old Workers currently still exist in Cloudflare.

DO NOT delete them until the new notification system passes the complete
production test.

After successful Stripe + PayPal + tracking tests:

- Disable/delete old email notification Workers.
- Keep `mosaic-notifications`.
- Keep the main `mosaic-pinsspace` Pages project.

The old Workers currently show failed builds because their old source
folders were removed from the repository.

Backup copies of the old files are available locally if recovery is needed.

---

## E. Tomorrow — first checks after Airtable Team upgrade

### 1. Check Airtable

Confirm API access works and the 429 billing-limit error is gone.

### 2. Production system check

Open:

`https://mosaicpins.space/api/system-check`

Expected:

- `ok: true`
- Products Airtable request = 200
- Orders Airtable request = 200
- Stripe production configuration present
- PayPal credentials present
- `paypalMode: "live"`
- `paypalLive: true`
- Mail configuration present
- KV binding present
- R2 binding present

Do not continue to real payment tests until the system check is healthy.

---

## F. Catalog test

1. Change one test product in Airtable.
2. Do NOT use an old manual sync URL.
3. Wait for the catalog cache to refresh.
4. Verify the change appears automatically on mosaicpins.space.
5. Verify product images load correctly.

---

## G. Stripe LIVE test

Make one small REAL Stripe purchase.

Verify:

- Payment succeeds.
- Exactly ONE Orders record is created.
- Correct product is linked.
- Quantity is correct.
- Currency and Amount Total are correct.
- Customer information is correct.
- Stock decreases exactly ONCE.
- `Order Status` becomes paid.
- Customer confirmation email arrives.
- BCC/store copy arrives if enabled.
- `Paid Email Sent` becomes checked.

Also verify:

- Stripe cancel returns correctly to `/cancel`.
- Refresh/retry does not create a duplicate order.
- Stock is not decreased twice.

---

## H. PayPal LIVE test

Make one small REAL PayPal purchase.

Verify:

- PayPal is LIVE — no Sandbox branding/endpoints.
- Payment succeeds.
- Exactly ONE Orders record is created.
- Correct product is linked.
- Quantity is correct.
- Currency and Amount Total are correct.
- Customer information is correct.
- Stock decreases exactly ONCE.
- `Order Status` becomes paid.
- Customer confirmation email arrives.
- `Paid Email Sent` becomes checked.

Also verify:

- No duplicate Airtable order.
- No duplicate stock reduction.
- No duplicate confirmation email.

---

## I. Tracking / shipping email test

Use one of the test orders.

1. Enter a test `Tracking Number` in Airtable.
2. Do NOT call a manual shipping-email URL.
3. Wait for `mosaic-notifications`.

Because Cron currently runs once per hour, allow up to approximately
one hour for automatic processing.

Verify:

- Shipping email arrives.
- Correct Order ID / OrderCode is shown.
- Correct Tracking Number is shown.
- Carrier displays correctly.
- `Shipped Email Sent` becomes checked.
- The email is sent only once.

For faster testing, the Worker may be triggered manually while observing
Cloudflare logs.

---

## J. Cloudflare Observability

During tests check:

Cloudflare
→ Workers & Pages
→ mosaic-notifications
→ Observability

Verify:

- Scheduled Worker runs successfully.
- No Airtable 429 after Team upgrade.
- No MailChannels errors.
- No repeated processing of already-sent emails.
- No unexpected Worker exceptions.

---

## K. Regression test

Before opening the store publicly verify:

- Shop works.
- Product pages work.
- About works.
- Shipping works.
- Returns works.
- Reviews works.
- Navigation order is correct on every page.
- Cart works from Shop.
- Cart works from About.
- Cart works from Reviews.
- Cart works from Product pages.
- Product image/gallery works.
- Mobile menu works.
- Mobile cart works.
- Stripe checkout works.
- PayPal checkout works.
- Stripe cancel page works.
- No Sandbox PayPal configuration remains in production.

---

## L. Cleanup after successful tests

ONLY after all production tests pass:

1. Disable/delete the old email Workers.
2. Keep `mosaic-notifications`.
3. Keep `mosaic-pinsspace`.
4. Verify old cron schedules are gone.
5. Verify only the new notification schedule remains.
6. Check Cloudflare Observability one final time.
7. Commit final configuration/documentation changes to GitHub.

---

## M. Open store

Only after ALL tests above pass:

- Remove/disable Cloudflare Access protection used during development.
- Open mosaicpins.space to customers.
- Make one final mobile test.
- Make one final desktop test.

PRODUCTION READY only when:

Airtable ✅
Stripe LIVE ✅
PayPal LIVE ✅
Stock update ✅
Paid email ✅
Tracking email ✅
MailChannels ✅
KV ✅
R2/images ✅
Mobile ✅
No duplicate orders/payments/emails ✅
Old notification Workers disabled ✅
