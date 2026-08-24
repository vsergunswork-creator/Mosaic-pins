Mosaic Pins Space — BIMI self-asserted setup

1) Deploy this patch so the logo is publicly available at:
   https://mosaicpins.space/assets/img/mosaic-pins-bimi.svg

2) Confirm the URL opens directly over HTTPS.

3) Add Cloudflare DNS TXT record:
   Name: default._bimi
   Content: v=BIMI1; l=https://mosaicpins.space/assets/img/mosaic-pins-bimi.svg; a=;
   TTL: Auto (or 1 hour)

Current status:
- SPF: PASS
- DKIM: PASS
- DMARC: PASS
- DMARC enforcement: p=quarantine; sp=quarantine; pct=100

Note: This is a self-asserted BIMI record. Gmail generally requires a VMC/CMC for logo display.
