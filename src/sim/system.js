// The real Solar System. Global frame: heliocentric, axes of the J2000 Earth equator
// (x towards the March equinox, z towards the Earth's north pole); time t in seconds from
// J2000 (2000-01-01 12:00 TT). Planets follow their J2000 mean Keplerian elements (JPL
// "Approximate positions of the planets"), the Moon a fixed mean orbit; each body rotates
// about its IAU pole. Gravity uses patched conics with Laplace spheres of influence.
import { V3, Quat, clamp } from '../core/math.js';
import { propagate } from './orbit.js';
import { EarthTerrain, MoonTerrain, MarsTerrain, CrateredTerrain, dirFromLatLon } from './terrain.js';

export const AU = 1.495978707e11;
export const MU_SUN = 1.32712440018e20;
export const DAY = 86400;
const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392811 * DEG;

/** Ecliptic (J2000) → equatorial (J2000) rotation about x. */
function eclToEq(v) {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return new V3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

/** Unit vector from right ascension / declination (deg) in the equatorial frame. */
function radec(ra, dec) {
  return new V3(Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG));
}

// J2000 mean elements: a (AU), e, i (deg), mean longitude L, longitude of perihelion ϖ, node Ω (deg).
const PLANETS = [
  ['mercury', 'Mercurio', 0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 2.4397e6, 2.2032e13, { ra: 281.0097, dec: 61.4143, w0: 329.5469, wd: 6.1385025 }],
  ['venus', 'Venere', 0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 6.0518e6, 3.24859e14, { ra: 272.76, dec: 67.16, w0: 160.2, wd: -1.4813688 }],
  ['earth', 'Terra', 1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 6.371e6, 3.986004418e14, { ra: 0, dec: 90, w0: 190.147, wd: 360.9856235 }],
  ['mars', 'Marte', 1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 3.3895e6, 4.282837e13, { ra: 317.68143, dec: 52.8865, w0: 176.63, wd: 350.89198226 }],
  ['jupiter', 'Giove', 5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 6.9911e7, 1.26686534e17, { ra: 268.056595, dec: 64.495303, w0: 284.95, wd: 870.536 }],
  ['saturn', 'Saturno', 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 5.8232e7, 3.7931187e16, { ra: 40.589, dec: 83.537, w0: 38.9, wd: 810.7939024 }],
  ['uranus', 'Urano', 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, 2.5362e7, 5.793939e15, { ra: 257.311, dec: -15.175, w0: 203.81, wd: -501.1600928 }],
  ['neptune', 'Nettuno', 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 2.4622e7, 6.836529e15, { ra: 299.36, dec: 43.46, w0: 249.978, wd: 541.1397757 }],
];

/** Kepler elements (equatorial frame) → state at mean anomaly M. */
function stateFromKepler(mu, a, e, i, node, argp, M) {
  // Solve Kepler's equation.
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const xp = a * (cosE - e), yp = a * Math.sqrt(1 - e * e) * sinE;
  const n = Math.sqrt(mu / (a * a * a));
  const vxp = (-a * n * sinE) / (1 - e * cosE), vyp = (a * n * Math.sqrt(1 - e * e) * cosE) / (1 - e * cosE);
  const cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(argp), sw = Math.sin(argp);
  const P = new V3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si);
  const Q = new V3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si);
  void r;
  return {
    pos: new V3().addScaled(P, xp).addScaled(Q, yp),
    vel: new V3().addScaled(P, vxp).addScaled(Q, vyp),
  };
}

function soi(a, mu, muParent) {
  return a * Math.pow(mu / muParent, 0.4);
}

// ---------------------------------------------------------------- bodies

export const BODIES = {};

BODIES.sun = {
  id: 'sun', name: 'Sole', kind: 'star', parent: null, radius: 6.957e8, mu: MU_SUN, soi: Infinity,
  rotation: { ra: 286.13, dec: 63.87, w0: 84.176, wd: 14.1844 },
  description: 'La stella del Sistema Solare: 99,86% della sua massa.',
};

for (const [id, name, aAU, e, i, L, peri, node, radius, mu, rot] of PLANETS) {
  const a = aAU * AU;
  // Orbit in the ecliptic, then rotated to the equatorial frame (P, Q vectors).
  const argp = (peri - node) * DEG;
  const M0 = (L - peri) * DEG;
  BODIES[id] = {
    id, name, kind: ['jupiter', 'saturn', 'uranus', 'neptune'].includes(id) ? 'giant' : 'planet', parent: 'sun', radius, mu,
    soi: soi(a, mu, MU_SUN), rotation: rot,
    orbit: { a, e, i: i * DEG, node: node * DEG, argp, M0, n: Math.sqrt(MU_SUN / (a * a * a)), ecliptic: true },
  };
}

BODIES.moon = {
  id: 'moon', name: 'Luna', kind: 'moon', parent: 'earth', radius: 1.7374e6, mu: 4.9048695e12,
  // Mean orbit (ecliptic): a, e, i, Ω, ω, M at J2000. Nodal and apsidal precession are neglected.
  orbit: { a: 3.844e8, e: 0.0549, i: 5.145 * DEG, node: 125.08 * DEG, argp: 318.15 * DEG, M0: 135.27 * DEG, ecliptic: true },
  rotation: 'locked',
};
BODIES.moon.orbit.n = Math.sqrt((BODIES.earth.mu + BODIES.moon.mu) / BODIES.moon.orbit.a ** 3);
BODIES.moon.soi = soi(BODIES.moon.orbit.a, BODIES.moon.mu, BODIES.earth.mu);

// Atmospheres: tabulated / exponential density models, sound speed for Mach.
BODIES.earth.atmosphere = { height: 140e3, model: 'us76', sound: 340, scaleHeight: 8500, rho0: 1.225, p0: 101325 };
BODIES.mars.atmosphere = { height: 130e3, model: 'exp', sound: 240, scaleHeight: 11100, rho0: 0.02, p0: 610 };
BODIES.venus.atmosphere = { height: 250e3, model: 'exp', sound: 410, scaleHeight: 15900, rho0: 65, p0: 9.2e6 };
for (const g of ['jupiter', 'saturn', 'uranus', 'neptune']) BODIES[g].atmosphere = { height: 1000e3, model: 'exp', sound: 1000, scaleHeight: 27000, rho0: 0.16, p0: 1e5 };
BODIES.earth.ocean = true;

// Saturn's rings (inner / outer radius) for the renderer.
BODIES.saturn.rings = { inner: 7.45e7, outer: 1.4022e8 };

BODIES.sun.description = 'La stella del Sistema Solare.';
BODIES.mercury.description = 'Il pianeta più vicino al Sole: crateri, nessuna atmosfera, giorno di 176 giorni.';
BODIES.venus.description = 'Nubi di acido solforico, 92 bar e 464 °C al suolo: nessun veicolo può atterrare.';
BODIES.earth.description = 'Il nostro pianeta: oceani, atmosfera fino a circa 100 km, rotazione in 23 h 56 min.';
BODIES.moon.description = 'Satellite naturale della Terra, in rotazione sincrona: mostra sempre la stessa faccia.';
BODIES.mars.description = 'Atmosfera di CO₂ a 6 millibar, Olympus Mons, Valles Marineris e le calotte polari.';
BODIES.jupiter.description = 'Gigante gassoso: 318 masse terrestri, la Grande Macchia Rossa.';
BODIES.saturn.description = 'Gigante gassoso con il sistema di anelli più esteso.';
BODIES.uranus.description = 'Gigante ghiacciato con l’asse di rotazione quasi nel piano dell’orbita.';
BODIES.neptune.description = 'Il pianeta più lontano, venti fino a 2.000 km/h.';

// ---------------------------------------------------------------- sites (real places)

const site = (id, name, body, lat, lon, elev, flatKm, blendKm, extra = {}) => ({
  id, name, body, lat, lon, elev, dir: dirFromLatLon(lat, lon),
  flat: (flatKm * 1000) / BODIES[body].radius, blend: (blendKm * 1000) / BODIES[body].radius, ...extra,
});

export const SITES = {
  malindi: site('malindi', 'Centro Spaziale Luigi Broglio (Malindi)', 'earth', -2.996, 40.19, 18, 3.5, 7, {
    pad: { east: 0, north: 0 },
    runway: { east: 1800, north: -900, heading: 90, length: 3000, width: 45 },
    short: 'Malindi',
  }),
  grottaglie: site('grottaglie', 'Spazioporto di Taranto-Grottaglie', 'earth', 40.517, 17.403, 65, 3.5, 7, {
    pad: { east: 0, north: 0 },
    runway: { east: 0, north: 0, heading: 172, length: 3200, width: 60 },
    noPad: true,
    short: 'Grottaglie',
  }),
  tranquillitatis: site('tranquillitatis', 'Base Tranquillitatis (Mare della Tranquillità)', 'moon', 0.674, 23.473, -1900, 2.2, 5, {
    pads: [{ east: 0, north: 0 }, { east: 220, north: 140 }, { east: -190, north: 200 }],
    landmark: 'Statio Tranquillitatis (Apollo 11) a 1,9 km verso est-sud-est',
    short: 'Tranquillitatis',
  }),
  jezero: site('jezero', 'Cratere Jezero', 'mars', 18.38, 77.58, -2600, 3, 8, {
    pads: [{ east: 0, north: 0 }],
    short: 'Jezero',
  }),
};

// Surface models (data-driven where real maps exist; see terrain.js and planet-data.js).
BODIES.earth.terrain = new EarthTerrain([SITES.malindi, SITES.grottaglie], BODIES.earth.radius);
BODIES.moon.terrain = new MoonTerrain([SITES.tranquillitatis], BODIES.moon.radius);
BODIES.mars.terrain = new MarsTerrain([SITES.jezero], BODIES.mars.radius);
BODIES.mercury.terrain = new CrateredTerrain([], BODIES.mercury.radius, 77, 4000);
for (const id of ['sun', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune']) BODIES[id].terrain = { maxHeight: 0, height: () => 0, flat: true };
BODIES.venus.terrain = { maxHeight: 0, height: () => 0, flat: true };

export const BODY_LIST = Object.values(BODIES);

/** Children (bodies orbiting `id`). */
export function childrenOf(id) {
  return BODY_LIST.filter((b) => b.parent === id);
}

// ---------------------------------------------------------------- ephemeris

const cache = new Map();

/** Heliocentric state of a body at time t (cached per t). */
export function bodyState(id, t) {
  const key = id;
  const c = cache.get(key);
  if (c && c.t === t) return c;
  const b = BODIES[id];
  let s;
  if (!b.parent) s = { pos: new V3(), vel: new V3() };
  else {
    const o = b.orbit;
    const muP = b.parent === 'sun' ? MU_SUN : BODIES[b.parent].mu + b.mu;
    const M = o.M0 + o.n * t;
    const k = stateFromKepler(muP, o.a, o.e, o.i, o.node, o.argp, ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    let pos = k.pos, vel = k.vel;
    if (o.ecliptic) {
      pos = eclToEq(pos);
      vel = eclToEq(vel);
    }
    const p = bodyState(b.parent, t);
    s = { pos: pos.add(p.pos), vel: vel.add(p.vel) };
  }
  s.t = t;
  cache.set(key, s);
  return s;
}

/** Position of body `id` relative to body `ref` at time t. */
export function relativeState(id, ref, t) {
  const a = bodyState(id, t), b = bodyState(ref, t);
  return { pos: a.pos.clone().sub(b.pos), vel: a.vel.clone().sub(b.vel) };
}

/**
 * Orientation of a body (body-fixed → inertial) at time t, and its angular velocity vector
 * (inertial, rad/s). Body-fixed axes: x at longitude 0, y at 90°E, z the north pole.
 */
export function bodyOrientation(id, t, out = new Quat()) {
  const b = BODIES[id];
  if (b.rotation === 'locked') {
    // Synchronous rotation: longitude 0 faces the parent; z along the orbit normal.
    const r = relativeState(b.parent, id, t);
    const x = r.pos.clone().normalize();
    const zn = new V3().crossVectors(r.pos.clone().scale(-1), r.vel.clone().scale(-1)).normalize();
    const y = new V3().crossVectors(zn, x).normalize();
    const z = new V3().crossVectors(x, y);
    return matToQuat(x, y, z, out);
  }
  const { ra, dec, w0, wd } = b.rotation;
  const W = (w0 + wd * (t / DAY)) * DEG;
  // IAU: inertial → body = Rz(W) · Rx(90° − dec) · Rz(90° + ra). We build body → inertial.
  const pole = radec(ra, dec);
  const node = new V3(-Math.sin(ra * DEG), Math.cos(ra * DEG), 0); // ascending node of the equator (Q direction)
  const nodeY = new V3().crossVectors(pole, node);
  const x = node.clone().scale(Math.cos(W)).addScaled(nodeY, Math.sin(W));
  const y = new V3().crossVectors(pole, x);
  return matToQuat(x, y, pole, out);
}

export function bodySpin(id, t) {
  const b = BODIES[id];
  if (b.rotation === 'locked') {
    const r = relativeState(id, b.parent, t);
    const h = new V3().crossVectors(r.pos, r.vel);
    return h.scale(1 / r.pos.lenSq());
  }
  const pole = radec(b.rotation.ra, b.rotation.dec);
  return pole.scale((b.rotation.wd * DEG) / DAY);
}

function matToQuat(x, y, z, q) {
  const m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q.w = 0.25 * s; q.x = (m21 - m12) / s; q.y = (m02 - m20) / s; q.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q.w = (m21 - m12) / s; q.x = 0.25 * s; q.y = (m01 + m10) / s; q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q.w = (m02 - m20) / s; q.x = (m01 + m10) / s; q.y = 0.25 * s; q.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q.w = (m10 - m01) / s; q.x = (m02 + m20) / s; q.y = (m12 + m21) / s; q.z = 0.25 * s;
  }
  return q.normalize();
}

/** Inertial direction → body-fixed direction. */
export function toFixed(id, t, v, out = new V3()) {
  return bodyOrientation(id, t).rotateInv(v, out);
}

/** Body-fixed vector → inertial. */
export function fromFixed(id, t, v, out = new V3()) {
  return bodyOrientation(id, t).rotate(v, out);
}

/** Terrain height (m) under an inertial position relative to the body centre. */
export function heightAt(id, t, rel) {
  const b = BODIES[id];
  const f = toFixed(id, t, rel);
  const l = f.len() || 1;
  return b.terrain.height(f.x / l, f.y / l, f.z / l);
}

// ---------------------------------------------------------------- atmosphere

// US Standard Atmosphere 1976 densities (kg/m³) by altitude (km), extended with typical
// thermosphere values; interpolated in log space.
const US76 = [
  [0, 1.225], [2, 1.007], [4, 0.8194], [6, 0.6601], [8, 0.5258], [10, 0.4135], [12, 0.3119], [15, 0.1948], [20, 0.08891],
  [25, 0.04008], [30, 0.01841], [35, 0.008463], [40, 0.003996], [45, 0.001966], [50, 0.001027], [55, 5.68e-4], [60, 3.097e-4],
  [65, 1.632e-4], [70, 8.283e-5], [75, 3.992e-5], [80, 1.846e-5], [85, 7.99e-6], [90, 3.416e-6], [95, 1.393e-6], [100, 5.604e-7],
  [110, 9.708e-8], [120, 2.222e-8], [130, 8.152e-9], [140, 3.831e-9], [160, 1.233e-9], [180, 5.194e-10], [200, 2.541e-10],
  [250, 6.073e-11], [300, 1.916e-11], [400, 2.803e-12], [500, 5.215e-13], [600, 1.137e-13],
];
const US76_LOG = US76.map(([h, r]) => [h * 1000, Math.log(r)]);

function us76(h) {
  if (h <= 0) return 1.225 * Math.exp(-h / 8500);
  if (h >= 600e3) return 0;
  let lo = 0, hi = US76_LOG.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (US76_LOG[mid][0] <= h) lo = mid;
    else hi = mid;
  }
  const [h0, l0] = US76_LOG[lo], [h1, l1] = US76_LOG[hi];
  return Math.exp(l0 + ((l1 - l0) * (h - h0)) / (h1 - h0));
}

/** Density (kg/m³) and pressure (Pa) at altitude h over a body. */
export function atmosphereAt(body, h) {
  const atm = body.atmosphere;
  if (!atm) return { rho: 0, p: 0 };
  if (atm.model === 'us76') {
    const rho = us76(h);
    return { rho, p: (rho / 1.225) * 101325 };
  }
  if (h >= atm.height) return { rho: 0, p: 0 };
  const k = Math.exp(-Math.max(h, -2000) / atm.scaleHeight);
  return { rho: atm.rho0 * k, p: atm.p0 * k };
}

// ---------------------------------------------------------------- local frames at sites

/**
 * Ground point of a site at time t: inertial position (relative to the body centre), local
 * east / north / up unit vectors (inertial) and the ground velocity.
 */
export function siteFrame(siteDef, t = 0, offsetEast = 0, offsetNorth = 0) {
  const body = BODIES[siteDef.body];
  const upF = new V3(...siteDef.dir);
  const lon = siteDef.lon * DEG;
  const eastF = new V3(-Math.sin(lon), Math.cos(lon), 0);
  const northF = new V3().crossVectors(upF, eastF);
  const dirF = upF.clone().scale(body.radius).addScaled(eastF, offsetEast).addScaled(northF, offsetNorth).normalize();
  const h = body.terrain.height(dirF.x, dirF.y, dirF.z);
  const q = bodyOrientation(body.id, t);
  const up = q.rotate(dirF, new V3());
  const east = q.rotate(eastF, new V3());
  const north = q.rotate(northF, new V3());
  const pos = up.clone().scale(body.radius + Math.max(h, body.ocean ? 0 : -1e9));
  const vel = new V3().crossVectors(bodySpin(body.id, t), pos);
  return { body, pos, up, east, north, height: h, vel, fixed: { up: upF, east: eastF, north: northF, pos: dirF.clone().scale(body.radius + h) } };
}

// ---------------------------------------------------------------- orbiting objects

/**
 * Permanent objects on rails. `orbit`: { altitude, inclination (deg, relative to the
 * parent's equator), lan (deg), argLat (rad) } around `ref`.
 */
export const OBJECTS = {
  aurora: {
    id: 'aurora',
    name: 'Stazione Aurora',
    kind: 'station',
    ref: 'earth',
    orbit: { altitude: 410e3, inclination: 6, lan: 40, argLat: 0 },
    radius: 95,
    ports: [
      { id: 'prua', name: 'Porta di prua', pos: [46, 0, 0], dir: [1, 0, 0] },
      { id: 'zenit', name: 'Porta zenitale', pos: [8, 0, -9], dir: [0, 0, -1] },
      { id: 'poppa', name: 'Porta di poppa', pos: [-44, 0, 0], dir: [-1, 0, 0] },
    ],
    capsules: [
      [-40, 0, 0, 42, 0, 0, 3.4],
      [8, 0, -2, 8, 0, -6.2, 2.2],
      [-12, -38, 0, -12, 38, 0, 1.1],
      [24, 0, 0, 24, 0, 22, 1.2],
    ],
    boxes: [
      [-12, -58, 0, 16, 7.5, 0.4],
      [-12, 58, 0, 16, 7.5, 0.4],
      [-30, 0, 10, 7, 0.3, 5],
    ],
    rings: [{ x: 24, radius: 22, tube: 2.6 }],
  },
  detriti: {
    id: 'detriti',
    name: 'Campo di detriti Kessler-7',
    kind: 'swarm',
    model: 'swarm',
    ref: 'earth',
    orbit: { altitude: 780e3, inclination: 8, lan: 120, argLat: 1.2 },
    radius: 6000,
    asteroids: { count: 140, spread: 4500, seed: 77, debris: true },
    outpost: false,
    wreck: true,
  },
  selene: {
    id: 'selene',
    name: 'Navetta orbitale Selene',
    kind: 'orbiter',
    ref: 'moon',
    orbit: { altitude: 100e3, inclination: 2, lan: 0, argLat: 0 },
    radius: 14,
    ports: [{ id: 'nadir', name: 'Porta di attracco', pos: [6.5, 0, 0], dir: [1, 0, 0] }],
    capsules: [[-6, 0, 0, 3.8, 0, 0, 2.1]],
    boxes: [[0, -6.5, 0, 1.3, 3.75, 0.2], [0, 6.5, 0, 1.3, 3.75, 0.2]],
  },
  phobos: {
    id: 'phobos',
    name: 'Phobos',
    kind: 'moonlet',
    model: 'moonlet',
    ref: 'mars',
    // Real orbit: 9376 km from the centre, period 7 h 39 min, near the equator.
    orbit: { altitude: 9376e3 - 3.3895e6, inclination: 1.1, lan: 0, argLat: 0.4 },
    radius: 13500,
    size: [13000, 11400, 9100],
  },
  deimos: {
    id: 'deimos',
    name: 'Deimos',
    kind: 'moonlet',
    model: 'moonlet',
    ref: 'mars',
    orbit: { altitude: 23463e3 - 3.3895e6, inclination: 1.8, lan: 0, argLat: 2.5 },
    radius: 8000,
    size: [7500, 6100, 5200],
  },
};

/** Deterministic fragment list of a debris field (positions relative to its centre). */
export function swarmAsteroids(def) {
  const { count, spread, seed } = def.asteroids;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = spread * Math.pow(rnd(), 0.8);
    const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
    const x = r * Math.sin(ph) * Math.cos(th) * 1.6, y = r * Math.sin(ph) * Math.sin(th) * 0.5, z = r * Math.cos(ph) * 0.35;
    if (Math.hypot(x, y, z) < 300) continue;
    const big = rnd() < 0.06;
    const radius = big ? 6 + rnd() * 10 : 0.6 + Math.pow(rnd(), 2) * 4;
    out.push({ x, y, z, radius, shape: Math.floor(rnd() * 4), spin: (rnd() - 0.5) * 0.4, axis: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], phase: rnd() * 6.28, tone: rnd() });
  }
  return out;
}

// ---------------------------------------------------------------- dates

/** Seconds from J2000 for a UTC date (TT−UTC ≈ 69 s is neglected). */
export function j2000FromDate(date) {
  return (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 1000;
}

export function dateFromJ2000(t) {
  return new Date(Date.UTC(2000, 0, 1, 12, 0, 0) + t * 1000);
}

/** Local mean solar hour at a longitude for time t (for scenario setup). */
export function localSolarHour(t, lonDeg) {
  const d = dateFromJ2000(t);
  const utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return (((utc + lonDeg / 15) % 24) + 24) % 24;
}

export { clamp, propagate };
