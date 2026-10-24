// Dev tool: render a shaded overview map of the terrain to a PNG.
import fs from 'node:fs';
import { encodePNG } from './png.mjs';
import { getTerrain } from '../src/world/terrain-height.js';
import { AIRPORTS } from '../src/world/world-data.js';
const out = process.argv[2] || 'terrain.png';
const T = getTerrain();
const W = 512, H = 512, half = 75000;
const rgb = new Uint8Array(W * H * 3);
let t0 = performance.now();
let maxH = -1e9;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const n = half - (y / H) * 2 * half, e = -half + (x / W) * 2 * half;
  const h = T.height(n, e);
  maxH = Math.max(maxH, h);
  const h2 = T.height(n + 150, e - 150);
  const shade = Math.max(0.4, Math.min(1.3, 1 + (h - h2) / 40));
  let c;
  const lake = T.lakeLevel(n, e);
  if (h < 0 || (lake !== null && h < lake)) c = [30, 70, 140];
  else if (h < 3) c = [210, 200, 150];
  else if (h < 300) c = [90, 150, 70];
  else if (h < 900) c = [120, 140, 80];
  else if (h < 1700) c = [130, 115, 90];
  else if (h < 2100) c = [150, 140, 130];
  else c = [240, 240, 245];
  if (T.cityFactor(n, e) > 0.1) c = [170, 160, 160];
  const i = (y * W + x) * 3;
  rgb[i] = Math.min(255, c[0] * shade); rgb[i + 1] = Math.min(255, c[1] * shade); rgb[i + 2] = Math.min(255, c[2] * shade);
}
for (const ap of AIRPORTS) {
  const x = Math.round((ap.e + half) / (2 * half) * W), y = Math.round((half - ap.n) / (2 * half) * H);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = ((y + dy) * W + x + dx) * 3; rgb[i] = 255; rgb[i + 1] = 0; rgb[i + 2] = 0; }
  console.log(ap.icao, 'h=', T.height(ap.n, ap.e).toFixed(1), 'raw=', T.rawHeight(ap.n, ap.e).toFixed(1));
}
console.log('time per sample (us):', ((performance.now() - t0) * 1000 / (W * H * 2)).toFixed(2), 'maxH', maxH.toFixed(0));
fs.writeFileSync(out, encodePNG(W, H, Buffer.from(rgb)));
