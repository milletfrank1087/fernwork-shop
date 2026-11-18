// One-off integrity check: every local href/src/srcset in dist/ must resolve to a real file.
const fs = require('fs');
const path = require('path');

const DIST = process.env.DIST || path.join(__dirname, '..', '..', 'dist');
const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.html')) pages.push(p);
  }
})(DIST);

const exists = (file) => fs.existsSync(file) && fs.statSync(file).isFile();
const resolveTarget = (pageFile, ref) => {
  ref = ref.split('#')[0].split('?')[0];
  if (!ref) return null; // pure fragment / empty query
  const isAbs = ref.startsWith('/');
  const base = isAbs ? DIST : path.dirname(pageFile);
  let target = path.normalize(path.join(base, ref));
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  else if (ref.endsWith('/')) target = path.join(target, 'index.html');
  return target;
};

let checked = 0;
const broken = [];
const idsSeen = {};
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const refs = [];
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\bsrcset="([^"]+)"/g)) m[1].split(',').forEach((s) => refs.push(s.trim().split(/\s+/)[0]));
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(ref)) continue;
    const t = resolveTarget(page, ref);
    if (!t) continue;
    checked++;
    if (!exists(t)) broken.push(`${path.relative(DIST, page)}  ->  ${ref}`);
  }
  // duplicate ids make aria-labelledby / label[for] unreliable
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) idsSeen[path.relative(DIST, page)] = [...new Set(dup)];
}

console.log(`pages: ${pages.length}, local references checked: ${checked}`);
console.log(broken.length ? `BROKEN (${broken.length}):\n` + [...new Set(broken)].join('\n') : 'no broken local references');
console.log(Object.keys(idsSeen).length ? 'DUPLICATE IDS: ' + JSON.stringify(idsSeen) : 'no duplicate ids');

