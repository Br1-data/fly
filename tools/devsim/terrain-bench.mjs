import { getTerrain } from '../../src/world/terrain-height.js';
const T = getTerrain();
let s = 0; const t0 = performance.now(); const N = 200000;
for (let i = 0; i < N; i++) { const n = ((i * 7919) % 180000) - 90000, e = ((i * 104729) % 180000) - 90000; s += T.height(n, e); }
const dt = performance.now() - t0;
console.log('us/height', (dt * 1000 / N).toFixed(3), 'checksum', s.toFixed(3));
