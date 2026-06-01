// ===== U-NEXT アダプター =====
window.__SWO_ADAPTER__ = {
  name: 'U-NEXT',
  shortName: 'UWO',
  accentColor: '#ff5500',
  bgColor: '#0a0a0a',
  storagePrefix: 'swo_unext',
  listUrl: 'https://video.unext.jp/mylist/favorite/video',

  isListPage() {
    return location.href.includes('/mylist') || location.href.includes('/browse');
  },

  getRawItems() {
    const seen = new Set();
    const results = [];
    const links = document.querySelectorAll('a[href*="/title/"]');
    for (const link of links) {
      const href = link.href || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const serviceId = (href.match(/\/title\/(SID\d+)/) || [])[1] || '';
      const tile = link.closest('li') || link.closest('[class*="card"]') ||
                   link.closest('[class*="item"]') || link.closest('[class*="thumb"]') ||
                   link.parentElement;
      results.push({ link, tile, href, serviceId });
    }
    return results;
  },

  extractItemData({ link, tile, href, serviceId }) {
    let title = '';
    const img = tile ? tile.querySelector('img') : null;
    if (img && img.alt) title = img.alt;
    if (!title) title = link.getAttribute('aria-label') || link.getAttribute('title') || '';
    if (!title) {
      const raw = (tile ? tile.textContent : link.textContent) || '';
      title = raw
        .replace(/\d{4}\u5e74/g, '')
        .replace(/[\u2605\u2606\u2729]{1,5}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split('\n')[0]
        .trim()
        .slice(0, 50);
    }
    const thumbnail = img ? (img.src || img.dataset.src || '') : '';
    const fullText = (tile ? tile.textContent : '') || '';
    return { title, thumbnail, href, fullText, serviceId };
  },

  externalLinks(item) {
    const q = encodeURIComponent((item.title || '').replace(/[\uFF08(].*?[)\uFF09]/g,'').replace(/\s*(\u30b7\u30fc\u30ba\u30f3|Season)\s*\d+.*/i,'').trim());
    const id = encodeURIComponent(item.serviceId || '');
    const playLink = item.serviceId
      ? `<a class="swo-ext swo-ext-primary" href="https://video.unext.jp/title/${id}" target="_blank" rel="noopener noreferrer">\u25b6 \u8996\u8074</a>`
      : '';
    return `
      ${playLink}
      <a class="swo-ext" href="https://eiga.com/search/${q}/" target="_blank" rel="noopener noreferrer">\u6620\u753b.com</a>
      <a class="swo-ext" href="https://www.justwatch.com/jp/\u691c\u7d22?q=${q}" target="_blank" rel="noopener noreferrer">JustWatch</a>
      <a class="swo-ext" href="https://www.themoviedb.org/search?query=${q}" target="_blank" rel="noopener noreferrer">TMDb</a>
    `;
  }
};
