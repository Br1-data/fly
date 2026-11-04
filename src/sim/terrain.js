// Deterministic surface models of the two worlds. Input is a unit direction (x, y, z) in the
// body frame (z = north pole); output is the height in metres above the reference radius.
// Shared by the physics (landing legs, impacts, splashdown) and by the renderer, which builds
// its terrain meshes from exactly the same function.
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

/** Great-circle angle (radians) between two unit vectors. */
function angle(ax, ay, az, b) {
  const d = ax * b[0] + ay * b[1] + az * b[2];
  return Math.acos(clamp(d, -1, 1));
}

/** Flattened circular area: `h` inside `inner` (rad), natural ground beyond `outer`. */
function flatten(h, ax, ay, az, site, inner, outer) {
  const a = angle(ax, ay, az, site.dir);
  if (a >= outer) return h;
  const t = smoothstep(inner, outer, a);
  return site.elev + (h - site.elev) * t;
}

// ---------------------------------------------------------------- Ausonia (home planet)

export class AusoniaTerrain {
  constructor(sites = []) {
    this.n = new Simplex3(1971);
    this.m = new Simplex3(4242);
    this.sites = sites;
    this.radius = 800e3;
    this.maxHeight = 4600;
  }

  /** Continent field: < 0 sea, > 0 land. */
  continent(x, y, z) {
    const n = this.n;
    let c = n.fbm(x * 1.25 + 3.1, y * 1.25 - 1.7, z * 1.25 + 0.4, 5) * 1.1 + n.fbm(x * 4.1, y * 4.1, z * 4.1, 3) * 0.22 - 0.06;
    // The spaceport stands on a coast: land under the pads, open sea to the east.
    for (const s of this.sites) {
      if (!s.land) continue;
      const a = angle(x, y, z, s.dir);
      if (a < s.land * 2.5) c += 0.35 * (1 - smoothstep(s.land * 0.6, s.land * 2.5, a));
    }
    return c;
  }

  height(x, y, z) {
    const n = this.n;
    const c = this.continent(x, y, z);
    let h;
    if (c < 0) {
      // Continental shelf then abyssal plains.
      h = -Math.min(4200, 260 * smoothstep(0, 0.04, -c) + 5200 * smoothstep(0.03, 0.45, -c)) + n.noise(x * 60, y * 60, z * 60) * 40 * smoothstep(0, 0.05, -c);
    } else {
      const inland = smoothstep(0, 0.32, c);
      const mask = smoothstep(-0.05, 0.3, this.m.fbm(x * 2.3 + 7, y * 2.3, z * 2.3 - 2, 3));
      const r = n.ridged(x * 5.5 + 11, y * 5.5, z * 5.5 - 5, 6);
      const mountains = r * r * 4200 * mask * smoothstep(0.04, 0.3, c);
      const hills = (n.fbm(x * 28, y * 28, z * 28, 4) * 0.5 + 0.5) * 260 * smoothstep(0, 0.08, c);
      const detail = n.fbm(x * 420, y * 420, z * 420, 3) * 14 + n.noise(x * 3600, y * 3600, z * 3600) * 2.5;
      h = 2 + inland * 520 + mountains + hills + detail * smoothstep(0, 0.02, c);
    }
    for (const s of this.sites) h = flatten(h, x, y, z, s, s.flat, s.blend);
    return h;
  }

  /** Extra per-vertex data for the renderer: moisture (0 desert … 1 lush) and coast closeness. */
  sample(x, y, z) {
    const h = this.height(x, y, z);
    const moisture = clamp(this.m.fbm(x * 3.4 - 4, y * 3.4 + 9, z * 3.4, 4) * 0.9 + 0.55 - Math.abs(z) * 0.15 + (Math.abs(z) < 0.35 ? 0 : 0.2), 0, 1);
    return { h, moisture, maria: 0 };
  }
}

// ---------------------------------------------------------------- Lucina (moon)

/**
 * Crater octave: one candidate crater per cell of a 3D lattice around the sphere. Only the
 * 2×2×2 cells nearest the point can hold a crater that reaches it (radius < half a cell).
 */
function craterOctave(px, py, pz, freq, density, seed, depthRatio) {
  const qx = px * freq, qy = py * freq, qz = pz * freq;
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  const fx = qx - ix, fy = qy - iy, fz = qz - iz;
  const ox = fx < 0.5 ? -1 : 1, oy = fy < 0.5 ? -1 : 1, oz = fz < 0.5 ? -1 : 1;
  let h = 0;
  for (let a = 0; a < 2; a++) {
    const cx = ix + a * ox;
    for (let b = 0; b < 2; b++) {
      const cy = iy + b * oy;
      for (let c = 0; c < 2; c++) {
        const cz = iz + c * oz;
        const k = hash2(cx * 73 + cz * 7919, cy * 131 - cz * 31, seed);
        if (k > density) continue;
        // Feature point inside the cell, pulled onto the sphere of radius `freq`.
        let ex = cx + hash2(cx, cy * 3 + cz, seed + 1);
        let ey = cy + hash2(cy, cz * 5 + cx, seed + 2);
        let ez = cz + hash2(cz, cx * 7 + cy, seed + 3);
        const el = Math.hypot(ex, ey, ez);
        if (el < 1e-9) continue;
        const s = freq / el;
        ex *= s; ey *= s; ez *= s;
        const radius = 0.12 + 0.33 * hash2(cx + 17, cy - 23, seed + 4);
        const d = Math.hypot(qx - ex, qy - ey, qz - ez) / radius;
        if (d > 1.9) continue;
        // Bowl, raised rim, ejecta. Depth relative to the crater radius in metres.
        const rMetres = (radius / freq) * 240e3;
        const depth = rMetres * depthRatio;
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

const CRATER_OCTAVES = [
  // freq (cells per radius), density, depth / radius
  [7, 0.55, 0.08],
  [15, 0.5, 0.1],
  [32, 0.5, 0.13],
  [70, 0.45, 0.16],
  [150, 0.42, 0.18],
  [330, 0.4, 0.2],
  [720, 0.38, 0.2],
  [1600, 0.35, 0.2],
  [3500, 0.32, 0.18],
];

export class LucinaTerrain {
  constructor(sites = []) {
    this.n = new Simplex3(808);
    this.sites = sites;
    this.radius = 240e3;
    this.maxHeight = 3200;
  }

  maria(x, y, z) {
    return smoothstep(0.08, 0.32, this.n.fbm(x * 1.4 + 5, y * 1.4 - 3, z * 1.4 + 1, 3));
  }

  height(x, y, z, octaves = CRATER_OCTAVES.length) {
    const n = this.n;
    const mare = this.maria(x, y, z);
    let h = n.fbm(x * 3, y * 3, z * 3, 5) * 1100 * (1 - mare * 0.75) - mare * 1300 + n.fbm(x * 40, y * 40, z * 40, 3) * 90;
    for (let i = 0; i < octaves; i++) {
      const [freq, density, depth] = CRATER_OCTAVES[i];
      // Maria are younger: fewer large craters.
      h += craterOctave(x, y, z, freq, density * (i < 4 ? 1 - mare * 0.6 : 1), 31 + i * 17, depth);
    }
    h += n.noise(x * 9000, y * 9000, z * 9000) * 0.6;
    for (const s of this.sites) h = flatten(h, x, y, z, s, s.flat, s.blend);
    return h;
  }

  sample(x, y, z) {
    return { h: this.height(x, y, z), moisture: 0, maria: this.maria(x, y, z) };
  }
}
