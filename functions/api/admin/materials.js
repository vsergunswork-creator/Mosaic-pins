import { json, requireAdmin } from "./_auth.js";
import { createRecord, listRecords, updateRecord } from "./_airtable.js";
import { invalidateProductCache } from "../_airtable-products.js";

const EDITABLE = new Set(["Material", "RU", "DE", "FR"]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const table = String(env.AIRTABLE_MATERIAL_TRANSLATIONS_TABLE || "MaterialTranslations");
    const records = await listRecords(env, table, { maxRecords: 1000, sort: [{ field: "Material", direction: "asc" }] });
    return json({ ok: true, materials: records.map(normalize) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing material id" }, 400);
    const rec = await updateRecord(env, String(env.AIRTABLE_MATERIAL_TRANSLATIONS_TABLE || "MaterialTranslations"), id, sanitize(body.fields));
    await invalidateProductCache(env).catch(() => {});
    return json({ ok: true, material: normalize(rec) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const fields = sanitize(body.fields);
    if (!fields.Material) return json({ ok: false, error: "Material name is required" }, 400);
    const rec = await createRecord(env, String(env.AIRTABLE_MATERIAL_TRANSLATIONS_TABLE || "MaterialTranslations"), fields);
    await invalidateProductCache(env).catch(() => {});
    return json({ ok: true, material: normalize(rec) }, 201);
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

function sanitize(input = {}) { const out = {}; for (const [k,v] of Object.entries(input)) if (EDITABLE.has(k)) out[k] = String(v ?? "").trim(); return out; }
function normalize(rec) { const f = rec?.fields || {}; return { id: rec?.id || "", material: String(f.Material || ""), ru: String(f.RU || ""), de: String(f.DE || ""), fr: String(f.FR || "") }; }
