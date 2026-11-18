// Real-browser check of every page at 1440 and 390: JS exceptions, console errors, failed requests, broken images, overflow.
// Usage: node pagecheck.js [baseUrl]
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.argv[2] || process.env.BASE || 'http://localhost:3000';
const DIST = process.env.DIST || path.join(__dirname, '..', '..', 'dist');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const routes = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html') routes.push('/' + path.relative(DIST, path.dirname(p)).split(path.sep).join('/') + '/');
  }
})(DIST);
const pages = [...new Set(routes.map((r) => (r === '//' ? '/' : r)))].sort();

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pc-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const kill = () => { try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {} };
  try {
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { await sleep(250); } }
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pend = new Map(); let events = [];
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) events.push(m); });
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
    let problems = 0, total = 0;
    for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390 });
      for (const p of pages) {
        total++; events = [];
        await send('Page.navigate', { url: BASE + p });
        await sleep(450);
        await send('Runtime.evaluate', { expression: "document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager'); 1", returnByValue: true });
        await sleep(900);
        const r = await send('Runtime.evaluate', {
          expression: `(()=>{const imgs=[...document.images].filter(i=>i.getAttribute('src'));const bad=imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src'));const pending=imgs.filter(i=>!i.complete).length;return {bad,pending,overflow:document.documentElement.scrollWidth-innerWidth,imgs:imgs.length,h1:document.querySelectorAll('h1').length}})()`,
          returnByValue: true,
        });
        const v = r.result.value;
        const errs = [];
        for (const e of events) {
          if (e.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).split('\n')[0]);
          if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errs.push('console: ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
          if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) errs.push(`HTTP ${e.params.response.status}: ${e.params.response.url}`);
          if (e.method === 'Network.loadingFailed' && !e.params.canceled) errs.push('failed: ' + e.params.errorText);
        }
        if (v.bad.length) errs.push('broken images: ' + v.bad.join(', '));
        if (v.pending) errs.push(`${v.pending} images still loading`);
        if (v.overflow > 0) errs.push(`horizontal overflow ${v.overflow}px`);
        if (v.h1 !== 1) errs.push(`${v.h1} <h1> elements`);
        if (errs.length) { problems++; console.log(`FAIL ${width} ${p}\n   ` + [...new Set(errs)].join('\n   ')); }
      }
    }
    console.log(problems ? `\n${problems} of ${total} page checks had problems` : `\nAll ${total} page checks clean (${pages.length} pages x 2 widths): no JS errors, no failed requests, no broken images, no overflow, one h1 each`);
    ws.close();
    process.exitCode = problems ? 1 : 0;
  } finally { kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
