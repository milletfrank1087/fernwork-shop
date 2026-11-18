const fs = require('fs'), path = require('path');
function dims(f) {
  const b = fs.readFileSync(f); if (b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const t = b.toString('ascii', 12, 16);
  if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3), 'X' + ((b[20] & 0x10) ? '+alpha' : '')];
  if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff, 'lossy'];
  if (t === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1, 'lossless' + (((v >>> 28) & 1) ? '+alpha' : '')]; }
}
const O = process.argv[2] || path.join(__dirname, '..', 'render', 'out');
let n = 0, bad = [], sizes = { full: [], sm: [] };
for (const h of fs.readdirSync(O + '/products')) {
  for (let i = 1; i <= 5; i++) {
    for (const [suffix, want, kind] of [['', 1200, 'full'], ['-sm', 640, 'sm']]) {
      const f = `${O}/products/${h}/${i}${suffix}.webp`;
      if (!fs.existsSync(f)) { bad.push('MISSING ' + f); continue; }
      const d = dims(f); n++;
      if (!d || d[0] !== want || d[1] !== want) bad.push(`WRONG SIZE ${h}/${i}${suffix}: ${d}`);
      sizes[kind].push(fs.statSync(f).size / 1024);
    }
  }
}
const stat = (a) => `min ${Math.min(...a).toFixed(0)} / avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)} / max ${Math.max(...a).toFixed(0)} KB`;
console.log(`product images found: ${n} (expected 100)`);
console.log('full 1200px :', stat(sizes.full));
console.log('thumb 640px :', stat(sizes.sm));
const want = { 'hero-desktop': [1938, 812], 'hero-mobile': [941, 1672], newsletter: [1600, 638], about: [1254, 1254], contact: [1278, 1230] };
for (const [k, [w, h]] of Object.entries(want)) {
  const f = `${O}/site/${k}.webp`; const d = fs.existsSync(f) ? dims(f) : null;
  console.log(k.padEnd(13), d ? d.join(' x ').replace(/ x ([a-z+A-Z]+)$/, '  [$1]') : 'MISSING', (d && d[0] === w && d[1] === h) ? 'OK' : 'SIZE MISMATCH', (fs.statSync(f).size / 1024).toFixed(0) + ' KB');
}
console.log(bad.length ? 'PROBLEMS:\n' + bad.join('\n') : 'all product image sizes correct');
