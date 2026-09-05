// functions/api/_cache.js
// KV-first cache (shared between instances) with in-memory fallback.
// Uses env.STRIPE_EVENTS_KV if present.

const mem = new Map(); // key -> { exp:number, val:string }

function now() { return Date.now(); }

function memGet(key) {
  const x = mem.get(key);
  if (!x) return null;
  if (x.exp && x.exp < now()) { mem.delete(key); return null; }
  return x.val;
}
function memSet(key, val, ttlSec) {
  const exp = ttlSec ? now() + ttlSec * 1000 : 0;
  mem.set(key, { exp, val: String(val) });
}
function memDel(key) { mem.delete(key); }

async function kvGet(env, key) {
  const kv = env?.STRIPE_EVENTS_KV;
  if (!kv || typeof kv.get !== "function") return null;
  return await kv.get(key);
}
async function kvPut(env, key, val, ttlSec) {
  const kv = env?.STRIPE_EVENTS_KV;
  if (!kv || typeof kv.put !== "function") return false;
  await kv.put(key, String(val), ttlSec ? { expirationTtl: ttlSec } : undefined);
  return true;
}
async function kvDel(env, key) {
  const kv = env?.STRIPE_EVENTS_KV;
  if (!kv || typeof kv.delete !== "function") return false;
  await kv.delete(key);
  return true;
}

export async function cacheGet(env, key) {
  // 1) KV
  const kvVal = await kvGet(env, key);
  if (kvVal != null) return kvVal;

  // 2) memory
  return memGet(key);
}

export async function cacheSet(env, key, val, ttlSec) {
  // write both
  await kvPut(env, key, val, ttlSec);
  memSet(key, val, ttlSec);
}

export async function cacheDel(env, key) {
  await kvDel(env, key);
  memDel(key);
}