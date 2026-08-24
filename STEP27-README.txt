Mosaic Pins step27 — ALL EMAILS LIGHT OUTER CANVAS

Changes:
- All transactional emails now use a white outer email canvas.
- The existing dark Mosaic Pins Space branded card stays centered inside it.
- Applies to:
  * 6-digit sign-in code email (Pages / functions/api/_email.js)
  * paid/order confirmation email
  * DHL shipped/tracking email
  * standalone mosaic-notifications worker copy of paid/shipped templates
- Existing brand logo, dark card colors, green accent, translations, DKIM and email logic are preserved.

Deploy:
1) Deploy functions/api/_email.js with the normal site/Pages deployment.
2) IMPORTANT: separately update/deploy notification-worker/index.js to standalone Cloudflare Worker mosaic-notifications.
