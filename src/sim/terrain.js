// Surface models. Input: a unit direction in the body-fixed frame (x at longitude 0, y at
// 90°E, z north). Output: height in metres above the reference sphere.
// Earth, Moon and Mars use real global elevation maps (assets/planets, see
// tools/make-planet-data.py) plus deterministic fine detail; the same functions feed the
// physics (legs, impacts, splashdown) and the renderer's terrain meshes.
import { Simplex3 } from '../core/noise.js';
import { clamp, smoothstep, hash2 } from '../core/math.js';

/** Unit direction from latitude/longitude in degrees. */
export function dirFromLatLon(lat, lon, out = [0, 0, 0]) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  out[0] = Math.cos(la) * Math.cos(lo);
  out[1] = Math.cos(la) * Math.sin(lo);
  out[2] = Math.sin(la);
  return out;
}

/** Latitude/longitude (degrees) of a direction (not necessarily normalised). */
export function latLonFromDir(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: (Math.asin(clamp(z / r, -1, 1)) * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI };
}

function angle(ax, ay, az, b) {
  return Math.acos(clamp(ax * b[0] + ay * b[1] + az * b[2], -1, 1));
}

/** Flattened circular area: `site.elev` inside `inner` (rad), natural ground beyond `outer`. */
function flatten(h, ax, ay, az, site) {
  const a = angle(ax, ay, az, site.dir);
  if (a >= site.blend) return h;
  return site.elev + (h - site.elev) * smoothstep(site.flat, site.blend, a);
}

/** Bilinear sample of an equirectangular height map (Float32Array, metres). */
function sampleMap(map, x, y, z) {
  const lon = Math.atan2(y, x), lat = Math.asin(clamp(z, -1, 1));
  const W = map.width, H = map.height;
  const u = ((lon + Math.PI) / (2 * Math.PI)) * W - 0.5;
  const v = ((Math.PI / 2 - lat) / Math.PI) * H - 0.5;
  let x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = u - x0, fy = v - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  x0 = ((x0 % W) + W) % W;
  x1 = ((x1 % W) + W) % W;
  y0 = clamp(y0, 0, H - 1);
  y1 = clamp(y1, 0, H - 1);
  const d = map.data;
  const a = d[y0 * W + x0], b = d[y0 * W + x1], c = d[y1 * W + x0], e = d[y1 * W + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
}

/** Local relief of the map (difference with a wider neighbourhood), for detail amplitude. */
function reliefAt(map, x, y, z) {
  const h = sampleMap(map, x, y, z);
  const k = 0.012;
  const a = sampleMap(map, x + k, y, z), b = sampleMap(map, x - k, y, z), c = sampleMap(map, x, y + k, z), d = sampleMap(map, x, y - k, z);
  return Math.abs(h - (a + b + c + d) / 4) + Math.abs(a - b) * 0.25 + Math.abs(c - d) * 0.25;
}

/**
 * Crater octave: one candidate crater per cell of a 3D lattice around the sphere; only the
 * 2×2×2 nearest cells can reach the point (crater radius < half a cell).
 */
function craterOctave(px, py, pz, freq, density, seed, depthRatio, radius) {
  const qx = px * freq, qy = py * freq, qz = pz * freq;
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  const ox = qx - ix < 0.5 ? -1 : 1, oy = qy - iy < 0.5 ? -1 : 1, oz = qz - iz < 0.5 ? -1 : 1;
  let h = 0;
  for (let a = 0; a < 2; a++) {
    const cx = ix + a * ox;
    for (let b = 0; b < 2; b++) {
      const cy = iy + b * oy;
      for (let c = 0; c < 2; c++) {
        const cz = iz + c * oz;
        if (hash2(cx * 73 + cz * 7919, cy * 131 - cz * 31, seed) > density) continue;
        let ex = cx + hash2(cx, cy * 3 + cz, seed + 1);
        let ey = cy + hash2(cy, cz * 5 + cx, seed + 2);
        let ez = cz + hash2(cz, cx * 7 + cy, seed + 3);
        const el = Math.hypot(ex, ey, ez);
        if (el < 1e-9) continue;
        const s = freq / el;
        ex *= s; ey *= s; ez *= s;
        const rr = 0.12 + 0.33 * hash2(cx + 17, cy - 23, seed + 4);
        const d = Math.hypot(qx - ex, qy - ey, qz - ez) / rr;
        if (d > 1.9) continue;
        const depth = (rr / freq) * radius * depthRatio;
        let v = 0;
        if (d < 1) v += depth * Math.max(d * d - 1, -0.82);
        const w = (d - 1) / 0.28;
        v += depth * 0.24 * Math.exp(-w * w);
        h += v;
      }
    }
  }
  return h;
}

/** Crater octaves by cell size in metres (the lattice frequency depends on the radius). */
function craterSet(radius, cells) {
  return cells.map(([cellKm, density, depth]) => [radius / (cellKm * 1000), density, depth]);
}

class MapTerrain {
  constructor(sites, radius) {
    this.sites = sites;
    this.radius = radius;
    this.map = null;
  }

  setHeightmap(map) {
    this.map = map;
    let mx = -Infinity;
    for (let i = 0; i < map.data.length; i += 7) if (map.data[i] > mx) mx = map.data[i];
    this.maxHeight = Math.max(this.maxHeight || 0, mx + 500);
  }

  base(x, y, z) {
    return this.map ? sampleMap(this.map, x, y, z) : 0;
  }

  finish(h, x, y, z) {
    for (const s of this.sites) h = flatten(h, x, y, z, s);
    return h;
  }
}

// ---------------------------------------------------------------- Earth

export class EarthTerrain extends MapTerrain {
  constructor(sites, radius) {
    super(sites, radius);
    this.n = new Simplex3(1971);
    this.maxHeight = 8900;
  }

  height(x, y, z) {
    const n = this.n;
    let h = this.base(x, y, z);
    // Fine relief below the 20 km resolution of the map, stronger in mountains, absent at
    // the coast so that the real shorelines are kept.
    const land = h > 0;
    const coast = smoothstep(5, 120, Math.abs(h));
    const rough = land ? clamp(0.15 + h / 2500, 0.15, 1.6) : 0.25;
    const r = n.ridged(x * 900, y * 900, z * 900, 4);
    h += coast * rough * ((r - 0.45) * 650 + n.fbm(x * 4200, y * 4200, z * 4200, 3) * 70);
    h += coast * (n.noise(x * 30000, y * 30000, z * 30000) * 6 + n.noise(x * 120000, y * 120000, z * 120000) * 1.5) * (land ? 1 : 0);
    if (land && h < 1) h = 1;
    return this.finish(h, x, y, z);
  }

  /** Extra per-vertex data for the renderer. */
  sample(x, y, z) {
    return { h: this.height(x, y, z), moisture: 0, maria: 0 };
  }
}

// ---------------------------------------------------------------- Moon

const MOON_CRATERS = [
  // cell (km), density, depth/radius
  [60, 0.5, 0.12], [26, 0.5, 0.15], [11, 0.48, 0.17], [4.8, 0.45, 0.19], [2.1, 0.42, 0.2], [0.9, 0.4, 0.2], [0.38, 0.36, 0.19], [0.16, 0.32, 0.18], [0.07, 0.3, 0.16],
];

export class MoonTerrain extends MapTerrain {
  constructor(sites, radius) {
    super(sites, radius);
    this.n = new Simplex3(808);
    this.maxHeight = 11000;
    this.craters = craterSet(radius, MOON_CRATERS);
  }

  height(x, y, z, octaves = this.craters.length) {
    const n = this.n;
    let h = this.base(x, y, z) + n.fbm(x * 260, y * 260, z * 260, 4) * 160;
    for (let i = 0; i < octaves; i++) {
      const [freq, density, depth] = this.craters[i];
      h += craterOctave(x, y, z, freq, density, 31 + i * 17, depth, this.radius);
    }
    h += n.noise(x * 60000, y * 60000, z * 60000) * 0.5;
    return this.finish(h, x, y, z);
  }

  sample(x, y, z) {
    return { h: this.height(x, y, z), moisture: 0, maria: 0 };
  }
}

// ---------------------------------------------------------------- Mars

const MARS_CRATERS = [[70, 0.45, 0.08], [30, 0.45, 0.1], [12, 0.42, 0.12], [5, 0.4, 0.13], [2, 0.36, 0.13], [0.8, 0.32, 0.12], [0.3, 0.28, 0.1]];

export class MarsTerrain extends MapTerrain {
  constructor(sites, radius) {
    super(sites, radius);
    this.n = new Simplex3(4040);
    this.maxHeight = 23000;
    this.craters = craterSet(radius, MARS_CRATERS);
  }

  height(x, y, z) {
    const n = this.n;
    let h = this.base(x, y, z);
    h += (n.ridged(x * 500, y * 500, z * 500, 4) - 0.45) * 500 + n.fbm(x * 3000, y * 3000, z * 3000, 3) * 60;
    for (let i = 0; i < this.craters.length; i++) {
      const [freq, density, depth] = this.craters[i];
      h += craterOctave(x, y, z, freq, density, 91 + i * 13, depth, this.radius);
    }
    h += n.noise(x * 50000, y * 50000, z * 50000) * 1.2;
    return this.finish(h, x, y, z);
  }

  sample(x, y, z) {
    return { h: this.height(x, y, z), moisture: 0, maria: 0 };
  }
}

// ---------------------------------------------------------------- generic cratered body (Mercury)

export class CrateredTerrain {
  constructor(sites, radius, seed = 7, maxHeight = 4000) {
    this.sites = sites;
    this.radius = radius;
    this.n = new Simplex3(seed);
    this.maxHeight = maxHeight;
    this.craters = craterSet(radius, [[250, 0.5, 0.06], [100, 0.5, 0.09], [40, 0.5, 0.12], [16, 0.46, 0.15], [6, 0.44, 0.17], [2.4, 0.4, 0.18], [0.9, 0.36, 0.18], [0.35, 0.32, 0.16]]);
  }

  height(x, y, z) {
    let h = this.n.fbm(x * 3, y * 3, z * 3, 5) * 1200;
    for (let i = 0; i < this.craters.length; i++) {
      const [freq, density, depth] = this.craters[i];
      h += craterOctave(x, y, z, freq, density, 7 + i * 19, depth, this.radius);
    }
    for (const s of this.sites) h = flatten(h, x, y, z, s);
    return h;
  }

  sample(x, y, z) {
    return { h: this.height(x, y, z), moisture: 0, maria: 0 };
  }
}
