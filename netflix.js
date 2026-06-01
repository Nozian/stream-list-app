// ===== Netflix アダプター =====
window.__SWO_ADAPTER__ = {
  name: 'Netflix',
  shortName: 'NWO',
  accentColor: '#e50914',
  bgColor: '#141414',
  storagePrefix: 'swo_netflix',
  listUrl: 'https://www.netflix.com/browse/my-list',

  isListPage() {
    return location.href.includes('/browse');
  },

  getRawItems() {
    const seen = new Set();
    const results = [];
    const links = document.querySelectorAll('a[href*="/watch/"]');
    for (const link of links) {
      const href = link.href || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const serviceId = (href.match(/\/watch\/(\d+)/) || [])[1] || '';
      const tile = link.closest('[class*="slider"]') || link.closest('[class*="card"]') ||
                   link.closest('[class*="item"]') || link.closest('li') || link.parentElement;
      results.push({ link, tile, href, serviceId });
    }
    return results;
  },

  extractItemData({ link, tile, href, serviceId }) {
    let title = '';
    const img = tile ? tile.querySelector('img') : link.querySelector('img');
    if (img) title = img.alt || '';
    if (!title) title = link.getAttribute('aria-label') || link.getAttribute('title') || '';
    const thumbnail = img ? (img.src || img.dataset.src || '') : '';
    const fullText = (tile ? tile.textContent : '') || '';
    return { title, thumbnail, href, fullText, serviceId };
  },

  externalLinks(item) {
    const e = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const q = encodeURIComponent((item.title || '').replace(/[\uFF08(].*?[)\uFF09]/g,'').replace(/\s*(\u30b7\u30fc\u30ba\u30f3|Season)\s*\d+.*/i,'').trim());
    const id = encodeURIComponent(item.serviceId || '');
    const playLink = item.serviceId
      ? `<a class="swo-ext swo-ext-primary" href="https://www.netflix.com/watch/${id}" target="_blank" rel="noopener noreferrer">\u25b6 \u518d\u751f</a>`
      : '';
    return `
      ${playLink}
      <a class="swo-ext" href="https://eiga.com/search/${q}/" target="_blank" rel="noopener noreferrer">\u6620\u753b.com</a>
      <a class="swo-ext" href="https://www.justwatch.com/jp/\u691c\u7d22?q=${q}" target="_blank" rel="noopener noreferrer">JustWatch</a>
      <a class="swo-ext" href="https://www.themoviedb.org/search?query=${q}" target="_blank" rel="noopener noreferrer">TMDb</a>
    `;
  }
};
