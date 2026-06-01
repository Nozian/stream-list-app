// ===================================================
// Streaming Watchlist Organizer - content.js v3
// Prime Video / Netflix / U-NEXT 統合版
// 機能：視聴済み・スター・メモ・重複検出・ジャンル修正・ランダム提案
// ===================================================
(function () {
  'use strict';

  if (window.__SWO_LOADED__) return;
  window.__SWO_LOADED__ = true;

  const A = window.__SWO_ADAPTER__;
  if (!A) { console.error('[SWO] adapter not found'); return; }

  document.documentElement.style.setProperty('--swo-accent', A.accentColor);
  document.documentElement.style.setProperty('--swo-bg', A.bgColor);
  document.documentElement.style.setProperty('--swo-accent-dim', A.accentColor + '22');

  const STORAGE = A.storagePrefix;

  const GENRE_KEYWORDS = {
    'アクション・冒険':['アクション','冒険','バトル','戦争','特殊部隊','スパイ','格闘','action','battle','war','fight','combat','mission'],
    'コメディ':['コメディ','お笑い','comedy','funny','humor'],
    'ドラマ':['ドラマ','家族','人間関係','感動','drama','family','emotional'],
    'サスペンス・スリラー':['サスペンス','スリラー','ミステリー','謎','犯罪','推理','探偵','thriller','mystery','crime','detective','suspense'],
    'SF・ファンタジー':['SF','ファンタジー','宇宙','未来','ロボット','魔法','異世界','sci-fi','fantasy','space','future','robot','magic'],
    'ホラー':['ホラー','恐怖','ゾンビ','幽霊','horror','zombie','ghost','monster'],
    'アニメ':['アニメ','anime'],
    'ドキュメンタリー':['ドキュメンタリー','実話','記録','documentary'],
    'スポーツ':['スポーツ','野球','サッカー','バスケ','sport','baseball','soccer'],
    '歴史・時代劇':['時代劇','歴史','侍','江戸','戦国','historical','samurai'],
    'ロマンス':['恋愛','ラブ','ロマンス','romance','love'],
    'キッズ・ファミリー':['キッズ','こども','ファミリー','kids','children','family'],
  };

  const GENRE_COLORS = {
    'アクション・冒険':'#e74c3c','コメディ':'#d4870a','ドラマ':'#2980b9',
    'サスペンス・スリラー':'#7d3c98','SF・ファンタジー':'#1a9a7a','ホラー':'#c0392b',
    'アニメ':'#c0177a','ドキュメンタリー':'#1e8449','スポーツ':'#c87800',
    '歴史・時代劇':'#8a7060','ロマンス':'#c0177a','キッズ・ファミリー':'#0097a7','その他':'#6b6658',
  };

  const TMDB_GENRE_MAP = {
    28:'アクション・冒険',12:'アクション・冒険',10759:'アクション・冒険',
    35:'コメディ',18:'ドラマ',53:'サスペンス・スリラー',9648:'サスペンス・スリラー',80:'サスペンス・スリラー',
    878:'SF・ファンタジー',14:'SF・ファンタジー',10765:'SF・ファンタジー',
    27:'ホラー',16:'アニメ',99:'ドキュメンタリー',36:'歴史・時代劇',10752:'歴史・時代劇',
    10749:'ロマンス',10751:'キッズ・ファミリー',10762:'キッズ・ファミリー',
  };

  let TMDB_API_KEY = null;
  let organizedPanel = null;
  let currentItems = [];
  let isLightMode = false;
  let panelSearch = '';
  // ユーザーデータ（視聴済み・スター・メモ・手動ジャンル）
  let userData = {}; // { [href]: { watched, star, memo, genre } }

  // ===================== ストレージ =====================
  const sget = keys => new Promise(res => { try { chrome.storage.local.get(keys, r => res(r||{})); } catch(e){ res({}); } });
  const sset = obj  => new Promise(res => { try { chrome.storage.local.set(obj, ()=>res()); } catch(e){ res(); } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function loadUserData() {
    const s = await sget(['swo_userdata']);
    userData = s.swo_userdata || {};
  }
  async function saveUserData() {
    await sset({ swo_userdata: userData });
  }
  function getUD(href) { return userData[href] || {}; }
  async function setUD(href, patch) {
    userData[href] = { ...getUD(href), ...patch };
    await saveUserData();
  }

  // ===================== HTMLエスケープ =====================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function safeUrl(u) {
    const s = String(u == null ? '' : u);
    return /^https?:\/\//i.test(s) ? esc(s) : '#';
  }
  function phlHighlight(text) {
    const q = panelSearch.trim();
    if (!q) return esc(text);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(text).replace(new RegExp(`(${safe})`, 'gi'), '<mark class="sp-hl">$1</mark>');
  }

  // ===================== ボタン注入 =====================
  function injectButton() {
    if (document.getElementById('swo-toggle-btn')) return;
    if (!document.body) return;
    const btn = document.createElement('button');
    btn.id = 'swo-toggle-btn';
    btn.textContent = '整理モード';
    btn.addEventListener('click', onMainButtonClick);
    document.body.appendChild(btn);
  }

  // ===================== アイテム収集 =====================
  function getRawItems() { return A.getRawItems(); }

  function extractAndClassify(raw) {
    const d = A.extractItemData(raw);
    return { ...d, genre: estimateGenre(d), collectedAt: Date.now() };
  }

  function estimateGenre(item) {
    const text = (item.title + ' ' + item.fullText).toLowerCase();
    if (GENRE_KEYWORDS['アニメ'].some(kw => text.includes(kw.toLowerCase()))) return 'アニメ';
    for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
      if (genre === 'アニメ') continue;
      if (keywords.some(kw => text.includes(kw.toLowerCase()))) return genre;
    }
    return 'その他';
  }

  async function autoScrollAndCollect(onProgress) {
    const collected = new Map();
    const harvest = () => {
      for (const r of getRawItems()) {
        if (!collected.has(r.href)) collected.set(r.href, extractAndClassify(r));
      }
    };
    window.scrollTo(0, 0);
    await sleep(500); harvest();
    let lastH = 0, stable = 0;
    const step = Math.max(400, Math.floor(window.innerHeight * 0.7));
    for (let i = 0; i < 300; i++) {
      window.scrollBy(0, step);
      await sleep(400); harvest();
      if (onProgress) onProgress(collected.size);
      const cur = window.scrollY;
      const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 100);
      if (cur === lastH || atBottom) {
        stable++;
        if (stable >= 5) break;
        await sleep(600); harvest();
      } else stable = 0;
      lastH = cur;
    }
    window.scrollTo(0, 0);
    return Array.from(collected.values());
  }

  // ===================== TMDb =====================
  function cleanTitle(t) {
    return (t||'').replace(/[（(].*?[)）]/g,'').replace(/\s*(シーズン|Season)\s*\d+.*/i,'').replace(/\s+/g,' ').trim();
  }
  async function fetchGenresFromTMDb(title) {
    const q = cleanTitle(title);
    if (!q || !TMDB_API_KEY) return [];
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=ja-JP&query=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const data = await res.json();
      const first = (data.results||[]).find(r=>r.media_type==='movie'||r.media_type==='tv');
      if (!first||!first.genre_ids) return [];
      return [...new Set(first.genre_ids.map(id=>TMDB_GENRE_MAP[id]).filter(Boolean))];
    } catch(e) { return []; }
  }
  async function enrichWithTMDb(items, onProgress) {
    const store = await sget([`${STORAGE}_cache`]);
    const cache = store[`${STORAGE}_cache`] || {};
    const targets = items.filter(it=>it.genre==='その他');
    let done = 0;
    for (const item of targets) {
      const key = cleanTitle(item.title);
      let genres = cache[key];
      if (!genres) { genres = await fetchGenresFromTMDb(item.title); cache[key] = genres; await sleep(60); }
      if (genres&&genres.length>0) { item.genres = genres; item.genre = genres[0]; }
      done++;
      if (onProgress) onProgress(done, targets.length);
    }
    await sset({ [`${STORAGE}_cache`]: cache });
    return items;
  }

  // ===================== 保存 =====================
  async function saveItems(items) {
    const slim = items.map(({fullText,...rest})=>rest);
    await sset({ [`${STORAGE}_items`]: slim, [`${STORAGE}_at`]: Date.now() });
  }

  // ===================== メインボタン =====================
  async function onMainButtonClick() {
    const s = await sget(['tmdb_api_key',`${STORAGE}_onboarded`,`${STORAGE}_items`,`${STORAGE}_at`]);
    TMDB_API_KEY = s.tmdb_api_key || null;
    await loadUserData();
    if (!s[`${STORAGE}_onboarded`]) { showOnboarding(); return; }
    if (s[`${STORAGE}_items`]&&s[`${STORAGE}_items`].length>0) {
      currentItems = s[`${STORAGE}_items`];
      renderPanel(currentItems); return;
    }
    startOrganizing();
  }

  // ===================== オンボーディング =====================
  function showOnboarding() {
    closeAll();
    const ov = document.createElement('div');
    ov.id = 'swo-onboarding';
    ov.innerHTML = `
      <div class="swo-onb-card">
        <div class="swo-onb-hero">
          <span class="swo-onb-badge">${esc(A.shortName)}</span>
          <h1>${esc(A.name)}<br>Watchlist Organizer</h1>
          <p class="swo-onb-sub">ウォッチリストをジャンル別に整理。視聴済み管理・メモ・ランダム提案なども。</p>
        </div>
        <div class="swo-onb-body">
          <div class="swo-onb-section">
            <div class="swo-onb-num">1</div>
            <div class="swo-onb-text"><h3>そのまま使える</h3><p>APIキーなしでもタイトルからジャンルを推定します。</p></div>
          </div>
          <div class="swo-onb-section">
            <div class="swo-onb-num">2</div>
            <div class="swo-onb-text">
              <h3>TMDb連携でジャンル精度アップ（任意・無料）</h3>
              <details class="swo-onb-howto">
                <summary>▸ APIキーの取り方</summary>
                <ol><li><a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener noreferrer">themoviedb.org</a> で無料登録</li><li>設定 → API → Create → Developer</li><li>「API Key (v3 auth)」をコピー</li></ol>
              </details>
              <div class="swo-onb-keyrow"><input type="text" id="swo-onb-key" placeholder="TMDb APIキーを貼り付け（空欄でもOK）"></div>
            </div>
          </div>
        </div>
        <div class="swo-onb-actions"><button id="swo-onb-start" class="swo-onb-primary">始める →</button></div>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById('swo-onb-start').addEventListener('click', async () => {
      const key = (document.getElementById('swo-onb-key').value||'').trim();
      if (key) { TMDB_API_KEY = key; await sset({tmdb_api_key:key}); }
      await sset({[`${STORAGE}_onboarded`]:true});
      ov.remove(); startOrganizing();
    });
  }

  // ===================== 整理実行 =====================
  async function startOrganizing() {
    const btn = document.getElementById('swo-toggle-btn');
    const doScroll = confirm(`全アイテムを読み込みますか？\nOK = 自動スクロールで全件取得\nキャンセル = 今表示されてる分だけ`);
    let items;
    if (doScroll) {
      btn.textContent='読み込み中...'; btn.disabled=true;
      items = await autoScrollAndCollect(c=>btn.textContent=`${c}件 収集中...`);
    } else {
      items = getRawItems().map(r=>extractAndClassify(r));
    }
    if (!items||items.length===0) {
      alert('アイテムを検出できませんでした。'); btn.textContent='整理モード'; btn.disabled=false; return;
    }
    if (TMDB_API_KEY&&items.some(it=>it.genre==='その他')) {
      btn.disabled=true;
      items = await enrichWithTMDb(items,(d,t)=>btn.textContent=`ジャンル判定 ${d}/${t}`);
    }
    currentItems=items;
    await saveItems(items);
    btn.disabled=false; btn.textContent='整理モード';
    renderPanel(items);
  }

  // ===================== ユーザーデータを items にマージ =====================
  function mergeUserData(items) {
    return items.map(it => {
      const ud = getUD(it.href);
      return {
        ...it,
        genre: ud.genre || it.genre,    // 手動ジャンル優先
        genres: ud.genre ? [ud.genre] : it.genres,
        watched: !!ud.watched,
        star: ud.star || 0,
        memo: ud.memo || '',
        hasUserGenre: !!ud.genre,
      };
    });
  }

  // ===================== フィルタ適用 =====================
  function applyFilters(items, filterGenre, sortKey, filterWatched) {
    let list = [...items];
    if (filterWatched === 'unwatched') list = list.filter(it=>!it.watched);
    if (filterWatched === 'watched')   list = list.filter(it=>it.watched);
    if (filterGenre) list = list.filter(it=>it.genre===filterGenre);
    const q = panelSearch.trim().toLowerCase();
    if (q) list = list.filter(it=>(it.title||'').toLowerCase().includes(q));
    if (sortKey==='title')     list = list.sort((a,b)=>(a.title||'').localeCompare(b.title||'','ja'));
    if (sortKey==='star')      list = list.sort((a,b)=>b.star-a.star);
    if (sortKey==='collected') list = list.sort((a,b)=>(b.collectedAt||0)-(a.collectedAt||0));
    return list;
  }

  // ===================== パネル描画 =====================
  function renderPanel(rawItems, filterGenre, sortKey, viewMode, filterWatched) {
    filterGenre   = filterGenre   || null;
    sortKey       = sortKey       || null;
    viewMode      = viewMode      || 'genre';
    filterWatched = filterWatched || 'all';

    if (organizedPanel) organizedPanel.remove();
    organizedPanel = document.createElement('div');
    organizedPanel.id = 'swo-panel';
    if (isLightMode) organizedPanel.classList.add('sp-light');

    const items = mergeUserData(rawItems);
    const genreMap = {};
    for (const it of items) (genreMap[it.genre]=genreMap[it.genre]||[]).push(it);
    const genres = Object.keys(genreMap).sort();
    const otherCount = (genreMap['その他']||[]).length;
    const displayItems = applyFilters(items, filterGenre, sortKey, filterWatched);
    const q = panelSearch.trim();

    // 重複検出（同タイトルが複数hrefに存在）
    const titleMap = {};
    for (const it of items) {
      const key = cleanTitle(it.title).toLowerCase();
      if (key) (titleMap[key]=titleMap[key]||[]).push(it.href);
    }
    const dupHrefs = new Set();
    for (const hrefs of Object.values(titleMap)) {
      if (hrefs.length > 1) hrefs.forEach(h=>dupHrefs.add(h));
    }
    const dupCount = dupHrefs.size;

    organizedPanel.innerHTML = `
      <div class="sp-layout">
        <aside class="sp-sidebar">
          <div class="sp-brand">
            <span class="sp-badge">${esc(A.shortName)}</span>
            <span class="sp-name">${esc(A.name)}</span>
          </div>

          <div class="sp-search-wrap">
            <svg class="sp-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="sp-search" class="sp-search" placeholder="タイトルを検索…" value="${esc(panelSearch)}" autocomplete="off" spellcheck="false">
            <button class="sp-search-clear" id="sp-clear" style="display:${panelSearch?'block':'none'}">✕</button>
          </div>

          <nav class="sp-nav">
            <div class="sp-nav-label">Filter</div>
            <button class="sp-nav-item ${filterWatched==='all'?'active':''}" data-watched="all">
              <span class="sp-nav-text">すべて</span>
              <span class="sp-nav-count">${items.length}</span>
            </button>
            <button class="sp-nav-item ${filterWatched==='unwatched'?'active':''}" data-watched="unwatched">
              <span class="sp-nav-dot" style="background:#4ade80"></span>
              <span class="sp-nav-text">未視聴</span>
              <span class="sp-nav-count">${items.filter(it=>!it.watched).length}</span>
            </button>
            <button class="sp-nav-item ${filterWatched==='watched'?'active':''}" data-watched="watched">
              <span class="sp-nav-dot" style="background:#6b6658"></span>
              <span class="sp-nav-text">視聴済み</span>
              <span class="sp-nav-count">${items.filter(it=>it.watched).length}</span>
            </button>
            ${dupCount>0?`<button class="sp-nav-item ${filterWatched==='dup'?'active':''}" data-watched="dup">
              <span class="sp-nav-dot" style="background:#f39c12"></span>
              <span class="sp-nav-text">重複あり</span>
              <span class="sp-nav-count">${dupCount}</span>
            </button>`:''}

            <div class="sp-nav-label" style="margin-top:10px">Genre</div>
            <button class="sp-nav-item ${!filterGenre?'active':''}" data-genre="all">
              <span class="sp-nav-text">すべて</span>
              <span class="sp-nav-count">${items.length}</span>
            </button>
            ${genres.map(g=>{
              const color=GENRE_COLORS[g]||'#6b6658';
              return `<button class="sp-nav-item ${filterGenre===g?'active':''}" data-genre="${esc(g)}">
                <span class="sp-nav-dot" style="background:${color}"></span>
                <span class="sp-nav-text">${esc(g)}</span>
                <span class="sp-nav-count">${genreMap[g].length}</span>
              </button>`;
            }).join('')}
          </nav>

          <div class="sp-sidebar-footer">
            <span class="sp-updated" id="swo-updated"></span>
            <div class="sp-footer-actions">
              <button class="sp-ghost sp-random-btn" id="sp-random" data-tip="🎲 今日の1本｜未視聴の中からランダムに提案">🎲</button>
              <button class="sp-ghost sp-theme-toggle" id="sp-theme-toggle" data-tip="ライト／ダーク切替">${isLightMode?'🌙':'☀️'}</button>
              <button class="sp-ghost" id="swo-allsvc" data-tip="⊞ まとめて見る｜3サービスを横断して一覧">⊞</button>
              <button class="sp-ghost" id="swo-refresh" data-tip="↻ 再取得｜最新のウォッチリストを読み込み直す">↻</button>
              <button class="sp-ghost" id="swo-export" data-tip="CSV書き出し｜タイトル・ジャンル・視聴状態・メモを出力">CSV</button>
              <button class="sp-ghost" id="swo-settings" data-tip="設定｜TMDb APIキーの管理・データ削除">設定</button>
              <button class="sp-ghost sp-close" id="swo-close" class="sp-ghost sp-close tip-left" data-tip="パネルを閉じる（データは保存済み）">✕</button>
            </div>
          </div>
        </aside>

        <main class="sp-main">
          <div class="sp-topbar">
            <span class="sp-result">${q?`${displayItems.length}件 — 「${esc(panelSearch)}」`:`${displayItems.length} titles`}</span>
            <div class="sp-topbar-right">
              <div class="sp-sort">
                <button class="sp-sort-btn ${!sortKey?'active':''}" data-sort="">追加順</button>
                <button class="sp-sort-btn ${sortKey==='title'?'active':''}" data-sort="title">タイトル</button>
                <button class="sp-sort-btn ${sortKey==='star'?'active':''}" data-sort="star">★評価</button>
                <button class="sp-sort-btn ${sortKey==='collected'?'active':''}" data-sort="collected">収集日</button>
              </div>
              <div class="sp-view-group">
                <button class="sp-view-btn ${viewMode==='genre'?'active':''}" data-view="genre">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
                <button class="sp-view-btn ${viewMode==='list'?'active':''}" data-view="list">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
              </div>
              <span id="sp-collapse-wrap"></span>
            </div>
          </div>

          ${(!TMDB_API_KEY&&otherCount>0)?`
          <div class="sp-tmdb-bar">
            <span>「その他」が ${otherCount} 件 — TMDb APIキーでジャンル精度が上がります</span>
            <span class="sp-tmdb-input">
              <input type="text" id="swo-inline-key" placeholder="APIキーを貼り付け">
              <button id="swo-inline-apply">適用</button>
            </span>
          </div>`:''}

          <div class="sp-content" id="sp-content">
            ${displayItems.length===0
              ? `<div class="sp-empty"><p>${q?`「${esc(panelSearch)}」に一致する作品がありません`:'条件に一致する作品がありません'}</p></div>`
              : viewMode==='genre'
                ? renderGenreView(buildGenreMap(displayItems), sortKey, dupHrefs)
                : renderListView(displayItems, dupHrefs)
            }
          </div>
        </main>
      </div>

      <!-- ランダム提案モーダル -->
      <div class="sp-random-modal" id="sp-random-modal" style="display:none">
        <div class="sp-random-card" id="sp-random-card"></div>
      </div>
    `;
    document.body.appendChild(organizedPanel);

    // ===== イベント =====

    // 検索
    const searchEl = organizedPanel.querySelector('#sp-search');
    const clearEl  = organizedPanel.querySelector('#sp-clear');
    let searchTimer;
    searchEl.addEventListener('input', ()=>{
      panelSearch = searchEl.value;
      clearEl.style.display = panelSearch ? 'block' : 'none';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(()=>renderPanel(rawItems,filterGenre,sortKey,viewMode,filterWatched), 120);
    });
    clearEl.addEventListener('click', ()=>{
      panelSearch=''; searchEl.value=''; clearEl.style.display='none';
      renderPanel(rawItems,filterGenre,sortKey,viewMode,filterWatched);
    });

    // 視聴状態フィルター
    organizedPanel.querySelectorAll('[data-watched]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const w = btn.dataset.watched;
        const newFilter = w==='dup' ? filterWatched : w;
        if (w==='dup') {
          // 重複フィルター：displayItemsを重複hrefで絞る
          panelSearch='';
          renderPanel(rawItems, filterGenre, sortKey, viewMode, 'all');
          // TODO: dup専用フィルター実装余地
        } else {
          renderPanel(rawItems, filterGenre, sortKey, viewMode, newFilter);
        }
      });
    });

    // ジャンルナビ
    organizedPanel.querySelectorAll('[data-genre]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        panelSearch='';
        renderPanel(rawItems, btn.dataset.genre==='all'?null:btn.dataset.genre, sortKey, viewMode, filterWatched);
      });
    });

    // ソート・ビュー
    organizedPanel.querySelectorAll('.sp-sort-btn').forEach(b=>b.addEventListener('click', ()=>
      renderPanel(rawItems, filterGenre, b.dataset.sort||null, viewMode, filterWatched)));
    organizedPanel.querySelectorAll('.sp-view-btn').forEach(b=>b.addEventListener('click', ()=>
      renderPanel(rawItems, filterGenre, sortKey, b.dataset.view, filterWatched)));

    // 折りたたみ
    const updateColLabel = ()=>{
      const wrap = organizedPanel.querySelector('#sp-collapse-wrap');
      if (!wrap) return;
      const sections = organizedPanel.querySelectorAll('.sp-genre-section');
      if (sections.length<=1||filterGenre) { wrap.innerHTML=''; return; }
      const anyOpen = [...sections].some(s=>!s.classList.contains('collapsed'));
      wrap.innerHTML = `<button class="sp-sort-btn" id="sp-collapse-all">${anyOpen?'すべて閉じる':'すべて開く'}</button>`;
      organizedPanel.querySelector('#sp-collapse-all').addEventListener('click', ()=>{
        sections.forEach(s=>anyOpen?s.classList.add('collapsed'):s.classList.remove('collapsed'));
        updateColLabel();
      });
    };
    organizedPanel.querySelectorAll('.sp-genre-heading').forEach(h=>{
      h.addEventListener('click', ()=>{ h.closest('.sp-genre-section').classList.toggle('collapsed'); setTimeout(updateColLabel,0); });
    });
    updateColLabel();

    // 視聴済みトグル（カード内ボタン）
    organizedPanel.querySelectorAll('.sp-watched-btn').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.preventDefault(); e.stopPropagation();
        const href = btn.dataset.href;
        const ud = getUD(href);
        await setUD(href, { watched: !ud.watched });
        renderPanel(rawItems, filterGenre, sortKey, viewMode, filterWatched);
      });
    });

    // スター（カード内）
    organizedPanel.querySelectorAll('.sp-star-btn').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.preventDefault(); e.stopPropagation();
        const href = btn.dataset.href;
        const val  = parseInt(btn.dataset.val);
        const ud = getUD(href);
        const newStar = ud.star===val ? 0 : val; // 同じ星を押したらクリア
        await setUD(href, { star: newStar });
        renderPanel(rawItems, filterGenre, sortKey, viewMode, filterWatched);
      });
    });

    // メモ（カード内）
    organizedPanel.querySelectorAll('.sp-memo-btn').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.preventDefault(); e.stopPropagation();
        showMemoPopup(btn.dataset.href, rawItems, filterGenre, sortKey, viewMode, filterWatched);
      });
    });

    // ジャンル修正（ジャンルタグクリック）
    organizedPanel.querySelectorAll('.sp-genre-tag-edit').forEach(tag=>{
      tag.addEventListener('click', async e=>{
        e.preventDefault(); e.stopPropagation();
        showGenreEditPopup(tag.dataset.href, tag.dataset.genre, rawItems, filterGenre, sortKey, viewMode, filterWatched);
      });
    });

    // ランダム提案
    organizedPanel.querySelector('#sp-random').addEventListener('click', ()=>{
      const unwatched = displayItems.filter(it=>!it.watched);
      const pool = unwatched.length > 0 ? unwatched : displayItems;
      if (pool.length===0) return;
      const it = pool[Math.floor(Math.random()*pool.length)];
      showRandomModal(it);
    });

    // テーマトグル
    organizedPanel.querySelector('#sp-theme-toggle').addEventListener('click', ()=>{
      isLightMode = !isLightMode;
      organizedPanel.classList.toggle('sp-light', isLightMode);
      organizedPanel.querySelector('#sp-theme-toggle').textContent = isLightMode?'🌙':'☀️';
    });

    // アクション
    organizedPanel.querySelector('#swo-close').addEventListener('click', closeAll);
    organizedPanel.querySelector('#swo-export').addEventListener('click', ()=>exportCSV(displayItems));
    organizedPanel.querySelector('#swo-settings').addEventListener('click', showSettings);
    organizedPanel.querySelector('#swo-refresh').addEventListener('click', async()=>{
      if (!confirm('再取得しますか？')) return;
      closeAll(); await sset({[`${STORAGE}_items`]:[]});  startOrganizing();
    });
    organizedPanel.querySelector('#swo-allsvc').addEventListener('click', ()=>{
      try {
        const url = chrome.runtime.getURL('viewer.html');
        const w = window.open(url, '_blank');
        if (!w) alert('まとめビューを開けませんでした。ツールバーのアイコンをクリックしてください。');
      } catch(e) { alert('まとめビューを開けませんでした。'); }
    });

    // インラインTMDb
    const applyBtn = organizedPanel.querySelector('#swo-inline-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', async()=>{
        const key=(organizedPanel.querySelector('#swo-inline-key').value||'').trim();
        if(!key){alert('APIキーを入力してください');return;}
        TMDB_API_KEY=key; await sset({tmdb_api_key:key});
        applyBtn.textContent='判定中...'; applyBtn.disabled=true;
        const enriched=await enrichWithTMDb(rawItems,(d,t)=>applyBtn.textContent=`判定中 ${d}/${t}`);
        currentItems=enriched; await saveItems(enriched);
        renderPanel(enriched,filterGenre,sortKey,viewMode,filterWatched);
      });
    }

    // 更新日時
    sget([`${STORAGE}_at`]).then(r=>{
      const el=organizedPanel&&organizedPanel.querySelector('#swo-updated');
      const ts=r[`${STORAGE}_at`];
      if(el&&ts){
        const d=new Date(ts);
        const pad=n=>String(n).padStart(2,'0');
        el.textContent=`更新 ${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    });

    if (panelSearch && searchEl) searchEl.focus();
  }

  // ===================== ビュー描画 =====================
  function buildGenreMap(items) {
    const m={};
    for (const it of items) (m[it.genre]=m[it.genre]||[]).push(it);
    return m;
  }

  function renderGenreView(genreMap, sortKey, dupHrefs) {
    return Object.entries(genreMap).map(([genre, items])=>{
      const color=GENRE_COLORS[genre]||'#6b6658';
      return `<div class="sp-genre-section">
        <button class="sp-genre-heading">
          <span class="sp-genre-chevron">▾</span>
          <span class="sp-genre-name">${esc(genre)}</span>
          <span class="sp-genre-num">${items.length}</span>
        </button>
        <div class="sp-grid">${items.map(it=>renderCard(it,color,dupHrefs)).join('')}</div>
      </div>`;
    }).join('');
  }

  function renderListView(items, dupHrefs) {
    return `<div class="sp-list">${items.map((it,i)=>{
      const gl=(it.genres&&it.genres.length>0)?it.genres:[it.genre];
      const tags=gl.map(g=>{
        const c=GENRE_COLORS[g]||'#6b6658';
        return `<span class="sp-tag sp-genre-tag-edit" data-href="${safeUrl(it.href)}" data-genre="${esc(g)}" style="background:${c}1a;color:${c};border-color:${c}40" data-tip="クリックでジャンルを修正">${esc(g)}</span>`;
      }).join('');
      const ud = getUD(it.href);
      const isDup = dupHrefs && dupHrefs.has(it.href);
      return `<div class="sp-list-row ${it.watched?'sp-watched':''}">
        <span class="sp-list-num">${i+1}</span>
        <div class="sp-list-thumb">${it.thumbnail?`<img src="${safeUrl(it.thumbnail)}" alt="" loading="lazy">`:'<div class="sp-thumb-ph"></div>'}</div>
        <div class="sp-list-info">
          <div class="sp-list-title-row">
            <a class="sp-list-title" href="${safeUrl(it.href)}" target="_blank" rel="noopener noreferrer">${phlHighlight(it.title)||'(不明)'}</a>
            ${isDup?`<span class="sp-dup-badge" data-tip="他サービスにも同じ作品が登録されています">重複</span>`:''}
          </div>
          <div class="sp-list-tags">${tags}</div>
          ${ud.memo?`<div class="sp-list-memo">${esc(ud.memo)}</div>`:''}
        </div>
        <div class="sp-list-actions">
          ${renderStars(it.href, it.star)}
          <button class="sp-watched-btn ${it.watched?'sp-watched-on':''}" data-href="${safeUrl(it.href)}" data-tip="${it.watched?'✓ 視聴済み — クリックで解除':'未視聴 — クリックでチェック'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${it.watched?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="sp-memo-btn" data-href="${safeUrl(it.href)}" data-tip="メモを追加・編集">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${ud.memo?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        <div class="sp-ext">${A.externalLinks(it)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function renderStars(href, star) {
    return `<span class="sp-stars">${[1,2,3].map(v=>
      `<button class="sp-star-btn ${(star||0)>=v?'sp-star-on':''}" data-href="${safeUrl(href)}" data-val="${v}">★</button>`
    ).join('')}</span>`;
  }

  function renderCard(it, color, dupHrefs) {
    const ud = getUD(it.href);
    const isDup = dupHrefs && dupHrefs.has(it.href);
    const gl=(it.genres&&it.genres.length>1)
      ?`<div class="sp-card-genres">${it.genres.map(g=>`<span class="sp-mini-tag sp-genre-tag-edit" data-href="${safeUrl(it.href)}" data-genre="${esc(g)}" style="background:${(GENRE_COLORS[g]||'#6b6658')}1a;color:${GENRE_COLORS[g]||'#6b6658'}" data-tip="クリックでジャンルを修正">${esc(g)}</span>`).join('')}</div>`:'';
    return `<div class="sp-card ${it.watched?'sp-card-watched':''}" data-href="${safeUrl(it.href)}">
      <a class="sp-card-link" href="${safeUrl(it.href)}" target="_blank" rel="noopener noreferrer">
        <div class="sp-card-thumb">
          ${it.thumbnail?`<img src="${safeUrl(it.thumbnail)}" alt="${esc(it.title)}" loading="lazy">`:`<div class="sp-card-noimg" style="background:${color}18">?</div>`}
          ${isDup?`<span class="sp-card-dup" data-tip="他サービスにも同じ作品があります">!</span>`:''}
          ${it.watched?`<span class="sp-card-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>`:''}
        </div>
        <div class="sp-card-title">${phlHighlight(it.title)||'(不明)'}</div>
      </a>
      ${gl}
      <div class="sp-card-meta">
        ${renderStars(it.href, it.star)}
        <span class="sp-card-actions">
          <button class="sp-watched-btn ${it.watched?'sp-watched-on':''}" data-href="${safeUrl(it.href)}" data-tip="${it.watched?'✓ 視聴済み — クリックで解除':'未視聴 — クリックでチェック'}">✓</button>
          <button class="sp-memo-btn ${ud.memo?'sp-memo-has':''}" data-href="${safeUrl(it.href)}" data-tip="メモを追加・編集">✎</button>
        </span>
      </div>
      ${ud.memo?`<div class="sp-card-memo-preview">${esc(ud.memo.slice(0,30))}${ud.memo.length>30?'…':''}</div>`:''}
      <div class="sp-ext">${A.externalLinks(it)}</div>
    </div>`;
  }

  // ===================== メモポップアップ =====================
  function showMemoPopup(href, rawItems, fg, sk, vm, fw) {
    const existing = document.getElementById('sp-memo-popup');
    if (existing) existing.remove();
    const ud = getUD(href);
    const pop = document.createElement('div');
    pop.id = 'sp-memo-popup';
    pop.innerHTML = `
      <div class="sp-popup-card">
        <div class="sp-popup-head"><span>メモ</span><button id="sp-memo-close">✕</button></div>
        <textarea id="sp-memo-text" placeholder="メモを入力…" rows="4">${esc(ud.memo||'')}</textarea>
        <div class="sp-popup-actions">
          <button class="sp-ghost" id="sp-memo-clear">削除</button>
          <button class="sp-ghost sp-popup-save" id="sp-memo-save">保存</button>
        </div>
      </div>`;
    const panel = document.getElementById('swo-panel');
    if (panel) panel.appendChild(pop);
    pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
    pop.querySelector('#sp-memo-close').addEventListener('click', ()=>pop.remove());
    pop.querySelector('#sp-memo-save').addEventListener('click', async()=>{
      const memo = pop.querySelector('#sp-memo-text').value.trim();
      await setUD(href, {memo});
      pop.remove();
      renderPanel(rawItems,fg,sk,vm,fw);
    });
    pop.querySelector('#sp-memo-clear').addEventListener('click', async()=>{
      await setUD(href, {memo:''});
      pop.remove();
      renderPanel(rawItems,fg,sk,vm,fw);
    });
    setTimeout(()=>pop.querySelector('#sp-memo-text').focus(), 50);
  }

  // ===================== ジャンル修正ポップアップ =====================
  function showGenreEditPopup(href, currentGenre, rawItems, fg, sk, vm, fw) {
    const existing = document.getElementById('sp-genre-popup');
    if (existing) existing.remove();
    const genres = Object.keys(GENRE_COLORS);
    const pop = document.createElement('div');
    pop.id = 'sp-genre-popup';
    pop.innerHTML = `
      <div class="sp-popup-card">
        <div class="sp-popup-head"><span>ジャンルを修正</span><button id="sp-genre-close">✕</button></div>
        <div class="sp-genre-list">
          ${genres.map(g=>{
            const c=GENRE_COLORS[g]||'#6b6658';
            return `<button class="sp-genre-choice ${g===currentGenre?'sp-genre-choice-active':''}" data-genre="${esc(g)}" style="--gc:${c}">${esc(g)}</button>`;
          }).join('')}
          <button class="sp-genre-choice" data-genre="__reset__">自動判定に戻す</button>
        </div>
      </div>`;
    const panel = document.getElementById('swo-panel');
    if (panel) panel.appendChild(pop);
    pop.addEventListener('click', e=>{ if(e.target===pop) pop.remove(); });
    pop.querySelector('#sp-genre-close').addEventListener('click', ()=>pop.remove());
    pop.querySelectorAll('.sp-genre-choice').forEach(btn=>{
      btn.addEventListener('click', async()=>{
        if (btn.dataset.genre==='__reset__') {
          await setUD(href, {genre:null});
        } else {
          await setUD(href, {genre: btn.dataset.genre});
        }
        pop.remove();
        renderPanel(rawItems,fg,sk,vm,fw);
      });
    });
  }

  // ===================== ランダム提案モーダル =====================
  function showRandomModal(it) {
    const modal = organizedPanel.querySelector('#sp-random-modal');
    const card  = organizedPanel.querySelector('#sp-random-card');
    const color = GENRE_COLORS[it.genre]||'#6b6658';
    card.innerHTML = `
      <div class="sp-random-inner">
        <div class="sp-random-label">今日の1本</div>
        ${it.thumbnail?`<img class="sp-random-img" src="${safeUrl(it.thumbnail)}" alt="${esc(it.title)}">`:`<div class="sp-random-noimg" style="background:${color}22"></div>`}
        <div class="sp-random-title">${esc(it.title)}</div>
        <div class="sp-random-genre" style="color:${color}">${esc(it.genre)}</div>
        <div class="sp-random-btns">
          <a class="sp-random-go" href="${safeUrl(it.href)}" target="_blank" rel="noopener noreferrer">視聴する →</a>
          <button class="sp-ghost sp-random-again" id="sp-random-again">別の作品</button>
          <button class="sp-ghost" id="sp-random-close">閉じる</button>
        </div>
      </div>`;
    modal.style.display = 'flex';
    modal.addEventListener('click', e=>{ if(e.target===modal) modal.style.display='none'; });
    card.querySelector('#sp-random-close').addEventListener('click', ()=>modal.style.display='none');
    card.querySelector('#sp-random-again').addEventListener('click', ()=>{
      const items = mergeUserData(currentItems);
      const unwatched = items.filter(it=>!it.watched);
      const pool = unwatched.length>0?unwatched:items;
      if (pool.length===0) return;
      showRandomModal(pool[Math.floor(Math.random()*pool.length)]);
    });
  }

  // ===================== 設定 =====================
  async function showSettings(){
    const existing = document.getElementById('swo-settings-overlay');
    if (existing) { existing.remove(); return; }
    const s = await sget(['tmdb_api_key']);
    const ov = document.createElement('div');
    ov.id = 'swo-settings-overlay';
    ov.innerHTML = `
      <div class="swo-set-card">
        <div class="swo-set-head"><h2>設定</h2><button id="swo-set-close">✕</button></div>
        <div class="swo-set-body">
          <label class="swo-set-label">TMDb APIキー（3サービス共通）</label>
          <input type="text" id="swo-set-key" value="${s.tmdb_api_key||''}" placeholder="32文字の英数字">
          <details class="swo-onb-howto" style="margin-top:12px">
            <summary>▸ キーの取り方</summary>
            <ol><li><a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener noreferrer">themoviedb.org</a> で無料登録</li><li>設定 → API → Create → Developer</li><li>「API Key (v3 auth)」をコピー</li></ol>
          </details>
          <div class="swo-set-actions">
            <button id="swo-set-clear" class="swo-set-secondary">キャッシュ削除</button>
            <button id="swo-set-userdata" class="swo-set-secondary">視聴/メモ削除</button>
            <button id="swo-set-save" class="swo-set-primary">保存</button>
          </div>
        </div>
      </div>`;
    const panel = document.getElementById('swo-panel');
    if (panel) panel.appendChild(ov);
    else document.body.appendChild(ov);
    ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
    ov.querySelector('#swo-set-close').addEventListener('click', ()=>ov.remove());
    ov.querySelector('#swo-set-save').addEventListener('click', async()=>{
      const key=(ov.querySelector('#swo-set-key').value||'').trim();
      TMDB_API_KEY=key||null; await sset({tmdb_api_key:key}); ov.remove();
    });
    ov.querySelector('#swo-set-clear').addEventListener('click', async()=>{
      await sset({[`${STORAGE}_cache`]:{}});  ov.remove();
    });
    ov.querySelector('#swo-set-userdata').addEventListener('click', async()=>{
      if (!confirm('視聴済み・スター・メモをすべて削除しますか？')) return;
      userData={}; await saveUserData();  ov.remove();
      renderPanel(currentItems);
    });
  }

  // ===================== CSV =====================
  function exportCSV(items){
    const header=['タイトル','ジャンル','視聴済み','スター','メモ','URL'];
    const rows=items.map(it=>{
      const g=(it.genres&&it.genres.length>0)?it.genres.join(' / '):it.genre;
      return [
        `"${(it.title||'').replace(/"/g,'""')}"`,`"${g}"`,
        `"${it.watched?'済み':'未視聴'}"`,`"${'★'.repeat(it.star||0)}"`,
        `"${(it.memo||'').replace(/"/g,'""')}"`,`"${it.href||''}"`
      ].join(',');
    });
    const csv='\uFEFF'+[header.join(','),...rows].join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`${A.storagePrefix}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ===================== 共通 =====================
  function closeAll(){
    if(organizedPanel){organizedPanel.remove();organizedPanel=null;}
    ['swo-onboarding','swo-settings-overlay'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
  }

  function start(){try{injectButton();}catch(e){console.error('[SWO]',e);}}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
  setInterval(()=>{if(!document.getElementById('swo-toggle-btn'))start();},3000);

})();
