// The Ausonia system: a home planet with oceans and atmosphere, its moon Lucina, an orbital
// station, an asteroid swarm at Lucina's leading Lagrange point and the surface sites.
// All bodies are imaginary. Inertial frame centred on Ausonia, z = Ausonia's north pole,
// Lucina orbits in the equatorial plane. Bodies do not rotate (their surfaces are inertial).
import { V3 } from '../core/math.js';
import { AusoniaTerrain, LucinaTerrain, dirFromLatLon } from './terrain.js';

const site = (id, name, lat, lon, elev, flat, blend, extra = {}) => ({ id, name, lat, lon, elev, flat, blend, dir: dirFromLatLon(lat, lon), ...extra });

/** Surface sites; `flat` / `blend` are angular radii (rad) of the levelled area. */
export const SITES = {
  spaceport: site('spaceport', 'Spazioporto Capo Aurora', 0.8, -38, 32, 9000 / 800e3, 16000 / 800e3, {
    body: 'ausonia', land: 30000 / 800e3,
    // Launch pad and runway in metres east / north of the site centre.
    pad: { east: 0, north: 0 },
    runway: { east: 2600, north: -1400, heading: 90, length: 4600, width: 60 },
  }),
  lucerna: site('lucerna', 'Base Lucerna', 9.5, 31, -620, 1800 / 240e3, 4200 / 240e3, {
    body: 'lucina',
    pads: [{ east: 0, north: 0 }, { east: 180, north: 120 }, { east: -160, north: 170 }],
  }),
};

export const AUSONIA = {
  id: 'ausonia',
  name: 'Ausonia',
  kind: 'planet',
  radius: 800e3,
  mu: 6.144e12, // surface gravity 9.6 m/s²
  soi: Infinity,
  atmosphere: { height: 70e3, scaleHeight: 7000, rho0: 1.225, p0: 101325, sound: 320 },
  ocean: true,
  description: 'Pianeta natale: oceani, continenti e un’atmosfera respirabile alta 70 km.',
};

export const LUCINA = {
  id: 'lucina',
  name: 'Lucina',
  kind: 'moon',
  radius: 240e3,
  mu: 9.33e10, // surface gravity 1.62 m/s²
  soi: 1.873e6,
  atmosphere: null,
  ocean: false,
  orbit: { parent: 'ausonia', a: 10e6, phase0: 0 },
  description: 'Luna di Ausonia, grigia e craterizzata, senza atmosfera.',
};

AUSONIA.terrain = new AusoniaTerrain([SITES.spaceport]);
LUCINA.terrain = new LucinaTerrain([SITES.lucerna]);
LUCINA.orbit.n = Math.sqrt(AUSONIA.mu / LUCINA.orbit.a ** 3);

export const BODIES = { ausonia: AUSONIA, lucina: LUCINA };

/** Lucina's position / velocity (Ausonia-centred) at time t, with a scenario phase offset. */
export function lucinaState(t, phase = 0, pos = new V3(), vel = new V3()) {
  const { a, n } = LUCINA.orbit;
  const th = phase + n * t;
  pos.set(a * Math.cos(th), a * Math.sin(th), 0);
  vel.set(-a * n * Math.sin(th), a * n * Math.cos(th), 0);
  return { pos, vel };
}

/** Sun direction (unit, inertial) from a longitude and declination in degrees. */
export function sunDirection(lonDeg, decDeg = 7) {
  const lo = (lonDeg * Math.PI) / 180, de = (decDeg * Math.PI) / 180;
  return new V3(Math.cos(de) * Math.cos(lo), Math.cos(de) * Math.sin(lo), Math.sin(de));
}

/** Sun longitude that gives `hour` local solar time at a site (12 = noon). */
export function sunLonForLocalTime(siteDef, hour) {
  return siteDef.lon + (hour - 12) * 15;
}

/** Ground point of a site: direction, radius and local east/north/up unit vectors. */
export function siteFrame(siteDef, offsetEast = 0, offsetNorth = 0) {
  const body = BODIES[siteDef.body];
  const up = new V3(...siteDef.dir);
  const east = new V3(-Math.sin((siteDef.lon * Math.PI) / 180), Math.cos((siteDef.lon * Math.PI) / 180), 0);
  const north = new V3().crossVectors(up, east);
  const dir = up.clone().scale(body.radius).addScaled(east, offsetEast).addScaled(north, offsetNorth).normalize();
  const h = body.terrain.height(dir.x, dir.y, dir.z);
  const pos = dir.clone().scale(body.radius + h);
  return { body, pos, up: dir.clone(), east, north, height: h };
}

/** Atmospheric density (kg/m³) and pressure (Pa) at altitude h over a body. */
export function atmosphereAt(body, h) {
  const atm = body.atmosphere;
  if (!atm || h >= atm.height) return { rho: 0, p: 0 };
  const k = Math.exp(-Math.max(h, -200) / atm.scaleHeight);
  // Fade to zero at the top so drag is continuous.
  const fade = h > atm.height - 8000 ? (atm.height - h) / 8000 : 1;
  return { rho: atm.rho0 * k * fade, p: atm.p0 * k * fade };
}

// ---------------------------------------------------------------- orbiting objects

/**
 * Permanent objects. Orbits are circular and on rails: `ref` body, radius, inclination,
 * node and argument of latitude at t = 0 (overridable per scenario).
 */
export const OBJECTS = {
  aurora: {
    id: 'aurora',
    name: 'Stazione Aurora',
    kind: 'station',
    ref: 'ausonia',
    orbit: { altitude: 300e3, inclination: 0, lan: 0, argLat: 0 },
    radius: 95,
    // Docking ports in station body coordinates (x along the main axis, z towards the planet at t0).
    ports: [
      { id: 'prua', name: 'Porta di prua', pos: [46, 0, 0], dir: [1, 0, 0] },
      { id: 'zenit', name: 'Porta zenitale', pos: [8, 0, -9], dir: [0, 0, -1] },
      { id: 'poppa', name: 'Porta di poppa', pos: [-44, 0, 0], dir: [-1, 0, 0] },
    ],
    // Collision volumes: capsules [ax, ay, az, bx, by, bz, radius] and boxes [cx, cy, cz, hx, hy, hz].
    capsules: [
      [-40, 0, 0, 42, 0, 0, 3.4], // pressurised core
      [8, 0, -2, 8, 0, -6.2, 2.2], // zenith node
      [-12, -38, 0, -12, 38, 0, 1.1], // main truss
      [24, 0, 0, 24, 0, 22, 1.2], // ring spoke
    ],
    boxes: [
      [-12, -58, 0, 16, 0.4, 7.5], // solar wings
      [-12, 58, 0, 16, 0.4, 7.5],
      [-30, 0, 9, 7, 0.3, 5], // radiator
    ],
    rings: [{ x: 24, radius: 22, tube: 2.6 }], // habitation ring (around the x axis)
  },
  ardesia: {
    id: 'ardesia',
    name: 'Sciame Ardesia',
    kind: 'swarm',
    ref: 'ausonia',
    // Lucina's leading Lagrange point: same orbit, 60° ahead.
    orbit: { radius: 10e6, inclination: 0, lan: 0, argLat: Math.PI / 3, followsLucina: true },
    radius: 9000,
    asteroids: { count: 170, spread: 7000, seed: 77 },
    outpost: true,
    ports: [{ id: 'miniera', name: 'Avamposto minerario', pos: [0, 0, 18], dir: [0, 0, 1] }],
  },
  selene: {
    id: 'selene',
    name: 'Navetta orbitale Selene',
    kind: 'orbiter',
    ref: 'lucina',
    orbit: { altitude: 60e3, inclination: 0, lan: 0, argLat: 0 },
    radius: 14,
    ports: [{ id: 'nadir', name: 'Porta di attracco', pos: [6.5, 0, 0], dir: [1, 0, 0] }],
    capsules: [[-6, 0, 0, 3.8, 0, 0, 2.1]],
    boxes: [[0, -9, 0, 4, 0.2, 1.4], [0, 9, 0, 4, 0.2, 1.4]],
  },
};

/** Deterministic asteroid list of the swarm: positions relative to the swarm centre. */
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
    // Flattened cloud, denser in the middle; a clear bubble around the outpost.
    const r = spread * Math.pow(rnd(), 0.7);
    const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
    const x = r * Math.sin(ph) * Math.cos(th), y = r * Math.sin(ph) * Math.sin(th), z = r * Math.cos(ph) * 0.45;
    if (Math.hypot(x, y, z) < 420) continue;
    const big = rnd() < 0.08;
    const radius = big ? 120 + rnd() * 260 : 8 + Math.pow(rnd(), 2.2) * 90;
    out.push({ x, y, z, radius, shape: Math.floor(rnd() * 4), spin: (rnd() - 0.5) * 0.02, axis: [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], phase: rnd() * 6.28, tone: rnd() });
  }
  return out;
}
