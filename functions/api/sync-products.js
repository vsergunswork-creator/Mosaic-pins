// functions/api/sync-products.js
// GET /api/sync-products
// Sync Products: Airtable -> D1 + mirror images to R2

export async function onRequestGet({ env, request }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = String(env.AIRTABLE_TABLE_NAME || "").trim();
    const PIN_FIELD = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();

    const R2_PUBLIC_BASE_URL = String(env.R2_PUBLIC_BASE_URL || "").trim();

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!TABLE) throw new Error("AIRTABLE_TABLE_NAME missing");
    if (!env.DB) throw new Error("DB (D1 binding) missing");
    if (!env.PRODUCT_IMAGES) throw new Error("PRODUCT_IMAGES (R2 binding) missing");
    if (!R2_PUBLIC_BASE_URL) throw new Error("R2_PUBLIC_BASE_URL missing");

    const allRecords = [];
    let offset = null;

    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);

      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Airtable error ${r.status}: ${safeJson(data)}`);

      const records = Array.isArray(data.records) ? data.records : [];
      allRecords.push(...records);

      offset = data.offset || null;
      if (!offset) break;
    }

    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO products (
        pin,
        title,
        description,
        images,
        stock,
        price_eur,
        price_usd,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    let skipped = 0;
    let uploaded_images = 0;
    let reused_images = 0;

    for (const rec of allRecords) {
      const f = rec?.fields || {};

      const pin = String(f[PIN_FIELD] ?? "").trim();
      if (!pin) {
        skipped++;
        continue;
      }

      const title = String(f["Title"] ?? pin);
      const description = String(f["Description"] ?? "");
      const stock = toInt(f["Stock"], 0);
      const priceEur = toNumber(f["Price_EUR"], 0);
      const priceUsd = toNumber(f["Price_USD"], 0);
      const active = f["Active"] === true ? 1 : 0;

      const imagesRaw = Array.isArray(f["Images"]) ? f["Images"] : [];
      const finalImages = [];

      for (let i = 0; i < imagesRaw.length; i++) {
        const item = imagesRaw[i];
        const srcUrl =
          typeof item === "string"
            ? item
            : (item && typeof item === "object" && item.url ? String(item.url) : "");

        if (!srcUrl) continue;

        const ext = detectExtension(item, srcUrl);
        const objectKey = `products/${sanitizePin(pin)}/${String(i + 1).padStart(2, "0")}.${ext}`;
        const publicUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;

        const already = await env.PRODUCT_IMAGES.head(objectKey);
        if (!already) {
          const imgResp = await fetch(srcUrl);
          if (!imgResp.ok) {
            console.warn(`Image fetch failed for ${pin}: ${srcUrl} -> ${imgResp.status}`);
            continue;
          }

          const contentType =
            imgResp.headers.get("content-type") || contentTypeByExt(ext);

          const arrBuf = await imgResp.arrayBuffer();

          await env.PRODUCT_IMAGES.put(objectKey, arrBuf, {
            httpMetadata: {
              contentType,
              cacheControl: "public, max-age=31536000, immutable",
            },
          });

          uploaded_images++;
        } else {
          reused_images++;
        }

        finalImages.push(publicUrl);
      }

      await stmt
        .bind(
          pin,
          title,
          description,
          JSON.stringify(finalImages),
          stock,
          priceEur,
          priceUsd,
          active
        )
        .run();

      inserted++;
    }

    return Response.json({
      ok: true,
      synced: inserted,
      skipped,
      total_from_airtable: allRecords.length,
      uploaded_images,
      reused_images,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

function sanitizePin(pin) {
  return String(pin || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function detectExtension(item, url) {
  const filename = String(item?.filename || "").toLowerCase();

  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "jpg";
  if (filename.endsWith(".png")) return "png";
  if (filename.endsWith(".webp")) return "webp";
  if (filename.endsWith(".gif")) return "gif";

  const cleanUrl = String(url || "").split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
  if (cleanUrl.endsWith(".png")) return "png";
  if (cleanUrl.endsWith(".webp")) return "webp";
  if (cleanUrl.endsWith(".gif")) return "gif";

  const type = String(item?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";

  return "jpg";
}

function contentTypeByExt(ext) {
  switch (ext) {
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    default: return "image/jpeg";
  }
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function toNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}