// Smoke test against the running dev server: every built page, plus routing edge cases.
const fs = require('fs');
const path = require('path');
const BASE = process.argv[2] || process.env.BASE || 'http://localhost:3000';
const DIST = process.env.DIST || path.join(__dirname, '..', '..', 'dist');

const routes = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html') routes.push('/' + path.relative(DIST, path.dirname(p)).split(path.sep).join('/') + '/');
  }
})(DIST);

(async () => {
  let bad = 0;
  const check = (ok, label, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${extra}`); };

  for (const r of routes.map((x) => (x === '//' ? '/' : x)).sort()) {
    const res = await fetch(BASE + r, { redirect: 'manual' });
    const html = await res.text();
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '(none)';
    check(res.status === 200 && /text\/html/.test(res.headers.get('content-type')) && title !== '(none)', `GET ${r}`, `-> ${res.status} "${title}"`);
  }

  let res = await fetch(BASE + '/products/zinc-watering-can', { redirect: 'manual' });
  check(res.status === 301 && /\/products\/zinc-watering-can\/$/.test(res.headers.get('location') || ''), 'redirect: missing trailing slash', `-> ${res.status} ${res.headers.get('location')}`);

  res = await fetch(BASE + '/definitely-not-a-page/');
  const body = await res.text();
  check(res.status === 404 && /<html/i.test(body), 'unknown route returns 404 page', `-> ${res.status}`);

  res = await fetch(BASE + '/..%2f..%2fpackage.json');
  const t = await res.text();
  check(res.status !== 200 || !t.includes('"scripts"'), 'path traversal does not leak package.json', `-> ${res.status}`);

  res = await fetch(BASE + '/assets/css/style.css');
  check(res.status === 200 && /text\/css/.test(res.headers.get('content-type')) && res.headers.get('cache-control') === 'no-cache', 'css served fresh', `-> ${res.headers.get('cache-control')}`);

  res = await fetch(BASE + '/assets/img/hero-desktop.webp');
  check(res.status === 200 && /image\/webp/.test(res.headers.get('content-type')), 'webp image served', `-> ${res.headers.get('content-type')}`);

  console.log(bad ? `\n${bad} FAILURE(S)` : `\nAll checks passed (${routes.length} pages + 6 edge cases)`);
  process.exit(bad ? 1 : 0);
})();

