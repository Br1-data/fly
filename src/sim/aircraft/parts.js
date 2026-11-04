// Building blocks for aircraft definitions: wing panels, tail planes, fuselage, contacts
// and lights derived from a few real dimensions (area, span, taper, sweep, positions).
// Body axes: x forward, y right, z down, origin at the centre of gravity.
export const DEG = Math.PI / 180;

/**
 * Four wing panels (inner/outer per side). The outer panels carry the ailerons; the inner
 * ones the flaps (outer flaps too when `outerFlap` is given, as on airliners and deltas)
 * and sit in the propeller slipstream (`propwash`).
 */
export function wing({
  area, span, taper = 0.5, sweep = 0, x = 0, z = 0, dihedral = 3, incidence = 1.5, washout = 2,
  clMax = 1.45, flap = null, outerFlap = null, aileronTau = 0.42, split = 0.55, propwash = 0, base = {},
}) {
  const half = span / 2;
  const root = (2 * area) / (span * (1 + taper));
  const chordAt = (f) => root + (root * taper - root) * f;
  const panel = (f0, f1) => {
    const c0 = chordAt(f0), c1 = chordAt(f1);
    const f = (f0 + f1) / 2;
    return {
      area: ((c0 + c1) / 2) * (f1 - f0) * half,
      chord: (c0 + c1) / 2,
      y: f * half,
      x: x - f * half * Math.tan(sweep * DEG),
      z: z - f * half * Math.tan(dihedral * DEG),
    };
  };
  const inner = panel(0.08, split), outer = panel(split, 0.96);
  // Panels cover 8–96 % of the half span; scale so the areas add up to the real wing.
  const k = area / 2 / (inner.area + outer.area);
  const common = { group: 'wing', ar: (span * span) / area, sweep, alpha0: -2, clMin: -1, cd0: 0.006, e: 0.8, cm0: -0.04, dihedral, ...base };
  const surfaces = [];
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? 1 : -1;
    surfaces.push(
      { ...common, name: `wing${side}I`, side, pos: [inner.x, s * inner.y, inner.z], area: inner.area * k, chord: inner.chord, incidence, clMax,
        ...(flap ? { flap } : {}), ...(propwash ? { propwash } : {}) },
      { ...common, name: `wing${side}O`, side, pos: [outer.x, s * outer.y, outer.z], area: outer.area * k, chord: outer.chord, incidence: incidence - washout,
        clMax: clMax * 0.97, aileron: -s, tau: aileronTau, ...(outerFlap ? { flap: outerFlap } : {}) },
    );
  }
  return surfaces;
}

/** Horizontal tail (elevator, or all-moving `stab` for trimmable stabilisers). */
export function hstab({ area, x, z = 0, ar = 4, sweep = 0, incidence = -1.5, tau = 0.5, cmCtrl = 0.12, stab = false, propwash = 0, clMax = 1.2 }) {
  return {
    name: 'hstab', side: 'C', pos: [x, 0, z], area, chord: Math.sqrt(area / ar), ar, sweep, alpha0: 0, clMax, clMin: -clMax, cd0: 0.008, e: 0.75,
    incidence, elevator: -1, tau, cmCtrl, downwash: true, ...(stab ? { stab: -1 } : {}), ...(propwash ? { propwash } : {}),
  };
}

/** Vertical tail (twin fins are lumped into one equivalent surface). */
export function fin({ area, x, z = -1, ar = 1.8, sweep = 30, tau = 0.5, propwash = 0, swirl = 0 }) {
  return {
    name: 'vfin', vertical: true, pos: [x, 0, z], area, chord: Math.sqrt(area / ar), ar, sweep, alpha0: 0, clMax: 1.1, clMin: -1.1, cd0: 0.008, e: 0.7,
    rudder: -1, tau, cmCtrl: 0.1, ...(propwash ? { propwash } : {}), ...(swirl ? { swirl } : {}),
  };
}

/** Fuselage lift/side-force surfaces (destabilising, ahead of the centre of gravity). */
export function body({ length, width, height = width, x = length * 0.1, z = 0 }) {
  return [
    { name: 'fusH', side: 'C', pos: [x, 0, z], area: 0.22 * length * width, chord: length * 0.35, ar: 1.0, clAlpha: 0.8, clMax: 0.6, clMin: -0.6, cd0: 0, e: 0.5 },
    { name: 'fusV', vertical: true, pos: [x * 0.7, 0, z], area: 0.42 * length * height, chord: length * 0.42, ar: 0.8, clAlpha: 0.7, clMax: 0.6, clMin: -0.6, cd0: 0, e: 0.5 },
  ];
}

/** Structure contact points used for crash detection (nose, tail, wing tips, belly, top). */
export function contacts({ nose, tail, half, tipX = 0, tipZ = 0, belly, top, extra = [] }) {
  return [
    { name: 'tail', pos: [tail, 0, belly * 0.4], critical: false },
    { name: 'ala sinistra', pos: [tipX, -half, tipZ] },
    { name: 'ala destra', pos: [tipX, half, tipZ] },
    { name: 'muso', pos: [nose, 0, belly * 0.6] },
    { name: 'ventre', pos: [0, 0, belly] },
    { name: 'tettuccio', pos: [nose * 0.4, 0, top] },
    ...extra,
  ];
}

/** Navigation, strobe, beacon and landing lights at the wing tips and tail. */
export function lights({ half, tipX = 0, tipZ = 0, tail, tailZ, beacon, landing }) {
  return {
    navL: [tipX, -half, tipZ],
    navR: [tipX, half, tipZ],
    tail: [tail, 0, tailZ],
    beacon,
    landing,
    strobeL: [tipX - 0.05, -half - 0.03, tipZ],
    strobeR: [tipX - 0.05, half + 0.03, tipZ],
  };
}

/**
 * Propeller tables: the trainer's fixed-pitch curves (ct, cp against advance ratio J),
 * scaled for blade count and solidity. The engine's `pitch` (fixed) or `governor`
 * (constant speed) shifts them to coarser blade angles.
 */
const CT = [[0, 0.1], [0.2, 0.0954], [0.3, 0.093], [0.4, 0.0842], [0.5, 0.072], [0.6, 0.0587], [0.7, 0.0463], [0.8, 0.033], [0.9, 0.0187], [1.0, 0.0058], [1.1, -0.006], [1.2, -0.018], [1.4, -0.045], [1.6, -0.07], [2.0, -0.11]];
const CP = [[0, 0.055], [0.2, 0.054], [0.3, 0.0525], [0.4, 0.051], [0.5, 0.048], [0.6, 0.044], [0.7, 0.0395], [0.8, 0.033], [0.9, 0.024], [1.0, 0.013], [1.1, 0.001], [1.2, -0.01], [1.4, -0.028], [1.6, -0.042], [2.0, -0.06]];
export function propeller(solidity = 1, staticGain = 1) {
  // Constant-speed blades at their fine stop pull harder at low speed (staticGain > 1).
  const gain = (j) => 1 + (staticGain - 1) * Math.max(0, 1 - j / 0.6);
  return { ct: CT.map(([j, c]) => [j, c * solidity * gain(j)]), cp: CP.map(([j, c]) => [j, c * solidity]) };
}

/** Fuel tanks split between the wings (and an optional fuselage tank). */
export function tanks(capacity, wingY, centre = 0) {
  const wingFuel = (capacity - centre) / 2;
  return [
    { name: 'Ala sinistra', capacity: wingFuel, y: -wingY },
    { name: 'Ala destra', capacity: wingFuel, y: wingY },
    ...(centre ? [{ name: 'Fusoliera', capacity: centre, y: 0 }] : []),
  ];
}
