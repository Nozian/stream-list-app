export const SERVICES={prime:'Prime Video',netflix:'Netflix',unext:'U-NEXT'};
export const TYPES=['映画','アニメ','ドキュメンタリー','シリーズ','未分類'];
export function safeURL(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
export function normalize(value){
 if(!value||typeof value!=='object'||typeof value.title!=='string'||!value.title.trim()||!Object.hasOwn(SERVICES,value.service))throw Error('作品名またはサービスが不正です。');
 return {id:typeof value.id==='string'&&value.id?value.id:crypto.randomUUID(),title:value.title.trim().slice(0,250),service:value.service,type:TYPES.includes(value.type)?value.type:value.genre==='アニメ'?'アニメ':value.genre==='ドキュメンタリー'?'ドキュメンタリー':'未分類',genre:String(value.genre||'その他').slice(0,100),href:safeURL(value.href),memo:String(value.memo||'').slice(0,5000),watched:value.watched===true,star:Math.max(0,Math.min(3,Math.floor(Number(value.star)||0))),addedAt:Number.isFinite(value.addedAt)?value.addedAt:Date.now()};
}
export function readImport(data){
 if(data?.schema==='swo-web'&&data.version===1&&Array.isArray(data.items))return data.items.map(normalize);
 if(data&&['prime','netflix','unext'].some(s=>Array.isArray(data[`swo_${s}_items`])))return Object.keys(SERVICES).flatMap(service=>(data[`swo_${service}_items`]||[]).map(it=>normalize({...it,...data.swo_userdata?.[it.href],service})));
 throw Error('SWOのJSONバックアップを選んでください。');
}
export function mergeImport(current,incoming){const result=current.map(x=>({...x}));for(const item of incoming){const i=result.findIndex(x=>x.id===item.id||(item.href&&x.href===item.href&&x.service===item.service));if(i<0)result.push(item);else result[i]={...item,id:result[i].id};}return result;}
export function filterItems(items,{service='all',type='all',status='all',query='',sort='added'}={}){let result=items.filter(i=>(service==='all'||i.service===service)&&(type==='all'||i.type===type)&&(status==='all'||i.watched===(status==='watched'))&&[i.title,i.genre,i.memo].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));return result.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title,'ja'):sort==='rating'?(a,b)=>b.star-a.star:(a,b)=>b.addedAt-a.addedAt);}
export function csv(items){const cell=value=>'"'+String(value).replace(/^[\s]*[=+@-]/,s=>"'"+s).replaceAll('"','""')+'"';return '\uFEFF'+[['タイトル','種類','ジャンル','サービス','視聴済み','★評価','メモ','URL'],...items.map(i=>[i.title,i.type,i.genre,SERVICES[i.service],i.watched?'済み':'未視聴','★'.repeat(i.star),i.memo,i.href])].map(row=>row.map(cell).join(',')).join('\r\n');}
