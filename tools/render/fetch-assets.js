// Downloads the CC0 Poly Haven assets that render.py needs into tools/render/.cache.
// Usage: node tools/render/fetch-assets.js      (safe to re-run: existing files are skipped)
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '.cache');
const API = 'https://api.polyhaven.com/files/';

const MODELS = [
  'potted_plant_01', 'potted_plant_02', 'potted_plant_04', 'planter_pot_clay',
  'ceramic_vase_01', 'ceramic_vase_04', 'antique_ceramic_vase_01', 'brass_vase_02', 'jug_01',
  'Lantern_01', 'wooden_lantern_01', 'wicker_basket_01', 'wicker_basket_02',
  'watering_can_metal_01', 'wooden_bowl_02', 'wooden_bucket_01', 'throw_pillows_01',
];
const HDRIS = ['studio_small_09'];
const TEXTURES = ['laminate_floor_02', 'plastered_wall_02'];
// Poly Haven map name -> short suffix used by render.py (tex/<id>_<suffix>.jpg)
const MAPS = [['Diffuse', 'diff'], ['Rough', 'rough'], ['nor_gl', 'nor']];

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 0;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  let bytes = 0;

  for (const id of MODELS) {
    const files = await json(API + id);
    const res = files.gltf['2k'] ? '2k' : '1k';
    const gltf = files.gltf[res].gltf;
    const dir = path.join(CACHE, 'models', id);
    bytes += await download(gltf.url, path.join(dir, `${id}_${res}.gltf`));
    for (const [rel, f] of Object.entries(gltf.include || {})) bytes += await download(f.url, path.join(dir, rel));
    console.log('model  ', id, res);
  }

  for (const id of HDRIS) {
    const files = await json(API + id);
    bytes += await download(files.hdri['2k'].hdr.url, path.join(CACHE, 'hdri', `${id}_2k.hdr`));
    console.log('hdri   ', id);
  }

  for (const id of TEXTURES) {
    const files = await json(API + id);
    for (const [map, key] of MAPS) {
      const entry = files[map] && files[map]['2k'] && files[map]['2k'].jpg;
      if (!entry) throw new Error(`${id}: no 2k jpg for map "${map}"`);
      bytes += await download(entry.url, path.join(CACHE, 'tex', `${id}_${key}.jpg`));
    }
    console.log('texture', id);
  }

  console.log(`done. downloaded ${(bytes / 1048576).toFixed(1)} MB into ${CACHE}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
