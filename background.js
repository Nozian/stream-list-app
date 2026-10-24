chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('library.html')}));
chrome.runtime.onMessage.addListener((msg, sender, reply)=>{
  if(msg?.type==='NZ_ENT_OPEN_LIBRARY'){
    chrome.tabs.create({url:chrome.runtime.getURL('library.html')}).then(()=>reply({ok:true})).catch(e=>reply({ok:false,error:e.message}));
    return true;
  }
});
