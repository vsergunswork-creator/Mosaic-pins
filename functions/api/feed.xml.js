// Google Merchant Center feed from Airtable-backed catalog.
import { getProductsCatalog } from "./_airtable-products.js";

export async function onRequestGet({ env, request }) {
  try {
    const baseUrl = new URL(request.url).origin;
    const { products } = await getProductsCatalog(env);
    const items = products.filter(p=>p.active).map(p=>{
      const price=Number(p.price?.USD); if(!Number.isFinite(price)||!p.images?.length)return null;
      const extra=[`PIN: ${p.pin}`,p.type?`Type: ${p.type}`:null,p.diameter?`Diameter: ${p.diameter} mm`:null,p.materials?.length?`Materials: ${p.materials.join(", ")}`:null].filter(Boolean);
      return {id:p.pin,title:p.title||p.pin,description:[cleanText(p.description),extra.join(" • ")].filter(Boolean).join("\n\n").slice(0,5000),link:`${baseUrl}/p/${encodeURIComponent(p.pin).replace(/%2C/gi, ",")}`,image_link:p.images[0],availability:Number(p.stock||0)>0?'in stock':'out of stock',price:`${price.toFixed(2)} USD`,brand:'Mosaic Pins',condition:'new',gender:'unisex',age_group:'adult',color:p.color||'Multicolor'};
    }).filter(Boolean);
    return new Response(buildXml(items,baseUrl),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=60'}});
  } catch(e){return new Response('Feed error: '+String(e?.message||e),{status:500,headers:{'Content-Type':'text/plain'}});}
}
function buildXml(items,baseUrl){return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Mosaic Pins</title><link>${baseUrl}/</link><description>Handcrafted mosaic pins</description>${items.map(it=>`<item><g:id>${xml(it.id)}</g:id><title>${xml(it.title)}</title><description>${xml(it.description)}</description><link>${xml(it.link)}</link><g:image_link>${xml(it.image_link)}</g:image_link><g:availability>${xml(it.availability)}</g:availability><g:price>${xml(it.price)}</g:price><g:brand>${xml(it.brand)}</g:brand><g:condition>${xml(it.condition)}</g:condition><g:gender>${xml(it.gender)}</g:gender><g:age_group>${xml(it.age_group)}</g:age_group><g:color>${xml(it.color)}</g:color></item>`).join('')}</channel></rss>`;}
function cleanText(s){return String(s||'').replace(/\*\*/g,'').replace(/\n{3,}/g,'\n\n').trim();}
function xml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
