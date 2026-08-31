import {
  getOrderRecord,
  updateOrderRecord,
  requireOrdersEnv,
  niceOrderId,
} from "./_airtable-orders.js";
import { getProductsCatalog } from "./_airtable-products.js";

const INVOICE_TABLE = "account_invoices";

const SELLER = {
  name: "Vitalijs Serguns",
  brand: "Mosaic Pins Space",
  street: "Tribseer Damm 50",
  postalCity: "18437 Stralsund",
  country: "Germany",
  email: "support@mosaicpins.space",
  vatId: "DE457327997",
};

export async function ensureInvoiceForOrder(env, orderRecord) {
  if (!env.DB) throw new Error("DB binding is not configured");
  if (!orderRecord?.id) throw new Error("Order record ID is missing");

  await ensureInvoiceTable(env);

  // Fetch the fresh Airtable record so formula fields such as OrderCode and any
  // already-uploaded invoice attachment are available even immediately after create.
  const record = await getOrderRecord(env, orderRecord.id).catch(() => orderRecord);
  assertInvoiceEligible(record, env);

  const orderKey = snapshotOrderKey(record, env) || record.id;
  let stored = await loadStoredInvoiceRow(env, orderKey);
  let invoice = stored?.invoice || null;
  let createdNew = false;

  if (!invoice) {
    invoice = await buildInvoiceSnapshot(env, record);
    createdNew = await insertInvoiceSnapshot(env, invoice, record.id);
    if (!createdNew) {
      stored = await loadStoredInvoiceRow(env, orderKey);
      invoice = stored?.invoice || invoice;
    }
  }

  const pdfBytes = buildInvoicePdf(invoice);
  const fresh = await getOrderRecord(env, record.id).catch(() => record);
  const existingAttachment = invoiceAttachments(fresh, env);

  if (existingAttachment.length) {
    await syncInvoiceMetadata(env, fresh.id, invoice).catch((error) => {
      console.error("Invoice metadata sync failed", error);
    });
    await markInvoiceUploaded(env, invoice.orderKey).catch(() => {});
    return { invoice, pdfBytes, airtableStored: true, attachment: existingAttachment[0] };
  }

  // Usually only one payment finalizer reaches this point. The short retry below
  // also avoids a duplicate attachment if two browser tabs request the same legacy
  // invoice while the first upload is still finishing.
  if (!createdNew && stored && !stored.airtableUploadedAt) {
    await sleep(140);
    const retryRecord = await getOrderRecord(env, record.id).catch(() => null);
    const retryAttachment = invoiceAttachments(retryRecord, env);
    if (retryAttachment.length) {
      await markInvoiceUploaded(env, invoice.orderKey).catch(() => {});
      return { invoice, pdfBytes, airtableStored: true, attachment: retryAttachment[0] };
    }
  }

  const uploaded = await uploadInvoiceAttachment(env, record.id, invoice, pdfBytes);
  await syncInvoiceMetadata(env, record.id, invoice);
  await markInvoiceUploaded(env, invoice.orderKey).catch(() => {});

  return { invoice, pdfBytes, airtableStored: true, attachment: uploaded };
}

export function assertInvoiceEligible(record, env) {
  const f = record?.fields || {};
  const statusField = String(env.AIRTABLE_ORDER_STATUS_FIELD || "Order Status");
  const refundField = String(env.AIRTABLE_REFUND_STATUS_FIELD || "Refund Status");
  const trackingField = String(env.AIRTABLE_TRACKING_FIELD || "Tracking Number");
  const status = String(f[statusField] || "").trim().toLowerCase();
  const refund = String(f[refundField] || "").trim().toLowerCase();
  const tracking = String(f[trackingField] || "").trim();

  const paidOrShipped = ["paid", "shipped"].includes(status) || Boolean(tracking);
  if (!paidOrShipped) {
    const error = new Error("Invoice is available after payment");
    error.code = "INVOICE_NOT_PAID";
    throw error;
  }

  if (
    status === "refunded" ||
    ["refunded", "fully_refunded", "fully refunded"].includes(refund)
  ) {
    const error = new Error("This order was refunded and requires a credit note");
    error.code = "INVOICE_REFUNDED";
    throw error;
  }
}

async function buildInvoiceSnapshot(env, record) {
  const f = record?.fields || {};
  const amountField = String(env.AIRTABLE_AMOUNT_FIELD || "Amount Total");
  const currencyField = String(env.AIRTABLE_CURRENCY_FIELD || "Currency");
  const createdField = String(env.AIRTABLE_CREATED_AT_FIELD || "Created At");
  const quantityField = String(env.AIRTABLE_QUANTITY_FIELD || "Quantity");
  const productsField = String(env.AIRTABLE_ORDER_PRODUCTS_FIELD || "Products");
  const nameField = String(env.AIRTABLE_CUSTOMER_NAME_FIELD || "Customer Name");
  const emailField = String(env.AIRTABLE_CUSTOMER_EMAIL_FIELD || "Customer Email");
  const addressField = String(env.AIRTABLE_SHIPPING_ADDRESS_FIELD || "Shipping Address");
  const countryField = String(env.AIRTABLE_SHIPPING_COUNTRY_FIELD || "Shipping Country");
  const cityField = String(env.AIRTABLE_SHIPPING_CITY_FIELD || "Shipping City");
  const postalField = String(env.AIRTABLE_SHIPPING_POSTAL_FIELD || "Shipping Postal Code");
  const stateField = String(env.AIRTABLE_SHIPPING_STATE_FIELD || "Shipping State/Region");
  const languageField = String(env.AIRTABLE_LANGUAGE_FIELD || "Language");
  const invoiceNumberField = String(env.AIRTABLE_INVOICE_NUMBER_FIELD || "Invoice Number");
  const invoiceDateField = String(env.AIRTABLE_INVOICE_DATE_FIELD || "Invoice Date");

  const orderId = niceOrderId(record, env);
  const orderKey = snapshotOrderKey(record, env) || orderId || record.id;
  const existingIssueDate = Date.parse(String(f[invoiceDateField] || ""));
  const issuedAt = Number.isFinite(existingIssueDate)
    ? Math.floor(existingIssueDate / 1000)
    : Math.floor(Date.now() / 1000);
  const invoiceNumber = String(f[invoiceNumberField] || "").trim() ||
    await makeInvoiceNumber(orderId, orderKey, issuedAt);
  const currency = String(f[currencyField] || "EUR").trim().toUpperCase() || "EUR";
  const amountTotal = numberOrNull(f[amountField]);
  const totalQuantity = numberOrNull(f[quantityField]);

  const linkedProductIds = Array.isArray(f[productsField])
    ? f[productsField].map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  let items = await loadSnapshotItems(env, orderKey);
  if (!items.length && linkedProductIds.length) {
    const { products: catalog = [] } = await getProductsCatalog(env);
    const byId = new Map((catalog || []).map((p) => [String(p?.recordId || ""), p]));
    items = linkedProductIds
      .map((recordId) => byId.get(recordId))
      .filter(Boolean)
      .map((p) => ({
        pin: String(p.pin || ""),
        title: String(p.title || p.pin || "Mosaic Pin"),
        diameter: numberOrNull(p.diameter),
        quantity: linkedProductIds.length === 1 ? totalQuantity : null,
        unitPrice: null,
        currency,
      }));
  }

  const priced = items.length > 0 && items.every((item) =>
    Number.isFinite(Number(item.quantity)) &&
    Number(item.quantity) > 0 &&
    Number.isFinite(Number(item.unitPrice))
  );
  const productsSubtotal = priced
    ? roundMoney(items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0))
    : null;
  const shippingAmount = priced && Number.isFinite(amountTotal)
    ? Math.max(0, roundMoney(amountTotal - productsSubtotal))
    : null;

  return {
    invoiceNumber,
    issuedAt,
    orderId,
    orderKey,
    airtableRecordId: String(record.id || ""),
    orderCreatedAt: String(f[createdField] || ""),
    language: normalizeLanguage(f[languageField]),
    seller: SELLER,
    buyer: {
      name: String(f[nameField] || "").trim(),
      email: String(f[emailField] || "").trim(),
      addressLines: buildBuyerAddress({
        raw: f[addressField],
        postal: f[postalField],
        city: f[cityField],
        state: f[stateField],
        country: f[countryField],
      }),
    },
    items,
    currency,
    amountTotal,
    productsSubtotal,
    shippingAmount,
    taxMode: "kleinunternehmer",
    taxNote: "Nach Paragraph 19 UStG wird keine Umsatzsteuer berechnet.",
  };
}

async function loadSnapshotItems(env, orderKey) {
  if (!env.DB || !orderKey) return [];
  try {
    const response = await env.DB.prepare(
      `SELECT pin, title, diameter, quantity, unit_price, currency
       FROM order_item_snapshots
       WHERE order_key = ?1
       ORDER BY created_at ASC, pin ASC`
    ).bind(orderKey).all();

    return (Array.isArray(response?.results) ? response.results : []).map((row) => ({
      pin: String(row?.pin || ""),
      title: String(row?.title || row?.pin || "Mosaic Pin"),
      diameter: numberOrNull(row?.diameter),
      quantity: numberOrNull(row?.quantity),
      unitPrice: numberOrNull(row?.unit_price),
      currency: String(row?.currency || "").toUpperCase(),
    }));
  } catch (error) {
    console.error("Invoice snapshot read failed; using catalog fallback", error);
    return [];
  }
}

function buildBuyerAddress({ raw, postal, city, state, country }) {
  const rawLines = String(raw || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  let streetLines = rawLines;
  if (rawLines.length > 1) {
    const first = rawLines[0].toLowerCase();
    const p = String(postal || "").trim().toLowerCase();
    const c = String(city || "").trim().toLowerCase();
    const co = String(country || "").trim().toLowerCase();
    if ((p && first.includes(p)) || (c && first.includes(c)) || (co && first.includes(co))) {
      streetLines = rawLines.slice(1);
    }
  }

  const cityLine = [String(postal || "").trim(), String(city || "").trim()].filter(Boolean).join(" ");
  const regionLine = String(state || "").trim();
  const countryLine = String(country || "").trim().toUpperCase();
  return [...streetLines, cityLine, regionLine, countryLine].filter(Boolean);
}

function snapshotOrderKey(record, env) {
  const f = record?.fields || {};
  const idField = String(env.AIRTABLE_ORDER_ID_FIELD || "Order ID");
  const stripeField = String(env.AIRTABLE_STRIPE_SESSION_FIELD || "Stripe Session ID");
  return String(f[idField] || f[stripeField] || "").trim();
}

async function makeInvoiceNumber(orderId, orderKey, issuedAt) {
  const friendly = String(orderId || "").trim();
  if (/^MP-[A-Za-z0-9-]+$/i.test(friendly)) return `INV-${friendly.toUpperCase()}`;
  const year = new Date(issuedAt * 1000).getUTCFullYear();
  const digest = await sha256Text(orderKey || friendly || crypto.randomUUID());
  return `INV-${year}-${digest.slice(0, 10).toUpperCase()}`;
}

async function ensureInvoiceTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${INVOICE_TABLE} (
      id TEXT PRIMARY KEY,
      order_key TEXT NOT NULL UNIQUE,
      airtable_record_id TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      invoice_json TEXT NOT NULL,
      airtable_uploaded_at INTEGER,
      created_at INTEGER NOT NULL
    )`
  ).run();

  // Safe auto-migration in case an earlier local Step52 draft ever created the
  // table before Airtable PDF storage was added.
  const info = await env.DB.prepare(`PRAGMA table_info(${INVOICE_TABLE})`).all();
  const columns = new Set((info?.results || []).map((row) => String(row?.name || '')));
  if (!columns.has('airtable_record_id')) {
    await env.DB.prepare(`ALTER TABLE ${INVOICE_TABLE} ADD COLUMN airtable_record_id TEXT NOT NULL DEFAULT ''`).run();
  }
  if (!columns.has('airtable_uploaded_at')) {
    await env.DB.prepare(`ALTER TABLE ${INVOICE_TABLE} ADD COLUMN airtable_uploaded_at INTEGER`).run();
  }

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_${INVOICE_TABLE}_email ON ${INVOICE_TABLE}(customer_email)`
  ).run();
}

async function insertInvoiceSnapshot(env, invoice, recordId) {
  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO ${INVOICE_TABLE}
       (id, order_key, airtable_record_id, invoice_number, customer_email, issued_at, invoice_json, airtable_uploaded_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)`
    ).bind(
      crypto.randomUUID(),
      invoice.orderKey,
      String(recordId || ""),
      invoice.invoiceNumber,
      String(invoice?.buyer?.email || "").trim().toLowerCase(),
      invoice.issuedAt,
      JSON.stringify(invoice),
      Math.floor(Date.now() / 1000)
    ).run();
    return Number(result?.meta?.changes || 0) > 0;
  } catch (error) {
    const stored = await loadStoredInvoiceRow(env, invoice.orderKey);
    if (stored) return false;
    throw error;
  }
}

async function loadStoredInvoiceRow(env, orderKey) {
  if (!orderKey) return null;
  const row = await env.DB.prepare(
    `SELECT invoice_json, airtable_uploaded_at FROM ${INVOICE_TABLE} WHERE order_key = ?1 LIMIT 1`
  ).bind(orderKey).first();
  if (!row?.invoice_json) return null;
  try {
    return {
      invoice: JSON.parse(String(row.invoice_json)),
      airtableUploadedAt: numberOrNull(row.airtable_uploaded_at),
    };
  } catch (_) {
    return null;
  }
}

async function markInvoiceUploaded(env, orderKey) {
  await env.DB.prepare(
    `UPDATE ${INVOICE_TABLE} SET airtable_uploaded_at = ?1 WHERE order_key = ?2`
  ).bind(Math.floor(Date.now() / 1000), orderKey).run();
}

function invoiceAttachments(record, env) {
  const field = String(env.AIRTABLE_INVOICE_PDF_FIELD || "Invoice PDF");
  const value = record?.fields?.[field];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function uploadInvoiceAttachment(env, recordId, invoice, pdfBytes) {
  const { token, baseId } = requireOrdersEnv(env);
  const field = String(env.AIRTABLE_INVOICE_PDF_FIELD || "Invoice PDF").trim();
  const endpoint = `https://content.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(recordId)}/${encodeURIComponent(field)}/uploadAttachment`;
  const filename = `${safeFilename(invoice.invoiceNumber || "Invoice")}.pdf`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: "application/pdf",
      filename,
      file: bytesToBase64(pdfBytes),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Airtable invoice upload failed: ${response.status} ${safeJson(data)}`);
  }

  const attachment = Array.isArray(data?.attachments)
    ? data.attachments[data.attachments.length - 1]
    : (data?.attachment || data);
  return attachment || null;
}

async function syncInvoiceMetadata(env, recordId, invoice) {
  const numberField = String(env.AIRTABLE_INVOICE_NUMBER_FIELD || "Invoice Number");
  const dateField = String(env.AIRTABLE_INVOICE_DATE_FIELD || "Invoice Date");
  const createdField = String(env.AIRTABLE_INVOICE_CREATED_FIELD || "Invoice Created");
  await updateOrderRecord(env, recordId, {
    [numberField]: invoice.invoiceNumber,
    [dateField]: new Date(invoice.issuedAt * 1000).toISOString(),
    [createdField]: true,
  });
}

export function buildInvoicePdf(invoice) {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const firstCapacity = 12;
  const laterCapacity = 24;
  const pages = [];
  let cursor = 0;

  if (!items.length) {
    pages.push({ first: true, items: [], final: true });
  } else {
    pages.push({ first: true, items: items.slice(0, firstCapacity), final: items.length <= firstCapacity });
    cursor = firstCapacity;
    while (cursor < items.length) {
      const chunk = items.slice(cursor, cursor + laterCapacity);
      cursor += laterCapacity;
      pages.push({ first: false, items: chunk, final: cursor >= items.length });
    }
  }

  const contentStreams = pages.map((page, index) =>
    invoicePageContent(invoice, page, index + 1, pages.length)
  );

  const objects = [];
  const pageRefs = [];
  for (let i = 0; i < pages.length; i++) pageRefs.push(`${5 + i * 2} 0 R`);

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  for (let i = 0; i < pages.length; i++) {
    const pageObj = 5 + i * 2;
    const contentObj = pageObj + 1;
    const stream = contentStreams[i];
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = "%PDF-1.4\n% Mosaic Pins Space\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function invoicePageContent(invoice, page, pageNumber, pageCount) {
  const c = [];
  const add = (s) => c.push(s);
  const currency = pdfAscii(invoice?.currency || "EUR");

  drawText(add, 50, 800, 18, "F2", "Mosaic Pins Space");
  drawText(add, 405, 800, 22, "F2", "INVOICE");
  drawText(add, 405, 782, 9, "F1", invoice?.invoiceNumber || "");
  drawLine(add, 50, 766, 545, 766, 0.8);

  let tableY;
  if (page.first) {
    drawText(add, 50, 744, 9, "F2", "SELLER");
    drawText(add, 315, 744, 9, "F2", "BILL TO");

    const sellerLines = [
      invoice?.seller?.name,
      invoice?.seller?.street,
      invoice?.seller?.postalCity,
      invoice?.seller?.country,
      invoice?.seller?.email,
      `VAT ID: ${invoice?.seller?.vatId || ""}`,
    ].filter(Boolean);
    sellerLines.forEach((line, i) => drawText(add, 50, 727 - i * 14, i === 0 ? 10 : 9, i === 0 ? "F2" : "F1", line));

    const buyerLines = [
      invoice?.buyer?.name,
      ...(Array.isArray(invoice?.buyer?.addressLines) ? invoice.buyer.addressLines : []),
      invoice?.buyer?.email,
    ].filter(Boolean).slice(0, 7);
    buyerLines.forEach((line, i) => drawText(add, 315, 727 - i * 14, i === 0 ? 10 : 9, i === 0 ? "F2" : "F1", truncate(line, 40)));

    drawLine(add, 50, 632, 545, 632, 0.5);
    drawText(add, 50, 614, 9, "F1", `Invoice date: ${formatPdfDate(invoice?.issuedAt)}`);
    drawText(add, 225, 614, 9, "F1", `Order: ${invoice?.orderId || ""}`);
    drawText(add, 405, 614, 9, "F1", `Order date: ${formatPdfDate(invoice?.orderCreatedAt)}`);
    tableY = 580;
  } else {
    drawText(add, 50, 742, 10, "F2", `Order ${invoice?.orderId || ""} - continued`);
    tableY = 710;
  }

  drawRectFill(add, 50, tableY, 495, 22, 0.94);
  drawText(add, 58, tableY + 7, 9, "F2", "Item");
  drawRight(add, 410, tableY + 7, 9, "F2", "Qty");
  drawRight(add, 480, tableY + 7, 9, "F2", "Unit");
  drawRight(add, 540, tableY + 7, 9, "F2", "Amount");

  let y = tableY - 22;
  for (const item of page.items) {
    const qty = numberOrNull(item?.quantity);
    const unit = numberOrNull(item?.unitPrice);
    const amount = Number.isFinite(qty) && Number.isFinite(unit) ? roundMoney(qty * unit) : null;
    const itemName = [item?.title || item?.pin || "Mosaic Pin", item?.pin ? `(${item.pin})` : ""]
      .filter(Boolean).join(" ");
    drawText(add, 58, y + 6, 8.5, "F1", truncate(itemName, 55));
    drawRight(add, 410, y + 6, 8.5, "F1", Number.isFinite(qty) ? String(qty) : "-");
    drawRight(add, 480, y + 6, 8.5, "F1", Number.isFinite(unit) ? `${unit.toFixed(2)} ${currency}` : "-");
    drawRight(add, 540, y + 6, 8.5, "F1", Number.isFinite(amount) ? `${amount.toFixed(2)} ${currency}` : "-");
    drawLine(add, 50, y, 545, y, 0.25);
    y -= 22;
  }

  if (page.final) {
    y -= 8;
    if (Number.isFinite(Number(invoice?.productsSubtotal))) {
      drawText(add, 385, y, 9, "F1", "Products subtotal");
      drawRight(add, 540, y, 9, "F1", moneyPlain(invoice.productsSubtotal, currency));
      y -= 16;
    }
    if (Number.isFinite(Number(invoice?.shippingAmount))) {
      drawText(add, 385, y, 9, "F1", "Shipping");
      drawRight(add, 540, y, 9, "F1", moneyPlain(invoice.shippingAmount, currency));
      y -= 18;
    }
    drawLine(add, 380, y + 10, 545, y + 10, 0.7);
    drawText(add, 385, y - 4, 11, "F2", "TOTAL");
    drawRight(add, 540, y - 4, 11, "F2", moneyPlain(invoice?.amountTotal, currency));
    y -= 42;

    drawText(add, 50, y, 9, "F2", "Tax note");
    drawText(add, 50, y - 16, 8.5, "F1", invoice?.taxNote || "Nach Paragraph 19 UStG wird keine Umsatzsteuer berechnet.");
    drawText(add, 50, y - 34, 8, "F1", "No VAT is shown separately on this invoice.");
  }

  drawLine(add, 50, 55, 545, 55, 0.4);
  drawText(add, 50, 38, 7.5, "F1", "Mosaic Pins Space | support@mosaicpins.space | mosaicpins.space");
  drawRight(add, 545, 38, 7.5, "F1", `Page ${pageNumber} of ${pageCount}`);

  return c.join("\n");
}

function drawText(add, x, y, size, font, text) {
  add(`BT /${font} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${pdfEscape(text)}) Tj ET`);
}

function drawRight(add, rightX, y, size, font, text) {
  const clean = pdfAscii(text);
  const estimate = clean.length * size * 0.49;
  drawText(add, Math.max(0, rightX - estimate), y, size, font, clean);
}

function drawLine(add, x1, y1, x2, y2, width) {
  add(`${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
}

function drawRectFill(add, x, y, w, h, gray) {
  add(`${num(gray)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f 0 g`);
}

function moneyPlain(value, currency) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} ${currency}` : `0.00 ${currency}`;
}

function formatPdfDate(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "-";
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

function truncate(value, max) {
  const text = pdfAscii(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
}

function pdfEscape(value) {
  return pdfAscii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfAscii(value) {
  let text = String(value ?? "");
  const cyr = {
    А:"A",Б:"B",В:"V",Г:"G",Д:"D",Е:"E",Ё:"E",Ж:"Zh",З:"Z",И:"I",Й:"I",К:"K",Л:"L",М:"M",Н:"N",О:"O",П:"P",Р:"R",С:"S",Т:"T",У:"U",Ф:"F",Х:"Kh",Ц:"Ts",Ч:"Ch",Ш:"Sh",Щ:"Shch",Ъ:"",Ы:"Y",Ь:"",Э:"E",Ю:"Yu",Я:"Ya",
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
    Є:"Ye",І:"I",Ї:"Yi",Ґ:"G",є:"ie",і:"i",ї:"i",ґ:"g",
  };
  text = text.replace(/[А-Яа-яЁёЄІЇҐєіїґ]/g, (ch) => cyr[ch] ?? "");
  text = text.replace(/ß/g, "ss").replace(/Æ/g, "AE").replace(/æ/g, "ae").replace(/Ø/g, "O").replace(/ø/g, "o");
  try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return text.replace(/[^\x20-\x7E]/g, "?").replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function safeFilename(value) {
  return pdfAscii(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Invoice";
}

function normalizeLanguage(value) {
  const lang = String(value || "en").trim().toLowerCase().slice(0, 2);
  return ["en", "de", "ru", "fr"].includes(lang) ? lang : "en";
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function num(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

async function sha256Text(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}
