// GET /api/content?key=about
// Airtable SiteContent is the source of truth. No manual sync required.

import { cacheGet, cacheSet } from "./_cache.js";

const TTL = 60;

export async function onRequestGet({ env, request }) {
  try {
    const token = String(env.AIRTABLE_TOKEN || "").trim();
    const baseId = String(env.AIRTABLE_BASE_ID || "").trim();
    const table = String(env.AIRTABLE_CONTENT_TABLE_NAME || "SiteContent").trim();
    if (!token || !baseId) return json({ ok:false,error:"Airtable is not configured" },500);

    const key = String(new URL(request.url).searchParams.get("key") || "").trim();
    if (!key) return json({ ok:false,error:"Missing key" },400);

    const cacheKey = `cache:sitecontent:airtable:v2:${key}`;
    const cached = await cacheGet(env, cacheKey);
    if (cached) return new Response(cached,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",'X-Cache':'HIT'}});

    const formula = `AND({Key}='${escapeFormula(key)}',{Active}=TRUE())`;
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('filterByFormula',formula);
    url.searchParams.set('maxRecords','1');
    const r = await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`Airtable content failed: ${r.status} ${JSON.stringify(data)}`);
    const rec = data?.records?.[0];
    const f = rec?.fields || {};
    if(!rec) return json({ok:false,error:'Content not found'},404);

    const heroImage = await durableImage(env,key,'hero',Array.isArray(f['Hero Image'])?f['Hero Image'][0]:null);
    const galleryRaw = Array.isArray(f['Gallery'])?f['Gallery']:[];
    const gallery=[];
    for(let i=0;i<galleryRaw.length;i++) gallery.push(await durableImage(env,key,`gallery-${i+1}`,galleryRaw[i]));

    const body=JSON.stringify({ok:true,content:{key,heroImage,heroTitle:String(f['Hero Title']||''),heroSubtitle:String(f['Hero Subtitle']||''),aboutBody:String(f['About Body']||''),gallery:gallery.filter(Boolean)}});
    await cacheSet(env,cacheKey,body,TTL);
    return new Response(body,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",'X-Cache':'MISS'}});
  } catch(e) { return json({ok:false,error:String(e?.message||e)},500); }
}

async function durableImage(env,key,slot,item){const src=String(item?.url||'').trim();if(!src)return '';const r2=env.PRODUCT_IMAGES;const base=String(env.R2_PUBLIC_BASE_URL||'').trim().replace(/\/+$/,'');if(!r2||!base)return src;const id=String(item?.id||slot);const ext=detectExt(item,src);const objectKey=`content/${sanitize(key)}/${sanitize(id)}.${ext}`;try{if(!await r2.head(objectKey)){const rr=await fetch(src);if(!rr.ok)throw new Error('image');await r2.put(objectKey,await rr.arrayBuffer(),{httpMetadata:{contentType:rr.headers.get('content-type')||mime(ext),cacheControl:'public, max-age=31536000, immutable'}});}return `${base}/${objectKey}`;}catch(_){return src;}}
function detectExt(item,url){const n=String(item?.filename||'').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];if(n)return norm(n);try{return norm(new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1]||'jpg');}catch(_){return 'jpg';}}
function norm(x){x=String(x||'').toLowerCase();if(x==='jpeg')x='jpg';return ['jpg','png','webp','gif','avif'].includes(x)?x:'jpg';}
function mime(x){return({jpg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'})[x]||'image/jpeg';}
function sanitize(s){return String(s||'').replace(/[^a-zA-Z0-9._-]/g,'_');}
function escapeFormula(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
