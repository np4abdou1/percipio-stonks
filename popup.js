const form = document.getElementById('site-form');
const input = document.getElementById('subdomain');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');
const { DEFAULT_HOST, normalizeHost, matchPattern } = PercipioSite;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

chrome.storage.local.get('siteHost').then(({ siteHost = DEFAULT_HOST }) => {
  input.value = normalizeHost(siteHost).replace(/\.percipio\.com$/, '');
  input.disabled = false;
  saveButton.disabled = false;
  setStatus(`Selected site: ${siteHost}`);
}).catch(error => setStatus(`Unable to load settings: ${error.message}`, true));

form.addEventListener('submit', async event => {
  event.preventDefault();
  input.setCustomValidity('');
  let siteHost;
  try {
    siteHost = normalizeHost(input.value);
  } catch (error) {
    input.setCustomValidity(error.message);
    input.reportValidity();
    return;
  }

  saveButton.disabled = true;
  input.disabled = true;
  try {
    // Request immediately in the submit gesture, before any other asynchronous work.
    const allowed = await chrome.permissions.request({ origins: [matchPattern(siteHost)] });
    if (!allowed) throw new Error('Site access was not granted. The previous selection is unchanged.');
    setStatus('Saving and reloading…');
    const result = await chrome.runtime.sendMessage({ type: 'SAVE_SITE', siteHost });
    if (!result || result.error) throw new Error(result?.error || 'No response from the extension. Reload it and try again.');
    input.value = result.siteHost.replace(/\.percipio\.com$/, '');
    setStatus(result.warning || (result.reloaded
      ? `Saved ${result.siteHost}. Reloaded ${result.reloaded} tab(s).`
      : `Saved. Open https://${result.siteHost} to use the extension.`));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveButton.disabled = false;
    input.disabled = false;
  }
});

input.addEventListener('input', () => input.setCustomValidity(''));

document.getElementById('panel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Open your selected Percipio site first.');
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    window.close();
  } catch (error) {
    setStatus('Open your selected Percipio site, then save and reload its tab before showing the panel.', true);
  }
});
