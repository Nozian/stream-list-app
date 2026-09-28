// アイコンクリックで端末間同期対応のWeb版を開く
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://swo-watchlist.nozian.chatgpt.site/' });
});
