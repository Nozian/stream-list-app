export const SERVICES={prime:'Prime Video',netflix:'Netflix',unext:'U-NEXT'};
export const TYPES=['映画','アニメ','ドキュメンタリー','シリーズ','未分類'];

export function safeURL(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}

export function normalize(value){
  if(!value||typeof value!=='object'||typeof value.title!=='string'||!value.title.trim()||!Object.hasOwn(SERVICES,value.service))throw Error('作品名またはサービスが不正です。');
  const now=Date.now();
  return {id:typeof value.id==='string'&&value.id?value.id:crypto.randomUUID(),title:value.title.trim().slice(0,250),service:value.service,type:TYPES.includes(value.type)?value.type:value.genre==='アニメ'?'アニメ':value.genre==='ドキュメンタリー'?'ドキュメンタリー':'未分類',genre:String(value.genre||'その他').slice(0,100),href:safeURL(value.href),memo:String(value.memo||'').slice(0,5000),watched:value.watched===true,star:Math.max(0,Math.min(3,Math.floor(Number(value.star)||0))),addedAt:Number.isFinite(Number(value.addedAt))?Number(value.addedAt):now,updatedAt:Number.isFinite(Number(value.updatedAt))?Number(value.updatedAt):now};
}

export function readImport(data){
  if(data?.schema==='swo-web'&&[1,2].includes(data.version)&&Array.isArray(data.items))return data.items.map(normalize);
  if(data&&['prime','netflix','unext'].some(s=>Array.isArray(data[`swo_${s}_items`])))return Object.keys(SERVICES).flatMap(service=>(data[`swo_${service}_items`]||[]).map(it=>normalize({...it,...data.swo_userdata?.[it.href],service})));
  throw Error('SWOのJSONバックアップを選んでください。');
}

function rowsFromCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(field);field=''}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}
    else field+=c;
  }
  if(quoted)throw Error('CSVの引用符が閉じられていません。');
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}
  return rows.filter(r=>r.some(v=>v.trim()));
}

export function readCSV(text){
  const rows=rowsFromCSV(String(text).replace(/^\uFEFF/,''));if(rows.length<2)throw Error('CSVに作品データがありません。');
  const headers=rows.shift().map(h=>h.trim());const find=(...names)=>names.map(n=>headers.indexOf(n)).find(i=>i>=0)??-1;
  const col={title:find('タイトル','作品名','title'),type:find('種類','種別','type'),genre:find('ジャンル','genre'),service:find('サービス','service'),watched:find('視聴済み','視聴状態','watched'),star:find('★評価','評価','star'),memo:find('メモ','memo'),href:find('URL','作品URL','url')};
  if(col.title<0||col.service<0)throw Error('CSVには「タイトル」と「サービス」の列が必要です。');
  const serviceOf=s=>Object.entries(SERVICES).find(([key,name])=>[key,name,name.replace(' Video','')].some(v=>v.toLowerCase()===String(s).trim().toLowerCase()))?.[0];
  return rows.map((row,index)=>{const service=serviceOf(row[col.service]);if(!service)throw Error(`${index+2}行目のサービスに対応していません。`);const watched=/^(済み|視聴済み|true|1|yes)$/i.test(row[col.watched]||'');const stars=(row[col.star]||'').match(/★/g)?.length||Number(row[col.star])||0;return normalize({title:row[col.title],type:row[col.type],genre:row[col.genre],service,watched,star:stars,memo:row[col.memo],href:row[col.href]})});
}

export function mergeImport(current,incoming){const result=current.map(x=>({...x}));for(const item of incoming){const i=result.findIndex(x=>x.id===item.id||(item.href&&x.href===item.href&&x.service===item.service)||(x.title===item.title&&x.service===item.service));if(i<0)result.push(item);else result[i]={...item,id:result[i].id,addedAt:result[i].addedAt,updatedAt:Math.max(item.updatedAt,Date.now())};}return result;}

export function mergeSynced(local,remote,tombstones=[]){const byId=new Map(local.map(i=>[i.id,i]));for(const item of remote){const old=byId.get(item.id);if(!old||item.updatedAt>=old.updatedAt)byId.set(item.id,normalize(item))}for(const tomb of tombstones){const old=byId.get(tomb.id);if(old&&tomb.updatedAt>=old.updatedAt)byId.delete(tomb.id)}return [...byId.values()];}

export function filterItems(items,{service='all',type='all',status='all',query='',sort='added'}={}){let result=items.filter(i=>(service==='all'||i.service===service)&&(type==='all'||i.type===type)&&(status==='all'||i.watched===(status==='watched'))&&[i.title,i.genre,i.memo].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));return result.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title,'ja'):sort==='rating'?(a,b)=>b.star-a.star:(a,b)=>b.addedAt-a.addedAt);}

export function csv(items){const cell=value=>'"'+String(value).replace(/^[\s]*[=+@-]/,s=>"'"+s).replaceAll('"','""')+'"';return '\uFEFF'+[['タイトル','種類','ジャンル','サービス','視聴済み','★評価','メモ','URL'],...items.map(i=>[i.title,i.type,i.genre,SERVICES[i.service],i.watched?'済み':'未視聴','★'.repeat(i.star),i.memo,i.href])].map(row=>row.map(cell).join(',')).join('\r\n');}
