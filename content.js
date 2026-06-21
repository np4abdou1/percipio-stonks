(function() {
  if (document.getElementById('pai-root')) return;

  /* ── Config ── */
  const sendMsg = async msg => {
    try { return await chrome.runtime.sendMessage(msg); }
    catch (e) {
      if (typeof log !== 'undefined' && (e.message.includes('context invalidated') || e.message.includes('does not exist')))
        logMsg('error', 'Extension reloaded — refresh this page');
      return { error: e.message };
    }
  };
  const loadConfig = () => sendMsg({ type: 'GET_CONFIG' });
  const saveConfig = c => sendMsg({ type: 'SAVE_CONFIG', config: c });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ── Fetch interceptor to capture submission UUIDs ── */
  let subUuidMap = {};
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    return origFetch.apply(this, args).then(async resp => {
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (url && url.includes('graphql3')) {
          const ct = resp.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const cloned = resp.clone();
            const json = await cloned.json();
            const d = Array.isArray(json) ? json[0] : json;
            const createSub = d?.data?.createChallengeSubmission;
            if (createSub?.assessmentsChallengeQuestionUuid) {
              const uuid = createSub.assessmentsChallengeQuestionUuid;
              const subResp = await origFetch('https://ofppt.percipio.com/api/graphql3?query=getSubmission', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('id_token')}` },
                body: JSON.stringify([{
                  operationName: 'getSubmission',
                  variables: { uuid },
                  query: 'query g($uuid:ID!){submission(challengeQuestionId:$uuid){questionUuid:ucsQuestionUuid correctedChoices{choiceUuid solution}}}'
                }])
              });
              const subData = await subResp.json();
              const sd = (Array.isArray(subData) ? subData[0].data : subData.data).submission;
              if (sd?.questionUuid && sd?.correctedChoices) {
                const correctUuids = sd.correctedChoices.filter(c => c.solution === 'true').map(c => c.choiceUuid);
                subUuidMap[sd.questionUuid] = correctUuids;
              }
            }
          }
        }
      } catch (e) {}
      return resp;
    });
  };

  let config = { apiKey: '', apiUrl: '', model: '', theme: 'light', visionKey: '', visionModel: '', visionUrl: '' };
  loadConfig().then(c => {
    config = c;
    if (c.theme === 'dark') { panel.classList.add('pai-dark'); themeBtn.innerHTML = '&#127769;'; }
    else { panel.classList.remove('pai-dark'); themeBtn.innerHTML = '&#127774;'; }
    setRunning(false);
  });

  /* ── Mode detection ── */
  const URL = window.location.href;
  const globalState = {
    MODE: URL.includes('/knowledgeCheck/') ? 'KNOWLEDGE_CHECK'
        : URL.includes('/videos/')          ? 'VIDEOS'
        : URL.includes('/questions')        ? 'ASSESSMENT'
        : URL.includes('/assessment/')      ? 'ASSESSMENT'
        : URL.includes('/journey/')         ? 'JOURNEY'
        : URL.match(/\/courses\/[^/]+\/?$/) ? 'COURSE_TOC'
        :                                    'UNKNOWN',
    courseId: URL.match(/\/courses\/([^/]+)/)?.[1] || '',
    assessmentId: URL.match(/knowledgeCheck\/([^/]+)/)?.[1] || '',
  };

  /* ── UI ── */
  const root = document.createElement('div');
  root.id = 'pai-root';
  root.innerHTML = `
<style>
  #pai-root *{box-sizing:border-box;margin:0;padding:0}
  #pai-panel.pai-light,
  #pai-panel{
    --bg:#fff;--bg2:#f5f5f5;--bg3:#ebebeb;
    --border:#d4d4d4;--border2:#bbb;
    --text:#000;--text2:#333;--text3:#888;
    --accent:#3366cc;--accent2:#2a5ab8;
    --green:#1a8a3a;--red:#c42c2c;--blue:#2563eb;--yellow:#9a7a04;--pink:#c0266e;--teal:#0d7a8a;
    --red-bg:rgba(196,44,44,.08);--accent-bg:rgba(51,102,204,.08);
    --shadow:rgba(0,0,0,.1);
    --icon-filter:none;
  }
  #pai-panel.pai-dark{
    --bg:hsl(0,0%,10%);--bg2:hsl(0,0%,14%);--bg3:hsl(0,0%,19%);
    --border:hsl(0,0%,22%);--border2:hsl(0,0%,30%);
    --text:hsl(0,0%,92%);--text2:hsl(0,0%,65%);--text3:hsl(0,0%,45%);
    --accent:hsl(215,70%,65%);--accent2:hsl(215,65%,55%);
    --green:hsl(140,65%,60%);--red:hsl(0,70%,65%);--blue:hsl(215,80%,65%);--yellow:hsl(50,80%,60%);--pink:hsl(330,70%,65%);--teal:hsl(175,70%,55%);
    --red-bg:hsla(0,70%,65%,.12);--accent-bg:hsla(240,70%,70%,.12);
    --shadow:rgba(0,0,0,.5);
    --icon-filter:invert(1);
  }
  #pai-panel{
    position:fixed;left:20px;top:80px;z-index:999999;
    background:var(--bg);border:1px solid var(--border);border-radius:14px;
    box-shadow:0 8px 32px var(--shadow);
    color:var(--text);font:17px/1.6 system-ui,-apple-system,sans-serif;direction:ltr;
    display:none;flex-direction:row;overflow:hidden;
  }
  #pai-main{
    display:flex;flex-direction:column;width:520px;max-height:min(720px,calc(100vh - 40px));
  }
  .pai-start-btn{
    display:flex;align-items:center;justify-content:center;gap:10px;
    margin:12px 18px 12px 18px;padding:16px 24px;
    background:var(--accent);color:#fff;
    border:none;border-radius:10px;cursor:pointer;
    font:18px system-ui,sans-serif;font-weight:700;
    transition:background .15s;flex-shrink:0;
    min-height:54px;
    letter-spacing:0.5px;
  }
  .pai-start-btn:hover{background:var(--accent2)}
  .pai-start-btn img{filter:invert(1)!important}
  .pai-golden-btn {
    background: linear-gradient(135deg, #d4af37 0%, #ffd700 50%, #b8860b 100%) !important;
    color: #000000 !important;
    border: 2px solid #b8860b !important;
    box-shadow: 0 4px 15px rgba(212, 175, 55, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4) !important;
    font-weight: 800 !important;
    transition: all 0.3s ease !important;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) !important;
  }
  .pai-golden-btn:hover {
    background: linear-gradient(135deg, #b8860b 0%, #ffd700 50%, #d4af37 100%) !important;
    box-shadow: 0 6px 20px rgba(212, 175, 55, 0.8) !important;
    transform: scale(1.02) !important;
  }
  .pai-golden-btn img {
    filter: none !important;
  }
  #pai-panel.open{display:flex}
  #pai-header{
    display:flex;align-items:center;gap:12px;
    padding:14px 18px;background:var(--bg2);border-bottom:1px solid var(--border);
    user-select:none;flex-shrink:0;
  }
  #pai-header .pai-dot{
    width:8px;height:8px;border-radius:50%;background:var(--green);
    flex-shrink:0;transition:.3s;
  }
  #pai-header .pai-dot.off{background:var(--text3)}
  #pai-header .pai-title{font-weight:600;font-size:15px;color:var(--text);white-space:nowrap;letter-spacing:.3px}
  #pai-header .pai-title .accent{color:var(--accent)}
  #pai-header .pai-title .dim{color:var(--text3);font-weight:400}
  #pai-header .pai-mode-badge{
    font-size:12px;padding:4px 9px;border-radius:5px;
    background:var(--bg3);color:var(--text2);margin-left:4px;font-weight:500;text-transform:uppercase;
  }
  #pai-header .pai-actions{margin-left:auto;display:flex;gap:4px}
  #pai-header .pai-actions button{
    background:transparent;border:none;color:var(--text2);cursor:pointer;
    width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;
    font-size:18px;transition:all .15s;
  }
  #pai-header .pai-actions button:hover{background:var(--bg3);color:var(--text)}
  #pai-header .pai-actions button:active{background:var(--border2)}
  #pai-body{flex:1;overflow-y:auto;padding:0 12px 12px 12px;background:var(--bg)}
  #pai-body::-webkit-scrollbar{width:5px}
  #pai-body::-webkit-scrollbar-track{background:transparent}
  #pai-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
  #pai-log{display:flex;flex-direction:column;gap:3px}
  #pai-log:not(:empty){padding-top:12px}
  #pai-log .e{
    padding:12px 16px;font-size:16px;line-height:1.65;word-break:break-word;white-space:pre-wrap;
    border-radius:10px;background:rgba(0,0,0,.03);
    border:1px solid transparent;border-left:4px solid transparent;transition:all .15s;
    margin-bottom:3px;
  }
  #pai-panel.pai-dark #pai-log .e{background:rgba(255,255,255,.04)}
  #pai-log .e:hover{background:rgba(0,0,0,.06)}
  #pai-panel.pai-dark #pai-log .e:hover{background:rgba(255,255,255,.07)}
  #pai-log .e.status-entry::before{content:none!important}
  #pai-log .info{border-color:rgba(37,99,235,.2);border-left-color:var(--blue);color:var(--blue)}
  #pai-panel.pai-dark #pai-log .info{border-color:rgba(96,165,250,.2)}
  #pai-log .info::before{content:"\\26A1 "}
  #pai-log .correct{border-color:rgba(22,163,74,.2);border-left-color:var(--green);color:var(--green)}
  #pai-panel.pai-dark #pai-log .correct{border-color:rgba(74,222,128,.2)}
  #pai-log .correct::before{content:"\\2713 "}
  #pai-log .wrong{border-color:rgba(220,38,38,.2);border-left-color:var(--red);color:var(--red);font-weight:600}
  #pai-panel.pai-dark #pai-log .wrong{border-color:rgba(248,113,113,.2)}
  #pai-log .wrong::before{content:"\\2717 "}
  #pai-log .ai{border-color:rgba(202,138,4,.2);border-left-color:var(--yellow);color:var(--yellow)}
  #pai-panel.pai-dark #pai-log .ai{border-color:rgba(253,224,71,.2)}
  #pai-log .ai::before{content:"\\1F916 "}
  #pai-log .error{border-color:rgba(220,38,38,.25);border-left-color:var(--red);color:var(--red);background:var(--red-bg)}
  #pai-panel.pai-dark #pai-log .error{border-color:rgba(248,113,113,.25)}
  #pai-log .error::before{content:"\\26A0 "}
  #pai-log .summary{
    border-color:rgba(99,102,241,.25);border-left-color:var(--accent);color:var(--text);font-weight:600;font-size:15px;text-align:center;
    padding:12px;background:var(--accent-bg);border-radius:8px;margin-top:6px;
  }
  #pai-panel.pai-dark #pai-log .summary{border-color:rgba(129,140,248,.25)}
  #pai-log .hack{border-color:rgba(99,102,241,.2);border-left-color:var(--accent);color:var(--accent)}
  #pai-panel.pai-dark #pai-log .hack{border-color:rgba(129,140,248,.2)}
  #pai-log .hack::before{content:"\\1F4BB "}
  #pai-log .api{border-color:rgba(8,145,178,.2);border-left-color:var(--teal);color:var(--teal)}
  #pai-panel.pai-dark #pai-log .api{border-color:rgba(45,212,191,.2)}
  #pai-log .api::before{content:"\\1F4E1 "}
  #pai-log .video{border-color:rgba(220,38,38,.2);border-left-color:var(--red);color:var(--red)}
  #pai-panel.pai-dark #pai-log .video{border-color:rgba(248,113,113,.2)}
  #pai-log .video::before{content:"\\1F3AC "}
  #pai-log .progress{border-color:rgba(219,39,119,.2);border-left-color:var(--pink);color:var(--pink)}
  #pai-panel.pai-dark #pai-log .progress{border-color:rgba(244,114,182,.2)}
  #pai-log .progress::before{content:"\\23F3 "}
  @keyframes pai-spin{to{transform:rotate(360deg)}}
  .pai-loading{display:flex;align-items:center;gap:10px;padding:10px 14px;color:var(--yellow)}
  .pai-loading .pai-spinner{
    width:18px;height:18px;border:3px solid rgba(202,138,4,.25);border-top-color:var(--yellow);
    border-radius:50%;animation:pai-spin .6s linear infinite;flex-shrink:0;display:block;
  }
  #pai-panel.pai-dark .pai-loading .pai-spinner{border-color:rgba(253,224,71,.25);border-top-color:var(--yellow)}
  #pai-donut{
    margin:0;padding:8px 0;text-align:center;font:13px/1.15 monospace;color:var(--accent);
    background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0;overflow:hidden;height:130px;
    letter-spacing:1px;white-space:pre;
  }
  #pai-panel.pai-dark #pai-donut{color:var(--accent)}
  #pai-log .score{
    background:var(--accent-bg);border:1px solid rgba(99,102,241,.25);border-radius:8px;
    color:var(--text);margin-bottom:4px;
  }
  #pai-panel.pai-dark #pai-log .score{border-color:rgba(129,140,248,.25)}
  #pai-config{
    display:none;width:340px;padding:16px 20px;background:var(--bg2);
    border-left:1px solid var(--border);flex-shrink:0;overflow-y:auto;
    max-height:min(720px,calc(100vh - 40px));
  }
  #pai-config.open{display:block}
  #pai-config label{display:block;font-size:13px;color:var(--text2);font-weight:500;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.5px}
  #pai-config label:first-child{margin-top:0}
  #pai-config input{
    width:100%;padding:10px 12px;font:14px system-ui,sans-serif;
    background:var(--bg3);border:1px solid var(--border2);color:var(--text);
    border-radius:8px;outline:none;transition:border-color .15s;
  }
  #pai-config input:focus{border-color:var(--accent)}
  #pai-config input::placeholder{color:var(--text3)}
  #pai-save-cfg{
    margin-top:12px;padding:10px 18px;background:var(--accent);color:#fff;
    border:none;border-radius:8px;cursor:pointer;font:14px system-ui,sans-serif;font-weight:600;
    transition:background .15s;width:100%;
  }
  #pai-save-cfg:hover{background:var(--accent2)}
  #pai-cfg-status{font-size:12px;margin-top:8px;color:var(--green);text-align:center}
</style>
<div id="pai-panel">
  <div id="pai-main">
    <div id="pai-header">
      <div class="pai-dot off" id="pai-dot"></div>
      <span class="pai-title"><span class="accent">Percipio</span><span class="dim">AI</span><span class="pai-mode-badge" id="pai-mode-badge">${globalState.MODE === 'KNOWLEDGE_CHECK' ? 'KC' : globalState.MODE === 'VIDEOS' ? 'VID' : globalState.MODE === 'ASSESSMENT' ? 'EXAM' : globalState.MODE === 'JOURNEY' ? 'PATH' : '?'}</span></span>
      <div class="pai-actions">
        <button id="pai-toggle-btn" title="Collapse panel"><img src="https://img.icons8.com/ios-glyphs/24/menu.png" width="20" height="20" alt="☰" style="filter:var(--icon-filter);display:block"></button>
        <button id="pai-rld-btn" title="Re-scan page"><img src="https://img.icons8.com/ios-glyphs/24/refresh.png" width="22" height="22" alt="↻" style="filter:var(--icon-filter);display:block"></button>
        <button id="pai-theme-btn" title="Toggle theme"><img class="sun" src="https://img.icons8.com/ios-glyphs/24/sun.png" width="22" height="22" alt="☀" style="filter:var(--icon-filter);display:block"><img class="moon" src="https://img.icons8.com/ios-glyphs/24/moon.png" width="22" height="22" alt="☾" style="filter:var(--icon-filter);display:none"></button>
        <button id="pai-cfg-btn" title="Settings"><img src="https://img.icons8.com/ios-glyphs/24/settings.png" width="22" height="22" alt="⚙" style="filter:var(--icon-filter);display:block"></button>
        <button id="pai-clr-btn" title="Clear log"><img src="https://img.icons8.com/ios-glyphs/24/trash.png" width="22" height="22" alt="🗑" style="filter:var(--icon-filter);display:block"></button>
      </div>
    </div>
    <button id="pai-btn" class="pai-start-btn"><img src="https://img.icons8.com/ios-glyphs/24/play--v1.png" width="20" height="20" alt="▶" style="filter:invert(1);display:block"><span>START AUTOMATION</span></button>
    <pre id="pai-donut"></pre>
    <div id="pai-body">
      <div id="pai-log"></div>
    </div>
    <div style="padding:8px 18px;text-align:center;font-size:11px;color:var(--text3);letter-spacing:2px;flex-shrink:0;border-top:1px solid var(--border)">MADE BY JOYBOY</div>
  </div>
  <div id="pai-config">
    <label>API Key</label>
    <input type="password" id="pai-key-input" placeholder="sk-...">
    <label>API URL</label>
    <input id="pai-url-input" placeholder="https://api.groq.com/openai/v1/chat/completions">
    <label>Model</label>
    <input id="pai-model-input" placeholder="llama-3.3-70b-versatile">
    <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
    <label style="color:var(--accent)">🖼️ Vision (for image questions)</label>
    <label>Vision API Key</label>
    <input type="password" id="pai-vision-key" placeholder="gsk_...">
    <label>Vision Model</label>
    <input id="pai-vision-model" placeholder="meta-llama/llama-4-scout-17b-16e-instruct">
    <label>Vision API URL</label>
    <input id="pai-vision-url" placeholder="https://api.groq.com/openai/v1/chat/completions">
    <button id="pai-save-cfg">Save</button>
    <div class="status" id="pai-cfg-status"></div>
  </div>
</div>
  `;
  document.body.appendChild(root);

  /* ── DOM refs ── */
  const panel = document.getElementById('pai-panel');
  const header = document.getElementById('pai-header');
  const body = document.getElementById('pai-body');
  const log = document.getElementById('pai-log');
  const dot = document.getElementById('pai-dot');
  const btn = document.getElementById('pai-btn');
  const rldBtn = document.getElementById('pai-rld-btn');
  const cfgBtn = document.getElementById('pai-cfg-btn');
  const themeBtn = document.getElementById('pai-theme-btn');
  const clrBtn = document.getElementById('pai-clr-btn');
  const cfgPanel = document.getElementById('pai-config');
  const keyInput = document.getElementById('pai-key-input');
  const urlInput = document.getElementById('pai-url-input');
  const modelInput = document.getElementById('pai-model-input');
  const visionKeyInput = document.getElementById('pai-vision-key');
  const visionModelInput = document.getElementById('pai-vision-model');
  const visionUrlInput = document.getElementById('pai-vision-url');
  const saveCfg = document.getElementById('pai-save-cfg');
  const cfgStatus = document.getElementById('pai-cfg-status');
  const modeBadge = document.getElementById('pai-mode-badge');

  let running = false;
  let loadingEl = null;
  let statusEl = null;
  let scoreEl = null;
  let donutAnimId = null;

  function startDonut() {
    const pre = document.getElementById('pai-donut');
    if (!pre) return;
    const W = 36, H = 14;
    const chars = '.,-~:;=!*#$@';
    let A = 0, B = 0;
    const R1 = 1, R2 = 2, K2 = 5;
    const K1 = W * K2 * 3 / (8 * (R1 + R2));

    function frame() {
      A += 0.07;
      B += 0.03;
      const cosA = Math.cos(A), sinA = Math.sin(A);
      const cosB = Math.cos(B), sinB = Math.sin(B);
      const output = new Array(W * H).fill(' ');
      const zbuf = new Array(W * H).fill(0);

      for (let theta = 0; theta < 2 * Math.PI; theta += 0.07) {
        const cost = Math.cos(theta), sint = Math.sin(theta);
        for (let phi = 0; phi < 2 * Math.PI; phi += 0.02) {
          const cosp = Math.cos(phi), sinp = Math.sin(phi);
          const cx = R2 + R1 * cost;
          const cy = R1 * sint;
          const x = cx * (cosB * cosp + sinA * sinB * sinp) - cy * cosA * sinB;
          const y = cx * (sinB * cosp - sinA * cosB * sinp) + cy * cosA * cosB;
          const z = K2 + cosA * cx * sinp + cy * sinA;
          const ooz = 1 / z;
          const xp = Math.round(W / 2 + K1 * ooz * x);
          const yp = Math.round(H / 2 - K1 * ooz * y);
          const idx = xp + yp * W;
          if (idx >= 0 && idx < W * H) {
            const L = cosp * cost * sinB - cosA * cost * sinp - sinA * sint + cosB * (cosA * sint - cost * sinA * sinp);
            if (L > 0 && ooz > zbuf[idx]) {
              zbuf[idx] = ooz;
              output[idx] = chars[Math.min(Math.floor(L * 8), 11)];
            }
          }
        }
      }
      let out = '';
      for (let i = 0; i < H; i++) out += output.slice(i * W, (i + 1) * W).join('') + '\n';
      pre.textContent = out.slice(0, -1);
      donutAnimId = requestAnimationFrame(frame);
    }
    cancelAnimationFrame(donutAnimId);
    donutAnimId = requestAnimationFrame(frame);
  }
  function setScore(correct, wrong, total) {
    const pct = total ? Math.round((correct / total) * 100) : 0;
    if (!scoreEl) {
      scoreEl = document.createElement('div');
      scoreEl.className = 'e score';
      scoreEl.style.cssText = 'text-align:center;font-weight:700;font-size:15px;padding:10px;margin-bottom:4px';
      log.appendChild(scoreEl);
    }
    scoreEl.textContent = `\u2705 ${correct}  \u274C ${wrong}  / ${total}  (${pct}%)`;
    body.scrollTop = body.scrollHeight;
  }

  function clearScore() {
    if (scoreEl) { scoreEl.remove(); scoreEl = null; }
  }

  function setStatus(type, msg) {
    hideLoading();
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = `e ${type}`;
      log.appendChild(statusEl);
    }
    statusEl.className = `e ${type} status-entry`;
    statusEl.textContent = msg;
    body.scrollTop = body.scrollHeight;
    panel.classList.add('open');
  }

  function clearStatus() {
    if (statusEl) { statusEl.remove(); statusEl = null; }
  }

  /* ── Drag ── */
  let drag = false, wasDrag = false, dragStartX, dragStartY, dragOrigLeft, dragOrigTop;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, select, textarea')) return;
    drag = true;
    wasDrag = false;
    const rect = panel.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigLeft = rect.left;
    dragOrigTop = rect.top;
    panel.style.cursor = 'grabbing';
    panel.style.transition = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3) wasDrag = true;
    panel.style.left = (dragOrigLeft + e.clientX - dragStartX) + 'px';
    panel.style.top = (dragOrigTop + e.clientY - dragStartY) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = false;
    panel.style.cursor = '';
    panel.style.transition = '';
  });

  /* ── Logging ── */
  function logMsg(type, msg) {
    const e = document.createElement('div');
    e.className = `e ${type}`;
    e.textContent = msg;
    log.appendChild(e);
    body.scrollTop = body.scrollHeight;
    panel.classList.add('open');
    return e;
  }

  function showLoading() {
    clearStatus();
    if (loadingEl) return;
    loadingEl = document.createElement('div');
    loadingEl.className = 'e ai pai-loading';
    loadingEl.innerHTML = '<div class="pai-spinner"></div><span>AI thinking...</span>';
    log.appendChild(loadingEl);
    body.scrollTop = body.scrollHeight;
    panel.classList.add('open');
  }

  function hideLoading() {
    if (loadingEl) { loadingEl.remove(); loadingEl = null; }
  }

  clrBtn.onclick = () => { log.innerHTML = ''; };

  rldBtn.onclick = () => {
    if (running) { logMsg('error', 'Cannot re-scan while running'); return; }
    log.innerHTML = '';
    const u = window.location.href;
    const newMode = u.includes('/knowledgeCheck/') ? 'KNOWLEDGE_CHECK'
                  : u.includes('/videos/')          ? 'VIDEOS'
                  : u.includes('/questions')        ? 'ASSESSMENT'
                  : u.includes('/assessment/')      ? 'ASSESSMENT'
                  : u.includes('/journey/')         ? 'JOURNEY'
                  : u.match(/\/courses\/[^/]+\/?$/) ? 'COURSE_TOC'
                  :                                   'UNKNOWN';
    const newCourseId = u.match(/\/courses\/([^/]+)/)?.[1] || '';
    const newAssId = u.match(/knowledgeCheck\/([^/]+)/)?.[1] || '';
    Object.assign(globalState, { MODE: newMode, courseId: newCourseId, assessmentId: newAssId });
    modeBadge.textContent = newMode === 'KNOWLEDGE_CHECK' ? 'KC'
                          : newMode === 'VIDEOS' ? 'VID'
                          : newMode === 'ASSESSMENT' ? 'EXAM'
                          : newMode === 'JOURNEY' ? 'PATH'
                          : '?';
    setRunning(false);
    if (newMode === 'UNKNOWN') logMsg('error', 'Not on a supported page.');
  };

  /* ── Panel toggle ── */
  document.getElementById('pai-toggle-btn').onclick = () => {
    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open');
    if (opening) startDonut();
    else cancelAnimationFrame(donutAnimId);
  };

  /* ── Config ── */
  cfgBtn.onclick = () => {
    cfgPanel.classList.toggle('open');
    if (cfgPanel.classList.contains('open')) {
      keyInput.value = config.apiKey;
      urlInput.value = config.apiUrl;
      modelInput.value = config.model;
      visionKeyInput.value = config.visionKey;
      visionModelInput.value = config.visionModel;
      visionUrlInput.value = config.visionUrl;
    }
  };

  /* ── Theme toggle ── */
  themeBtn.onclick = async e => {
    e.stopPropagation();
    const dark = panel.classList.toggle('pai-dark');
    themeBtn.innerHTML = dark ? '&#127769;' : '&#127774;';
    config.theme = dark ? 'dark' : 'light';
    await saveConfig({ theme: config.theme });
  };

  saveCfg.onclick = async () => {
    config.apiKey = keyInput.value.trim();
    config.apiUrl = urlInput.value.trim();
    config.model = modelInput.value.trim();
    config.visionKey = visionKeyInput.value.trim();
    config.visionModel = visionModelInput.value.trim();
    config.visionUrl = visionUrlInput.value.trim();
    await saveConfig({ apiKey: config.apiKey, apiUrl: config.apiUrl, model: config.model, visionKey: config.visionKey, visionModel: config.visionModel, visionUrl: config.visionUrl });
    cfgStatus.textContent = 'Saved!';
    setTimeout(() => { cfgStatus.textContent = ''; }, 2000);
  };

  function setRunning(state) {
    running = state;
    if (globalState.MODE === 'ASSESSMENT') {
      btn.classList.add('pai-golden-btn');
      btn.innerHTML = state
        ? '<img src="https://img.icons8.com/ios-glyphs/24/pause.png" width="20" height="20" alt="⏸" style="display:block"><span>STOP SOLVER</span>'
        : '<img src="https://img.icons8.com/ios-glyphs/24/crown.png" width="22" height="22" alt="👑" style="display:block"><span>START</span>';
    } else {
      btn.classList.remove('pai-golden-btn');
      btn.innerHTML = state
        ? '<img src="https://img.icons8.com/ios-glyphs/24/pause.png" width="20" height="20" alt="⏸" style="filter:invert(1);display:block"><span>STOP AUTOMATION</span>'
        : '<img src="https://img.icons8.com/ios-glyphs/24/play--v1.png" width="20" height="20" alt="▶" style="filter:invert(1);display:block"><span>START AUTOMATION</span>';
    }
    dot.className = state ? 'pai-dot' : 'pai-dot off';
    body.style.background = state ? 'var(--bg3)' : 'var(--bg)';
    if (state) { cancelAnimationFrame(donutAnimId); }
    else { startDonut(); }
  }

  /* ════════════════════════════════════════════
     MODE: KNOWLEDGE CHECK  (mini-exam.js)
     ════════════════════════════════════════════ */
  async function getCorrectIds(token) {
    const q = `query LPKnowledgeCheck($id: ID!, $isInteractiveKC: Boolean = false) {
      knowledgeCheck(assessmentId: $id) {
        id:uuid licensed practiceQuestions {
          id:uuid questionType stem backgroundText
          images{id:uuid altText contentType fileName url __typename}
          choices{id:uuid text practiceFeedback __typename}
          options{id:uuid text __typename} responseType
          interactiveLaunchUrl @include(if:$isInteractiveKC) __typename
        } title __typename
      }
    }`;
    const resp = await fetch('https://ofppt.percipio.com/api/graphql3?query=LPKnowledgeCheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify([{ operationName: 'LPKnowledgeCheck', variables: { id: globalState.assessmentId, isInteractiveKC: false }, query: q }]),
    });
    const data = await resp.json();
    const kc = (Array.isArray(data) ? data[0].data : data.data).knowledgeCheck;
    const correct = new Set();
    for (const q of kc.practiceQuestions) {
      for (const c of q.choices) {
        const fb = c.practiceFeedback || '';
        if ((/correct/i.test(fb) && !/incorrect/i.test(fb)) || (/صحيح/i.test(fb) && !/غير/i.test(fb))) correct.add(c.id);
      }
    }
    return correct;
  }

  function readKCChoices() {
    return $$('li[class*="MultipleChoice"]').map(li => {
      const input = li.querySelector('input[type="radio"], input[type="checkbox"]');
      const textEl = li.querySelector('[class*="choiceText"]');
      return { id: input?.id, input, text: textEl?.innerText?.replace(/^[A-Z]\.\s*|إجابة\s*[A-Z]\.\s*/g, '').trim() };
    }).filter(c => c.id);
  }

  function clickBtn(marker) {
    const b = $(`[data-marker="${marker}"]`);
    if (b) { b.click(); return true; }
    return false;
  }

  async function runKnowledgeCheck() {
    const token = localStorage.getItem('id_token');
    if (!token) { logMsg('error', 'No auth token found. Refresh the page.'); return; }

    setStatus('hack', '🔥 INITIALIZING KNOWLEDGE CHECK...');
    setStatus('api', '📡 Fetching correct answers...');

    let correctIds;
    try { correctIds = await getCorrectIds(token); }
    catch (err) { logMsg('error', `API error: ${err.message}`); return; }

    setStatus('api', `📡 Found ${correctIds.size} correct IDs`);
    if (!correctIds.size) { logMsg('error', 'No correct answers found in API response'); return; }

    let answered = 0;

    setStatus('info', `▶ Starting knowledge check...`);

    while (running && answered < 50) {
      dismissExitModal();
      await sleep(800);
      const choices = readKCChoices();
      if (!choices.length) { logMsg('error', 'No choices visible — waiting...'); await sleep(2000); continue; }

      const correct = choices.filter(c => correctIds.has(c.id));
      if (!correct.length) {
        logMsg('error', 'No matching answers on this question — skipping...');
        clickBtn('LP.assessments.verify');
        await sleep(1000);
        continue;
      }

      for (const c of correct) {
        if (!c.input.checked) { c.input.click(); await sleep(100); }
      }
      setStatus('correct', `✅ ${answered + 1}`);

      await sleep(200);
      clickBtn('LP.assessments.verify');
      setStatus('info', '📤 Verifying...');
      await sleep(1500);

      let next = false;
      for (const d of [0, 1500]) {
        if (d) await sleep(d);
        if (clickBtn('LP.assessments.next')) { next = true; break; }
      }
      if (!next) {
        if (clickBtn('LP.assessments.finish')) {
          logMsg('summary', `Done: ${answered + 1} question(s)`);
        }
        break;
      }
      answered++;
      setStatus('info', `➡ ${answered + 1}`);
      await sleep(1200);
    }
    if (answered >= 50) logMsg('summary', `Stopped at ${answered} (safety limit)`);
  }

  /* ════════════════════════════════════════════
     MODE: VIDEOS  (vidoes_files.js)
     ════════════════════════════════════════════ */
  async function runVideoMark() {
    const token = localStorage.getItem('id_token');
    if (!token) { logMsg('error', 'No auth token found. Refresh the page.'); return; }
    if (!globalState.courseId) { logMsg('error', 'Not on a course page'); return; }

    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://ofppt.percipio.com', 'user-agent': navigator.userAgent };

    setStatus('hack', '🔥 INITIALIZING VIDEO MARKER...');

    /* 1. Scan DOM TOC */
    const seen = new Set();
    const items = [];
    const list = $('[class*="ContentItemList"]');
    if (list) {
      list.querySelectorAll('li[class*="ContentItem"]').forEach(li => {
        const link = li.querySelector('a');
        if (!link) return;
        const m = link.href.match(/\/courses\/[^/]+\/videos\/([a-f0-9-]{36})/);
        if (!m || m[1] === globalState.courseId) return;
        const isResource = li.innerHTML.includes('ملف مضغوط') || li.innerHTML.includes('Compressed') || li.innerHTML.includes('ZIP');
        const uuid = m[1];
        if (!seen.has(uuid)) {
          seen.add(uuid);
          items.push({ uuid, type: isResource ? 'RESOURCE' : 'VIDEO' });
        }
      });
    }

    /* 2. Query course API for extra resources (exercise files tied to videos) */
    try {
      const courseQ = `query courseQueryWithBadging($uuid: String!) {
        ffb_courseWithLT(uuid: $uuid) {
          ... on FFB_Course {
            courseItems {
              ... on FFB_Video { id:uuid resourceUuids __typename }
              ... on FFB_ContentResourceType { id:uuid __typename }
              __typename
            }
            __typename
          }
          __typename
        }
      }`;
      const courseResp = await fetch('https://ofppt.percipio.com/api/graphql2?query=courseQueryWithBadging', {
        method: 'POST', headers,
        body: JSON.stringify([{ operationName: 'courseQueryWithBadging', variables: { uuid: globalState.courseId }, query: courseQ }]),
      });
      const courseData = await courseResp.json();
      const course = (Array.isArray(courseData) ? courseData[0].data : courseData.data).ffb_courseWithLT;
      if (course?.courseItems) {
        for (const ci of course.courseItems) {
          if (ci.__typename === 'FFB_Video') {
            if (!seen.has(ci.id)) {
              seen.add(ci.id);
              items.push({ uuid: ci.id, type: 'VIDEO' });
            }
            for (const ruuid of ci.resourceUuids || []) {
              if (!seen.has(ruuid)) {
                seen.add(ruuid);
                items.push({ uuid: ruuid, type: 'RESOURCE' });
              }
            }
          }
          if (ci.__typename === 'FFB_ContentResourceType') {
            if (!seen.has(ci.id)) {
              seen.add(ci.id);
              items.push({ uuid: ci.id, type: 'RESOURCE' });
            }
          }
        }
      }
    } catch (err) {
      logMsg('error', `API course fetch failed (continuing with DOM items): ${err.message}`);
    }

    if (!items.length) { logMsg('error', 'No videos/resources found'); return; }

    setStatus('api', `📡 Found ${items.length} items (${items.filter(i => i.type === 'VIDEO').length} videos, ${items.filter(i => i.type === 'RESOURCE').length} resources)`);

    let ok = 0, fail = 0, done = 0;
    for (const item of items) {
      if (!running) { logMsg('error', 'Stopped by user'); break; }
      setStatus('progress', `⏳ ${done + 1}/${items.length} ${item.type}`);
      logMsg('info', `⏳ Progress: ${done + 1}/${items.length} (${item.type} ${item.uuid.substring(0,8)}...)`);

      if (item.type === 'RESOURCE') {
        const r = await fetch('https://ofppt.percipio.com/api/graphql3?query=mutation:upsertContentResourceConsumption', {
          method: 'POST', headers,
          body: JSON.stringify([{ operationName: 'upsertContentResourceConsumption', variables: { input: { contentId: item.uuid, parentId: globalState.courseId, instanceNumber: 1 } }, query: 'mutation upsertContentResourceConsumption($input: ContentResourceConsumptionInput) { upsertContentResourceConsumption(input: $input) { id orgId userId contentId parentId __typename } }' }]),
        });
        if (r.ok) { ok++; logMsg('info', `✅ Completed resource: ${item.uuid.substring(0,8)}...`); }
        else { fail++; logMsg('error', `❌ Failed resource: ${item.uuid.substring(0,8)}...`); }
        setStatus(r.ok ? 'correct' : 'error', `${r.ok ? '✅' : '❌'} ${done + 1}/${items.length}`);
        await sleep(100);
      } else {
        const sid = crypto.randomUUID();
        const cc = { uuid: item.uuid, type: 'VIDEO', parentUuid: globalState.courseId };
        const r1 = await fetch('https://ofppt.percipio.com/api/graphql2?query=mutation:contentLaunchEvent', {
          method: 'POST', headers,
          body: JSON.stringify([{ operationName: 'contentLaunchEvent', variables: { contentContext: cc, eventContext: { action: 'ARRIVED', sessionId: sid, viewParams: [{ paramName: 'COURSE_TOC', paramValue: globalState.courseId }], fromWithinView: 'COURSE_TOC', source: null, applicationType: 'PERCIPIO_WEB', deviceType: 'DESKTOP', userAgent: navigator.userAgent, instanceNumber: 1 } }, query: 'mutation contentLaunchEvent($contentContext: BFF_contentContext!, $eventContext: BFF_launchEventContext!) { enrichmentLaunchEvent(contentContext: $contentContext, eventContext: $eventContext) { success validation __typename } }' }] ),
        });
        await sleep(80);
        const r2 = await fetch('https://ofppt.percipio.com/api/graphql2?query=mutation:contentConsumption', {
          method: 'POST', headers,
          body: JSON.stringify([{ operationName: 'contentConsumption', variables: { contentContext: cc, eventContext: { action: 'CONSUMED', sessionId: sid, playbackMultiplier: 1, sessionDurationSeconds: 9999, startPos: '0', endPos: '9999', positionType: 'SECONDS', instanceNumber: 1 }, sessionId: sid }, query: 'mutation contentConsumption($contentContext: BFF_contentContext!, $eventContext: BFF_eventContext!) { enrichmentConsumptionEvent(contentContext: $contentContext, eventContext: $eventContext) { success validation __typename } }' }] ),
        });
        if (r1.ok && r2.ok) { ok += 2; logMsg('info', `✅ Watched video: ${item.uuid.substring(0,8)}...`); }
        else { fail += 2; logMsg('error', `❌ Failed video: ${item.uuid.substring(0,8)}...`); }
        setStatus(r1.ok && r2.ok ? 'correct' : 'error', `${r1.ok && r2.ok ? '✅' : '❌'} ${done + 1}/${items.length}`);
        await sleep(80);
      }
      done++;
    }

    logMsg('summary', `Done: ${done}/${items.length} (${ok} OK, ${fail} FAIL)`);
  }

  /* ════════════════════════════════════════════
     MODE: ASSESSMENT  (original AI solver)
     ════════════════════════════════════════════ */

  function findBtn(texts) {
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]');
    for (const b of buttons) {
      if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
      const text = b.textContent.trim();
      for (const t of texts) {
        if (text === t || b.value === t) return b;
      }
    }
    return null;
  }

  function dismissExitModal() {
    const text = document.body.innerText || '';
    if (!text.includes('هل ترغب في الخروج من الاختبار الآن') && !text.includes('Are you sure you want to exit')) return false;
    logMsg('info', '⚠ Exit confirmation detected — dismissing');
    const cancelBtn = findBtn(['إلغاء', 'لا', 'عودة', 'رجوع', 'Cancel', 'No', 'Back', 'استئناف', 'Resume']);
    if (cancelBtn) { cancelBtn.click(); return true; }
    return false; // Never click confirm!
  }

  function getActiveInputs(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(el => {
      let curr = el;
      while (curr && curr !== document.body) {
        const style = window.getComputedStyle(curr);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        curr = curr.parentElement;
      }
      return true;
    });
  }

  function isMatchingQuestion() {
    const radios = getActiveInputs('input[type="radio"]');
    const names = new Set(radios.map(r => r.name));
    return radios.length > 0 && names.size > 1;
  }

  function extractQuestion() {
    const radios = getActiveInputs('input[type="radio"]');
    const checkboxes = getActiveInputs('input[type="checkbox"]');
    const hasMove = document.querySelector('[data-marker="moveUp"], [data-marker="moveDown"]') !== null;
    
    const bodyText = document.body.innerText;
    const numMatch = bodyText.match(/السؤال (\d+) من (\d+)/);
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    const total = numMatch ? parseInt(numMatch[2]) : 0;
    const qLabel = document.querySelector('[class*="LabeledMessage"]');
    let questionText = '';
    if (qLabel) {
      const textDiv = qLabel.querySelector(':scope > div:last-child');
      if (textDiv) questionText = textDiv.textContent.trim();
    }
    if (!questionText) {
      const stemMatch = bodyText.match(/السؤال\s*:\s*(.+?)(?:\n|التعليمات|$)/);
      if (stemMatch) questionText = stemMatch[1].trim();
    }
    const hasImage = Array.from(document.querySelectorAll('img')).some(i => {
      if (i.closest('#pai-panel') || i.closest('#pai-root')) return false;
      const src = i.src || '';
      const className = i.className || '';
      if (className.includes('Logo') || src.includes('Logo') || src.includes('powered-skillsoft')) return false;
      if (src.includes('appleAppStore') || src.includes('GooglePlayStore') || src.includes('icons8.com')) return false;
      return i.offsetWidth > 0 && i.offsetHeight > 0;
    });

    if (hasMove) {
      // Reordering question
      const seenTexts = new Set();
      const choices = [];
      const layouts = document.querySelectorAll('[class*="choiceLayout"], [class*="ChoiceLayout"]');
      layouts.forEach(l => {
        const textEl = l.querySelector('.Choice---choiceText---tpnwf');
        if (!textEl) return;
        const textVal = textEl.textContent.trim();
        if (seenTexts.has(textVal)) return;
        seenTexts.add(textVal);

        const labelSpan = l.querySelector('.common---choiceLabel---DrtIN');
        const label = labelSpan ? labelSpan.textContent.trim() : '';
        const letterMatch = label.match(/^\s*([A-Za-z])\./);
        const letter = letterMatch ? letterMatch[1].toUpperCase() : 'ABCDEFGH'[choices.length];
        const cleaned = textVal.replace(/^[A-Za-z]\.\s*إجابة\s*[A-Za-z]\.\s*/, '').trim();

        choices.push({
          letter,
          text: cleaned,
          el: l
        });
      });
      return { number, total, text: questionText, choices, hasImage, ordering: true };
    }

    const inputs = radios.length ? radios : checkboxes;
    if (!inputs.length) return null;
    const matching = isMatchingQuestion();
    const multiSelect = matching ? false : (radios.length === 0 && checkboxes.length > 0);

    if (matching) {
      const names = [...new Set(radios.map(r => r.name))];
      const groups = names.map(name => {
        const firstInput = document.querySelector(`input[name="${name}"]`);
        const legend = firstInput?.closest('fieldset')?.querySelector('legend');
        const label = legend?.textContent?.trim() || '';
        return { label, name };
      });
      const firstGroup = document.querySelectorAll(`input[name="${names[0]}"]`);
      const options = Array.from(firstGroup).map(r => {
        const labelSpan = document.getElementById(`label-for-choice-${r.name}-${r.value}`);
        const fullText = labelSpan?.textContent?.trim() || '';
        const letterMatch = fullText.match(/^\s*([A-Za-z])\./);
        const letter = letterMatch ? letterMatch[1].toUpperCase() : 'A';
        const text = fullText.replace(/^[A-Za-z]\.\s*إجابة\s*[A-Za-z]\.\s*/, '') || '';
        return { letter, value: r.value, text };
      });
      return { number, total, text: questionText, hasImage, multiSelect, matching, groups, options };
    }

    const choices = Array.from(inputs).map((r, i) => {
      const label = r.parentElement?.textContent?.trim() || '';
      const letterMatch = label.match(/^\s*([A-Za-z])\./);
      const letter = letterMatch ? letterMatch[1].toUpperCase() : 'ABCDEFGH'[i];
      const cleaned = label.replace(/^[A-Za-z]\.\s*إجابة\s*[A-Za-z]\.\s*/, '').trim();
      return { letter, text: cleaned || label, id: r.id };
    });
    return { number, total, text: questionText, choices, hasImage, multiSelect };
  }

  function extractLetter(text, valid = ['A','B','C','D']) {
    const cleaned = text.trim().toUpperCase();
    const pattern = new RegExp(`\\b([${valid.join('')}])\\b`);
    const m = cleaned.match(pattern);
    if (m) return m[1];
    const fallback = cleaned.replace(new RegExp(`[^${valid.join('')}]`, 'g'), '');
    return fallback ? fallback[0] : '';
  }

  function extractLetters(text, valid = ['A','B','C','D']) {
    const cleaned = text.trim().toUpperCase();
    const pattern = new RegExp(`\\b([${valid.join('')}])\\b`, 'g');
    return [...cleaned.matchAll(pattern)].map(m => m[1]);
  }

  async function extractQuestionImage() {
    // Filter out header logos, app store icons, and our own panel icons
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => {
      if (i.closest('#pai-panel') || i.closest('#pai-root')) return false;
      const src = i.src || '';
      const className = i.className || '';
      if (className.includes('Logo') || src.includes('Logo') || src.includes('powered-skillsoft')) return false;
      if (src.includes('appleAppStore') || src.includes('GooglePlayStore') || src.includes('icons8.com')) return false;
      // Must be visible
      if (i.offsetWidth === 0 && i.offsetHeight === 0) return false;
      return true;
    });
    const img = imgs[0];
    if (!img) return null;
    try {
      const resp = await fetch(img.src);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      logMsg('error', `Failed to load image: ${e.message}`);
      return null;
    }
  }

  async function askAI(question, retries = 2) {
    const contextStr = document.title ? `Context: ${document.title}. ` : '';
    const valid = question.matching ? question.options.map(c => c.letter) : question.choices.map(c => c.letter);
    if (question.matching) {
      const valid = question.options.map(c => c.letter);
      if (question.hasImage) {
        const imgData = await extractQuestionImage();
        if (imgData) {
          const groupsStr = question.groups.map((g, i) => `${i + 1}. ${g.label}`).join('\n');
          const optionsStr = question.options.map(c => `${c.letter}. ${c.text}`).join('\n');
          const text = question.text + '\n\nItems to match:\n' + groupsStr + '\n\nOptions:\n' + optionsStr;
          for (let attempt = 0; attempt <= retries; attempt++) {
            showLoading();
            const resp = await sendMsg({ type: 'ASK_VISION_AI', text, image: imgData });
            hideLoading();
              if (resp && resp.answer) {
                logMsg('ai', `👁️ Vision: ${resp.answer.replace(/\\n/g, ' ').substring(0, 150)}...`);
                const ansText = resp.answer.includes('FINAL_ANSWER:') ? resp.answer.split('FINAL_ANSWER:')[1] : resp.answer;
                const parts = ansText.split(',').map(s => s.trim().toUpperCase().replace(/[^A-D]/g, '')).filter(Boolean);
                if (parts.length === question.groups.length) return parts.join(',');
              }
            }
          }
        const mapping = question.groups.map(g => `${g.label}=${valid[Math.floor(Math.random() * valid.length)]}`).join(', ');
        logMsg('ai', `🖼️ Image matching — guessing ${mapping}`);
        return mapping;
      }
      const groupsStr = question.groups.map((g, i) => `${i + 1}. ${g.label}`).join('\n');
      const optionsStr = question.options.map(c => `${c.letter}. ${c.text}`).join('\n');
      const userPrompt = question.text + '\n\nItems to match:\n' + groupsStr + '\n\nOptions:\n' + optionsStr;
      const count = question.groups.length;
      const systemPrompt = `You are a certified IT/business expert. ${contextStr}MATCHING question with ${count} items. Each option letter used ONCE. Briefly explain your reasoning (1-2 sentences). Then end with exactly: FINAL_ANSWER: B,C,A`;
      for (let attempt = 0; attempt <= retries; attempt++) {
        showLoading();
        const resp = await sendMsg({
          type: 'ASK_AI',
          messages: [{
            role: 'system', content: systemPrompt
          }, {
            role: 'user', content: userPrompt
          }]
        });
        hideLoading();
        if (resp && resp.answer) {
          logMsg('ai', `🧠 ${resp.answer.replace(/\\n/g, ' ').substring(0, 150)}...`);
          const ansText = resp.answer.includes('FINAL_ANSWER:') ? resp.answer.split('FINAL_ANSWER:')[1] : resp.answer;
          const parts = extractLetters(ansText, valid);
          if (parts.length === question.groups.length) {
            return parts.join(',');
          }
          logMsg('error', `AI bad matching format (got ${parts.length} letters, need ${question.groups.length}), retry ${attempt + 1}/${retries}`);
        }
      }
      return question.groups.map(() => valid[Math.floor(Math.random() * valid.length)]).join(',');
    }

    if (question.hasImage) {
      const imgData = await extractQuestionImage();
      if (imgData) {
        const text = question.text + '\n\n' + question.choices.map(c => `${c.letter}. ${c.text}`).join('\n');
        for (let attempt = 0; attempt <= retries; attempt++) {
          showLoading();
          const resp = await sendMsg({ type: 'ASK_VISION_AI', text, image: imgData });
          hideLoading();
          if (resp && resp.answer) {
            logMsg('ai', `👁️ Vision: ${resp.answer.replace(/\\n/g, ' ').substring(0, 150)}...`);
            const ansText = resp.answer.includes('FINAL_ANSWER:') ? resp.answer.split('FINAL_ANSWER:')[1] : resp.answer;
            const letters = extractLetters(ansText, valid);
            if (letters.length) {
              if (question.multiSelect) {
                return [...new Set(letters)].join(',');
              } else {
                return letters[0];
              }
            }
          }
          }
        }
      if (question.multiSelect) {
        const count = Math.min(2, valid.length);
        const shuffled = [...valid].sort(() => Math.random() - 0.5).slice(0, count);
        logMsg('ai', `🖼️ Image multi-select — guessing ${shuffled.join(',')}`);
        return shuffled.join(',');
      }
      const random = valid[Math.floor(Math.random() * valid.length)];
      logMsg('ai', `🖼️ Image question — guessing ${random}`);
      return random;
    }
    const userPrompt = question.text + '\n\n' + question.choices.map(c => `${c.letter}. ${c.text}`).join('\n');
    
    // Dynamically build the reference guide based on the active course title
    let appGuide = "";
    const titleLower = (document.title || "").toLowerCase();
    const isPpt = titleLower.includes('powerpoint') || titleLower.includes('باوربوينت') || titleLower.includes('شرائح');
    const isExcel = titleLower.includes('excel') || titleLower.includes('إكسل');
    const isWord = titleLower.includes('word') || titleLower.includes('ورد') || titleLower.includes('مستند');

    if (isPpt) {
      appGuide = "PowerPoint 365 Reference Guide:\n" +
        "- Draw tab: Draw with digital pen, convert Ink to Text, convert Ink to Shape.\n" +
        "- Design tab: Slide Size (Standard 4:3, Widescreen 16:9), Customize theme/variants/font combinations, Designer tool (automated layout suggestions).\n" +
        "- Format shape: Shape Fill, Shape Outline, custom colors.\n" +
        "- Font Color dropdown -> More Colors -> Custom tab -> input hex/RGB to define custom colors.\n" +
        "- Ruler shortcut: Alt+Shift+F9 or Ctrl+R or View -> Ruler checkbox.\n" +
        "- WordArt: Insert tab -> WordArt gallery -> select preset -> type text.\n\n";
    } else if (isExcel) {
      appGuide = "Excel 365 Reference Guide:\n" +
        "- Workbook Protection: Review -> Protect Workbook (prevents restructuring like adding/deleting/moving sheets).\n" +
        "- Sheet Protection: Review -> Protect Sheet (prevents modifying cells, content, or formatting inside a specific sheet).\n" +
        "- Print settings: Page Layout tab allows setting Print Area, Print Titles (repeat header rows), margins, orientation, and scaling without opening dialogs.\n" +
        "- Formulas & View: Freeze Panes (keeps rows visible), Page Break Preview (adjusts print pages).\n\n";
    } else if (isWord) {
      appGuide = "Word 365 Reference Guide:\n" +
        "- Layout setup: Page Setup group in Layout tab (Margins, Orientation, Size, Columns).\n" +
        "- Navigation: Section Breaks (applies different formatting to parts of document) vs Page Breaks.\n" +
        "- Styles: Home -> Styles gallery (Heading 1, Heading 2, Title) for clean navigation pane mapping.\n\n";
    }

    const systemPrompt = question.ordering
      ? `You are a certified Microsoft Office expert. ${contextStr}${appGuide}Order the items correctly. Briefly explain your reasoning (1-2 sentences). Then end with exactly: FINAL_ANSWER: B,C,A,D`
      : question.multiSelect
      ? `You are a certified Microsoft Office expert. ${contextStr}${appGuide}Briefly explain your reasoning (1-2 sentences max). Then end with exactly: FINAL_ANSWER: A,D`
      : `You are a certified Microsoft Office expert. ${contextStr}${appGuide}Briefly explain your reasoning (1-2 sentences max). Then end with exactly: FINAL_ANSWER: X (where X is from ${valid.join(', ')})`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      showLoading();
      const resp = await sendMsg({
        type: 'ASK_AI',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      hideLoading();
      if (resp.error) { logMsg('error', `${resp.error}`); continue; }
      logMsg('ai', `🧠 ${resp.answer.replace(/\\n/g, ' ').substring(0, 150)}...`);
      const ansText = resp.answer.includes('FINAL_ANSWER:') ? resp.answer.split('FINAL_ANSWER:')[1] : resp.answer;
      if (question.ordering) {
        const letters = extractLetters(ansText || '', valid);
        if (letters.length === valid.length) return letters.join(',');
      } else if (question.multiSelect) {
        const letters = extractLetters(ansText || '');
        const validLetters = letters.filter(l => valid.includes(l));
        if (validLetters.length) return validLetters.join(',');
      } else {
        const answer = extractLetter(ansText || '', valid);
        if (answer && valid.includes(answer)) return answer;
      }
      logMsg('error', `AI invalid output — retrying...`);
    }
    if (question.multiSelect) {
      const count = Math.min(2, valid.length);
      const shuffled = [...valid].sort(() => Math.random() - 0.5).slice(0, count);
      logMsg('error', `AI exhausted — random fallback ${shuffled.join(',')}`);
      return shuffled.join(',');
    }
    const fallback = valid[Math.floor(Math.random() * valid.length)];
    logMsg('error', `AI exhausted — random fallback ${fallback}`);
    return fallback;
  }

  async function waitForQuestion(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      const hasMove = document.querySelector('[data-marker="moveUp"], [data-marker="moveDown"]') !== null;
      if (inputs.length || hasMove) return true;
      await sleep(300);
    }
    return false;
  }

  async function waitForResult(timeout = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const text = document.body.innerText;
      if (text.includes('النتيجة:') || text.includes('Result:') || /صحيح|خطأ|صحيحة|خاطئة|correct|incorrect/i.test(text)) {
        if (/صحيح|correct|صحيحة/i.test(text) && !/غير صحيح|incorrect|خاطئة|خطأ/i.test(text)) return 'correct';
        if (/خطأ|incorrect|خاطئة|غير صحيح/i.test(text)) return 'wrong';
        return 'unknown';
      }
      await sleep(200);
    }
    return 'timeout';
  }

  function isAlreadyAnswered() {
    const text = document.body.innerText;
    const hasNext = findBtn(['السؤال التالي', 'التالي', 'التالي السؤال', 'Next', 'Continue', 'متابعة']) !== null;
    return hasNext || text.includes('النتيجة:') || text.includes('Result:');
  }

  function parseOrder(altText) {
    if (!altText) return 999;
    const text = altText.toLowerCase();
    if (text.includes('أولى') || text.includes('اولى') || text.includes('أول') || text.includes('اول') || text.includes('first') || text.includes('1st') || text.includes('1')) return 1;
    if (text.includes('ثانية') || text.includes('ثانيه') || text.includes('ثاني') || text.includes('second') || text.includes('2nd') || text.includes('2')) return 2;
    if (text.includes('ثالثة') || text.includes('ثالثه') || text.includes('ثالث') || text.includes('third') || text.includes('3rd') || text.includes('3')) return 3;
    if (text.includes('رابعة') || text.includes('رابعه') || text.includes('رابع') || text.includes('fourth') || text.includes('4th') || text.includes('4')) return 4;
    if (text.includes('خامسة') || text.includes('خامسه') || text.includes('خامس') || text.includes('fifth') || text.includes('5th') || text.includes('5')) return 5;
    if (text.includes('سادسة') || text.includes('سادسه') || text.includes('سادس') || text.includes('sixth') || text.includes('6th') || text.includes('6')) return 6;
    if (text.includes('سابعة') || text.includes('سابعه') || text.includes('سابع') || text.includes('seventh') || text.includes('7th') || text.includes('7')) return 7;
    return 999;
  }

  async function getMagicAnswer(q) {
    const token = localStorage.getItem('id_token');
    const u = window.location.href;
    const challengeId = u.match(/challenge\/([^/]+)/)?.[1];
    const qPos = q.number - 1;

    let questionUuid = '';
    try {
      const activeQQuery = `query activeChallenge($uuid: ID!) {
        activeChallenge(assessmentId: $uuid) {
          questions: challengeQuestions {
            questionUuid: ucsQuestionUuid
            position
          }
        }
      }`;
      const activeQResp = await fetch('https://ofppt.percipio.com/api/graphql3?query=activeChallenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify([{ operationName: 'activeChallenge', variables: { uuid: u.match(/assessment\/([^/]+)/)?.[1] }, query: activeQQuery }])
      });
      const activeQData = await activeQResp.json();
      const activeQ = (Array.isArray(activeQData) ? activeQData[0].data : activeQData.data).activeChallenge.questions;
      const activeQuestion = activeQ.find(aq => aq.position === qPos);
      if (activeQuestion) {
        questionUuid = activeQuestion.questionUuid;
      }
    } catch (err) {
      console.error('Failed to map question position to UUID:', err);
    }

    let database = {};
    try {
      database = JSON.parse(localStorage.getItem('percipio_answers') || '{}');
    } catch (e) {}

    if (questionUuid && database[questionUuid]) {
      const correctUuids = database[questionUuid];
      const correctLetters = q.choices
        .filter(c => correctUuids.includes(c.id))
        .map(c => c.letter);
      if (correctLetters.length) {
        return correctLetters.join(',');
      }
    }

    if (q.ordering) {
      try {
        const activeQQuery = `query activeChallenge($uuid: ID!) {
          activeChallenge(assessmentId: $uuid) {
            questions: challengeQuestions {
              questionUuid: ucsQuestionUuid
              position
            }
          }
        }`;
        const activeQResp = await fetch('https://ofppt.percipio.com/api/graphql3?query=activeChallenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify([{ operationName: 'activeChallenge', variables: { uuid: u.match(/assessment\/([^/]+)/)?.[1] }, query: activeQQuery }])
        });
        const activeQData = await activeQResp.json();
        const activeQ = (Array.isArray(activeQData) ? activeQData[0].data : activeQData.data).activeChallenge.questions;
        const activeQuestion = activeQ.find(aq => aq.position === qPos);
        if (activeQuestion) {
          const locQ = `query getQuestionLocalizations($body: JSON) {
            getQuestionLocalizations(body: $body)
          }`;
          const locResp = await fetch('https://ofppt.percipio.com/api/graphql3?query=getQuestionLocalizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify([{
              operationName: 'getQuestionLocalizations',
              variables: { body: { questionUuids: [activeQuestion.questionUuid], locale: 'arb' } },
              query: locQ
            }])
          });
          const locData = await locResp.json();
          const loc = (Array.isArray(locData) ? locData[0].data : locData.data).getQuestionLocalizations[0];
          
          if (loc && loc.answers) {
            const sorted = [...loc.answers].sort((a, b) => parseOrder(a.altText) - parseOrder(b.altText));
            const sortedUuids = sorted.map(a => a.uuid);
            
            const orderedLetters = [];
            for (const uuid of sortedUuids) {
              const matchedChoiceInUI = q.choices.find(c => {
                const locAns = loc.answers.find(la => la.uuid === uuid);
                if (!locAns) return false;
                const cleanUiText = c.text.toLowerCase().replace(/\s/g, '');
                const cleanLocText = locAns.text.toLowerCase().replace(/\s/g, '');
                return cleanUiText.includes(cleanLocText) || cleanLocText.includes(cleanUiText);
              });
              if (matchedChoiceInUI) {
                orderedLetters.push(matchedChoiceInUI.letter);
              }
            }
            if (orderedLetters.length === q.choices.length) {
              return orderedLetters.join(',');
            }
          }
        }
      } catch (err) {
        console.error('Ordering resolver error:', err);
      }
    }

    return q.choices[0]?.letter || 'A';
  }

  async function runAssessment() {
    clearScore();
    clearStatus();
    setStatus('hack', `🎯 ${document.title.substring(0, 60)}`);
    setStatus('info', '🚀 API-based assessment solver');

    const api = 'https://ofppt.percipio.com/api/graphql3';
    const token = localStorage.getItem('id_token');
    const h = {'authorization':`Bearer ${token}`,'content-type':'application/json','x-sksfront-features':'MultipleCompletions-Admin,LPDynamicContentRestart,NASBACPEExpiration,PageBuilderQ4,MyLearningRedesign'};
    const cid = window.location.href.match(/\/courses\/([^/]+)/)?.[1];
    const aid = window.location.href.match(/assessment\/([^/]+)/)?.[1];
    if (!cid || !aid) { logMsg('error', 'Cannot detect course/assessment IDs'); return; }

    const cache = JSON.parse(localStorage.getItem('percipio_answers') || '{}');
    let logEntries = [];

    // Discovery rounds until all questions cached
    for (let round = 0; round < 10; round++) {
      let r = await (await fetch(api+'?query=mutation:createChallenge',{method:'POST',headers:h,
        body:JSON.stringify([{operationName:'createChallenge',variables:{assessment:{assessmentId:aid,challengeType:'ASSESSMENT',courseId:cid,instanceNumber:1}},query:'mutation createChallenge($assessment:ChallengeInput!){createAssessmentChallenge(input:$assessment){id:uuid questions:challengeQuestions{id:uuid choiceIds:choiceUuids optionIds:optionUuids position questionType questionUuid:ucsQuestionUuid}}}'}])
      })).json();
      let d = (Array.isArray(r)?r[0].data:r.data)?.createAssessmentChallenge;
      if (!d) { logEntries.push('Round ' + round + ': createChallenge failed'); break; }
      const newQs = d.questions.filter(q => !cache[q.questionUuid]);
      if (!newQs.length) { logEntries.push('All cached!'); break; }
      
      setStatus('info', `🔍 Discovery round ${round + 1}: ${newQs.length} new`);
      for (const q of newQs) {
        const isMatch = q.questionType === 'matching';
        const isRank = q.questionType === 'ranking';
        let dummy;
        if (isMatch) {
          const m = {};
          q.choiceIds.forEach((c, i) => { m[c] = [q.optionIds[i % q.optionIds.length]]; });
          dummy = JSON.stringify(m);
        } else if (isRank) { dummy = JSON.stringify(q.choiceIds); }
        else { dummy = JSON.stringify([q.choiceIds[0]]); }

        await (await fetch(api+'?query=mutation:createChallengeSubmission',{method:'POST',headers:h,
          body:JSON.stringify([{operationName:'createChallengeSubmission',variables:{challengeId:d.id,questionPosition:q.position,answerParams:dummy},query:'mutation createChallengeSubmission($questionPosition:Int!,$challengeId:String!,$answerParams:String){createChallengeSubmission(input:{questionPosition:$questionPosition,challengeId:$challengeId,answerParams:$answerParams}){id:uuid}}'}])
        })).json();

        let g = await (await fetch(api+'?query=getSubmission',{method:'POST',headers:h,
          body:JSON.stringify([{operationName:'getSubmission',variables:{uuid:q.id},query:'query getSubmission($uuid:ID!){submission(challengeQuestionId:$uuid){correctedChoices{choiceUuid solution}}}'}])
        })).json();
        let sub = (Array.isArray(g)?g[0].data:g.data)?.submission;
        if (!sub) continue;

        let cc = sub.correctedChoices;
        if (isMatch) {
          const m = {};
          for (const x of cc) {
            let v;
            try { v = JSON.parse(x.solution); } catch (e) { v = [x.solution]; }
            m[x.choiceUuid] = Array.isArray(v) ? v : [v];
          }
          cache[q.questionUuid] = m;
        } else if (isRank) {
          cache[q.questionUuid] = [...cc].sort((a,b)=>+a.solution-+b.solution).map(x => x.choiceUuid);
        } else {
          cache[q.questionUuid] = cc.filter(x => x.solution === 'true').map(x => x.choiceUuid);
        }
      }
    }

    localStorage.setItem('percipio_answers', JSON.stringify(cache));

    // Final challenge with correct answers
    setStatus('info', '🎯 Submitting correct answers...');
    let r = await (await fetch(api+'?query=mutation:createChallenge',{method:'POST',headers:h,
      body:JSON.stringify([{operationName:'createChallenge',variables:{assessment:{assessmentId:aid,challengeType:'ASSESSMENT',courseId:cid,instanceNumber:1}},query:'mutation createChallenge($assessment:ChallengeInput!){createAssessmentChallenge(input:$assessment){id:uuid questions:challengeQuestions{id:uuid choiceIds:choiceUuids optionIds:optionUuids position questionType questionUuid:ucsQuestionUuid}}}'}])
    })).json();
    let d = (Array.isArray(r)?r[0].data:r.data).createAssessmentChallenge;

    let correct = 0;
    for (const q of d.questions) {
      const ans = cache[q.questionUuid];
      if (!ans) { logEntries.push('Q' + q.position + ': no cache'); continue; }
      const ansStr = typeof ans === 'string' ? ans : JSON.stringify(ans);
      r = await (await fetch(api+'?query=mutation:createChallengeSubmission',{method:'POST',headers:h,
        body:JSON.stringify([{operationName:'createChallengeSubmission',variables:{challengeId:d.id,questionPosition:q.position,answerParams:ansStr},query:'mutation createChallengeSubmission($questionPosition:Int!,$challengeId:String!,$answerParams:String){createChallengeSubmission(input:{questionPosition:$questionPosition,challengeId:$challengeId,answerParams:$answerParams}){score}}'}])
      })).json();
      const resp = (Array.isArray(r)?r[0]:r);
      if (resp.errors) { logEntries.push('Q' + q.position + ': ' + resp.errors[0].message); continue; }
      const s = resp.data.createChallengeSubmission.score;
      if (s >= 1) correct++;
      logEntries.push('Q' + q.position + ': score=' + s);
    }

    const total = d.questions.length;
    const pct = Math.round(correct / total * 100);
    logEntries.push('\n' + correct + '/' + total + ' (' + pct + '%)');
    for (const entry of logEntries) logMsg('api', entry);

    if (pct >= 80) {
      logMsg('summary', '✅ PASSED! Score: ' + pct + '%');
      sessionStorage.setItem('pai_solved_' + cid + '_' + aid, '1');
      setRunning(false);
      sessionStorage.setItem('pai_chain_active', '1');
      clickNextCourseLink();
      return;
    } else {
      logMsg('summary', '❌ FAILED! Score: ' + pct + '%');
    }
  }

  function clickAssessmentLink() {
    const links = document.querySelectorAll('a[href*="/assessment/"]');
    for (const link of links) {
      if (link.href.includes('/courses/') && link.href.includes('/assessment/')) {
        link.click();
        return true;
      }
    }
    return false;
  }

  /* ════════════════════════════════════════════
     MAIN TRIGGER
     ════════════════════════════════════════════ */
  btn.onclick = async () => {
    if (running) { setRunning(false); logMsg('error', 'Stopped by user'); return; }
    setRunning(true);

    try {
      if (globalState.MODE === 'KNOWLEDGE_CHECK') {
        await runKnowledgeCheck();
      } else if (globalState.MODE === 'VIDEOS') {
        await runVideoMark();
      } else if (globalState.MODE === 'ASSESSMENT') {
        await runAssessment();
      } else {
        logMsg('error', 'Not on a supported Percipio page.');
      }
    } catch (err) {
      logMsg('error', `${err.message}`);
    }

    if (globalState.MODE === 'VIDEOS' || globalState.MODE === 'KNOWLEDGE_CHECK') {
      if (clickAssessmentLink()) {
        logMsg('info', '➡ All content done! Clicked assessment link...');
        setRunning(false);
        return;
      }
    }

    setRunning(false);
    startDonut();
  };

  let autoStartTimer = null;
  function checkAutoStart() {
    if (running) return;
    if (autoStartTimer) return;
    autoStartTimer = setTimeout(() => {
      if (running) return;
      const u = window.location.href;
      const bodyText = document.body.innerText;
      if (bodyText.length < 30) { autoStartTimer = null; checkAutoStart(); return; }

      if (u.includes('/questions')) {
        btn.click();
      } else if (u.includes('/assessment/') && !u.includes('/result') && !u.includes('/questions')) {
        const aid = u.match(/assessment\/([^/]+)/)?.[1];
        const cid = u.match(/courses\/([^/]+)/)?.[1];
        if (!(aid && cid && sessionStorage.getItem('pai_solved_' + cid + '_' + aid))) {
          logMsg('info', '⚡ Running API assessment solver directly...');
          btn.click();
        }
      } else if ((u.includes('/videos/') || u.includes('/knowledgeCheck/') || u.match(/\/courses\/[^/]+\/?$/)) && sessionStorage.getItem('pai_chain_active')) {
        sessionStorage.removeItem('pai_chain_active');
        logMsg('info', '⚡ Chaining to next course automation...');
        btn.click();
      }
    }, 2500);
  }

  function clickNextCourseLink() {
    const links = document.querySelectorAll('nav[aria-label*="تقدم"] a, [class*="NavigationBar"] a');
    if (!links.length) return false;
    for (const link of links) {
      const aria = link.getAttribute('aria-label') || '';
      const href = link.href || '';
      if (aria.includes('التالي في المسار') && href.match(/\/courses\//) && !href.match(/\/(videos|assessment|knowledgeCheck)\//)) {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    return false;
  }

  /* ── Auto-show ── */
  function shouldShow() {
    const u = window.location.href;
    return u.includes('/questions') || u.includes('/knowledgeCheck/') || u.includes('/videos/') || u.includes('/assessment/') || u.includes('/journey/') || u.match(/\/courses\/[^/]+\/?$/);
  }

  if (shouldShow()) {
    setTimeout(() => {
      panel.classList.add('open');
      startDonut();
      checkAutoStart();
    }, 1500);
  }

  /* ── Observer & SPA navigation — auto re-scan ── */
  new MutationObserver(() => {
    checkAutoStart();
    if (running) return;
    if (!panel.classList.contains('open') && shouldShow()) {
      panel.classList.add('open');
      rldBtn.click();
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    if (running) return;
    autoStartTimer = null;
    if (shouldShow()) panel.classList.add('open');
    rldBtn.click();
  });

  /* Also re-scan on URL change (SPA pushState) */
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (running) return;
    const cur = location.href;
    if (cur !== lastUrl) {
      lastUrl = cur;
      autoStartTimer = null;
      rldBtn.click();
    }
  }).observe(document.querySelector('title') || document.documentElement, { childList: true, subtree: true, characterData: true });
})();
