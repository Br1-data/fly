// Small, allocation-free math helpers used by the simulation.
// World frame: NED (x = north, y = east, z = down). Body frame: x fwd, y right, z down.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.80665;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const sq = (v) => v * v;

/** Wrap angle in degrees to [0, 360). */
export const wrap360 = (d) => ((d % 360) + 360) % 360;
/** Wrap angle in degrees to [-180, 180). */
export const wrap180 = (d) => wrap360(d + 180) - 180;
/** Wrap angle in radians to [-PI, PI). */
export const wrapPi = (r) => {
  r = (r + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
};

/** Exponential approach of `cur` to `target` with time constant tau (s). */
export const approach = (cur, target, dt, tau) => (tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau)));
/** Move `cur` towards `target` by at most `rate * dt`. */
export const moveTowards = (cur, target, rate, dt) => {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
};

/** Linear interpolation in a breakpoint table [[x0,y0],[x1,y1],...] (sorted by x, clamped at ends). */
export function table1(tab, x) {
  const n = tab.length;
  if (x <= tab[0][0]) return tab[0][1];
  if (x >= tab[n - 1][0]) return tab[n - 1][1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const a = tab[lo];
  const b = tab[hi];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

export class V3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone() {
    return new V3(this.x, this.y, this.z);
  }
  fromArray(a) {
    this.x = a[0];
    this.y = a[1];
    this.z = a[2];
    return this;
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  addScaled(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  scale(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  /** this = a x b */
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  len() {
    return Math.hypot(this.x, this.y, this.z);
  }
  lenSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  normalize() {
    const l = this.len();
    if (l > 1e-12) this.scale(1 / l);
    return this;
  }
  zero() {
    this.x = this.y = this.z = 0;
    return this;
  }
}

/** Unit quaternion (w, x, y, z) rotating body vectors into world (NED) vectors. */
export class Quat {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  copy(q) {
    this.w = q.w;
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    return this;
  }
  clone() {
    return new Quat(this.w, this.x, this.y, this.z);
  }
  normalize() {
    const l = Math.hypot(this.w, this.x, this.y, this.z) || 1;
    this.w /= l;
    this.x /= l;
    this.y /= l;
    this.z /= l;
    return this;
  }
  /** Build from aerospace Euler angles (radians): yaw psi (heading), pitch theta, roll phi; Z-Y-X order. */
  setFromEuler(phi, theta, psi) {
    const cr = Math.cos(phi / 2),
      sr = Math.sin(phi / 2);
    const cp = Math.cos(theta / 2),
      sp = Math.sin(theta / 2);
    const cy = Math.cos(psi / 2),
      sy = Math.sin(psi / 2);
    this.w = cr * cp * cy + sr * sp * sy;
    this.x = sr * cp * cy - cr * sp * sy;
    this.y = cr * sp * cy + sr * cp * sy;
    this.z = cr * cp * sy - sr * sp * cy;
    return this;
  }
  /** Returns {phi, theta, psi} (radians); psi in [0, 2PI). */
  toEuler(out = { phi: 0, theta: 0, psi: 0 }) {
    const { w, x, y, z } = this;
    out.phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    out.theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
    let psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    if (psi < 0) psi += 2 * Math.PI;
    out.psi = psi;
    return out;
  }
  /** out = R * v (body -> world) */
  rotate(v, out = new V3()) {
    const { w, x, y, z } = this;
    const vx = v.x,
      vy = v.y,
      vz = v.z;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    out.x = vx + w * tx + (y * tz - z * ty);
    out.y = vy + w * ty + (z * tx - x * tz);
    out.z = vz + w * tz + (x * ty - y * tx);
    return out;
  }
  /** out = R^T * v (world -> body) */
  rotateInv(v, out = new V3()) {
    const w = this.w,
      x = -this.x,
      y = -this.y,
      z = -this.z;
    const vx = v.x,
      vy = v.y,
      vz = v.z;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    out.x = vx + w * tx + (y * tz - z * ty);
    out.y = vy + w * ty + (z * tx - x * tz);
    out.z = vz + w * tz + (x * ty - y * tx);
    return out;
  }
  /** Integrate body angular rate omega (rad/s) over dt. */
  integrate(omega, dt) {
    const { w, x, y, z } = this;
    const p = omega.x,
      q = omega.y,
      r = omega.z;
    this.w = w + 0.5 * dt * (-x * p - y * q - z * r);
    this.x = x + 0.5 * dt * (w * p + y * r - z * q);
    this.y = y + 0.5 * dt * (w * q + z * p - x * r);
    this.z = z + 0.5 * dt * (w * r + x * q - y * p);
    return this.normalize();
  }
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of 2 ints -> [0,1). */
export function hash2(ix, iy, seed = 0) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bearing (deg, 0..360) from point a to point b in the NED plane. */
export function bearingDeg(aN, aE, bN, bE) {
  return wrap360(Math.atan2(bE - aE, bN - aN) * RAD);
}
