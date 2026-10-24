/* Nozian Entertainment Hub v1.1 — service collectors, safe incremental import,
   cancelable multi-scroll, original YouTube grid & tag editing preserved. */
(() => {
  'use strict';
  if (window.__nzEntertainmentCollector) return;
  window.__nzEntertainmentCollector = true;

  const host = location.hostname;
  const service = host.endsWith('youtube.com') ? 'youtube' :
    host.endsWith('netflix.com') ? 'netflix' :
    host === 'video.unext.jp' ? 'unext' :
    (host.includes('amazon.') || host.endsWith('primevideo.com')) ? 'prime' : null;
  if (!service) return;
  const names = { youtube: 'YouTube', netflix: 'Netflix', prime: 'Prime Video', unext: 'U-NEXT' };
  const LIMIT = 12000;
  const safeUrl = (v) => {
    try { const u = new URL(v, location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; }
    catch { return ''; }
  };
  const cleanText = v => String(v || '').replace(/[\u00a0\s]+/g, ' ').trim().slice(0, 240);
  const normalized = v => cleanText(v).normalize('NFKC').toLocaleLowerCase('ja');
  const stamp = () => Date.now();
  const captured = new Map();
  let bar = null, gridUI = null, collapsed = false, collecting = false, stopFlag = false, lastUrl = location.href;
  let activeRun = 0, hasCollected = false;

  function currentPage() {
    const p = location.pathname.toLowerCase();
    if (service === 'youtube') return p === '/playlist' || p === '/watch';
    if (service === 'netflix') return p.startsWith('/browse');
    if (service === 'unext') return /\/(mylist|browse)/.test(p);
    if (service === 'prime') return /(?:\/gp\/video\/|\/watchlist|\/mystuff|\/my-stuff|\/storefront|\/region\/)/.test(p) || host.endsWith('primevideo.com');
    return false;
  }
  function listPage() {
    const address = (location.pathname + location.search).toLowerCase();
    if (service === 'netflix') return /my-list|mylist|\/browse\/m/.test(address);
    if (service === 'prime') return /watchlist|my.?stuff|\/list/.test(address);
    if (service === 'youtube') return location.pathname === '/playlist';
    return /mylist/.test(address);
  }

  const NON_TITLES = /^(?:true|false|undefined|null|yes|no|on|off|1|0|play|pause|watch|more|video|視聴する|再生(?:する)?|続きを再生|詳細を見る|再生済み|再生済|視聴済み|視聴済|既に再生済み|再生履歴あり|未再生|あとで見る|次に再生|次へ|前へ|もっと見る|詳細|マイリスト|新着作品のお知らせ|新作のお知らせ|新着エピソードのお知らせ|リマインダーを設定|お知らせ|通知|add to my list|my list|watched|played|already watched|resume|mark as watched)$/i;
  function usableTitle(value) {
    const s = cleanText(value);
    if (!s || s.length < 2 || s.length > 190 || NON_TITLES.test(s)) return '';
    return s;
  }
  function titleFor(tile, link, img) {
    const candidates = [
      link?.getAttribute('title'),
      tile?.querySelector('a#video-title, a#video-title-link, #video-title')?.getAttribute('title'),
      tile?.querySelector('yt-formatted-string#video-title')?.getAttribute('title'),
      link?.querySelector('yt-formatted-string#video-title, yt-formatted-string')?.textContent,
      tile?.querySelector('a#video-title, a#video-title-link, #video-title yt-formatted-string, h3 a#video-title, h3 yt-formatted-string')?.textContent,
      tile?.querySelector('#video-title')?.textContent,
      link?.textContent,
      tile?.querySelector('.fallback-text, .title-card-title, [data-testid="title"], [data-uia*="title-text"], [data-automation-id="title"]')?.textContent,
      img?.getAttribute('alt'),
      link?.getAttribute('aria-label'), tile?.getAttribute('aria-label'),
      tile?.querySelector('img[alt]')?.getAttribute('alt'),
      tile?.querySelector('[class*="title"]')?.textContent
    ];
    for (const candidate of candidates) {
      const title=usableTitle(candidate);
      if (title) return title;
    }
    return '';
  }
  function isWrongTitle(title) {
    const s=cleanText(title);
    return !usableTitle(s) || /^(?:Netflix作品（ID|Netflix作品\s*\(|タイトル確認待ち|作品名未取得)/i.test(s);
  }
  function newRecord(href, title, image = '', more = {}) {
    if (!title || (!href && !(service==='netflix' && more.sourceId))) return null;
    return {title, service, href:href||'', thumbnail: safeUrl(image), genre:'', type:service==='youtube'?'動画':'未分類',
      tags:'', memo:'', watched:false, star:0, addedAt:stamp(), updatedAt:stamp(), ...more};
  }
  function recordKey(item){return item.service+'|'+(item.href||item.sourceId||item.title);}
  function remember(m, item) {
    if (!item || (!item.href && !item.sourceId) || m.size >= LIMIT) return;
    let key=recordKey(item);
    // If the same poster later reveals a Netflix title ID, upgrade its draft card
    // instead of counting the poster and the named item twice.
    if(service==='netflix' && item.artworkKey){
      for(const [k,previous] of m){
        if(k!==key && previous.service==='netflix' && previous.artworkKey===item.artworkKey){
          if((previous.pendingTitle && !item.pendingTitle) || (previous.sourceId?.startsWith('poster:') && item.sourceId?.startsWith('nf:'))){m.delete(k);break;}
          if(!previous.pendingTitle && item.pendingTitle)return;
        }
      }
    }
    const old=m.get(key);
    if (!old)m.set(key,item);
    else if ((isWrongTitle(old.title)) && !isWrongTitle(item.title))m.set(key,{...old,...item,thumbnail:item.thumbnail||old.thumbnail});
    else if (!old.thumbnail && item.thumbnail)m.set(key,{...old,thumbnail:item.thumbnail});
  }
  // Netflix 2026 My Netflix markup, verified from user DevTools screenshot:
  // section[aria-labelledby] / [data-uia="carousel-row-section-*"]
  //    -> [data-uia="carousel-scroller"] -> cards.
  // Select the ROW BY ITS LABEL, NOT by preexisting card data-videoid.
  // Netflix is ALWAYS horizontal-only. We never scroll the page or call scrollIntoView.
  let selectedNetflixRow = null, detectedNetflixRow = null;
  const NETFLIX_CAROUSEL = '[data-uia="carousel-scroller"], .sliderContent, [class*="sliderContent"]';
  const NETFLIX_ROW = 'section[aria-labelledby], section[data-uia^="carousel-row-section"], section.carousel-row, section.lolomoRow';
  const NETFLIX_META = '[data-videoid],[data-video-id],[data-title-id],[data-titleid],[data-entity-id],[data-uia*="carousel-item"],[data-uia*="title-card"],.slider-item,.title-card-container,a[href*="/watch/"],a[href*="/title/"],a[href*="jbv="]';
  let netflixDiagnostics = {cards:0, ids:0, named:0, drafts:0, row:false};
  function isMyListHeading(value) {
    return /^(?:マイリスト|あなたのマイリスト|My\s*List)(?:\s*[（(]?\d+[)）]?)?$/i.test(cleanText(value));
  }
  function scrollerOf(row) { return row?.querySelector(NETFLIX_CAROUSEL) || null; }
  function labelOf(row) {
    const labelled=row.getAttribute('aria-labelledby')||'';
    for(const id of labelled.split(/\s+/)){
      const el=document.getElementById(id);
      if(el && isMyListHeading(el.textContent))return el;
    }
    const aria=row.getAttribute('aria-label');
    if(isMyListHeading(aria))return row;
    // Only inspect heading-like elements in this row, never all its button text.
    for(const el of row.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-uia*="heading"],[class*="rowTitle"],[class*="row-title"]')){
      if(isMyListHeading(el.textContent)||isMyListHeading(el.getAttribute('aria-label')))return el;
    }
    return null;
  }
  function netflixRowHeadings(row) {
    return [...row.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-uia*="heading"]')]
      .map(x=>cleanText(x.textContent)).filter(Boolean);
  }
  function rowFromHeading(heading) {
    if(!heading)return null;
    if(heading.matches?.(NETFLIX_ROW) && scrollerOf(heading))return heading;
    const direct=heading.closest?.(NETFLIX_ROW);
    if(direct && scrollerOf(direct))return direct;
    for(let el=heading.parentElement, depth=0;el && el!==document.body && depth<8;el=el.parentElement,depth++){
      if(el.matches?.('section') && scrollerOf(el))return el;
    }
    return null;
  }
  function findNetflixMyListRow() {
    if(selectedNetflixRow?.isConnected && scrollerOf(selectedNetflixRow))return selectedNetflixRow;
    if(detectedNetflixRow?.isConnected && scrollerOf(detectedNetflixRow))return detectedNetflixRow;
    // This is the important fix: a labelled row is valid even if none of its
    // movie cards has mounted a URL/ID yet.
    for(const row of document.querySelectorAll(NETFLIX_ROW)){
      if(!scrollerOf(row))continue;
      if(labelOf(row)) {detectedNetflixRow=row;return row;}
    }
    // Fallback for older layouts with a separate "マイリスト" heading.
    for(const heading of document.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-uia*="heading"]')){
      if(!isMyListHeading(heading.textContent))continue;
      const row=rowFromHeading(heading);
      if(row){detectedNetflixRow=row;return row;}
    }
    // Last resort: match the exact text in a span/div near a carousel.
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n,iterations=0;
    while((n=walker.nextNode()) && iterations++<40000){
      if(!isMyListHeading(n.nodeValue))continue;
      const row=rowFromHeading(n.parentElement);
      if(row){detectedNetflixRow=row;return row;}
    }
    return null;
  }
  function netflixCardCount(row) {
    const scope=scrollerOf(row);
    return scope?.querySelectorAll(NETFLIX_META).length || scope?.querySelectorAll('img').length || 0;
  }
  // The carousel can be virtualized: no newly saved titles does not mean no motion.
  // Observe physical position, CSS transforms, card IDs and visible card layout.
  function netflixRowSignature(row) {
    if(!row?.isConnected)return 'detached';
    const slider=scrollerOf(row);
    if(!slider)return 'missing-scroller';
    const cards=[...slider.querySelectorAll('[data-videoid],[data-video-id],[data-title-id],[data-titleid],[data-entity-id]')].slice(0,40);
    const ids=cards.map(el=>['data-videoid','data-video-id','data-title-id','data-titleid','data-entity-id'].map(k=>el.getAttribute(k)||'').join(':')).join(';');
    const track=slider.querySelector('[class*="sliderContent"],[role="list"],ul')||slider.firstElementChild;
    const first=cards[0]||slider.querySelector('img');
    const position=first?.getBoundingClientRect?.();
    const transform=track?getComputedStyle(track).transform:'';
    return [Math.round(slider.scrollLeft||0),slider.scrollWidth,ids,
      slider.querySelectorAll('img').length, track?.style?.transform||'',transform,
      position?Math.round(position.left):'', position?Math.round(position.right):''].join('|');
  }
  // Stable *visible* card order lets us detect a carousel that loops back to
  // its beginning. Do not use the number of saved items as a lap indicator:
  // Netflix can mount many items at once or delay rendering their titles.
  function netflixVisibleWindow(row) {
    const scroller=scrollerOf(row);
    if(!scroller)return [];
    const viewport=scroller.getBoundingClientRect();
    if(viewport.width<80 || viewport.height<20)return [];
    const cards=[];
    for(const tile of netflixCandidateTiles(row)) {
      const box=tile.getBoundingClientRect();
      // Only items actually inside the horizontal carousel viewport count.
      if(box.width<15 || box.height<15 || box.right<=viewport.left+12 || box.left>=viewport.right-12 ||
         box.bottom<=viewport.top || box.top>=viewport.bottom)continue;
      const id=netflixId(tile);
      const art=id?'':netflixArtwork(tile).url;
      const key=id?'nf:'+id:art?netflixPosterKey(art):'';
      if(!key)continue;
      cards.push({key,left:box.left});
    }
    cards.sort((a,b)=>a.left-b.left);
    return [...new Set(cards.map(c=>c.key))];
  }
  function netflixWindowFingerprint(row) {
    const keys=netflixVisibleWindow(row);
    // A single card or an unlabeled card is not a reliable lap marker.
    return keys.length>=2?keys.slice(0,Math.min(keys.length,4)).join('|'):'';
  }
  function netflixArrowButtons(row, direction) {
    const isForward=direction>0;
    const candidates=[...row.querySelectorAll('button,[role="button"],[data-uia*="next"],[data-uia*="prev"]')];
    const directionRE=isForward?/(?:\bnext\b|right|次へ|次の|右へ|前に進む|carousel.*forward)/i:/(?:\bprev\b|previous|left|前へ|前の|左へ|戻る|carousel.*back)/i;
    return candidates.filter(b=>{
      const names=['aria-label','data-uia','data-testid','title','data-automation-id'].map(k=>b.getAttribute(k)||'').join(' ');
      // Netflix also uses arrow-only buttons named handleNext / handlePrev.
      // Match these tokens precisely, not unrelated class names such as preview.
      const css=typeof b.className==='string'?b.className:'';
      const token=isForward?/(?:^|[\s_-])(?:handleNext|nextButton|sliderNext|next)(?:$|[\s_-])/i:/(?:^|[\s_-])(?:handlePrev|prevButton|sliderPrev|prev|previous)(?:$|[\s_-])/i;
      return directionRE.test(names)||token.test(css);
    });
  }
  function netflixAtBoundary(row,direction) {
    const slider=scrollerOf(row); if(!slider)return false;
    const buttons=netflixArrowButtons(row,direction);
    if(buttons.length && buttons.every(b=>b.disabled||b.getAttribute('aria-disabled')==='true'))return true;
    // Native horizontal scroll has a measurable endpoint; CSS-transform sliders do not.
    if(!buttons.length && slider.scrollWidth>slider.clientWidth+20){
      const max=Math.max(0,slider.scrollWidth-slider.clientWidth);
      return direction>0?slider.scrollLeft>=max-3:slider.scrollLeft<=3;
    }
    return false;
  }
  function moveNetflixMyList(direction=1) {
    const row=findNetflixMyListRow();
    if(!row)return {moved:false,reason:'row-missing'};
    const slider=scrollerOf(row);
    const buttons=netflixArrowButtons(row,direction);
    for(const b of buttons){
      if(b.disabled||b.getAttribute('aria-disabled')==='true'||b.hasAttribute('hidden'))continue;
      // Netflix may animate a virtualized carousel on arrow clicks.
      b.click();return {moved:true,via:'row-arrow'};
    }
    // Fallback only for a genuinely scrollable, horizontal CAROUSEL, never the document.
    for(const target of [slider,slider?.querySelector('[role="list"],ul,[class*="sliderContent"]')]){
      if(!target||target.scrollWidth<=target.clientWidth+20)continue;
      const old=target.scrollLeft;
      const amount=Math.max(200,Math.floor(target.clientWidth*.78));
      target.scrollLeft=old+direction*amount;
      if(Math.abs(target.scrollLeft-old)>2)return {moved:true,via:'horizontal-scroll'};
    }
    return {moved:false,reason:'no-working-horizontal-control'};
  }
  function netflixId(node) {
    // Only recognized Netflix title IDs, never arbitrary tracking/row numbers.
    const fields=['data-videoid','data-video-id','data-title-id','data-titleid','data-entity-id'];
    const chain=[node,...node.querySelectorAll('[data-videoid],[data-video-id],[data-title-id],[data-titleid],[data-entity-id],a[href],[role="link"][data-href]')];
    for(const el of chain){
      for(const field of fields){const raw=el.getAttribute?.(field);if(/^\d{5,20}$/.test(raw||''))return raw;}
      for(const href of [el.getAttribute?.('href'),el.getAttribute?.('data-href')]){
        const s=String(href||'');
        const match=s.match(/\/(?:watch|title)\/(\d{5,20})(?:[/?#]|$)/)||s.match(/[?&]jbv=(\d{5,20})(?:[&#]|$)/);
        if(match)return match[1];
      }
    }
    return '';
  }
  function netflixArtwork(tile) {
    const images=[...tile.querySelectorAll('img')];
    // Netflix can lazy-load img.src after the card first mounts.
    for(const img of images){
      const url=safeUrl(img.currentSrc||img.getAttribute('src')||img.getAttribute('data-src')||'');
      if(!url || /(?:\/logo[.\/_-]|data:image\/svg)/i.test(url))continue;
      if(img.naturalWidth && img.naturalHeight && img.naturalWidth<80 && img.naturalHeight<80)continue;
      return {url,img};
    }
    return {url:'',img:images[0]||null};
  }
  function netflixTitle(tile) {
    const labeledBy=[];
    for(const el of [tile,...tile.querySelectorAll('[aria-labelledby]')]){
      const ids=(el.getAttribute?.('aria-labelledby')||'').split(/\s+/);
      for(const id of ids){const label=id&&document.getElementById(id);if(label && tile.contains(label))labeledBy.push(label.textContent);}
    }
    const sources=[
      ...[tile,...tile.querySelectorAll('[data-title],[data-name],[data-title-name],a[aria-label],[role="link"][aria-label],img[aria-label]')].flatMap(el=>[
        el.getAttribute('data-title'),el.getAttribute('data-name'),el.getAttribute('data-title-name'),el.getAttribute('aria-label')]),
      ...[...tile.querySelectorAll('img')].flatMap(el=>[el.getAttribute('alt'),el.getAttribute('title')]),
      ...[...tile.querySelectorAll('.fallback-text,.title-card-title,[data-uia*="title-text"],[data-uia*="title-name"],[data-testid="title"],.video-title,.title-text')].map(el=>el.textContent),
      ...labeledBy,
      tile.querySelector('a[href*="/watch/"]')?.getAttribute('title'),
      tile.querySelector('a[href*="/title/"]')?.getAttribute('title')
    ];
    for(const raw of sources){
      let value=cleanText(raw);
      value=value.replace(/^(?:作品の詳細[：:]\s*|作品[：:]\s*|Watch\s+|Play\s+|再生する[：:]\s*)/i,'')
        .replace(/\s*(?:を再生|を視聴|の詳細|を詳しく見る|を再生する)\s*$/,'');
      if(!usableTitle(value) || /^(?:作品|画像|ポスター|サムネイル|Netflix|プレイ|再生|再生する|続きを再生|視聴中|再生済み|詳細を見る|予告を見る|マイリストに追加|マイリストから削除|新着作品のお知らせ|リマインダーを設定)$/i.test(value))continue;
      if(/^(?:続きから再生|音声と字幕|新着作品のお知らせ|マイリスト|あなたへのおすすめ)/.test(value))continue;
      return value;
    }
    return '';
  }
  function netflixPosterKey(url){
    // A stable DOM-visible artwork fingerprint is a temporary key, not a Netflix title ID.
    let h=2166136261;
    for(let i=0;i<url.length;i++){h=Math.imul(h^url.charCodeAt(i),16777619)>>>0;}
    return 'poster:'+h.toString(36);
  }
  function netflixCandidateTiles(row) {
    const scroller=scrollerOf(row);if(!scroller)return [];
    const cardSelector='[data-uia*="carousel-item"],[data-uia*="title-card"],.slider-item,.title-card-container,[role="listitem"],li';
    const elements=[...scroller.querySelectorAll(NETFLIX_META+',img')];
    const cards=[],seen=new Set();
    for(const node of elements){
      if(node.closest('#nz-ent-capture,#nz-ent-grid'))continue;
      let tile=node.closest(cardSelector);
      if(!tile || !scroller.contains(tile)){
        const a=node.closest('a[href*="/watch/"],a[href*="/title/"]');
        tile=a && scroller.contains(a)?a:(node.matches('img')?node.parentElement:node);
      }
      if(!tile || !scroller.contains(tile))continue;
      // If a nested title-ID node was encountered, prefer a poster wrapper where possible.
      if(tile.matches('img'))tile=tile.parentElement;
      if(!seen.has(tile)){seen.add(tile);cards.push(tile);}
    }
    // A few Netflix carousel variants store cards as flex children with only poster images.
    if(!cards.length){for(const img of scroller.querySelectorAll('img')){
      const tile=img.closest('a,button,[role="link"]')||img.parentElement;
      if(tile && !seen.has(tile)){seen.add(tile);cards.push(tile);}
    }}
    return cards;
  }
  function netflixScan(m) {
    const row=findNetflixMyListRow();
    if(!row){netflixDiagnostics={cards:0,ids:0,named:0,drafts:0,row:false};return;}
    const tiles=netflixCandidateTiles(row);
    const stats={cards:tiles.length,ids:0,named:0,drafts:0,row:true};
    for(const tile of tiles){
      const id=netflixId(tile);if(id)stats.ids++;
      const title=netflixTitle(tile);if(title)stats.named++;
      const poster=netflixArtwork(tile);
      const artworkKey=poster.url?netflixPosterKey(poster.url):'';
      if(!id && !artworkKey)continue; // no trustworthy identity at all
      const pendingTitle=!title;
      if(pendingTitle)stats.drafts++;
      const sourceId=id?'nf:'+id:artworkKey;
      const href=id?'https://www.netflix.com/watch/'+id: title?'https://www.netflix.com/search?q='+encodeURIComponent(title):'';
      const name=title||'タイトル確認待ち（Netflix）';
      remember(m,newRecord(href,name,poster.url,{sourceId,artworkKey,pendingTitle}));
    }
    netflixDiagnostics=stats;
  }
  function primeScan(m) {
    const candidates = document.querySelectorAll([
      'a[href*="/detail/"]','a[href*="/gp/video/detail/"]','a[href*="/dp/"]',
      '[data-testid*="title-card"]','[data-testid*="watchlist"] a[href]',
      '[data-automation-id*="title-card"] a[href]','[data-testid*="content-card"] a[href]'
    ].join(','));
    for (const node of candidates) {
      if (node.closest('#nz-ent-capture,#nz-ent-grid')) continue;
      const link=node.matches('a[href]')?node:node.querySelector('a[href*="/detail/"],a[href*="/dp/"]');
      if (!link) continue;
      const address=safeUrl(link.href||link.getAttribute('href'));
      if (!address || !/\/(?:detail|dp)\//.test(new URL(address).pathname)) continue;
      const url=new URL(address);url.search='';url.hash='';
      const tile=node.closest('article,li,[data-testid*="card"],[data-automation-id*="card"],[class*="Card"],[class*="card"],[class*="item"]')||node.parentElement;
      const img=tile?.querySelector('img[alt],img') || link.querySelector('img');
      const title=titleFor(tile,link,img);
      if(!title)continue;
      remember(m,newRecord(url.href,title,img?.currentSrc||img?.src||''));
    }
  }
  function youtubeTitle(tile, link){
    // Status/overlay text ("再生済み", "True") is NOT a title.
    const titleNode=tile.querySelector('a#video-title,a#video-title-link,yt-formatted-string#video-title,#video-title');
    const sources=[
      link?.getAttribute('title'),titleNode?.getAttribute('title'),
      tile.querySelector('yt-formatted-string#video-title')?.getAttribute('title'),
      tile.querySelector('a#video-title yt-formatted-string, a#video-title .yt-core-attributed-string')?.textContent,
      titleNode?.textContent,link?.textContent,
      tile.querySelector('h3')?.textContent,
      tile.querySelector('img[alt]')?.getAttribute('alt'),
      link?.getAttribute('aria-label')
    ];
    return sources.map(usableTitle).find(Boolean)||'';
  }
  function youtubeScan(m) {
    const sel=listPage()?'ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer':
      'ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer,ytd-rich-grid-media';
    for(const tile of document.querySelectorAll(sel)) {
      const link=tile.querySelector('a#video-title,a#video-title-link,a[href*="watch?v="]');if(!link)continue;
      const u=safeUrl(link.href||link.getAttribute('href'));if(!u)continue;
      const id=new URL(u).searchParams.get('v');if(!id||!/^[-\w]{6,20}$/.test(id))continue;
      const name=youtubeTitle(tile,link);if(!name)continue;
      remember(m,newRecord('https://www.youtube.com/watch?v='+encodeURIComponent(id),name,
        'https://i.ytimg.com/vi/'+encodeURIComponent(id)+'/hqdefault.jpg',{sourceId:id}));
    }
  }
  function unextScan(m) {
    for(const a of document.querySelectorAll('a[href*="/title/"]')) {
      const url=safeUrl(a.href);if(!url)continue;
      const tile=a.closest('li,[class*="card"],[class*="item"],[class*="thumb"]')||a.parentElement;
      const img=tile?.querySelector('img[alt],img');const title=titleFor(tile,a,img);
      remember(m,newRecord(url,title,img?.currentSrc||img?.src||''));
    }
  }
  function scan() {
    const current=new Map();
    if(service==='netflix')netflixScan(current);
    else if(service==='prime')primeScan(current);
    else if(service==='youtube')youtubeScan(current);
    else if(service==='unext')unextScan(current);
    for(const item of current.values()) remember(captured,item);
    return [...current.values()];
  }
  function status(message) {if(bar)bar.querySelector('.nz-msg').textContent=message;}
  async function persist(newItems) {
    const saved=await chrome.storage.local.get('nzEntertainmentItems');
    const all=Array.isArray(saved.nzEntertainmentItems)?saved.nzEntertainmentItems:[];
    if(!newItems.length)return {added:0,total:all.length,pending:all.filter(x=>x.service==='netflix'&&x.pendingTitle).length};
    const findExisting=item=>all.findIndex(x=>x.service===item.service && (
      (item.href && x.href===item.href) ||
      (item.sourceId && x.sourceId===item.sourceId) ||
      (item.artworkKey && x.artworkKey===item.artworkKey && (x.pendingTitle||item.pendingTitle))));
    let added=0,improved=0;
    for(const it of newItems){
      const oldIndex=findExisting(it);
      if(oldIndex<0){all.push(it);added++;continue;}
      const old=all[oldIndex];let changed=false;
      if(isWrongTitle(old.title)&&!isWrongTitle(it.title)){old.title=it.title;old.pendingTitle=false;changed=true;}
      if(it.href && (!old.href || (/\/search\?q=/.test(old.href) && /\/watch\/\d+/.test(it.href)))){old.href=it.href;changed=true;}
      if(it.sourceId && (!old.sourceId || (old.sourceId.startsWith('poster:') && it.sourceId.startsWith('nf:')))){old.sourceId=it.sourceId;changed=true;}
      if(!old.artworkKey && it.artworkKey){old.artworkKey=it.artworkKey;changed=true;}
      if(!old.thumbnail&&it.thumbnail){old.thumbnail=it.thumbnail;changed=true;}
      if(changed)improved++;
    }
    if(added||improved)await chrome.storage.local.set({nzEntertainmentItems:all});
    return {added,total:all.length,pending:all.filter(x=>x.service==='netflix'&&x.pendingTitle).length};
  }

  // Scroll the page as well as a main list's own vertical/horizontal scrollers.
  function scrollTargets() {
    const root=document.scrollingElement||document.documentElement;
    const candidates=[root,...document.querySelectorAll('main,[role="main"],[data-testid*="watchlist"],[class*="watchlist"],[class*="scroll"],ytd-playlist-video-list-renderer')];
    return [...new Set(candidates)].filter(el=>!el.closest?.('#nz-ent-capture,#nz-ent-grid')&&el.clientWidth>180).slice(0,75);
  }
  function scrollStep() {
    const scrollable=scrollTargets();let shifted=0;
    for (const el of scrollable) {
      const isRoot=el===document.scrollingElement||el===document.documentElement;
      const oldY=isRoot?scrollY:el.scrollTop;
      const height=isRoot?window.innerHeight:el.clientHeight;
      if(el.scrollHeight>height+45) {
        const next=oldY+Math.max(250,Math.floor(height*.82));
        if(isRoot)window.scrollTo({top:next,behavior:'instant'});
        else el.scrollTop=next;
        shifted+=Math.max(0,(isRoot?scrollY:el.scrollTop)-oldY);
      }
      // Prime sometimes uses horizontally scrolling card rows inside My List.
      if(service==='prime' && el!==document.documentElement && el.scrollWidth>el.clientWidth+90 && el.clientWidth>300){
        const x=el.scrollLeft;el.scrollLeft=x+Math.max(280,el.clientWidth*.8);shifted+=Math.abs(el.scrollLeft-x);
      }
    }
    return shifted;
  }
  async function saveOnePass(label='画面を収集') {
    hasCollected=true;
    const items=scan(), outcome=await persist(items);
    if(!items.length) status(service==='netflix'
      ? `0件：${netflixDiagnostics.row?'マイリスト行は検出済み':'マイリスト行が未検出'}。カード候補 ${netflixDiagnostics.cards}件、ID取得 ${netflixDiagnostics.ids}件、タイトル取得 ${netflixDiagnostics.named}件、仮登録 ${netflixDiagnostics.drafts}件。識別できた画像や作品IDは「タイトル確認待ち」で仮保存します。` 
      : '0件：対象の作品がまだ画面に読み込まれていません。リスト画面で再試行してね。');
    else status(`${label}：${items.length}件確認、${outcome.added}件追加（保存済み ${outcome.total}件）`);
    return items;
  }
  // Keeps the last carousel position when a scan stalls or the user stops.
  let netflixResume={direction:1,paused:false};
  const NETFLIX_WAIT_MS=[420,440,520,680,950];
  const NETFLIX_STALL_LIMIT=8; // 3 was too aggressive for Netflix lazy loading.
  const waitNetflix=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function netflixCollectRow(run) {
    let row=findNetflixMyListRow();
    for(let i=0;i<12&&!row&&!stopFlag&&run===activeRun;i++){
      status(`Netflixの「マイリスト」行を確認中… ${i+1}/12`);
      await waitNetflix(600);row=findNetflixMyListRow();
    }
    if(!row){status('マイリスト行が見つかりません。ページは縦スクロールしていません。「マイリスト行を指定」を使ってね。');return;}
    let added=0,paused=false,endedWithProof=false,completedLap=false;
    const collectPass=async()=>{
      const results=scan();const r=await persist(results);added+=r.added;
      status(`右送り収集中：今回${captured.size}件取得・新規${added}件 / 保存済み${r.total}件（タイトル確認待ち${r.pending}件）｜カード${netflixDiagnostics.cards}/ID${netflixDiagnostics.ids}/題名${netflixDiagnostics.named}`);
      return {count:captured.size,diagnostics:{...netflixDiagnostics}};
    };
    await collectPass();
    // Track the visible *order* of cards, not just saved-count growth.
    const origin=netflixWindowFingerprint(row);
    let lastWindow=origin;
    const distinctWindows=new Set(origin?[origin]:[]);
    let leftOrigin=false,changedWindows=0;
    let stalled=0;
    const maxSteps=1200;
    for(let step=0;step<maxSteps&&!stopFlag&&run===activeRun;step++){
      row=findNetflixMyListRow();
      if(!row){
        for(let j=0;j<8&&!row&&!stopFlag&&run===activeRun;j++){
          await waitNetflix(350);row=findNetflixMyListRow();
        }
        if(!row){paused=true;break;}
      }
      const before=netflixRowSignature(row),beforeCount=captured.size;
      const boundaryBefore=netflixAtBoundary(row,1);
      if(boundaryBefore){
        // Give the carousel a chance to flush any final lazy-loaded cards.
        for(let j=0;j<3&&!stopFlag&&run===activeRun;j++){await waitNetflix(400);await collectPass();}
        endedWithProof=true;break;
      }
      const movement=moveNetflixMyList(1); // ALWAYS forward/right, never rewind.
      let changed=false;
      for(const ms of NETFLIX_WAIT_MS){
        if(stopFlag||run!==activeRun)break;
        await waitNetflix(ms);
        const result=await collectPass();
        row=findNetflixMyListRow();
        if((row && netflixRowSignature(row)!==before)||result.count!==beforeCount){changed=true;break;}
      }
      if(stopFlag||run!==activeRun)break;
      if(changed)stalled=0;else stalled++;
      const windowKey=row?netflixWindowFingerprint(row):'';
      if(windowKey && windowKey!==lastWindow){
        changedWindows++;
        distinctWindows.add(windowKey);
        if(origin && windowKey!==origin)leftOrigin=true;
        // Loop confirmed only after departing origin, physically advancing
        // through several different windows, then returning to exact order.
        if(origin && leftOrigin && windowKey===origin && changedWindows>=3 && distinctWindows.size>=3){
          completedLap=true;endedWithProof=true;
        }
        lastWindow=windowKey;
      }
      status(`Netflix 右送り ${step+1}回：${captured.size}件取得・${added}件追加 ｜カード${netflixDiagnostics.cards}/ID${netflixDiagnostics.ids}/題名${netflixDiagnostics.named}/仮${netflixDiagnostics.drafts} ｜窓の変化${changedWindows} ｜待機${stalled}/${NETFLIX_STALL_LIMIT} ｜停止可能`);
      if(completedLap)break;
      const provenEdge=!!row && netflixAtBoundary(row,1);
      if(provenEdge && stalled>=2){endedWithProof=true;break;}
      if(stalled>=NETFLIX_STALL_LIMIT){paused=true;break;}
      if(step===maxSteps-1){paused=true;break;}
      // No working control is not evidence of a completed lap or of the edge.
      if(!movement.moved && !changed && !provenEdge && stalled>=3){paused=true;break;}
    }
    if(!stopFlag&&run===activeRun)await collectPass();
    if(stopFlag||run!==activeRun){
      netflixResume={direction:1,paused:true};
      status(`手動停止：${captured.size}件取得・${added}件保存。現在位置から右送りを再開できます。`);
    } else if(paused){
      netflixResume={direction:1,paused:true};
      status(`右送りが一時停止：${captured.size}件取得・${added}件保存。終点や一周を確認できなかったため、続きから再開できます。`);
    } else {
      netflixResume={direction:1,paused:false};
      status(completedLap?
        `マイリスト1周完了を検知して自動停止：${captured.size}件検出・${added}件追加。同じ作品の並びに戻りました。`:
        endedWithProof?
        `確認できる右端まで到達して自動停止：${captured.size}件検出・${added}件追加。`:
        `横送りの進行が止まりました：${captured.size}件検出・${added}件追加。終点の確証はありません。`);
    }
    const auto=bar?.querySelector('[data-action="auto"]');
    if(auto)auto.textContent=netflixResume.paused?'続きから横送り収集':'マイリストを横送り収集';
  }
  // For vertical collectors, only declare completion after reaching the actual
  // bottom of the root page (or its independently scrollable main pane) AND
  // observing several settled scans. This protects lazy-loaded lists.
  function verticalBottomState() {
    const root=document.scrollingElement||document.documentElement;
    const rootHeight=Math.max(root.scrollHeight,document.documentElement.scrollHeight,document.body?.scrollHeight||0);
    if(rootHeight>innerHeight+45) {
      return {measurable:true,atBottom:(scrollY+innerHeight>=rootHeight-9)};
    }
    const nested=scrollTargets().filter(el=>el!==root&&el!==document.documentElement &&
      el.scrollHeight>el.clientHeight+45 && /auto|scroll/i.test(getComputedStyle(el).overflowY));
    if(nested.length){
      const main=nested.reduce((best,el)=>el.scrollHeight>best.scrollHeight?el:best,nested[0]);
      return {measurable:true,atBottom:main.scrollTop+main.clientHeight>=main.scrollHeight-9};
    }
    return {measurable:false,atBottom:false};
  }
  async function autoCollect() {
    if(collecting)return;
    hasCollected=true;
    collecting=true;stopFlag=false;const run=++activeRun;
    bar.querySelector('[data-action="auto"]').hidden=true;
    bar.querySelector('[data-action="stop"]').hidden=false;
    bar.classList.remove('nz-collapsed');collapsed=false;
    const stopFloating=document.getElementById('nz-ent-stop-fixed');if(stopFloating)stopFloating.hidden=false;
    let scans=0,stable=0,prev=-1,totalAdded=0,bottomStable=0,atBottomProof=false,safetyLimit=false;
    // A finite fail-safe prevents getting stuck on feeds that never end.
    try {
      if(service==='netflix') {
        await netflixCollectRow(run);
        return;
      }
      for(let i=0;i<400 && !stopFlag && run===activeRun;i++) {
        const found=scan();const r=await persist(found);totalAdded+=r.added;scans++;
        status(`自動収集中… ${captured.size}件検出 / ${totalAdded}件追加（${i+1}回目）｜「停止」で中断`);
        if(stopFlag)break;
        const moved=scrollStep();
        const bottom=verticalBottomState();
        if(prev===captured.size && moved<10)stable++;else stable=0;
        // Verify the bottom on separate scans: lazy content may still mount.
        if(bottom.measurable && bottom.atBottom && prev===captured.size && moved<10)bottomStable++;
        else bottomStable=0;
        prev=captured.size;
        if(bottomStable>=4){atBottomProof=true;break;}
        // Unresponsive scrollers without a measurable page end are a pause,
        // not a false "reached bottom" completion.
        if(stable>=12 && !bottom.atBottom){safetyLimit=true;break;}
        if(i===399)safetyLimit=true;
        await new Promise(resolve=>setTimeout(resolve,service==='prime'?850:650));
      }
      if(!stopFlag) {
        const found=scan();const r=await persist(found);totalAdded+=r.added;
      }
      status(stopFlag
        ? `停止しました。${captured.size}件検出済み、${totalAdded}件追加。保存データは残っています。`
        : atBottomProof
          ? `ページ最下部と追加読み込みの安定を確認して自動停止：${captured.size}件検出、${totalAdded}件追加。`
          : `収集を一時停止：${captured.size}件検出、${totalAdded}件追加。${safetyLimit?'進行の停滞または安全回数上限に達しました。':'最下部を確認できていません。'} 再度開始できます。`);
    } catch(e) {status('収集中にエラー：'+(e?.message||String(e)));}
    finally {collecting=false;bar?.querySelector('[data-action="auto"]')?.removeAttribute('hidden');
      bar?.querySelector('[data-action="stop"]')?.setAttribute('hidden','');
      if(stopFloating)stopFloating.hidden=true;}
  }
  function stopCollect(){stopFlag=true;activeRun++;status(`停止を受け付けました。保存済みの${captured.size}件は保持します。`);}

  function init() {
    if(!document.body)return;
    if(!currentPage()) {bar?.remove();bar=null;document.getElementById('nz-ent-stop-fixed')?.remove();gridUI?.remove();gridUI=null;return;}
    if(bar)return;
    bar=document.createElement('div');bar.id='nz-ent-capture';bar.setAttribute('lang','ja');
    const heading=document.createElement('b');heading.textContent=names[service]+' → Entertainment Hub';
    const minimize=document.createElement('button');minimize.type='button';minimize.className='nz-min';minimize.textContent='−';minimize.title='最小化';
    const actions=document.createElement('div');actions.className='nz-actions';
    function action(name,label){const b=document.createElement('button');b.type='button';b.dataset.action=name;b.textContent=label;actions.append(b);return b;}
    const one=action('scan','画面の作品を収集');
    const auto=action('auto',service==='netflix'?'マイリストを横送り収集':service==='prime'?'マイリストを自動収集':'自動スクロール収集');
    const stop=action('stop','収集停止');stop.hidden=true;stop.className='nz-stop';
    const lib=action('open','ライブラリを開く');
    const choose=service==='netflix'?action('choose','マイリスト行を指定'):null;
    const grid=service==='youtube'?action('grid','グリッド表示'):null;
    const msg=document.createElement('p');msg.className='nz-msg';msg.textContent=service==='netflix'?'マイリストを右送りし、識別できたカードを保存。タイトル不明は仮登録します。':'表示済みの商品・作品を収集できます。自動収集は途中で停止できます。';
    bar.append(minimize,heading,actions,msg);document.body.append(bar);
    minimize.addEventListener('click',()=>{collapsed=!collapsed;bar.classList.toggle('nz-collapsed',collapsed);minimize.textContent=collapsed?'+':'−'});
    one.addEventListener('click',()=>saveOnePass());auto.addEventListener('click',autoCollect);stop.addEventListener('click',stopCollect);
    lib.addEventListener('click',()=>chrome.runtime.sendMessage({type:'NZ_ENT_OPEN_LIBRARY'}));
    choose?.addEventListener('click',()=>{
      status('画面内の「マイリスト」の見出しか、その行の作品カードを一度クリックしてね。作品は開かず、収集対象行として記憶するよ。');
      const select=e=>{
        if(e.target.closest('#nz-ent-capture,#nz-ent-stop-fixed'))return;
        let target=e.target, row=rowFromHeading(target);
        if(!row){for(let p=target,depth=0;p&&p!==document.body&&depth<12;p=p.parentElement,depth++){
          if(scrollerOf(p) && (p.matches?.(NETFLIX_ROW)||p.matches?.("section"))){row=p;break;}
        }}
        if(!row){status('この位置では作品の行を特定できませんでした。マイリストの作品画像か見出しを押してね。');return;}
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
        selectedNetflixRow=row;detectedNetflixRow=row;netflixResume={direction:1,paused:false};
        document.removeEventListener('click',select,true);
        status(`対象の行を設定したよ（${netflixCardCount(row)}個のカード候補）。「マイリストを横送り収集」を押してね。`);
      };
      document.addEventListener('click',select,true);
    });
    grid?.addEventListener('click',toggleGrid);
    const floating=document.createElement('button');floating.id='nz-ent-stop-fixed';floating.type='button';floating.textContent='収集を停止';floating.hidden=true;
    document.body.append(floating);floating.addEventListener('click',stopCollect);
    if(service==='netflix' && listPage()) {
      // On SPA navigation, allow Netflix card artwork/data-videoid to hydrate first.
      setTimeout(()=>{if(bar&&!collecting&&!hasCollected) {const seen=scan();status(seen.length?`マイリストで${seen.length}件のカードを検出しました。収集できます。`:'マイリストの作品カードを読み込み中。横送り収集も使えます。');}},1600);
    }
  }

  async function toggleGrid() {
    if(gridUI){gridUI.remove();gridUI=null;return;}
    const videos=scan();if(videos.length)await persist(videos);if(!videos.length){status('動画がまだ読み込まれていません。まずリストをスクロールしてね。');return;}
    gridUI=document.createElement('section');gridUI.id='nz-ent-grid';gridUI.setAttribute('lang','ja');
    const controls=document.createElement('div');controls.className='nz-ent-gridbar';
    const heading=document.createElement('b');heading.textContent='YouTube再生リスト・グリッド '+videos.length+'件';
    const search=document.createElement('input');search.type='search';search.placeholder='動画タイトル・タグで検索';search.setAttribute('aria-label','動画タイトル・タグで検索');
    const select=document.createElement('select');select.setAttribute('aria-label','列数');for(let i=2;i<=15;i++){const opt=document.createElement('option');opt.value=String(i);opt.textContent=i+'列';select.append(opt)}
    const savedCfg=await chrome.storage.local.get('nzEntYoutubeCols');select.value=String(savedCfg.nzEntYoutubeCols||5);
    const close=document.createElement('button');close.textContent='閉じる';close.addEventListener('click',toggleGrid);
    controls.append(heading,search,select,close);
    const cards=document.createElement('div');cards.className='nz-ent-gridcards';gridUI.append(controls,cards);
    const target=document.querySelector('#primary #contents')||document.querySelector('ytd-playlist-video-list-renderer')||document.body;
    target.prepend(gridUI);
    const saved=(await chrome.storage.local.get('nzEntertainmentItems')).nzEntertainmentItems||[];
    const tags=new Map(saved.filter(i=>i.service==='youtube').map(i=>[i.href,i.tags||'']));
    function render(){const q=normalized(search.value);cards.style.gridTemplateColumns=`repeat(${select.value},minmax(0,1fr))`;cards.replaceChildren();
      for(const v of videos){if(!normalized([v.title,tags.get(v.href)].join(' ')).includes(q))continue;
        const item=document.createElement('div');item.className='nz-ent-griditem';
        const a=document.createElement('a');a.href=v.href;a.target='_blank';a.rel='noopener noreferrer';
        const im=document.createElement('img');im.loading='lazy';im.src=v.thumbnail;im.alt='';a.append(im);
        a.title=v.title; a.setAttribute('aria-label',v.title);
        const title=document.createElement('p');title.textContent=v.title;title.className='nz-ent-video-title';a.append(title);
        const tooltip=document.createElement('div');tooltip.className='nz-ent-title-tooltip';tooltip.textContent=v.title;tooltip.setAttribute('aria-hidden','true');
        item.append(tooltip);
        const tag=document.createElement('input');tag.type='text';tag.placeholder='タグを入力';tag.setAttribute('aria-label',v.title+' のタグ');tag.value=tags.get(v.href)||'';
        tag.addEventListener('change',async()=>{tags.set(v.href,tag.value);
          const rows=(await chrome.storage.local.get('nzEntertainmentItems')).nzEntertainmentItems||[];
          const old=rows.find(i=>i.service==='youtube'&&i.href===v.href);
          if(old)old.tags=tag.value;else rows.push({...v,tags:tag.value});
          await chrome.storage.local.set({nzEntertainmentItems:rows});});
        item.append(a,tag);cards.append(item);
      }
    }
    let composing=false;search.addEventListener('compositionstart',()=>composing=true);
    search.addEventListener('compositionend',()=>{composing=false;render()});
    search.addEventListener('input',()=>{if(!composing)render()});
    select.addEventListener('change',async()=>{await chrome.storage.local.set({nzEntYoutubeCols:Number(select.value)});render();});
    render();
  }

  init();
  setInterval(()=>{if(location.href!==lastUrl){lastUrl=location.href; selectedNetflixRow=null;detectedNetflixRow=null;netflixResume={direction:1,paused:false};
    if(collecting)stopCollect();
    if(gridUI){gridUI.remove();gridUI=null;}
    init();}
  },1100);
})();
