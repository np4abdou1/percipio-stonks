const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const targets = JSON.parse(data);
      const pages = targets.filter(t => t.type === 'page' && t.url && !t.url.startsWith('chrome-extension://'));
      console.log("Pages available:", pages.map(p => p.url));
    } catch (err) {
      console.log("Failed to parse targets list JSON. Server response was:", data || "(empty)");
    }
  });
}).on('error', err => console.log('Error:', err.message));
