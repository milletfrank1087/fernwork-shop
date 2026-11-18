// Headless-Chrome screenshot helper.
// Usage: node shot.js <url> <out.png> [width=1440] [height=900] [fullPage=0] [preScript=file.js] [waitMs=800] [mobile=0]
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [url, out, W = '1440', H = '900', FULL = '0', PRE = '', WAIT = '800', MOBILE = '0'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-shot-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const kill = () => { try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {} };
  try {
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { await sleep(250); } }
    if (!ok) throw new Error('chrome did not start');
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: MOBILE === '1' });
    if (MOBILE === '1') await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await send('Page.navigate', { url });
    await sleep(+WAIT + 700);
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>1)', awaitPromise: true });
    if (PRE) { const code = fs.readFileSync(PRE, 'utf8'); const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) console.log('preScript error:', JSON.stringify(r.exceptionDetails).slice(0, 300)); else if (r.result.value !== undefined) console.log('preScript ->', JSON.stringify(r.result.value).slice(0, 600)); await sleep(+WAIT); }
    let clip;
    if (FULL === '1') {
      const m = await send('Runtime.evaluate', { expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)', returnByValue: true });
      clip = { x: 0, y: 0, width: +W, height: Math.min(m.result.value, 16000), scale: 1 };
    }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL === '1', ...(clip ? { clip } : {}) });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('saved', out);
    ws.close();
  } finally { kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
