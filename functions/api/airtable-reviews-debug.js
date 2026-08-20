// functions/api/airtable-reviews-debug.js
// READ-ONLY diagnostic: shows which Airtable Reviews table/config the API sees.
// Does not expose tokens/secrets and performs no writes.

export async function onRequestGet({ env }) {
  try {
    const token = String(env.AIRTABLE_TOKEN_REVIEWS || env.AIRTABLE_TOKEN || '').trim();
    const baseId = String(env.AIRTABLE_BASE_ID || '').trim();
    const table = String(env.AIRTABLE_REVIEWS_TABLE || 'Reviews').trim();

    if (!token || !baseId) {
      return json({ ok: false, error: 'Missing Airtable Reviews credentials' }, 500);
    }

    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return json({
        ok: false,
        airtableStatus: r.status,
        airtableError: safeError(data),
        config: { table, baseIdSuffix: baseId.slice(-6) },
      }, r.status);
    }

    const records = Array.isArray(data?.records) ? data.records : [];
    const fieldNames = [...new Set(records.flatMap((rec) => Object.keys(rec?.fields || {})))].sort();
    const sourceSamples = records.slice(0, 40).map((rec) => ({
      id: rec.id,
      name: String(rec?.fields?.['Name'] || ''),
      sourceRaw: rec?.fields?.['Source'] ?? null,
      sourceType: typeof rec?.fields?.['Source'],
      importKey: String(rec?.fields?.['Import Key'] || ''),
    }));

    const sourceCounts = {};
    for (const rec of records) {
      const raw = rec?.fields?.['Source'];
      const key = raw == null ? '(missing)' : String(raw);
      sourceCounts[key] = (sourceCounts[key] || 0) + 1;
    }

    return json({
      ok: true,
      mode: 'airtable-reviews-read-only-debug',
      writesPerformed: 0,
      config: {
        table,
        baseIdSuffix: baseId.slice(-6),
        usingReviewsToken: Boolean(String(env.AIRTABLE_TOKEN_REVIEWS || '').trim()),
      },
      recordCount: records.length,
      fieldNames,
      sourceCounts,
      sourceSamples,
    });
  } catch (e) {
    return json({ ok: false, error: 'Server error', detail: String(e?.message || e || '') }, 500);
  }
}

function safeError(data) {
  if (!data || typeof data !== 'object') return 'Unknown error';
  return data?.error?.message || data?.error || data?.message || data;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
