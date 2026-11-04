// Two-body orbital mechanics in a body-centred inertial frame (metres, seconds).
// Universal-variable propagation works for circles, ellipses, parabolas and hyperbolas.
import { V3 } from '../core/math.js';

const TAU = Math.PI * 2;

/** Stumpff functions C(z), S(z). */
function stumpff(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)];
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * s * s)];
  }
  return [0.5 - z / 24 + (z * z) / 720, 1 / 6 - z / 120 + (z * z) / 5040];
}

/**
 * Propagates a state (r0, v0) by dt seconds under gravity mu. Writes into rOut / vOut.
 * Returns false if the solver did not converge (the output is then left unchanged).
 */
export function propagate(r0, v0, dt, mu, rOut, vOut) {
  const rx = r0.x, ry = r0.y, rz = r0.z, vx = v0.x, vy = v0.y, vz = v0.z;
  const r0m = Math.hypot(rx, ry, rz);
  const v0sq = vx * vx + vy * vy + vz * vz;
  const vr0 = (rx * vx + ry * vy + rz * vz) / r0m;
  const alpha = 2 / r0m - v0sq / mu; // 1/a
  const smu = Math.sqrt(mu);
  // Whole revolutions of an ellipse can be removed first.
  if (alpha > 1e-12) {
    const period = TAU / Math.sqrt(mu * alpha * alpha * alpha);
    if (Math.abs(dt) > period) dt -= Math.trunc(dt / period) * period;
  }
  if (dt === 0) {
    rOut.set(rx, ry, rz);
    vOut.set(vx, vy, vz);
    return true;
  }
  let chi;
  if (alpha > 1e-12) chi = smu * alpha * dt;
  else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const sgn = Math.sign(dt);
    chi = sgn * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (rx * vx + ry * vy + rz * vz + sgn * Math.sqrt(-mu * a) * (1 - r0m * alpha)));
    if (!Number.isFinite(chi)) chi = smu * dt / r0m;
  } else chi = smu * dt / r0m;
  let C = 0, S = 0, z = 0, ok = false;
  for (let i = 0; i < 60; i++) {
    z = alpha * chi * chi;
    [C, S] = stumpff(z);
    const chi2 = chi * chi;
    const F = ((r0m * vr0) / smu) * chi2 * C + (1 - alpha * r0m) * chi2 * chi * S + r0m * chi - smu * dt;
    const dF = ((r0m * vr0) / smu) * chi * (1 - alpha * chi2 * S) + (1 - alpha * r0m) * chi2 * C + r0m;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) {
      ok = true;
      break;
    }
  }
  if (!ok || !Number.isFinite(chi)) return false;
  z = alpha * chi * chi;
  [C, S] = stumpff(z);
  const chi2 = chi * chi;
  const f = 1 - (chi2 / r0m) * C;
  const g = dt - (chi2 * chi * S) / smu;
  const nx = f * rx + g * vx, ny = f * ry + g * vy, nz = f * rz + g * vz;
  const r = Math.hypot(nx, ny, nz);
  const fdot = (smu / (r * r0m)) * (alpha * chi2 * chi * S - chi);
  const gdot = 1 - (chi2 / r) * C;
  vOut.set(fdot * rx + gdot * vx, fdot * ry + gdot * vy, fdot * rz + gdot * vz);
  rOut.set(nx, ny, nz);
  return true;
}

/**
 * Classical elements and handy derived quantities of the orbit through (r, v).
 * Angles in radians. For hyperbolas a < 0 and period = Infinity.
 */
export function elements(r, v, mu) {
  const rm = r.len();
  const v2 = v.lenSq();
  const h = new V3().crossVectors(r, v);
  const hm = h.len();
  const rv = r.dot(v);
  // Eccentricity vector: ((v² - mu/r) r - (r·v) v) / mu
  const ex = ((v2 - mu / rm) * r.x - rv * v.x) / mu;
  const ey = ((v2 - mu / rm) * r.y - rv * v.y) / mu;
  const ez = ((v2 - mu / rm) * r.z - rv * v.z) / mu;
  const e = Math.hypot(ex, ey, ez);
  const energy = v2 / 2 - mu / rm;
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity;
  const p = (hm * hm) / mu;
  const i = Math.acos(Math.max(-1, Math.min(1, h.z / (hm || 1))));
  // Node line n = z × h
  const nx = -h.y, ny = h.x;
  const nm = Math.hypot(nx, ny);
  let lan = nm > 1e-9 ? Math.atan2(ny, nx) : 0;
  if (lan < 0) lan += TAU;
  let argp = 0;
  if (e > 1e-9) {
    if (nm > 1e-9) {
      argp = Math.acos(Math.max(-1, Math.min(1, (nx * ex + ny * ey) / (nm * e))));
      if (ez < 0) argp = TAU - argp;
    } else {
      argp = Math.atan2(ey, ex);
      if (h.z < 0) argp = -argp;
      if (argp < 0) argp += TAU;
    }
  }
  // True anomaly
  let nu;
  if (e > 1e-9) {
    nu = Math.acos(Math.max(-1, Math.min(1, (ex * r.x + ey * r.y + ez * r.z) / (e * rm))));
    if (rv < 0) nu = TAU - nu;
  } else {
    // Circular: argument of latitude from the node (or x axis).
    const ux = nm > 1e-9 ? nx / nm : 1, uy = nm > 1e-9 ? ny / nm : 0;
    nu = Math.acos(Math.max(-1, Math.min(1, (ux * r.x + uy * r.y) / rm)));
    if (r.z < 0 || (nm <= 1e-9 && r.y * Math.sign(h.z || 1) < 0)) nu = TAU - nu;
  }
  const rp = e < 1 || a < 0 ? (a < 0 ? a * (1 - e) : a * (1 - e)) : p / 2;
  const ra = e < 1 ? a * (1 + e) : Infinity;
  let period = Infinity, n = 0, M = 0, timeToPe = Infinity, timeToAp = Infinity;
  if (e < 1 && a > 0) {
    n = Math.sqrt(mu / (a * a * a));
    period = TAU / n;
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    M = E - e * Math.sin(E);
    if (M < 0) M += TAU;
    timeToPe = (TAU - M) / n;
    timeToAp = M < Math.PI ? (Math.PI - M) / n : (3 * Math.PI - M) / n;
  } else if (e > 1) {
    n = Math.sqrt(mu / -(a * a * a));
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    M = e * Math.sinh(H) - H;
    timeToPe = M < 0 ? -M / n : Infinity;
  }
  return { a, e, i, lan, argp, nu, p, rp, ra, period, n, M, timeToPe, timeToAp, energy, h, ecc: new V3(ex, ey, ez), mu };
}

/** Radius at true anomaly nu of an orbit with semi-latus rectum p and eccentricity e. */
export function radiusAt(p, e, nu) {
  return p / (1 + e * Math.cos(nu));
}

/** Perifocal unit vectors (P towards periapsis, Q 90° ahead) of an elements object. */
export function perifocal(el) {
  const { lan: O, i, argp: w } = el;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const P = new V3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si);
  const Q = new V3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si);
  return { P, Q };
}

/** Position on the conic at true anomaly nu (body-centred). */
export function positionAt(el, nu, out = new V3()) {
  const { P, Q } = el._pq || (el._pq = perifocal(el));
  const r = radiusAt(el.p, el.e, nu);
  const c = Math.cos(nu) * r, s = Math.sin(nu) * r;
  return out.set(P.x * c + Q.x * s, P.y * c + Q.y * s, P.z * c + Q.z * s);
}

/** State vector of a circular orbit of radius r. */
export function circularState(mu, r, { inclination = 0, lan = 0, argLat = 0 } = {}) {
  const el = { lan, i: inclination, argp: 0, e: 0, p: r };
  const pos = positionAt(el, argLat);
  const { P, Q } = perifocal(el);
  const v = Math.sqrt(mu / r);
  const vel = new V3(-P.x * Math.sin(argLat) + Q.x * Math.cos(argLat), -P.y * Math.sin(argLat) + Q.y * Math.cos(argLat), -P.z * Math.sin(argLat) + Q.z * Math.cos(argLat)).scale(v);
  return { pos, vel };
}

/** State from classical elements at true anomaly nu. */
export function stateFromElements(mu, { a, e, i = 0, lan = 0, argp = 0 }, nu) {
  const p = a * (1 - e * e);
  const el = { lan, i, argp, e, p };
  const pos = positionAt(el, nu);
  const { P, Q } = perifocal(el);
  const k = Math.sqrt(mu / p);
  const vp = -Math.sin(nu) * k, vq = (e + Math.cos(nu)) * k;
  const vel = new V3(P.x * vp + Q.x * vq, P.y * vp + Q.y * vq, P.z * vp + Q.z * vq);
  return { pos, vel };
}

/**
 * Points along the conic for drawing: closed ellipse, or the arc of a hyperbola / escape
 * ellipse limited to radius maxR. Returns an array of V3 (body-centred).
 */
export function conicPoints(el, count = 256, maxR = Infinity) {
  const pts = [];
  if (el.e < 1 && el.ra < maxR) {
    for (let k = 0; k <= count; k++) pts.push(positionAt(el, (k / count) * TAU));
    return pts;
  }
  // Open (or clipped) arc: true anomaly range where r <= maxR.
  let nuMax;
  if (el.e >= 1) nuMax = Math.acos(Math.max(-1, Math.min(1, -1 / el.e))) * 0.999;
  else nuMax = Math.PI;
  if (Number.isFinite(maxR)) {
    const c = (el.p / maxR - 1) / el.e;
    if (c > -1 && c < 1) nuMax = Math.min(nuMax, Math.acos(c));
  }
  for (let k = 0; k <= count; k++) pts.push(positionAt(el, -nuMax + (2 * nuMax * k) / count));
  return pts;
}

/** Local orbital frame at (r, v): prograde, normal (orbit normal), radial out. */
export function orbitalFrame(r, v) {
  const pro = v.clone().normalize();
  const nor = new V3().crossVectors(r, v).normalize();
  const rad = new V3().crossVectors(pro, nor); // perpendicular to prograde, roughly outwards
  return { pro, nor, rad };
}
