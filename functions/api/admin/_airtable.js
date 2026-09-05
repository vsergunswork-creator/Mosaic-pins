export function airtableConfig(env, table) {
  const token = String(env.AIRTABLE_TOKEN || "").trim();
  const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
  if (!token) throw new Error("AIRTABLE_TOKEN is not set");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  return { token, baseId, table: String(table || "").trim() };
}

export async function listRecords(env, table, { maxRecords = 1000, sort = [], fields = [] } = {}) {
  const { token, baseId } = airtableConfig(env, table);
  const out = [];
  let offset = "";
  let guard = 0;
  const max = Math.max(1, Math.min(5000, Number(maxRecords) || 1000));
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    for (const field of fields || []) url.searchParams.append("fields[]", field);
    (sort || []).forEach((s, i) => {
      if (!s?.field) return;
      url.searchParams.set(`sort[${i}][field]`, s.field);
      url.searchParams.set(`sort[${i}][direction]`, s.direction === "asc" ? "asc" : "desc");
    });
    const r = await fetch(url, { headers: auth(token) });
    const data = await parse(r, `Airtable ${table} list`);
    out.push(...(Array.isArray(data.records) ? data.records : []));
    if (out.length >= max) break;
    offset = String(data.offset || "");
    if (++guard > 60) throw new Error("Airtable pagination guard exceeded");
  } while (offset);
  return out.slice(0, max);
}

export async function getRecord(env, table, id) {
  const { token, baseId } = airtableConfig(env, table);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    headers: auth(token),
  });
  return parse(r, `Airtable ${table} read`);
}

export async function createRecord(env, table, fields) {
  const { token, baseId } = airtableConfig(env, table);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: auth(token, true),
    body: JSON.stringify({ fields, typecast: false }),
  });
  return parse(r, `Airtable ${table} create`);
}

export async function updateRecord(env, table, id, fields) {
  const { token, baseId } = airtableConfig(env, table);
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: auth(token, true),
    body: JSON.stringify({ fields, typecast: false }),
  });
  return parse(r, `Airtable ${table} update`);
}

export async function getBaseSchema(env) {
  const { token, baseId } = airtableConfig(env, "");
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: auth(token) });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

export async function uploadAttachment(env, table, recordId, field, file) {
  const { token, baseId } = airtableConfig(env, table);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const endpoint = `https://content.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(recordId)}/${encodeURIComponent(field)}/uploadAttachment`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: auth(token, true),
    body: JSON.stringify({
      contentType: String(file.type || "application/octet-stream"),
      filename: safeFilename(file.name || "upload.bin"),
      file: bytesToBase64(bytes),
    }),
  });
  return parse(r, `Airtable attachment upload`);
}

function auth(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function parse(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${safeJson(data)}`);
  return data;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function safeFilename(value) {
  return String(value || "upload.bin").replace(/[\\/:*?"<>|\x00-\x1F]+/g, "-").slice(0, 180) || "upload.bin";
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}
