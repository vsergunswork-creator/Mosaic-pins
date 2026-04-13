// functions/api/content.js
// GET /api/content?key=about
// D1 version

export async function onRequestGet({ env, request }) {
  try {
    if (!env.DB) {
      return json({ ok: false, error: "DB not configured" }, 500);
    }

    const url = new URL(request.url);
    const key = String(url.searchParams.get("key") || "").trim();

    if (!key) {
      return json({ ok: false, error: "Missing key" }, 400);
    }

    const row = await env.DB.prepare(`
      SELECT
        key,
        heroImage,
        heroTitle,
        heroSubtitle,
        aboutBody,
        gallery,
        active
      FROM content
      WHERE key = ?
      LIMIT 1
    `).bind(key).first();

    if (!row || Number(row.active || 0) !== 1) {
      return json({ ok: false, error: "Content not found" }, 404);
    }

    return json({
      ok: true,
      content: {
        key: String(row.key || ""),
        heroImage: String(row.heroImage || ""),
        heroTitle: String(row.heroTitle || ""),
        heroSubtitle: String(row.heroSubtitle || ""),
        aboutBody: String(row.aboutBody || ""),
        gallery: parseJsonArray(row.gallery),
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}