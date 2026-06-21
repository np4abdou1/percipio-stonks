chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RELOAD') {
    chrome.runtime.reload();
  }
});
