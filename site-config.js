/* Shared by the popup and service worker. No site script runs on a wildcard. */
globalThis.PercipioSite = (() => {
  const DEFAULT_HOST = 'kyndryl-centropublico.percipio.com';

  function normalizeHost(value) {
    let host = String(value || '').trim().toLowerCase();
    if (host.startsWith('https://')) {
      const url = new URL(host);
      if (url.username || url.password || url.port) throw new Error('Use a Percipio HTTPS address without credentials or a port.');
      host = url.hostname;
    } else {
      host = host.replace(/\/$/, '');
      if (!host.includes('.')) host += '.percipio.com';
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.percipio\.com$/.test(host)) {
      throw new Error('Enter a subdomain such as kyndryl-centropublico, or its https://…percipio.com address.');
    }
    return host;
  }

  const matchPattern = host => `https://${normalizeHost(host)}/*`;
  return { DEFAULT_HOST, normalizeHost, matchPattern };
})();

if (typeof module !== 'undefined') module.exports = globalThis.PercipioSite;
