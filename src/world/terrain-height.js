// Deterministic terrain model shared by flight physics (ground contact) and rendering.
import { Simplex2 } from '../core/noise.js';
import { clamp, lerp, smoothstep, DEG } from '../core/math.js';
import { AIRPORTS, LAKES, RIDGES, VALLEYS, ISLANDS, CITIES, airportLayouts, WORLD_HALF_SIZE } from './world-data.js';

const noiseA = new Simplex2(1971);
const noiseB = new Simplex2(4242);
const noiseC = new Simplex2(777);

const segCache = new WeakMap();
function segInfo(pts) {
  let info = segCache.get(pts);
  if (!info) {
    const segLen = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segLen.push(l);
      total += l;
    }
    info = { segLen, total };
    segCache.set(pts, info);
  }
  return info;
}

/** Distance from point to polyline plus interpolation parameter along it. */
function polyDist(n, e, pts, out) {
  let best = Infinity;
  let bestT = 0;
  let accum = 0;
  const { segLen, total } = segInfo(pts);
  for (let i = 0; i < pts.length - 1; i++) {
    const [an, ae] = pts[i];
    const [bn, be] = pts[i + 1];
    const vn = bn - an,
      ve = be - ae;
    const l2 = vn * vn + ve * ve;
    let t = ((n - an) * vn + (e - ae) * ve) / l2;
    t = clamp(t, 0, 1);
    const dn = an + vn * t - n,
      de = ae + ve * t - e;
    const d = Math.hypot(dn, de);
    if (d < best) {
      best = d;
      bestT = (accum + t * segLen[i]) / total;
    }
    accum += segLen[i];
  }
  if (out) out.t = bestT;
  return best;
}

/** Signed-ish distance from a point to an oriented rectangle (0 inside). */
function rectDist(n, e, r) {
  const h = r.heading * DEG;
  const cn = Math.cos(h),
    ce = Math.sin(h);
  const dn = n - r.n,
    de = e - r.e;
  const along = dn * cn + de * ce;
  const across = -dn * ce + de * cn;
  const ox = Math.abs(along) - r.length / 2;
  const oy = Math.abs(across) - r.width / 2;
  return Math.hypot(Math.max(ox, 0), Math.max(oy, 0)) + Math.min(Math.max(ox, oy), 0);
}

function insideRect(n, e, r, margin = 0) {
  const h = r.heading * DEG;
  const cn = Math.cos(h),
    ce = Math.sin(h);
  const dn = n - r.n,
    de = e - r.e;
  const along = dn * cn + de * ce;
  const across = -dn * ce + de * cn;
  return Math.abs(along) <= r.length / 2 + margin && Math.abs(across) <= r.width / 2 + margin;
}

export const SURFACES = {
  asphalt: { roll: 0.015, brake: 1.0, side: 1.0, bump: 0 },
  concrete: { roll: 0.015, brake: 1.0, side: 1.0, bump: 0 },
  grass: { roll: 0.05, brake: 0.55, side: 0.75, bump: 0.6 },
  dirt: { roll: 0.06, brake: 0.6, side: 0.7, bump: 0.8 },
  forest: { roll: 0.12, brake: 0.5, side: 0.7, bump: 1.5 },
  rock: { roll: 0.08, brake: 0.7, side: 0.8, bump: 1.2 },
  sand: { roll: 0.15, brake: 0.4, side: 0.6, bump: 0.5 },
  snow: { roll: 0.08, brake: 0.25, side: 0.35, bump: 0.4 },
  water: { roll: 0.5, brake: 0, side: 0.3, bump: 0 },
};

class TerrainModel {
  constructor() {
    this.layouts = airportLayouts();
    this.flats = this.layouts.map((L) => ({
      rect: L.flat,
      elev: L.airport.elev,
      blend: L.airport.size === 'small' ? (L.airport.elev > 800 ? 500 : 700) : 1300,
      surfaces: L.surfaces,
      airport: L.airport,
    }));
    this._pd = { t: 0 };
  }

  /** 0 = deep sea, 1 = land. */
  landFactor(n, e) {
    if (Math.abs(n) > WORLD_HALF_SIZE + 20000 || Math.abs(e) > WORLD_HALF_SIZE + 20000) return 0;
    const cn = 12000,
      ce = 8000;
    let u = Math.sqrt(((n - cn) / 50000) ** 2 + ((e - ce) / 47000) ** 2);
    u += 0.2 * noiseA.fbm(n / 26000 + 3.1, e / 26000 - 7.3, 4) + 0.045 * noiseB.fbm(n / 5000, e / 5000, 3);
    let land = smoothstep(1.0, 0.9, u);
    this._main = land;
    for (const isl of ISLANDS) {
      const raw = Math.hypot(n - isl.n, e - isl.e) / isl.r;
      if (raw > 1.4) continue; // the noise term is bounded by 0.25: no land possible here
      const d = raw + 0.25 * noiseB.fbm(n / 4000 + isl.n, e / 4000, 3);
      land = Math.max(land, smoothstep(1.0, 0.7, d));
    }
    // guarantee land around airports
    for (const ap of AIRPORTS) {
      const d = Math.hypot(n - ap.n, e - ap.e);
      land = Math.max(land, smoothstep(3800, 2400, d));
    }
    return land;
  }

  /** Raw terrain height before airport flattening. */
  rawHeight(n, e) {
    const land = this.landFactor(n, e);
    if (land === 0) return -185; // open sea: identical to the general formula below with land = 0
    const hills = 0.5 + 0.5 * noiseA.fbm(n / 15000, e / 15000, 5);
    const detail = noiseB.fbm(n / 1800, e / 1800, 4);
    const inland = smoothstep(0.15, 0.9, this._main) + 0.12 * smoothstep(0.2, 1, land - this._main);
    let h = 8 + inland * (hills * 220 + detail * 25 + 40 * hills * hills);

    // mountain ridges
    let mtn = 0;
    for (const r of RIDGES) {
      const d = polyDist(n, e, r.pts);
      const m = smoothstep(r.width, r.width * 0.15, d);
      if (m > 0) {
        const rd = noiseC.ridged(n / 9000 + r.height, e / 9000, 6);
        mtn = Math.max(mtn, m * (r.height * Math.pow(rd, 1.35) + 250 * m));
      }
    }
    // valleys carve passes through the mountains
    for (const v of VALLEYS) {
      const d = polyDist(n, e, v.pts, this._pd);
      if (d < v.width * 3) {
        const t = this._pd.t * (v.floor.length - 1);
        const i = Math.min(Math.floor(t), v.floor.length - 2);
        const floor = lerp(v.floor[i], v.floor[i + 1], t - i);
        const k = smoothstep(v.width * 3, v.width * 0.4, d);
        mtn *= 1 - 0.92 * k;
        h = lerp(h, Math.min(h, floor - 20), k * 0.9);
        if (k > 0) h = Math.max(h, lerp(h, floor + 15 * detail, k));
      }
    }
    h += mtn * inland;
    // lakes
    for (const lk of LAKES) {
      const d = Math.hypot(n - lk.n, e - lk.e) / lk.radius + 0.18 * noiseB.noise(n / 1500, e / 1500);
      if (d < 1.6) {
        const shore = smoothstep(1.6, 1.0, d);
        h = lerp(h, lk.level + 6 + 10 * hills, shore);
        const basin = smoothstep(1.05, 0.6, d);
        h = lerp(h, lk.level - lk.depth, basin);
      }
    }
    // sea floor
    const seaDepth = -25 - 160 * smoothstep(0.5, 0, land);
    return lerp(seaDepth, h, smoothstep(0.0, 0.5, land) * 0.5 + 0.5 * land);
  }

  /** Final terrain height (m MSL) at (n, e). */
  height(n, e) {
    let h = this.rawHeight(n, e);
    for (const f of this.flats) {
      const dc = Math.abs(n - f.rect.n) + Math.abs(e - f.rect.e);
      if (dc > f.rect.length + f.rect.width + f.blend * 2) continue;
      const d = rectDist(n, e, f.rect);
      if (d < f.blend) {
        const w = 1 - smoothstep(0, f.blend, d);
        h = lerp(h, f.elev, w);
      }
    }
    return h;
  }

  /** Paved/grass airport surface at a point, or null. */
  airportSurface(n, e) {
    for (const f of this.flats) {
      const dc = Math.abs(n - f.rect.n) + Math.abs(e - f.rect.e);
      if (dc > f.rect.length + f.rect.width) continue;
      for (const s of f.surfaces) if (insideRect(n, e, s)) return { surface: s.surface, kind: s.kind, airport: f.airport, elev: f.elev };
    }
    return null;
  }

  /** Lake water level at a point, or null. */
  lakeLevel(n, e) {
    for (const lk of LAKES) if (Math.hypot(n - lk.n, e - lk.e) < lk.radius * 1.5) return lk.level;
    return null;
  }

  /** Ground information for physics: height of the supporting surface, its type and normal. */
  groundInfo(n, e, out = {}) {
    const ap = this.airportSurface(n, e);
    let h, surface, kind = null;
    if (ap) {
      h = ap.elev;
      surface = ap.surface;
      kind = ap.kind;
      out.nx = 0;
      out.ny = 0;
      out.nz = -1;
    } else {
      h = this.height(n, e);
      const d = 3;
      const hn = this.height(n + d, e);
      const he = this.height(n, e + d);
      // normal (NED, pointing up = -z)
      const gx = (hn - h) / d,
        gy = (he - h) / d;
      const l = Math.hypot(gx, gy, 1);
      out.nx = gx / l;
      out.ny = gy / l;
      out.nz = -1 / l;
      surface = this.naturalSurface(n, e, h, Math.hypot(gx, gy));
      const lake = this.lakeLevel(n, e);
      if (h < 0.0) {
        h = 0;
        surface = 'water';
        out.nx = out.ny = 0;
        out.nz = -1;
      } else if (lake !== null && h < lake) {
        h = lake;
        surface = 'water';
        out.nx = out.ny = 0;
        out.nz = -1;
      }
    }
    out.h = h;
    out.surface = surface;
    out.kind = kind;
    return out;
  }

  /** Natural surface classification (also used for terrain colouring). */
  naturalSurface(n, e, h, slope) {
    if (h < 2.5) return 'sand';
    if (h > 2050 && slope < 0.9) return 'snow';
    if (slope > 0.75 || h > 1750) return 'rock';
    if (this.forestFactor(n, e, h, slope) > 0.5) return 'forest';
    return 'grass';
  }

  forestFactor(n, e, h, slope) {
    if (h < 4 || h > 1700) return 0;
    const f = noiseC.fbm(n / 2600 + 11, e / 2600 - 5, 4) + (h > 350 ? 0.35 : 0) - (slope > 0.6 ? 0.4 : 0);
    let ff = smoothstep(0.05, 0.3, f);
    // no forest in towns or at airports
    for (const c of CITIES) {
      const d = Math.hypot(n - c.n, e - c.e);
      if (d < c.radius * 1.4) ff *= smoothstep(c.radius * 0.9, c.radius * 1.4, d);
    }
    for (const fl of this.flats) {
      const d = rectDist(n, e, fl.rect);
      if (d < 400) ff *= smoothstep(150, 400, d);
    }
    return ff;
  }

  /** Town density at a point (0..1). */
  cityFactor(n, e) {
    let best = 0;
    for (const c of CITIES) {
      const d = Math.hypot(n - c.n, e - c.e) / c.radius + 0.25 * noiseB.noise(n / 900, e / 900);
      if (d < 1) best = Math.max(best, (1 - d) * c.density);
    }
    return best;
  }

  /** Agricultural field pattern: returns a cell hash in [0,1) and a "field" weight. */
  fieldCell(n, e) {
    const ang = noiseA.noise(n / 30000, e / 30000) * 0.8;
    const c = Math.cos(ang),
      s = Math.sin(ang);
    const wn = n + noiseB.noise(n / 700, e / 700) * 60;
    const we = e + noiseB.noise(e / 700 + 9, n / 700) * 60;
    const u = wn * c - we * s;
    const v = wn * s + we * c;
    const ix = Math.floor(u / 380);
    const iy = Math.floor(v / 260);
    let hsh = (ix * 73856093) ^ (iy * 19349663);
    hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
    return ((hsh ^ (hsh >>> 16)) >>> 0) / 4294967296;
  }

  noiseDetail(n, e, scale) {
    return noiseB.noise(n / scale, e / scale);
  }
}

let _terrain = null;
/** Singleton terrain model. */
export function getTerrain() {
  if (!_terrain) _terrain = new TerrainModel();
  return _terrain;
}

export { rectDist, insideRect, polyDist };
