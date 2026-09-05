// GET /api/paypal/config
// PAYPAL_MODE is intentionally mandatory. Missing mode must never silently fall back to Sandbox.
export function onRequestOptions({request}) { return new Response(null,{status:204,headers:corsHeaders(request)}); }
export async function onRequestGet({request,env}) {
  const headers=corsHeaders(request);
  const mode=String(env.PAYPAL_MODE||'').trim().toLowerCase();
  const clientId=String(env.PAYPAL_CLIENT_ID||'').trim();
  if(!['live','sandbox'].includes(mode)) return json({ok:false,error:'PAYPAL_MODE must be explicitly set to live or sandbox'},500,headers);
  if(!clientId) return json({ok:false,error:'PAYPAL_CLIENT_ID is missing'},500,headers);
  return json({ok:true,clientId,mode},200,headers);
}
function corsHeaders(request){const o=request.headers.get('Origin');return{'Access-Control-Allow-Origin':o||'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type',...(o?{Vary:'Origin'}:{})};}
function json(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});}
