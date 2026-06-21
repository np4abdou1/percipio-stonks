const DEFAULT_KEY = '';
const DEFAULT_URL = 'https://opencode.ai/zen/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash-free';
const DEFAULT_VISION_KEY = '';
const DEFAULT_VISION_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_VISION_MODEL = 'qwen/qwen3.5-flash-02-23';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RELOAD') {
    chrome.runtime.reload();
    return;
  }
  if (msg.type === 'GET_CONFIG') {
    chrome.storage.local.get(['apiKey', 'apiUrl', 'model', 'theme', 'visionKey', 'visionModel', 'visionUrl']).then(c => {
      sendResponse({
        apiKey: c.apiKey || DEFAULT_KEY,
        apiUrl: c.apiUrl || DEFAULT_URL,
        model: c.model || DEFAULT_MODEL,
        theme: c.theme || 'light',
        visionKey: c.visionKey || DEFAULT_VISION_KEY,
        visionModel: c.visionModel || DEFAULT_VISION_MODEL,
        visionUrl: c.visionUrl || DEFAULT_VISION_URL,
      });
    });
    return true;
  }
  if (msg.type === 'SAVE_CONFIG') {
    chrome.storage.local.set(msg.config).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'ASK_AI') {
    chrome.storage.local.get(['apiKey', 'apiUrl', 'model']).then(async c => {
      const fallbacks = [
        { url: c.apiUrl, key: c.apiKey, model: c.model },
        { url: 'https://opencode.ai/zen/v1/chat/completions', key: '', model: 'deepseek-v4-flash-free' },
        { url: 'https://api.groq.com/openai/v1/chat/completions', key: '', model: 'llama-3.3-70b-versatile' },
        { url: 'https://api.cerebras.ai/v1/chat/completions', key: '', model: 'llama3.1-8b' },
        { url: 'https://models.inference.ai.azure.com/chat/completions', key: '', model: 'gpt-4o-mini' },
        { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: '', model: 'gemini-2.5-flash' }
      ].filter(f => f.url && f.key && f.model);

      let lastError = 'No valid APIs configured';
      for (const api of fallbacks) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          const r = await fetch(api.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${api.key}`
            },
            body: JSON.stringify({
              model: api.model,
              messages: msg.messages,
              max_tokens: 1000,
              temperature: 0.1
            }),
            signal: controller.signal
          });
          clearTimeout(timer);
          const d = await r.json();
          if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
          
          const m = d.choices?.[0]?.message;
          let answer = m?.content || '';
          if (!answer && m?.reasoning_content) {
            answer = m.reasoning_content;
          }
          if (answer) {
            sendResponse({ answer });
            return;
          }
        } catch (e) {
          lastError = e.message;
          console.warn(`Text API failed (${api.model}):`, e.message);
        }
      }
      sendResponse({ error: lastError });
    });
    return true;
  }
  if (msg.type === 'ASK_VISION_AI') {
    chrome.storage.local.get(['visionKey', 'visionModel', 'visionUrl']).then(async c => {
      const fallbacks = [
        { url: c.visionUrl, key: c.visionKey, model: c.visionModel },
        { url: 'https://models.inference.ai.azure.com/chat/completions', key: '', model: 'gpt-4o-mini' },
        { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: '', model: 'gemini-2.5-flash' },
        { url: 'https://openrouter.ai/api/v1/chat/completions', key: '', model: 'google/gemini-2.5-flash:free' }
      ].filter(f => f.url && f.key && f.model);

      let lastError = 'No valid vision APIs configured';
      for (const api of fallbacks) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const r = await fetch(api.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${api.key}`,
              'HTTP-Referer': 'https://github.com/np4abdou1/percipio-stonks',
              'X-Title': 'Percipio Stonks'
            },
            body: JSON.stringify({
              model: api.model,
              messages: [
                { role: 'system', content: 'You are an elite expert in IT. Respond with ONLY the correct letter(s) (A, B, C, D) separated by commas. No formatting, no words.' },
                { role: 'user', content: [
                  { type: 'text', text: msg.text },
                  { type: 'image_url', image_url: { url: msg.image } }
                ]}
              ],
              max_tokens: 100
            }),
            signal: controller.signal
          });
          clearTimeout(timer);
          const d = await r.json();
          if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
          const m = d.choices?.[0]?.message;
          if (m?.content) {
            sendResponse({ answer: m.content });
            return;
          }
        } catch (e) {
          lastError = e.message;
          console.warn(`Vision API failed (${api.model}):`, e.message);
        }
      }
      sendResponse({ error: lastError });
    });
    return true;
  }
});
