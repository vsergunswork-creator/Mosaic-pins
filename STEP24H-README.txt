Mosaic Pins step24h — Branded transactional emails

Changes:
- Paid/order confirmation email: uses the Mosaic Pins circular brand mark and “Mosaic Pins Space”.
- DHL shipped email: same branded header.
- 6-digit passwordless sign-in code email: same branded header.
- Mail sender display name is “Mosaic Pins Space”.
- Standalone notification-worker STORE_NAME updated to “Mosaic Pins Space”.

Logo source used inside email HTML:
https://mosaicpins.space/assets/img/mosaic-pins-mark.png

Deployment note:
- Pages/GitHub deployment updates functions/api/_email.js and functions/api/account/request-code.js.
- The standalone Cloudflare Worker `mosaic-notifications` must also be updated/deployed from notification-worker/index.js (as with step22), otherwise paid/shipped emails will keep the old template.

Important:
The Gmail sender avatar (colored circle shown by Gmail outside the email body) is controlled by Gmail/BIMI and is not changed by HTML email. This patch changes the visible brand inside emails and sender display name only.
