const ASSETS=__ASSETS__;
const TYPES={'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8'};
const SERVICES=new Set(['prime','netflix','unext']);
const CATEGORIES=new Set(['映画','アニメ','ドキュメンタリー','シリーズ','未分類']);

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function clampText(value,max){return String(value??'').slice(0,max)}
function clean(item){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id||typeof item.title!=='string'||!item.title.trim()||!SERVICES.has(item.service))return null;
  let href='';try{const url=new URL(item.href);if(['http:','https:'].includes(url.protocol))href=url.href}catch{}
  const now=Date.now();return {id:item.id.slice(0,100),title:item.title.trim().slice(0,250),service:item.service,type:CATEGORIES.has(item.type)?item.type:'未分類',genre:clampText(item.genre||'その他',100),href,memo:clampText(item.memo,5000),watched:item.watched?1:0,star:Math.max(0,Math.min(3,Math.floor(Number(item.star)||0))),addedAt:Number.isFinite(Number(item.addedAt))?Number(item.addedAt):now,updatedAt:Number.isFinite(Number(item.updatedAt))?Number(item.updatedAt):now};
}
function upsert(db,userId,item,deleted=0){return db.prepare(`INSERT INTO watchlist_items (user_id,id,title,service,type,genre,href,memo,watched,star,added_at,updated_at,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,service=excluded.service,type=excluded.type,genre=excluded.genre,href=excluded.href,memo=excluded.memo,watched=excluded.watched,star=excluded.star,added_at=excluded.added_at,updated_at=excluded.updated_at,deleted=excluded.deleted WHERE excluded.updated_at >= watchlist_items.updated_at`).bind(userId,item.id,item.title,item.service,item.type,item.genre,item.href,item.memo,item.watched,item.star,item.addedAt,item.updatedAt,deleted)}
async function sync(request,env){
  const userId=request.headers.get('oai-authenticated-user-id');if(!userId)return json({error:'authentication_required'},401);
  const size=Number(request.headers.get('content-length')||0);if(size>2_000_000)return json({error:'request_too_large'},413);
  let body;try{const text=await request.text();if(text.length>2_000_000)return json({error:'request_too_large'},413);body=JSON.parse(text)}catch{return json({error:'invalid_json'},400)}
  if(!Array.isArray(body.items)||!Array.isArray(body.tombstones)||body.items.length>5000||body.tombstones.length>5000)return json({error:'invalid_payload'},400);
  const statements=[];
  for(const raw of body.items){const item=clean(raw);if(!item)return json({error:'invalid_item'},400);statements.push(upsert(env.DB,userId,item,0))}
  for(const raw of body.tombstones){if(!raw||typeof raw.id!=='string'||!raw.id)continue;const updatedAt=Number.isFinite(Number(raw.updatedAt))?Number(raw.updatedAt):Date.now();statements.push(upsert(env.DB,userId,{id:raw.id.slice(0,100),title:'削除済み',service:'prime',type:'未分類',genre:'その他',href:'',memo:'',watched:0,star:0,addedAt:updatedAt,updatedAt},1))}
  for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
  const result=await env.DB.prepare('SELECT id,title,service,type,genre,href,memo,watched,star,added_at AS addedAt,updated_at AS updatedAt,deleted FROM watchlist_items WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all();
  const items=[],tombstones=[];for(const row of result.results||[]){if(row.deleted)tombstones.push({id:row.id,updatedAt:row.updatedAt});else items.push({...row,watched:Boolean(row.watched),deleted:undefined})}
  return json({items,tombstones});
}
function asset(path,method){const key=path==='/'?'/':path;const body=ASSETS[key];if(body===undefined)return null;const ext=key==='/'?'.html':key.slice(key.lastIndexOf('.'));return new Response(method==='HEAD'?null:body,{headers:{'content-type':TYPES[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public, max-age=300','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}})}

export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/api/sync'&&request.method==='POST')return sync(request,env);if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);return asset(url.pathname,request.method)||new Response('Not found',{status:404})}};
