import { getTerrain, insideRect } from '../../src/world/terrain-height.js';
import { airportLayouts } from '../../src/world/world-data.js';
const T = getTerrain();
for (const L of airportLayouts()) {
  const r = L.flat; let s = 0, c = 0, mn = 1e9, mx = -1e9;
  for (let i = -20; i <= 20; i++) for (let j = -10; j <= 10; j++) {
    const h = r.heading * Math.PI / 180;
    const a = i / 20 * r.length / 2, b = j / 10 * r.width / 2;
    const n = r.n + Math.cos(h) * a - Math.sin(h) * b, e = r.e + Math.sin(h) * a + Math.cos(h) * b;
    const v = T.rawHeight(n, e); s += v; c++; mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  console.log(L.airport.icao, 'avg', (s / c).toFixed(1), 'min', mn.toFixed(0), 'max', mx.toFixed(0), 'elev', L.airport.elev);
}
