# Mosaic Pins — DHL live shipping update

Prepared for the current repository version.

## What changed

- Removed the shipping-country selector from the top navigation on Shop, Product, About and Reviews.
- Added one shipping-country selector inside the cart.
- Country list is loaded from the DHL Parcel DE Private Shipping Product Catalog.
- Only regular tracked DHL Paket / Parcel products that can carry at least 2 kg are offered.
- Shipping price is calculated server-side from DHL and shown in the cart before payment.
- DHL Product Catalog is cached for ~23 hours (with a stale fallback) to stay well below the 500 requests/day DHL limit.
- Stripe and PayPal now use the same server-side DHL quote.
- Stripe is restricted to the exact country selected in the cart.
- PayPal verifies the actual PayPal shipping country before capture and refuses capture if it differs from the cart country.
- Product-page direct PayPal was removed. “Buy now” now adds the item and opens the cart so shipping can be selected first.
- Shipping information page no longer contains hard-coded country-zone prices.

## Cloudflare secrets

Required:
- DHL_API_KEY (Secret)

Optional / already stored for future DHL operations:
- DHL_API_SECRET (Secret)

The Product Catalog authentication documented by DHL uses `dhl-api-key`.

## New endpoints

- GET /api/shipping/countries
- GET /api/shipping/quote?country=GB&currency=EUR

## Important first-deploy test

DHL warns that newly created API keys can take up to 24 hours to become active.
If the key is not active yet, the cart will safely show that DHL countries/rates are unavailable and payment buttons remain blocked.

When active, first verify:
- Germany -> expected current DHL tracked 2 kg rate
- United Kingdom -> expected current DHL tracked 2 kg rate
- France
- Switzerland
- USA
- Canada
- Australia
- Japan

Then test one Stripe checkout and one PayPal checkout.
