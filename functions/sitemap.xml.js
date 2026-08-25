import {getProductsCatalog} from "./api/_airtable-products.js";

export async function onRequestGet({env,request}){
  try{
    const origin=new URL(request.url).origin;
    const now=new Date().toISOString();
    const staticPages=[
      {loc:`${origin}/`,changefreq:"weekly",priority:"1.0"},
      {loc:`${origin}/about`,changefreq:"monthly",priority:"0.6"},
      {loc:`${origin}/shipping`,changefreq:"monthly",priority:"0.6"},
      {loc:`${origin}/returns`,changefreq:"monthly",priority:"0.6"},
      {loc:`${origin}/reviews`,changefreq:"weekly",priority:"0.7"},
      {loc:`${origin}/privacy.html`,changefreq:"yearly",priority:"0.3"},
      {loc:`${origin}/impressum.html`,changefreq:"yearly",priority:"0.3"}
    ];
    const guidePages=[
      "mosaic-pins-for-knives",
      "knife-handle-mosaic-pins",
      "lanyard-pins-for-knives",
      "glow-mosaic-pins"
    ].map(slug=>({loc:`${origin}/${slug}`,changefreq:"weekly",priority:"0.85"}));
    const {products}=await getProductsCatalog(env);
    const productPages=products.filter(p=>p.active).map(p=>({loc:`${origin}/p/${encodeURIComponent(p.pin).replace(/%2C/gi, ",")}`,changefreq:"weekly",priority:"0.7"}));
    const all=[...staticPages,...guidePages,...productPages];
    const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(x=>`  <url>\n    <loc>${escapeXml(x.loc)}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${x.changefreq}</changefreq>\n    <priority>${x.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
    return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=60'}});
  }catch(e){
    return new Response('Sitemap error: '+String(e?.message||e),{status:500,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
function escapeXml(s){return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));}
