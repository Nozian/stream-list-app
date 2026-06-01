// ===================================================
// Streaming Watchlist Organizer - viewer.js v2
// 全サービス統合ビュー（ユーザーデータ反映版）
// ===================================================

// ===== ユーティリティ =====
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeUrl(u) {
  const s = String(u == null ? '' : u);
  return /^https?:\/\//i.test(s) ? esc(s) : '#';
}
function highlight(text, query) {
  if (!query) return esc(text);
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return esc(text).replace(new RegExp(`(${safe})`, 'gi'), '<mark class="hl">$1</mark>');
}

// ===== 定数 =====
const GENRE_COLORS = {
  'アクション・冒険':'#e74c3c','コメディ':'#d4870a','ドラマ':'#2980b9',
  'サスペンス・スリラー':'#7d3c98','SF・ファンタジー':'#1a9a7a','ホラー':'#c0392b',
  'アニメ':'#c0177a','ドキュメンタリー':'#1e8449','スポーツ':'#c87800',
  '歴史・時代劇':'#8a7060','ロマンス':'#c0177a','キッズ・ファミリー':'#0097a7','その他':'#6b6658',
};
const TMDB_GENRE_MAP = {
  28:'アクション・冒険',12:'アクション・冒険',10759:'アクション・冒険',
  35:'コメディ',18:'ドラマ',
  53:'サスペンス・スリラー',9648:'サスペンス・スリラー',80:'サスペンス・スリラー',
  878:'SF・ファンタジー',14:'SF・ファンタジー',10765:'SF・ファンタジー',
  27:'ホラー',16:'アニメ',99:'ドキュメンタリー',
  36:'歴史・時代劇',10752:'歴史・時代劇',
  10749:'ロマンス',10751:'キッズ・ファミリー',10762:'キッズ・ファミリー',
};
const SVC = {
  prime:   { label:'P', name:'Prime Video' },
  netflix: { label:'N', name:'Netflix' },
  unext:   { label:'U', name:'U-NEXT' },
};

// ===== ストレージ =====
const sget = keys => new Promise(res => { try { chrome.storage.local.get(keys, r => res(r||{})); } catch(e){ res({}); } });
const sset = obj  => new Promise(res => { try { chrome.storage.local.set(obj, ()=>res()); } catch(e){ res(); } });

// ===== 状態 =====
let state = {
  allItems:    [],
  userData:    {},   // { [href]: { watched, star, memo, genre } }
  filterSvc:   'all',
  filterGenre: null,
  filterWatch: 'all', // all | unwatched | watched
  sortKey:     null,
  viewMode:    'genre',
  searchQuery: '',
  tmdbKey:     null,
  latestAt:    null,
};

// ===== ユーザーデータ操作 =====
function getUD(href) { return state.userData[href] || {}; }
async function setUD(href, patch) {
  state.userData[href] = { ...getUD(href), ...patch };
  await sset({ swo_userdata: state.userData });
  render();
}

// ===== 初期化 =====
async function init() {
  const data = await sget([
    'tmdb_api_key', 'swo_userdata',
    'swo_prime_items','swo_prime_at',
    'swo_netflix_items','swo_netflix_at',
    'swo_unext_items','swo_unext_at',
  ]);

  state.tmdbKey  = data.tmdb_api_key || null;
  state.userData = data.swo_userdata  || {};

  const prime   = (data.swo_prime_items   || []).map(it => ({...it, service:'prime'}));
  const netflix = (data.swo_netflix_items || []).map(it => ({...it, service:'netflix'}));
  const unext   = (data.swo_unext_items   || []).map(it => ({...it, service:'unext'}));
  state.allItems = [...prime, ...netflix, ...unext];

  const ats = [data.swo_prime_at, data.swo_netflix_at, data.swo_unext_at].filter(Boolean);
  state.latestAt = ats.length ? Math.max(...ats) : null;

  if (state.tmdbKey) document.getElementById('settings-key').value = state.tmdbKey;

  updateServiceCounts(prime.length, netflix.length, unext.length);
  updateFooter();
  buildGenreNav();
  render();
  bindEvents();
}

// ===== ユーザーデータをアイテムにマージ =====
function mergeUD(items) {
  return items.map(it => {
    const ud = getUD(it.href);
    return {
      ...it,
      genre:   ud.genre  || it.genre,
      genres:  ud.genre  ? [ud.genre] : it.genres,
      watched: !!ud.watched,
      star:    ud.star   || 0,
      memo:    ud.memo   || '',
    };
  });
}

// ===== サービスカウント =====
function updateServiceCounts(p, n, u) {
  const el = id => document.getElementById(id);
  el('count-all').textContent     = (p+n+u) || '—';
  el('count-prime').textContent   = p || '—';
  el('count-netflix').textContent = n || '—';
  el('count-unext').textContent   = u || '—';
}

// ===== フッター =====
function updateFooter() {
  const el = document.getElementById('footer-updated');
  if (!state.latestAt) { el.textContent = '未取得'; return; }
  const d = new Date(state.latestAt);
  const pad = n => String(n).padStart(2,'0');
  el.textContent = `最終更新\n${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== ジャンルナビ =====
function buildGenreNav() {
  const genreMap = {};
  for (const it of state.allItems) (genreMap[it.genre]=genreMap[it.genre]||[]).push(it);
  const genres = Object.keys(genreMap).sort();
  const container = document.getElementById('genre-nav');
  container.innerHTML = genres.map(g => {
    const color = GENRE_COLORS[g] || '#6b6658';
    return `<button class="nav-item ${state.filterGenre===g?'active':''}" data-genre="${esc(g)}">
      <span class="nav-genre-dot" style="background:${color}"></span>
      <span class="nav-text">${esc(g)}</span>
      <span class="nav-count">${genreMap[g].length}</span>
    </button>`;
  }).join('');
  container.querySelectorAll('[data-genre]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filterGenre = state.filterGenre===btn.dataset.genre ? null : btn.dataset.genre;
      state.filterSvc = 'all';
      syncNavActive();
      render();
    });
  });
}

function syncNavActive() {
  document.querySelectorAll('[data-svc]').forEach(b =>
    b.classList.toggle('active', b.dataset.svc===state.filterSvc && !state.filterGenre));
  document.querySelectorAll('[data-genre]').forEach(b =>
    b.classList.toggle('active', b.dataset.genre===state.filterGenre));
  document.querySelectorAll('[data-watch]').forEach(b =>
    b.classList.toggle('active', b.dataset.watch===state.filterWatch));
}

// ===== フィルター =====
function getFilteredItems() {
  let items = mergeUD(state.allItems);

  if (state.filterSvc!=='all' && !state.filterGenre)
    items = items.filter(it=>it.service===state.filterSvc);
  if (state.filterGenre)
    items = items.filter(it=>it.genre===state.filterGenre);
  if (state.filterWatch==='unwatched') items = items.filter(it=>!it.watched);
  if (state.filterWatch==='watched')   items = items.filter(it=>it.watched);

  const q = state.searchQuery.trim().toLowerCase();
  if (q) items = items.filter(it=>(it.title||'').toLowerCase().includes(q));

  if (state.sortKey==='title')    items = [...items].sort((a,b)=>(a.title||'').localeCompare(b.title||'','ja'));
  if (state.sortKey==='star')     items = [...items].sort((a,b)=>b.star-a.star);
  if (state.sortKey==='service') {
    const order={prime:0,netflix:1,unext:2};
    items = [...items].sort((a,b)=>(order[a.service]||0)-(order[b.service]||0));
  }
  return items;
}

// ===== TMDbバナー =====
function renderTMDbBanner(items) {
  const banner = document.getElementById('tmdb-banner');
  const otherCount = items.filter(it=>it.genre==='その他').length;
  banner.style.display = (!state.tmdbKey && otherCount>0) ? 'flex' : 'none';
}

// ===== スター描画（共通） =====
function renderStars(href, star) {
  return `<span class="v-stars">${[1,2,3].map(v =>
    `<button class="v-star-btn ${star>=v?'v-star-on':''}" data-href="${safeUrl(href)}" data-val="${v}" data-tip="★${v}評価">★</button>`
  ).join('')}</span>`;
}

// ===== メイン描画 =====
function render() {
  const items = getFilteredItems();
  const q = state.searchQuery.trim();

  // 統計カウント更新（視聴済み数）
  const all = mergeUD(state.allItems);
  const watchedCount   = all.filter(it=>it.watched).length;
  const unwatchedCount = all.length - watchedCount;
  const wEl = document.getElementById('count-watched');
  const uEl = document.getElementById('count-unwatched');
  if (wEl) wEl.textContent = watchedCount   || '—';
  if (uEl) uEl.textContent = unwatchedCount || '—';

  const label = document.getElementById('result-label');
  if (q) {
    label.innerHTML = `<span>${items.length}</span><span style="font-family:var(--sans);font-size:13px;color:var(--text-mid);font-weight:400"> 件 — 「${esc(q)}」</span>`;
  } else {
    label.textContent = `${items.length} titles`;
  }

  renderTMDbBanner(items);

  const container = document.getElementById('main-content');

  if (state.allItems.length===0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-rule"></div>
        <h2 class="empty-title">No data yet.</h2>
        <p class="empty-body">各サービスのウォッチリストページを開き、「整理モード」を実行してください。</p>
        <div class="empty-links">
          <a href="https://www.amazon.co.jp/gp/video/mystuff/watchlist/" target="_blank" rel="noopener noreferrer" class="empty-link prime">Prime Video</a>
          <a href="https://www.netflix.com/browse/my-list" target="_blank" rel="noopener noreferrer" class="empty-link netflix">Netflix</a>
          <a href="https://video.unext.jp/mylist/favorite/video" target="_blank" rel="noopener noreferrer" class="empty-link unext">U-NEXT</a>
        </div>
        <div class="empty-rule"></div>
      </div>`;
    return;
  }
  if (items.length===0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-rule"></div>
        <h2 class="empty-title">No results.</h2>
        <p class="empty-body">${q?`「${esc(q)}」に一致するタイトルが見つかりませんでした。`:'条件に一致する作品がありません。'}</p>
        <div class="empty-rule"></div>
      </div>`;
    return;
  }

  container.innerHTML = state.viewMode==='list' ? renderListAll(items) : renderGenreView(items);
  bindCollapseEvents();
  updateCollapseToggle();
  bindUserDataEvents();
}

// ===== ジャンル別グリッド =====
function renderGenreView(items) {
  const genreMap = {};
  for (const it of items) (genreMap[it.genre]=genreMap[it.genre]||[]).push(it);
  return Object.keys(genreMap).sort().map(genre => {
    const color = GENRE_COLORS[genre]||'#6b6658';
    return `
      <div class="genre-section" data-genre-section="${esc(genre)}">
        <button class="genre-heading">
          <span class="genre-chevron">▾</span>
          <span class="genre-name">${esc(genre)}</span>
          <span class="genre-num">${genreMap[genre].length}</span>
        </button>
        <div class="genre-grid">${genreMap[genre].map(it=>renderCard(it,color)).join('')}</div>
      </div>`;
  }).join('');
}

// ===== リストビュー =====
function renderListAll(items) {
  if (state.filterGenre || state.sortKey==='service') {
    return `<div class="genre-section"><div class="genre-list">${items.map((it,i)=>renderListRow(it,i)).join('')}</div></div>`;
  }
  const genreMap = {};
  for (const it of items) (genreMap[it.genre]=genreMap[it.genre]||[]).push(it);
  return Object.keys(genreMap).sort().map(genre => {
    const gItems = genreMap[genre];
    return `
      <div class="genre-section" data-genre-section="${esc(genre)}">
        <button class="genre-heading">
          <span class="genre-chevron">▾</span>
          <span class="genre-name">${esc(genre)}</span>
          <span class="genre-num">${gItems.length}</span>
        </button>
        <div class="genre-list">${gItems.map((it,i)=>renderListRow(it,i)).join('')}</div>
      </div>`;
  }).join('');
}

// ===== カード =====
function renderCard(it, color) {
  const q   = state.searchQuery.trim();
  const svc = SVC[it.service] || {};
  const gl  = (it.genres && it.genres.length>1)
    ? `<div class="card-genres">${it.genres.map(g=>`<span class="mini-tag" style="background:${(GENRE_COLORS[g]||'#6b6658')}1a;color:${GENRE_COLORS[g]||'#6b6658'}">${esc(g)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="item-card ${it.watched?'v-watched':''}">
      <a class="card-link" href="${safeUrl(it.href)}" target="_blank" rel="noopener noreferrer">
        <div class="card-thumb">
          ${it.thumbnail?`<img src="${safeUrl(it.thumbnail)}" alt="${esc(it.title)}" loading="lazy">`:`<div class="card-noimg" style="background:${color}18">?</div>`}
          <span class="card-svc ${esc(it.service)}">${esc(svc.label)||'?'}</span>
          ${it.watched?`<span class="v-card-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>`:''}
        </div>
        <div class="card-title">${highlight(it.title||'(不明)',q)}</div>
      </a>
      ${gl}
      <div class="v-card-meta">
        ${renderStars(it.href, it.star)}
        <span class="v-card-btns">
          <button class="v-watch-btn ${it.watched?'v-watch-on':''}" data-href="${safeUrl(it.href)}" data-tip="${it.watched?'✓ 視聴済み — クリックで解除':'未視聴 — クリックでチェック'}">✓</button>
          <button class="v-memo-btn ${it.memo?'v-memo-has':''}" data-href="${safeUrl(it.href)}" data-tip="メモを追加・編集">✎</button>
        </span>
      </div>
      ${it.memo?`<div class="v-card-memo">${esc(it.memo.slice(0,28))}${it.memo.length>28?'…':''}</div>`:''}
      <div class="card-ext">${extLinks(it)}</div>
    </div>`;
}

// ===== リスト行 =====
function renderListRow(it, i) {
  const q   = state.searchQuery.trim();
  const gl  = (it.genres && it.genres.length>0) ? it.genres : [it.genre];
  const tags = gl.map(g=>{
    const c=GENRE_COLORS[g]||'#6b6658';
    return `<span class="list-tag" style="background:${c}1a;color:${c};border-color:${c}40">${esc(g)}</span>`;
  }).join('');
  const svc = SVC[it.service]||{};
  return `
    <div class="list-row ${it.watched?'v-watched':''}">
      <span class="list-num">${i+1}</span>
      <div class="list-thumb">
        ${it.thumbnail?`<img src="${safeUrl(it.thumbnail)}" alt="" loading="lazy">`:''}
        <span class="list-svc ${esc(it.service)}">${esc(svc.label)||'?'}</span>
      </div>
      <div class="list-info">
        <a class="list-title" href="${safeUrl(it.href)}" target="_blank" rel="noopener noreferrer">${highlight(it.title||'(不明)',q)}</a>
        <div class="list-tags">${tags}</div>
        ${it.memo?`<div class="v-list-memo">${esc(it.memo)}</div>`:''}
      </div>
      <div class="v-list-actions">
        ${renderStars(it.href, it.star)}
        <button class="v-watch-btn ${it.watched?'v-watch-on':''}" data-href="${safeUrl(it.href)}" data-tip="${it.watched?'✓ 視聴済み — クリックで解除':'未視聴 — クリックでチェック'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${it.watched?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="v-memo-btn ${it.memo?'v-memo-has':''}" data-href="${safeUrl(it.href)}" data-tip="メモを追加・編集">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${it.memo?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="list-ext">${extLinks(it)}</div>
    </div>`;
}

// ===== 外部リンク =====
function extLinks(it) {
  const q = encodeURIComponent((it.title||'').replace(/[（(].*?[)）]/g,'').replace(/\s*(シーズン|Season)\s*\d+.*/i,'').trim());
  const id = encodeURIComponent(it.serviceId||'');
  let play = '';
  if (it.service==='netflix'&&it.serviceId) play=`<a class="ext play netflix" href="https://www.netflix.com/watch/${id}" target="_blank" rel="noopener noreferrer">▶</a>`;
  else if (it.service==='unext'&&it.serviceId) play=`<a class="ext play unext" href="https://video.unext.jp/title/${id}" target="_blank" rel="noopener noreferrer">▶</a>`;
  return `${play}
    <a class="ext" href="https://eiga.com/search/${q}/" target="_blank" rel="noopener noreferrer">映画</a>
    <a class="ext" href="https://www.justwatch.com/jp/検索?q=${q}" target="_blank" rel="noopener noreferrer">JW</a>
    <a class="ext" href="https://www.themoviedb.org/search?query=${q}" target="_blank" rel="noopener noreferrer">TMDb</a>`;
}

// ===== ユーザーデータのイベント =====
function bindUserDataEvents() {
  // 視聴済みトグル
  document.querySelectorAll('.v-watch-btn').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.preventDefault(); e.stopPropagation();
      const ud = getUD(btn.dataset.href);
      await setUD(btn.dataset.href, { watched: !ud.watched });
    });
  });
  // スター
  document.querySelectorAll('.v-star-btn').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.preventDefault(); e.stopPropagation();
      const ud  = getUD(btn.dataset.href);
      const val = parseInt(btn.dataset.val);
      await setUD(btn.dataset.href, { star: ud.star===val?0:val });
    });
  });
  // メモ
  document.querySelectorAll('.v-memo-btn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.preventDefault(); e.stopPropagation();
      showMemoPopup(btn.dataset.href);
    });
  });
}

// ===== メモポップアップ =====
function showMemoPopup(href) {
  const existing = document.getElementById('v-memo-popup');
  if (existing) existing.remove();
  const ud  = getUD(href);
  const pop = document.createElement('div');
  pop.id = 'v-memo-popup';
  pop.className = 'v-overlay';
  pop.innerHTML = `
    <div class="v-popup-card">
      <div class="v-popup-head"><span>メモ</span><button id="v-memo-close">✕</button></div>
      <textarea id="v-memo-text" placeholder="メモを入力…" rows="5">${esc(ud.memo||'')}</textarea>
      <div class="v-popup-actions">
        <button class="ghost-btn" id="v-memo-clear">削除</button>
        <button class="ghost-btn v-popup-save" id="v-memo-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(pop);
  pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
  pop.querySelector('#v-memo-close').addEventListener('click', ()=>pop.remove());
  pop.querySelector('#v-memo-save').addEventListener('click', async()=>{
    const memo = pop.querySelector('#v-memo-text').value.trim();
    await setUD(href, { memo });
    pop.remove();
  });
  pop.querySelector('#v-memo-clear').addEventListener('click', async()=>{
    await setUD(href, { memo:'' });
    pop.remove();
  });
  setTimeout(()=>pop.querySelector('#v-memo-text').focus(), 50);
}

// ===== 折りたたみ =====
function bindCollapseEvents() {
  document.querySelectorAll('.genre-heading').forEach(h=>{
    h.addEventListener('click', ()=>{ h.closest('.genre-section').classList.toggle('collapsed'); updateCollapseToggle(); });
  });
}
function updateCollapseToggle() {
  const wrap = document.getElementById('collapse-toggle-wrap');
  if (!wrap) return;
  const sections = document.querySelectorAll('.genre-section');
  if (sections.length<=1||state.filterGenre) { wrap.innerHTML=''; return; }
  const anyOpen = [...sections].some(s=>!s.classList.contains('collapsed'));
  wrap.innerHTML = `<button class="sort-btn" id="collapse-all-btn" style="border-bottom-color:var(--text-mid);color:var(--text-mid)">${anyOpen?'すべて閉じる':'すべて開く'}</button>`;
  document.getElementById('collapse-all-btn').addEventListener('click', ()=>{
    sections.forEach(s=>anyOpen?s.classList.add('collapsed'):s.classList.remove('collapsed'));
    updateCollapseToggle();
  });
}

// ===== CSV =====
function exportCSV() {
  const items = getFilteredItems();
  const header = ['タイトル','ジャンル','サービス','視聴済み','★評価','メモ','URL'];
  const rows = items.map(it=>{
    const g = (it.genres&&it.genres.length>0)?it.genres.join(' / '):it.genre;
    return [
      `"${(it.title||'').replace(/"/g,'""')}"`, `"${g}"`,
      `"${(SVC[it.service]||{}).name||it.service}"`,
      `"${it.watched?'済み':'未視聴'}"`, `"${'★'.repeat(it.star||0)}"`,
      `"${(it.memo||'').replace(/"/g,'""')}"`, `"${it.href||''}"`
    ].join(',');
  });
  const csv = '\uFEFF'+[header.join(','),...rows].join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`watchlist_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ===== TMDb再判定 =====
async function enrichAll(key) {
  for (const svcKey of ['prime','netflix','unext']) {
    const storeKey=`swo_${svcKey}_items`, cacheKey=`swo_${svcKey}_cache`;
    const s = await sget([storeKey,cacheKey]);
    const items=s[storeKey]||[], cache=s[cacheKey]||{};
    const targets=items.filter(it=>it.genre==='その他');
    for (const item of targets) {
      const q=(item.title||'').replace(/[（(].*?[)）]/g,'').replace(/\s*(シーズン|Season)\s*\d+.*/i,'').trim();
      if (!q) continue;
      let genres=cache[q];
      if (!genres) {
        try {
          const res=await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${key}&language=ja-JP&query=${encodeURIComponent(q)}`);
          const data=await res.json();
          const first=(data.results||[]).find(r=>r.media_type==='movie'||r.media_type==='tv');
          genres=first?[...new Set((first.genre_ids||[]).map(id=>TMDB_GENRE_MAP[id]).filter(Boolean))]:[];
        } catch(e){genres=[];}
        cache[q]=genres;
        await new Promise(r=>setTimeout(r,60));
      }
      if (genres.length>0){item.genres=genres;item.genre=genres[0];}
    }
    await sset({[storeKey]:items,[cacheKey]:cache});
  }
}

// ===== イベントバインド =====
function bindEvents() {
  // 検索
  const searchInput=document.getElementById('search-input');
  const searchClear=document.getElementById('search-clear');
  let searchTimer;
  searchInput.addEventListener('input',()=>{
    state.searchQuery=searchInput.value;
    searchClear.style.display=state.searchQuery?'block':'none';
    clearTimeout(searchTimer); searchTimer=setTimeout(render,120);
  });
  searchClear.addEventListener('click',()=>{
    searchInput.value=''; state.searchQuery=''; searchClear.style.display='none';
    searchInput.focus(); render();
  });
  document.addEventListener('keydown',e=>{
    if (e.key==='Escape'&&state.searchQuery){searchInput.value='';state.searchQuery='';searchClear.style.display='none';render();}
    if ((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();searchInput.focus();searchInput.select();}
  });

  // 視聴状態フィルター
  document.querySelectorAll('[data-watch]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.filterWatch=btn.dataset.watch;
      syncNavActive(); render();
    });
  });

  // サービスフィルター
  document.querySelectorAll('[data-svc]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.filterSvc=btn.dataset.svc; state.filterGenre=null;
      syncNavActive(); render();
    });
  });

  // ビュー切替
  document.querySelectorAll('.view-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); state.viewMode=btn.dataset.view; render();
    });
  });

  // ソート
  document.querySelectorAll('.sort-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if (btn.dataset.sort===undefined) return;
      document.querySelectorAll('.sort-btn[data-sort]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); state.sortKey=btn.dataset.sort||null; render();
    });
  });

  // CSV・テーマ
  document.getElementById('btn-export').addEventListener('click',exportCSV);
  document.getElementById('btn-theme').addEventListener('click',()=>{
    const isLight=document.body.classList.toggle('light');
    document.getElementById('btn-theme').textContent=isLight?'🌙':'☀️';
  });

  // 設定
  document.getElementById('btn-settings').addEventListener('click',()=>document.getElementById('settings-overlay').style.display='flex');
  document.getElementById('settings-close').addEventListener('click',()=>document.getElementById('settings-overlay').style.display='none');
  document.getElementById('settings-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
  document.getElementById('settings-save').addEventListener('click',async()=>{
    const key=(document.getElementById('settings-key').value||'').trim();
    state.tmdbKey=key||null; await sset({tmdb_api_key:key});
    document.getElementById('settings-overlay').style.display='none';
  });
  document.getElementById('settings-clear-cache').addEventListener('click',async()=>{
    await sset({swo_prime_cache:{},swo_netflix_cache:{},swo_unext_cache:{}}); alert('キャッシュを削除しました。');
  });
  document.getElementById('settings-clear-all').addEventListener('click',async()=>{
    if(!confirm('全サービスのデータを削除しますか？')) return;
    await sset({swo_prime_items:[],swo_netflix_items:[],swo_unext_items:[],swo_prime_cache:{},swo_netflix_cache:{},swo_unext_cache:{}});
    document.getElementById('settings-overlay').style.display='none'; await init();
  });

  // TMDbインライン
  document.getElementById('inline-apply').addEventListener('click',async()=>{
    const key=(document.getElementById('inline-key').value||'').trim();
    if(!key){alert('APIキーを入力してください');return;}
    state.tmdbKey=key; await sset({tmdb_api_key:key});
    const btn=document.getElementById('inline-apply');
    btn.disabled=true; btn.textContent='判定中…';
    await enrichAll(key); btn.disabled=false; btn.textContent='適用';
    await init();
  });
}

document.addEventListener('DOMContentLoaded',init);
