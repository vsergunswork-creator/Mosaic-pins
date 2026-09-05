import { json, requireAdmin } from "./_auth.js";
import { createRecord, getBaseSchema, listRecords, updateRecord } from "./_airtable.js";
import { invalidateProductCache } from "../_airtable-products.js";

const EDITABLE = new Set([
  "PIN Code", "Title", "Type", "Diameter", "Materials", "Color", "Price_EUR", "Stock", "Active", "Moonglow", "Knife Photo Example",
  "Description", "Description DE", "Description RU", "Description FR",
]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const table = String(env.AIRTABLE_TABLE_NAME || "Products");
    const [records, schema] = await Promise.all([
      listRecords(env, table, { maxRecords: 3000, sort: [{ field: "Model Number", direction: "desc" }] }),
      getBaseSchema(env),
    ]);
    const meta = productMeta(schema, table, records);
    return json({ ok: true, products: records.map(normalize), meta });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing product id" }, 400);
    const fields = sanitize(body.fields || {});
    if (!Object.keys(fields).length) return json({ ok: false, error: "Nothing to update" }, 400);
    const rec = await updateRecord(env, String(env.AIRTABLE_TABLE_NAME || "Products"), id, fields);
    await invalidateProductCache(env).catch(() => {});
    return json({ ok: true, product: normalize(rec) });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const fields = sanitize(body.fields || {});
    if (!String(fields["PIN Code"] || "").trim()) return json({ ok: false, error: "PIN Code is required" }, 400);
    const rec = await createRecord(env, String(env.AIRTABLE_TABLE_NAME || "Products"), fields);
    await invalidateProductCache(env).catch(() => {});
    return json({ ok: true, product: normalize(rec) }, 201);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

function sanitize(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!EDITABLE.has(k)) continue;
    if (["Price_EUR", "Stock"].includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      out[k] = k === "Stock" ? Math.floor(n) : Math.round(n * 100) / 100;
    } else if (["Active", "Moonglow", "Knife Photo Example"].includes(k)) {
      out[k] = Boolean(v);
    } else if (["Materials", "Color"].includes(k)) {
      out[k] = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    } else {
      out[k] = String(v ?? "").trim();
    }
  }
  return out;
}

function normalize(rec) {
  const f = rec?.fields || {};
  return {
    id: rec?.id || "",
    modelNumber: f["Model Number"] ?? null,
    pin: String(f["PIN Code"] || ""),
    title: String(f.Title || ""),
    type: String(f.Type || ""),
    diameter: String(f.Diameter || ""),
    materials: arr(f.Materials),
    color: arr(f.Color),
    priceEUR: num(f.Price_EUR),
    stock: Math.max(0, Math.floor(Number(f.Stock || 0))),
    active: f.Active === true,
    moonglow: f.Moonglow === true,
    knifePhotoExample: f["Knife Photo Example"] === true,
    description: String(f.Description || ""),
    descriptionDE: String(f["Description DE"] || ""),
    descriptionRU: String(f["Description RU"] || ""),
    descriptionFR: String(f["Description FR"] || ""),
    autoDescription: String(f["Auto Description EN"] || ""),
    images: Array.isArray(f.Images) ? f.Images.map((x) => ({ id: x?.id || "", url: x?.thumbnails?.large?.url || x?.url || "", fullUrl: x?.url || "", filename: x?.filename || "" })).filter((x) => x.url) : [],
  };
}

function productMeta(schema, tableName, records = []) {
  const table = schema?.tables?.find((t) => t.name === tableName || t.name === "Products");
  const choices = {};
  for (const field of table?.fields || []) {
    if (!field?.options?.choices) continue;
    choices[field.name] = field.options.choices.map((c) => c.name);
  }

  // Schema-read scope is convenient but not required. If the Airtable token
  // cannot read base metadata, derive every currently used choice from records
  // so the admin editor never clears a field just because metadata is unavailable.
  for (const name of ["Title", "Type", "Diameter", "Materials", "Color"]) {
    const set = new Set(choices[name] || []);
    for (const rec of records || []) {
      const value = rec?.fields?.[name];
      if (Array.isArray(value)) value.forEach((x) => { if (String(x || "").trim()) set.add(String(x)); });
      else if (String(value || "").trim()) set.add(String(value));
    }
    choices[name] = [...set];
  }
  return { choices };
}
function arr(v) { return Array.isArray(v) ? v.map((x) => String(x)) : (v ? [String(v)] : []); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
