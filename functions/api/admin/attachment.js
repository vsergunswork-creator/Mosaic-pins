import { json, requireAdmin } from "./_auth.js";
import { getRecord, updateRecord, uploadAttachment } from "./_airtable.js";
import { invalidateProductCache } from "../_airtable-products.js";
import { clearContentCache } from "./content.js";

const TARGETS = {
  products: { tableEnv: "AIRTABLE_TABLE_NAME", table: "Products", fields: new Set(["Images"]), max: 5 * 1024 * 1024 },
  content: { tableEnv: "AIRTABLE_CONTENT_TABLE_NAME", table: "SiteContent", fields: new Set(["Hero Image", "Gallery"]), max: 5 * 1024 * 1024 },
  reviews: { tableEnv: "AIRTABLE_REVIEWS_TABLE", table: "Reviews", fields: new Set(["Photos"]), max: 5 * 1024 * 1024 },
};

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const form = await request.formData();
    const target = String(form.get("target") || "").trim();
    const recordId = String(form.get("recordId") || "").trim();
    const field = String(form.get("field") || "").trim();
    const file = form.get("file");
    const cfg = TARGETS[target];
    if (!cfg || !cfg.fields.has(field)) return json({ ok: false, error: "Invalid attachment target" }, 400);
    if (!recordId || !file || typeof file.arrayBuffer !== "function" || Number(file.size || 0) <= 0) return json({ ok: false, error: "Missing file" }, 400);
    if (Number(file.size || 0) > cfg.max) return json({ ok: false, error: "File is too large (max 5 MB)" }, 400);
    if (!String(file.type || "").startsWith("image/")) return json({ ok: false, error: "Only image files are allowed here" }, 400);
    const table = String(env[cfg.tableEnv] || cfg.table);
    const data = await uploadAttachment(env, table, recordId, field, file);
    await afterChange(env, target, table, recordId);
    return json({ ok: true, result: data });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const target = String(body.target || "").trim();
    const recordId = String(body.recordId || "").trim();
    const field = String(body.field || "").trim();
    const attachmentId = String(body.attachmentId || "").trim();
    const cfg = TARGETS[target];
    if (!cfg || !cfg.fields.has(field) || !recordId || !attachmentId) return json({ ok: false, error: "Invalid attachment request" }, 400);
    const table = String(env[cfg.tableEnv] || cfg.table);
    const rec = await getRecord(env, table, recordId);
    const current = Array.isArray(rec.fields?.[field]) ? rec.fields[field] : [];
    const keep = current.filter((x) => String(x?.id || "") !== attachmentId).map((x) => ({ id: x.id }));
    const updated = await updateRecord(env, table, recordId, { [field]: keep });
    await afterChange(env, target, table, recordId, updated);
    return json({ ok: true });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

async function afterChange(env, target, table, recordId, record = null) {
  if (target === "products") await invalidateProductCache(env).catch(() => {});
  if (target === "content") {
    const rec = record || await getRecord(env, table, recordId);
    const key = String(rec.fields?.Key || "").trim();
    if (key) await clearContentCache(env, key);
  }
}
