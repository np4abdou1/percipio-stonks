importScripts('site-config.js');

const { DEFAULT_HOST, normalizeHost, matchPattern } = PercipioSite;
const SCRIPT_ID = 'percipio-selected-site';

// Serialize initialization and saves so an older registration cannot replace a new one.
let pending = Promise.resolve();
function enqueue(action) {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}

async function getSiteHost() {
  const { siteHost = DEFAULT_HOST } = await chrome.storage.local.get('siteHost');
  return normalizeHost(siteHost);
}

async function registerSite(host) {
  const script = {
    id: SCRIPT_ID,
    matches: [matchPattern(host)],
    js: ['navigation.js', 'content.js'],
    runAt: 'document_end',
    persistAcrossSessions: true,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

async function saveSite(value) {
  const siteHost = normalizeHost(value);
  if (!await chrome.permissions.contains({ origins: [matchPattern(siteHost)] })) {
    throw new Error('Allow Chrome access to this Percipio site, then save again.');
  }
  const previousHost = await getSiteHost();
  await registerSite(siteHost);
  try {
    await chrome.storage.local.set({ siteHost });
  } catch (error) {
    await registerSite(previousHost);
    throw error;
  }

  // Reload both sites to remove previously injected scripts and activate the new choice.
  // Unrelated tabs are never reloaded or navigated to another tenant.
  try {
    const patterns = [...new Set([matchPattern(previousHost), matchPattern(siteHost)])];
    const tabs = await chrome.tabs.query({ url: patterns });
    const results = await Promise.allSettled(tabs.map(tab => chrome.tabs.reload(tab.id)));
    const failed = results.filter(result => result.status === 'rejected').length;
    return { siteHost, reloaded: results.length - failed, warning: failed ? 'Some tabs could not reload. Refresh them manually.' : '' };
  } catch (error) {
    return { siteHost, reloaded: 0, warning: 'Saved. Refresh your Percipio tabs manually.' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let task;
  if (msg.type === 'SAVE_SITE') {
    // Only the extension popup can switch tenants, not a content script.
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
    task = enqueue(() => saveSite(msg.siteHost));
  } else if (msg.type === 'GET_CONFIG') {
    task = chrome.storage.local.get('config').then(({ config = {} }) => config);
  } else if (msg.type === 'SAVE_CONFIG') {
    task = enqueue(async () => {
      const { config = {} } = await chrome.storage.local.get('config');
      if (msg.config?.theme === 'light' || msg.config?.theme === 'dark') config.theme = msg.config.theme;
      await chrome.storage.local.set({ config });
      return { success: true };
    });
  } else if (msg.type === 'RELOAD') {
    chrome.runtime.reload();
    return;
  } else {
    return;
  }
  task.then(sendResponse).catch(error => sendResponse({ error: error.message }));
  return true;
});

// Persistent dynamic registration survives worker suspension and browser restarts.
// Reconcile on worker startup as well, covering unpacked-extension updates.
enqueue(async () => registerSite(await getSiteHost())).catch(console.error);
