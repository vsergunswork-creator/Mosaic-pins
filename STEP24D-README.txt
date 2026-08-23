Mosaic Pins step24d — About mobile hero natural ratio
Base: Mosaic-pins-main(20260823-191512).zip

Changes:
- Mobile About hero no longer forces 16:7.
- Hero container follows the real Airtable banner image ratio on all screen sizes.
- Mobile fallback is 4:1 until image dimensions load.
- Background remains contain / centered; no cropping.
- Desktop behavior is preserved (it already used the real image ratio).
- Cache-busted about.css and about.js refs in about.html.
