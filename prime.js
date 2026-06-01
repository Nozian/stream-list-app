// ===== Prime Video アダプター =====
window.__SWO_ADAPTER__ = {
  name: 'Prime Video',
  shortName: 'PWO',
  accentColor: '#1ba3e8',
  bgColor: '#0f171e',
  storagePrefix: 'swo_prime',
  listUrl: 'https://www.amazon.co.jp/gp/video/mystuff/watchlist/',

  isListPage() {
    return location.href.includes('/gp/video/');
  },

  getRawItems() {
    const seen = new Set();
    const results = [];
    const links = document.querySelectorAll('a[href*="/detail/"]');
    for (const link of links) {
      const href = link.href || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const tile = link.closest('li') || link.closest('[class*="card"]') ||
                   link.closest('[class*="item"]') || link.closest('[class*="tile"]') ||
                   link.parentElement;
      if (tile) results.push({ link, tile, href, serviceId: '' });
    }
    return results;
  },

  extractItemData({ link, tile, href }) {
    let title = '';
    const img = tile.querySelector('img');
    if (img) title = img.alt || img.getAttribute('aria-label') || '';
    if (!title) title = link.getAttribute('aria-label') || link.getAttribute('title') || '';
    if (!title) { const t = tile.querySelector('[class*="title"]'); if (t) title = t.textContent.trim(); }
    if (!title) title = (tile.textContent || '').trim().slice(0, 40);
    const thumbnail = img ? (img.src || img.dataset.src || '') : '';
    const fullText = tile.textContent || '';
    return { title, thumbnail, href, fullText, serviceId: '' };
  },

  externalLinks(item) {
    const q = encodeURIComponent((item.title || '').replace(/[\uFF08(].*?[)\uFF09]/g,'').replace(/\s*(\u30b7\u30fc\u30ba\u30f3|Season)\s*\d+.*/i,'').trim());
    return `
      <a class="swo-ext" href="https://eiga.com/search/${q}/" target="_blank" rel="noopener noreferrer">\u6620\u753b.com</a>
      <a class="swo-ext" href="https://www.justwatch.com/jp/\u691c\u7d22?q=${q}" target="_blank" rel="noopener noreferrer">JustWatch</a>
      <a class="swo-ext" href="https://www.themoviedb.org/search?query=${q}" target="_blank" rel="noopener noreferrer">TMDb</a>
    `;
  }
};
