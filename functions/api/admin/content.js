import { json, requireAdmin } from "./_auth.js";
import { listRecords, updateRecord } from "./_airtable.js";
import { cacheDel } from "../_cache.js";

const EDITABLE = new Set(["Key", "Active", "Hero Title", "Hero Subtitle", "About Body", "About Body DE", "About Body RU", "About Body FR"]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const table = String(env.AIRTABLE_CONTENT_TABLE_NAME || "SiteContent");
    const records = await listRecords(env, table, { maxRecords: 500 });
    return json({ ok: true, content: records.map(normalize) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing content id" }, 400);
    const fields = {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (!EDITABLE.has(k)) continue;
      fields[k] = k === "Active" ? Boolean(v) : String(v ?? "").trim();
    }
    const table = String(env.AIRTABLE_CONTENT_TABLE_NAME || "SiteContent");
    const rec = await updateRecord(env, table, id, fields);
    const key = String(rec.fields?.Key || body.key || "").trim();
    if (key) await clearContentCache(env, key);
    return json({ ok: true, content: normalize(rec) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function clearContentCache(env, key) {
  const base = `cache:sitecontent:airtable:v5:${key}`;
  await Promise.all([cacheDel(env, base), cacheDel(env, `${base}:stale`)]).catch(() => {});
}

function normalize(rec) {
  const f = rec?.fields || {};
  const att = (name) => Array.isArray(f[name]) ? f[name].map((x) => ({ id: x?.id || "", url: x?.thumbnails?.large?.url || x?.url || "", fullUrl: x?.url || "", filename: x?.filename || "" })).filter((x) => x.url) : [];
  return { id: rec?.id || "", key: String(f.Key || ""), active: f.Active === true, heroTitle: String(f["Hero Title"] || ""), heroSubtitle: String(f["Hero Subtitle"] || ""), aboutBody: String(f["About Body"] || ""), aboutBodyDE: String(f["About Body DE"] || ""), aboutBodyRU: String(f["About Body RU"] || ""), aboutBodyFR: String(f["About Body FR"] || ""), heroImage: att("Hero Image"), gallery: att("Gallery") };
}
