// Clean, indexable product URL: /p/:pin
// Renders the existing product.html UI while injecting product-specific SEO metadata.
import { getProductByPin } from "../api/_airtable-products.js";

const SITE_ORIGIN = "https://mosaicpins.space";
const SEO_START = "<!-- MP_PRODUCT_SEO_START -->";
const SEO_END = "<!-- MP_PRODUCT_SEO_END -->";

export async function onRequestGet({ params, env, request }) {
  try {
    const rawPin = String(params?.pin ?? "").trim();
    const pin = decodePinPath(rawPin);
    if (!pin) return notFound();

    const product = await getProductByPin(env, pin);
    if (!product || !product.active) return notFound();

    const templateResponse = await fetchProductTemplate(env, request);
    if (!templateResponse.ok) {
      return new Response("Product template unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const template = await templateResponse.text();
    const canonical = `${SITE_ORIGIN}/p/${productPathSegment(product.pin)}`;
    const title = buildTitle(product);
    const description = buildDescription(product);
    const image = Array.isArray(product.images) ? String(product.images[0] || "") : "";
    const structuredData = buildStructuredData(product, canonical, description);
    const seoBlock = buildSeoBlock({ title, description, canonical, image, product, structuredData });

    const html = injectProductContent(replaceSeoBlock(template, seoBlock), product);

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "X-Robots-Tag": "index, follow",
      },
    });
  } catch (e) {
    return new Response("Product unavailable", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

function decodePinPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function productPathSegment(value) {
  return encodeURIComponent(String(value ?? "").trim()).replace(/%2C/gi, ",");
}

async function fetchProductTemplate(env, request) {
  const url = new URL("/product.html", request.url);
  const assetRequest = new Request(url.toString(), { method: "GET" });

  // Pages/Workers static-assets binding when available.
  if (env?.ASSETS && typeof env.ASSETS.fetch === "function") {
    const response = await env.ASSETS.fetch(assetRequest);
    if (response?.ok) return response;
  }

  // Safe fallback for Pages deployments where product.html is served as a static asset.
  return fetch(assetRequest);
}

function buildTitle(product) {
  const rawTitle = cleanText(product?.title || product?.pin || "Mosaic Pin");
  const pin = cleanText(product?.pin || "");
  const suffix = "Mosaic Pins Space";
  const withPin = pin && !rawTitle.toLowerCase().includes(pin.toLowerCase())
    ? `${rawTitle} ${pin}`
    : rawTitle;
  return `${withPin} | Handmade Knife Handle Pin | ${suffix}`.slice(0, 90);
}

function buildDescription(product) {
  const title = cleanText(product?.title || "Mosaic pin");
  const pin = cleanText(product?.pin || "");
  const diameter = product?.diameter != null && !titleIncludesDiameter(title, product.diameter)
    ? `Ø${product.diameter} mm `
    : "";
  const manual = cleanText(stripHtml(product?.description || ""));
  const intro = `Handmade ${diameter}${title}${pin ? ` (${pin})` : ""} for custom knife handles.`;
  const text = manual ? `${intro} ${manual}` : `${intro} Small-batch mosaic, lanyard and glow pins by Mosaic Pins Space.`;
  return truncate(text, 160);
}

function buildStructuredData(product, canonical, description) {
  const price = Number(product?.price?.USD);
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean).map(String) : [];
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: cleanText(product?.title || product?.pin || "Mosaic Pin"),
    sku: cleanText(product?.pin || ""),
    url: canonical,
    description,
    image: images,
    brand: { "@type": "Brand", name: "Mosaic Pins Space" },
  };

  if (product?.color) data.color = cleanText(product.color);
  if (Array.isArray(product?.materials) && product.materials.length) {
    data.material = product.materials.map(cleanText).filter(Boolean).join(", ");
  }
  if (product?.diameter != null) data.size = `Ø${product.diameter} mm`;

  if (Number.isFinite(price) && price >= 0) {
    data.offers = {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "USD",
      price: price.toFixed(2),
      availability: Number(product?.stock || 0) > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "Mosaic Pins Space" },
    };
  }

  return data;
}

function buildSeoBlock({ title, description, canonical, image, product, structuredData }) {
  const imageTags = image
    ? `\n  <meta property="og:image" content="${escapeAttr(image)}" />\n  <meta name="twitter:image" content="${escapeAttr(image)}" />`
    : "";
  const price = Number(product?.price?.USD);
  const priceTags = Number.isFinite(price)
    ? `\n  <meta property="product:price:amount" content="${price.toFixed(2)}" />\n  <meta property="product:price:currency" content="USD" />`
    : "";

  return `${SEO_START}
  <title>${escapeHtml(title)}</title>
  <meta id="seoRobots" name="robots" content="index,follow,max-image-preview:large" />
  <meta id="seoDescription" name="description" content="${escapeAttr(description)}" />
  <link id="seoCanonical" rel="canonical" href="${escapeAttr(canonical)}" />
  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="Mosaic Pins Space" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${escapeAttr(canonical)}" />${imageTags}${priceTags}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <script id="productStructuredData" type="application/ld+json">${jsonForHtml(structuredData)}</script>
${SEO_END}`;
}

function injectProductContent(template, product) {
  const title = cleanText(product?.title || product?.pin || "Mosaic Pin");
  const pin = cleanText(product?.pin || "");
  const diameter = product?.diameter != null ? `Ø ${product.diameter} mm` : "";
  const sub = [pin, diameter].filter(Boolean).join(" • ");
  const description = cleanText(stripHtml(product?.description || ""));
  const chips = [];

  if (Array.isArray(product?.materials)) {
    for (const material of product.materials) {
      const text = cleanText(material);
      if (text) chips.push(text);
    }
  }
  if (product?.color) chips.push(`Color: ${cleanText(product.color)}`);
  if (product?.diameter != null) chips.push(`Ø ${product.diameter} mm`);

  let html = template;
  html = html.replace('<h1 class="h-title" id="hTitle">Loading…</h1>', `<h1 class="h-title" id="hTitle">${escapeHtml(title)}</h1>`);
  html = html.replace('<div class="sub" id="hSub"></div>', `<div class="sub" id="hSub">${escapeHtml(sub)}</div>`);
  html = html.replace('<div class="title" id="title"></div>', `<div class="title" id="title">${escapeHtml(title)}</div>`);
  html = html.replace('<div class="meta" id="desc"></div>', `<div class="meta" id="desc">${escapeHtml(description)}</div>`);

  if (chips.length) {
    const chipHtml = chips.map(value => `<span class="chip">${escapeHtml(value)}</span>`).join("");
    html = html.replace('<div class="chips" id="chips"></div>', `<div class="chips" id="chips">${chipHtml}</div>`);
  }

  const price = Number(product?.price?.USD);
  if (Number.isFinite(price)) {
    html = html.replace('<div class="price" id="price">—</div>', `<div class="price" id="price">$${price.toFixed(2)}</div>`);
  }

  const stock = Math.max(0, Number(product?.stock || 0));
  html = html.replace('<div class="badge" id="stockBadge">—</div>', `<div class="badge${stock > 0 ? "" : " sold"}" id="stockBadge">${stock > 0 ? `In stock: ${stock}` : "Sold out"}</div>`);

  return html;
}

function titleIncludesDiameter(title, diameter) {
  const rawTitle = String(title || "").toLowerCase().replace(/,/g, ".");
  const rawDiameter = String(diameter ?? "").toLowerCase().replace(/,/g, ".");
  if (!rawDiameter) return false;
  return rawTitle.includes(`ø${rawDiameter}`) ||
         rawTitle.includes(`ø ${rawDiameter}`) ||
         rawTitle.includes(`${rawDiameter}mm`) ||
         rawTitle.includes(`${rawDiameter} mm`);
}

function replaceSeoBlock(template, seoBlock) {
  const start = template.indexOf(SEO_START);
  const end = template.indexOf(SEO_END);
  if (start >= 0 && end > start) {
    return template.slice(0, start) + seoBlock + template.slice(end + SEO_END.length);
  }

  // Backward-safe fallback if the markers are ever missing.
  return template.replace("</head>", `${seoBlock}\n</head>`);
}

function notFound() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><title>Product not found | Mosaic Pins Space</title></head><body><h1>Product not found</h1><p><a href="/">Back to Mosaic Pins Space</a></p></body></html>`, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, follow" },
  });
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\*\*/g, " ");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "").trim() + "…";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function escapeAttr(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
