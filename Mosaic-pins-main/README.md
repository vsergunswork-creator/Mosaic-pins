# Mosaic Pins Space

Production storefront for **mosaicpins.space**.

## Architecture

- **Cloudflare Pages + Functions** — storefront and server API
- **Airtable** — source of truth for products, content, reviews and orders
- **Cloudflare KV** — short-lived catalog cache, Stripe checkout hand-off and payment idempotency/locks
- **Cloudflare R2** — durable copies of Airtable product/content images
- **Stripe + PayPal** — payments
- **MailChannels** — transactional customer email
- **Notification Worker** — automatic fallback/retry for paid emails and tracking emails

There is no manual Airtable → D1 sync in the production path. D1 is no longer used.

See `ARCHITECTURE.md` and `DEPLOY-TOMORROW.md` before deployment.
