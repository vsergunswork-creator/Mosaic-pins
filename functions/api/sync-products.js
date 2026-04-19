// functions/api/sync-products.js
// GET /api/sync-products?page=1&perPage=20&images=0|1
// Sync Products: Airtable -> R2 -> D1
// Safe batched version to avoid Cloudflare subrequest limits

export async function onRequestGet({ env, request }) {
  try {
    const AIRTABLE_TOKEN = String(env.AIRTABLE_TOKEN || "").trim();
    const BASE_ID = String(env.AIRTABLE_BASE_ID || "").trim();
    const TABLE = String(env.AIRTABLE_TABLE_NAME || "").trim();
    const PIN_FIELD = String(env.AIRTABLE_PIN_FIELD || "PIN Code").trim();

    const R2_PUBLIC_BASE_URL = String(env.R2_PUBLIC_BASE_URL || "")
      .trim()
      .replace(/\/+$/, "");

    if (!AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN missing");
    if (!BASE_ID) throw new Error("AIRTABLE_BASE_ID missing");
    if (!TABLE) throw new Error("AIRTABLE_TABLE_NAME missing");
    if (!env.DB) throw new Error("DB (D1 binding) missing");
    if (!env.PRODUCT_IMAGES) throw new Error("PRODUCT_IMAGES (R2 binding) missing");
    if (!R2_PUBLIC_BASE_URL) throw new Error("R2_PUBLIC_BASE_URL missing");

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage") || 20)));
    const withImages = String(url.searchParams.get("images") || "0") === "1";

    // ---------- LOAD ONE AIRTABLE PAGE ----------
    const airtableUrl = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
    airtableUrl.searchParams.set("pageSize", String(perPage));

    let offset = null;
    if (page > 1) {
      offset = await getOffsetForPage({
        token: AIRTABLE_TOKEN,
        baseId: BASE_ID,
        table: TABLE,
        targetPage: page,
        pageSize: perPage,
      });
      if (!offset) {
        return Response.json({
          ok: true,
          synced: 0,
          skipped: 0,
          total_from_airtable: 0,
          uploaded_images: 0,
          reused_images: 0,
          page,
          perPage,
          images: withImages,
          note: "No more records for this page",
        });
      }
      airtableUrl.searchParams.set("offset", offset);
    }

    const r = await fetch(airtableUrl.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable error ${r.status}: ${safeJson(data)}`);

    const allRecords = Array.isArray(data.records) ? data.records : [];

    // ---------- UPSERT INTO D1 ----------
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

      let finalImages = [];

      if (withImages) {
        const imagesRaw = Array.isArray(f["Images"]) ? f["Images"] : [];

        for (let i = 0; i < imagesRaw.length; i++) {
          const item = imagesRaw[i];
          if (!item) continue;

          const srcUrl =
            typeof item === "string"
              ? item
              : (item && typeof item === "object" && item.url ? String(item.url).trim() : "");

          if (!srcUrl) continue;

          const ext = detectExtension(item, srcUrl);
          const objectKey = `products/${sanitizePin(pin)}/${String(i + 1).padStart(2, "0")}.${ext}`;
          const publicUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;

          const existing = await env.PRODUCT_IMAGES.head(objectKey);

          if (!existing) {
            const imgResp = await fetch(srcUrl);
            if (!imgResp.ok) {
              throw new Error(`Image download failed for ${pin}: ${imgResp.status}`);
            }

            const contentType = imgResp.headers.get("content-type") || contentTypeByExt(ext);
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
      } else {
        // keep old images from D1 if they already exist
        const existingRow = await env.DB.prepare(
          `SELECT images FROM products WHERE pin = ? LIMIT 1`
        ).bind(pin).first();

        if (existingRow?.images) {
          finalImages = parseJsonArray(existingRow.images);
        }
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
      page,
      perPage,
      images: withImages,
      nextPageHint: data.offset ? page + 1 : null,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// ---------- helpers ----------

async function getOffsetForPage({ token, baseId, table, targetPage, pageSize }) {
  let offset = null;

  for (let currentPage = 1; currentPage < targetPage; currentPage++) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(pageSize));
    if (offset) url.searchParams.set("offset", offset);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Airtable paging error ${r.status}: ${safeJson(data)}`);

    offset = data.offset || null;
    if (!offset) return null;
  }

  return offset;
}

function parseJsonArray(v) {
  if (!v) return [];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
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
  if (filename.endsWith(".avif")) return "avif";

  const cleanUrl = String(url || "").split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
  if (cleanUrl.endsWith(".png")) return "png";
  if (cleanUrl.endsWith(".webp")) return "webp";
  if (cleanUrl.endsWith(".gif")) return "gif";
  if (cleanUrl.endsWith(".avif")) return "avif";

  const type = String(item?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("avif")) return "avif";

  return "jpg";
}

function contentTypeByExt(ext) {
  switch (ext) {
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
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