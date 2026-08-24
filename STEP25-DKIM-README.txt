Mosaic Pins step25 — MailChannels DKIM signing

Files changed:
- functions/api/_email.js
- notification-worker/index.js
- notification-worker/wrangler.toml

DKIM selector: mailchannels
DKIM domain: mosaicpins.space

Cloudflare DNS TXT record:
Name: mailchannels._domainkey
Type: TXT
Content:
v=DKIM1; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuyZ/DyL7Ii9PIuDcDBK9deRQ7OJERoZMPw90sl9bouRjP9H3OOlGhWXBayIUyryIha0Qn6CHsrbrg7/EYV2vCr+4rcNDnYVjOTBwxm9pFCBtvjqgXasYl3Q4uYaNItLRn+Ms2DgJp2qjbVNhZ/dkDxan1u/9e2DZEXGOL7+sGqPLYsI7xChgSEWyYmB248Uk2dRWUH4fMknyHZV5I0PTDv3V+MnX94ZHjq8SJsBLYI6S1iPDS1xVcTCmd4gAggODF38DwtoVla4qYsalF9b3zyGVV4N6TyFSvqHmGRpGMtftLl6asnbbUZcvCHSLnljEhJyOGINHjIvljBZR1EIk0QIDAQAB
TTL: Auto

IMPORTANT:
The private key is NOT included in this patch ZIP.
Store it only as Cloudflare secret named DKIM_PRIVATE_KEY.
Use the same secret value in:
1) Cloudflare Pages project mosaic-pinsspace (Functions environment)
2) Standalone Worker mosaic-notifications

The code is safe during rollout: if DKIM_PRIVATE_KEY is absent, emails continue to send without DKIM instead of failing.

After setup, send a new 6-digit sign-in code and use Gmail > Show original.
Expected:
SPF: PASS
DKIM: PASS
DMARC: PASS

Do NOT change DMARC p=none yet. Move to quarantine/reject only after DKIM PASS is confirmed in production.
