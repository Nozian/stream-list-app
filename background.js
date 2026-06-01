// アイコンクリックで統合ビューを全画面タブで開く
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});
