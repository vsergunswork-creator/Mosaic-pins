import { json, requireAdmin } from "./_auth.js";
import { listRecords, updateRecord } from "./_airtable.js";
import { cacheDel } from "../_cache.js";

const EDITABLE = new Set(["Name", "Active", "Rating", "Date", "Country", "Text"]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const table = String(env.AIRTABLE_REVIEWS_TABLE || "Reviews");
    const records = await listRecords(env, table, { maxRecords: 3000, sort: [{ field: "Date", direction: "desc" }] });
    return json({ ok: true, reviews: records.map(normalize) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAdmin(request, env, { write: true });
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing review id" }, 400);
    const fields = {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (!EDITABLE.has(k)) continue;
      if (k === "Active") fields[k] = Boolean(v);
      else if (k === "Rating") fields[k] = Math.max(1, Math.min(5, Number(v) || 1));
      else fields[k] = String(v ?? "").trim();
    }
    const rec = await updateRecord(env, String(env.AIRTABLE_REVIEWS_TABLE || "Reviews"), id, fields);
    await Promise.all([cacheDel(env, "reviews:30:"), cacheDel(env, "reviews:last:30:")]).catch(() => {});
    return json({ ok: true, review: normalize(rec) });
  } catch (e) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}

function normalize(rec) {
  const f = rec?.fields || {};
  return {
    id: rec?.id || "", name: String(f.Name || ""), active: f.Active === true, rating: Number(f.Rating || 0), date: String(f.Date || ""),
    country: String(f.Country || ""), text: String(f.Text || ""), source: String(f.Source || ""), sourceOrderId: String(f["Source Order ID"] || ""),
    photos: Array.isArray(f.Photos) ? f.Photos.map((x) => ({ id: x?.id || "", url: x?.thumbnails?.large?.url || x?.url || "", fullUrl: x?.url || "", filename: x?.filename || "" })).filter((x) => x.url) : [],
    video: f.Video?.[0]?.url || "",
  };
}
