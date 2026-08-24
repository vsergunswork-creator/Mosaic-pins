STEP38 — MATERIAL BADGES I18N

Airtable:
- New table: MaterialTranslations
- Products keep using the existing single Materials multiple-select field.
- Material translations are read centrally and applied automatically.

Replace these files:
- index.html
- product.html
- assets/js/index.js
- assets/js/product.js
- functions/api/_airtable-products.js

Then deploy.

Fallback behavior:
If a material has no dictionary row/translation, its original English label is shown.
