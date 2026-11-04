// Trajectory prediction with patched conics, maneuver nodes and automatic burn planning.
import { V3, G0, clamp } from '../core/math.js';
import { propagate, elements, orbitalFrame } from './orbit.js';
import { BODIES, LUCINA, lucinaState } from './system.js';

const TAU = Math.PI * 2;

/** Mean anomaly → time helpers on an elements object. */
function meanAnomalyAt(el, nu) {
  const e = el.e;
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += TAU;
    return M;
  }
  const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
  return e * Math.sinh(H) - H;
}

/** Time (s) from the current true anomaly to nuTarget, always in the future (Infinity if never). */
export function timeToTrueAnomaly(el, nuTarget) {
  const M0 = meanAnomalyAt(el, el.nu), M1 = meanAnomalyAt(el, nuTarget);
  if (el.e < 1) {
    let d = M1 - M0;
    while (d <= 1e-9) d += TAU;
    return d / el.n;
  }
  const d = M1 - M0;
  return d > 0 ? d / el.n : Infinity;
}

/** Time until the radius reaches `radius` (rising if `outbound`), or Infinity. */
export function timeToRadius(el, radius, outbound = true) {
  if (el.e < 1e-6) return Infinity;
  const c = (el.p / radius - 1) / el.e;
  if (c < -1 || c > 1) return Infinity;
  const nu = Math.acos(c);
  return timeToTrueAnomaly(el, outbound ? nu : TAU - nu);
}

/** Context with the moving bodies: the scenario phase of Lucina. */
export function bodyPosition(id, t, phase, out = new V3()) {
  if (id === 'lucina') return lucinaState(t, phase, out).pos;
  return out.set(0, 0, 0);
}

export function bodyVelocity(id, t, phase, out = new V3()) {
  if (id === 'lucina') return lucinaState(t, phase, new V3(), out).vel;
  return out.set(0, 0, 0);
}

/**
 * Patched-conic prediction from (pos, vel) relative to `ref` at time t0.
 * Returns segments [{ref, el, t0, pos, vel, tEnd, end: 'none'|'soi-exit'|'encounter'|'impact'|'atmosphere'}].
 */
export function predict(ref, pos, vel, t0, phase, { maxSegments = 3, horizon = 3 * 86400 } = {}) {
  const segments = [];
  let r = pos.clone(), v = vel.clone(), t = t0, curRef = ref;
  for (let k = 0; k < maxSegments; k++) {
    const body = BODIES[curRef];
    const el = elements(r, v, body.mu);
    const seg = { ref: curRef, el, t0: t, pos: r.clone(), vel: v.clone(), tEnd: Infinity, end: 'none' };
    segments.push(seg);
    let tEvent = Infinity, kind = 'none';
    // Surface / atmosphere interface on the way down.
    const floor = body.radius + (body.atmosphere ? body.atmosphere.height : body.terrain.maxHeight * 0.3);
    if (el.rp < floor) {
      const rNow = r.len();
      const tf = rNow > floor ? timeToRadius(el, floor, false) : 0;
      const impactR = body.radius + (body.atmosphere ? 0 : body.terrain.maxHeight * 0.1);
      const ti = el.rp < impactR ? timeToRadius(el, impactR, false) : Infinity;
      if (body.atmosphere && tf < Infinity && rNow > floor) {
        tEvent = tf;
        kind = 'atmosphere';
      } else if (ti < Infinity) {
        tEvent = ti;
        kind = 'impact';
      }
    }
    if (curRef === 'lucina') {
      if (el.e >= 1 || el.ra > LUCINA.soi) {
        const tx = timeToRadius(el, LUCINA.soi, true);
        if (tx < tEvent) {
          tEvent = tx;
          kind = 'soi-exit';
        }
      }
    } else {
      const span = Math.min(horizon, el.e < 1 ? el.period * 1.02 : horizon, tEvent);
      const enc = findEncounter(r, v, t, span, phase, body.mu);
      if (enc !== null && enc < tEvent) {
        tEvent = enc;
        kind = 'encounter';
      }
    }
    if (kind === 'none' || !Number.isFinite(tEvent)) break;
    seg.tEnd = t + tEvent;
    seg.end = kind;
    if (kind === 'impact' || kind === 'atmosphere') break;
    const nr = new V3(), nv = new V3();
    if (!propagate(r, v, tEvent, body.mu, nr, nv)) break;
    t += tEvent;
    const lp = lucinaState(t, phase);
    if (kind === 'encounter') {
      nr.sub(lp.pos);
      nv.sub(lp.vel);
      curRef = 'lucina';
    } else {
      nr.add(lp.pos);
      nv.add(lp.vel);
      curRef = 'ausonia';
    }
    r = nr;
    v = nv;
  }
  return segments;
}

/** First time (s from now) the Ausonia-centred trajectory enters Lucina's sphere of influence. */
function findEncounter(r, v, t0, span, phase, mu) {
  if (!(span > 0)) return null;
  // Quick reject: the orbit never reaches Lucina's distance band.
  const el = elements(r, v, mu);
  const a = LUCINA.orbit.a;
  if (el.e < 1 && el.ra < a - LUCINA.soi) return null;
  if (el.rp > a + LUCINA.soi) return null;
  const n = Math.min(900, Math.max(120, Math.ceil(span / 60)));
  const dt = span / n;
  const pr = new V3(), pv = new V3(), lp = new V3();
  const dist = (s) => {
    propagate(r, v, s, mu, pr, pv);
    bodyPosition('lucina', t0 + s, phase, lp);
    return Math.hypot(pr.x - lp.x, pr.y - lp.y, pr.z - lp.z);
  };
  if (dist(0) < LUCINA.soi) return null; // already inside (handled by the caller's frame)
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const s = i * dt;
    if (dist(s) < LUCINA.soi) {
      let lo = prev, hi = s;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (dist(mid) < LUCINA.soi) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = s;
  }
  return null;
}

/** State of the ship at absolute time t from its current state (same reference, no SOI change). */
export function stateAt(ref, pos, vel, t0, t) {
  const mu = BODIES[ref].mu;
  const r = new V3(), v = new V3();
  propagate(pos, vel, t - t0, mu, r, v);
  return { r, v };
}

/** World Δv vector of a node given the state at the node. */
export function nodeVector(node, r, v) {
  const { pro, nor, rad } = orbitalFrame(r, v);
  return new V3().addScaled(pro, node.pro).addScaled(nor, node.nor).addScaled(rad, node.rad);
}

/** Decompose a world vector into (pro, nor, rad) at state (r, v). */
export function decompose(dv, r, v) {
  const { pro, nor, rad } = orbitalFrame(r, v);
  return { pro: dv.dot(pro), nor: dv.dot(nor), rad: dv.dot(rad) };
}

/** Burn duration (s) for dv with the ship's active engine. */
export function burnTime(ship, dv) {
  const st = ship.engineStage;
  if (!st || st.fuelLeft <= 0 || dv <= 0) return 0;
  const ve = st.engine.ispVac * G0;
  const m1 = ship.mass * Math.exp(-dv / ve);
  if (ship.mass - m1 > st.fuelLeft) return Infinity;
  return ((ship.mass - m1) * ve) / st.engine.thrustVac;
}

/** Trajectory after a node: segments starting at the node time. */
export function predictWithNode(ref, pos, vel, t0, node, phase) {
  const { r, v } = stateAt(ref, pos, vel, t0, node.t);
  const dv = nodeVector(node, r, v);
  return predict(ref, r, v.clone().add(dv), node.t, phase);
}

/** Closest approach to an object on rails within `span` seconds (same reference). */
export function closestApproach(ref, pos, vel, t0, targetState, span) {
  const mu = BODIES[ref].mu;
  const n = 360;
  const pr = new V3(), pv = new V3();
  const f = (s) => {
    propagate(pos, vel, s, mu, pr, pv);
    const ts = targetState(t0 + s);
    return Math.hypot(pr.x - ts.pos.x, pr.y - ts.pos.y, pr.z - ts.pos.z);
  };
  let best = Infinity, bi = 0;
  for (let i = 0; i <= n; i++) {
    const d = f((i * span) / n);
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  let lo = Math.max(0, ((bi - 1) * span) / n), hi = Math.min(span, ((bi + 1) * span) / n);
  const g = 0.381966;
  for (let k = 0; k < 50; k++) {
    const a = lo + (hi - lo) * g, b = hi - (hi - lo) * g;
    if (f(a) < f(b)) hi = b;
    else lo = a;
  }
  const s = (lo + hi) / 2;
  const d = f(s);
  const ts = targetState(t0 + s);
  const rel = Math.hypot(pv.x - ts.vel.x, pv.y - ts.vel.y, pv.z - ts.vel.z);
  return { t: t0 + s, dist: d, relSpeed: rel };
}

// ---------------------------------------------------------------- automatic burn planning

function circSpeed(mu, r) {
  return Math.sqrt(mu / r);
}

/** Circularise at the next apoapsis ('ap') or periapsis ('pe'). */
export function planCircularize(ref, pos, vel, t0, at = 'ap') {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  let dt;
  if (at === 'ap') {
    if (el.e >= 1) return null;
    dt = el.timeToAp;
  } else dt = el.timeToPe;
  if (!Number.isFinite(dt)) return null;
  if (el.e < 0.002) dt = 60;
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + dt);
  const target = new V3().crossVectors(new V3().crossVectors(r, v), r).normalize().scale(circSpeed(mu, r.len()));
  const dv = target.sub(v);
  return { t: t0 + dt, ...decompose(dv, r, v) };
}

/** Change the opposite apsis to radius rTarget, burning at the next apsis (or soon if circular). */
export function planApsis(ref, pos, vel, t0, rTarget) {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  if (el.e >= 1) return null;
  const raising = rTarget > el.a;
  let dt = raising ? el.timeToPe : el.timeToAp;
  if (el.e < 0.003) dt = 60;
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + dt);
  const rb = r.len();
  const a = (rb + rTarget) / 2;
  const vNew = Math.sqrt(mu * (2 / rb - 1 / a));
  const horiz = new V3().crossVectors(new V3().crossVectors(r, v), r).normalize();
  const dv = horiz.scale(vNew).sub(v);
  return { t: t0 + dt, ...decompose(dv, r, v) };
}

/** Rotate the orbit plane into the target's plane at the next relative node. */
export function planMatchPlane(ref, pos, vel, t0, targetH) {
  const mu = BODIES[ref].mu;
  const h = new V3().crossVectors(pos, vel);
  const line = new V3().crossVectors(h, targetH);
  if (line.len() < 1e-9 * h.len() * targetH.len()) return null;
  line.normalize();
  const el = elements(pos, vel, mu);
  // True anomaly of the two nodes; pick the nearer in time.
  const { P, Q } = perifocalOf(el);
  const best = [line, line.clone().scale(-1)].map((d) => {
    const nu = Math.atan2(d.dot(Q), d.dot(P));
    return { dt: timeToTrueAnomaly(el, nu < 0 ? nu + TAU : nu), d };
  }).sort((a, b) => a.dt - b.dt)[0];
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + best.dt);
  // New velocity: same magnitude and flight path, in the target plane.
  const nT = targetH.clone().normalize();
  const vr = r.clone().normalize().scale(v.dot(r) / r.len());
  const vh = v.clone().sub(vr);
  const dirH = new V3().crossVectors(nT, r).normalize();
  if (dirH.dot(vh) < 0) dirH.scale(-1);
  const vNew = dirH.scale(vh.len()).add(vr);
  const dv = vNew.sub(v);
  return { t: t0 + best.dt, ...decompose(dv, r, v) };
}

function perifocalOf(el) {
  const { lan: O, i, argp: w } = el;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return {
    P: new V3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si),
    Q: new V3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si),
  };
}

/** Phase angle (rad, 0..2π) of b ahead of a around the orbit normal h. */
function phaseAngle(a, b, h) {
  const n = h.clone().normalize();
  const x = a.clone().normalize();
  const y = new V3().crossVectors(n, x);
  let ang = Math.atan2(b.dot(y), b.dot(x));
  if (ang < 0) ang += TAU;
  return ang;
}

/**
 * Hohmann transfer towards an object on a (near) circular orbit around the same body,
 * then a local search on node time and Δv to minimise the closest approach.
 */
export function planRendezvous(ref, pos, vel, t0, targetState) {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  const t1 = targetState(t0);
  const r1 = el.a > 0 ? el.a : pos.len();
  const r2 = t1.pos.len();
  const h = new V3().crossVectors(pos, vel);
  const n1 = Math.sqrt(mu / r1 ** 3), n2 = Math.sqrt(mu / r2 ** 3);
  const at = (r1 + r2) / 2;
  const tt = Math.PI * Math.sqrt(at ** 3 / mu);
  const lead = Math.PI - n2 * tt; // target must lead by this at departure
  const phi = phaseAngle(pos, t1.pos, h);
  const dn = n1 - n2;
  if (Math.abs(dn) < 1e-9) return null;
  let wait = (phi - lead) / dn;
  const syn = TAU / Math.abs(dn);
  wait = ((wait % syn) + syn) % syn;
  if (wait < 30) wait += syn;
  const dv0 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  let best = { t: t0 + wait, pro: dv0, nor: 0, rad: 0 };
  const cost = (node) => {
    const { r, v } = stateAt(ref, pos, vel, t0, node.t);
    const nv = v.clone().add(nodeVector(node, r, v));
    return closestApproach(ref, r, nv, node.t, targetState, tt * 1.4).dist;
  };
  let bestCost = cost(best);
  let steps = [60, Math.abs(dv0) * 0.04 + 0.5];
  for (let iter = 0; iter < 26; iter++) {
    let improved = false;
    for (const [key, step] of [['t', steps[0]], ['pro', steps[1]], ['rad', steps[1]]]) {
      for (const s of [-1, 1]) {
        const cand = { ...best, [key]: best[key] + s * step };
        if (cand.t < t0 + 10) continue;
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) steps = steps.map((s) => s * 0.5);
  }
  return { ...best, expected: bestCost };
}

/**
 * Transfer from Ausonia orbit to Lucina with a periapsis at `pe` metres altitude: Hohmann
 * estimate, then a search on time and prograde Δv using the patched-conic predictor.
 */
export function planLucinaTransfer(pos, vel, t0, phase, peAlt = 60e3) {
  const mu = BODIES.ausonia.mu;
  const el = elements(pos, vel, mu);
  if (el.e >= 1) return null;
  const r1 = el.a, r2 = LUCINA.orbit.a;
  const h = new V3().crossVectors(pos, vel);
  const at = (r1 + r2) / 2;
  const tt = Math.PI * Math.sqrt(at ** 3 / mu);
  const n1 = Math.sqrt(mu / r1 ** 3), n2 = LUCINA.orbit.n;
  const lp = lucinaState(t0, phase).pos;
  const phi = phaseAngle(pos, lp, h);
  const lead = Math.PI - n2 * tt;
  const dn = n1 - n2;
  const syn = TAU / dn;
  let wait = (((phi - lead) / dn) % syn + syn) % syn;
  if (wait < 60) wait += syn;
  const dv0 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const wantR = LUCINA.radius + peAlt;
  const cost = (node) => {
    const segs = predictWithNode('ausonia', pos, vel, t0, { ...node, nor: 0, rad: 0 }, phase);
    const s = segs.find((x) => x.ref === 'lucina');
    if (!s) {
      // No encounter: distance of closest approach to Lucina (rough) as penalty.
      return 1e7 + approachToLucina(segs[0], phase);
    }
    // Prefer prograde (counter-clockwise) arrival orbits.
    const retro = s.el.h.z < 0 ? 2e5 : 0;
    return Math.abs(s.el.rp - wantR) + retro;
  };
  let best = { t: t0 + wait, pro: dv0 };
  let bestCost = cost(best);
  let steps = [120, 6];
  for (let iter = 0; iter < 36; iter++) {
    let improved = false;
    for (const [key, step] of [['t', steps[0]], ['pro', steps[1]]]) {
      for (const s of [-1, 1]) {
        const cand = { ...best, [key]: best[key] + s * step };
        if (cand.t < t0 + 20) continue;
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) steps = steps.map((s) => s * 0.5);
    if (bestCost < 2000) break;
  }
  return { t: best.t, pro: best.pro, nor: 0, rad: 0, expected: bestCost };
}

function approachToLucina(seg, phase) {
  const span = seg.el.e < 1 ? seg.el.period : 2e5;
  return closestApproach('ausonia', seg.pos, seg.vel, seg.t0, (t) => lucinaState(t, phase), span).dist;
}

/**
 * Leave Lucina towards Ausonia with an Ausonia periapsis at `peAlt` (re-entry corridor):
 * search over the burn point on the current lunar orbit and the prograde Δv.
 */
export function planReturnToAusonia(pos, vel, t0, phase, peAlt = 45e3) {
  const mu = BODIES.lucina.mu;
  const el = elements(pos, vel, mu);
  if (el.e >= 1) return null;
  const wantR = BODIES.ausonia.radius + peAlt;
  const vEsc = Math.sqrt((2 * mu) / el.a);
  const cost = (node) => {
    const segs = predictWithNode('lucina', pos, vel, t0, { ...node, nor: 0, rad: 0 }, phase);
    const s = segs.find((x) => x.ref === 'ausonia');
    if (!s) return 1e8;
    return Math.abs(s.el.rp - wantR);
  };
  let best = null, bestCost = Infinity;
  for (let k = 0; k < 24; k++) {
    for (const extra of [80, 160, 260]) {
      const cand = { t: t0 + 60 + (k / 24) * el.period, pro: vEsc - Math.sqrt(mu / el.a) + extra };
      const c = cost(cand);
      if (c < bestCost) {
        best = cand;
        bestCost = c;
      }
    }
  }
  if (!best) return null;
  let steps = [el.period / 48, 20];
  for (let iter = 0; iter < 36; iter++) {
    let improved = false;
    for (const [key, step] of [['t', steps[0]], ['pro', steps[1]]]) {
      for (const s of [-1, 1]) {
        const cand = { ...best, [key]: best[key] + s * step };
        if (cand.t < t0 + 20) continue;
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) steps = steps.map((s) => s * 0.5);
  }
  return { t: best.t, pro: best.pro, nor: 0, rad: 0, expected: bestCost };
}

/**
 * Mid-course correction: small burn in a minute that sets the periapsis at the next body
 * (Lucina when outbound, Ausonia when returning) to `peAlt`.
 */
export function planCourseCorrection(ref, pos, vel, t0, phase, peAlt) {
  const nextRef = ref === 'ausonia' ? 'lucina' : 'ausonia';
  const wantR = BODIES[nextRef].radius + peAlt;
  const tNode = t0 + 60;
  const cost = (node) => {
    const segs = predictWithNode(ref, pos, vel, t0, { ...node, t: tNode }, phase);
    const s = segs.find((x) => x.ref === nextRef);
    if (!s) return 1e8 + (nextRef === 'lucina' ? approachToLucina(segs[0], phase) : 0) + Math.hypot(node.pro, node.nor, node.rad) * 10;
    return Math.abs(s.el.rp - wantR) + Math.hypot(node.pro, node.nor, node.rad) * 200;
  };
  let best = { pro: 0, nor: 0, rad: 0 };
  let bestCost = cost(best);
  let step = 8;
  for (let iter = 0; iter < 60 && step > 0.02; iter++) {
    let improved = false;
    for (const key of ['pro', 'rad', 'nor']) {
      for (const s of [-1, 1]) {
        const cand = { ...best, [key]: best[key] + s * step };
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
  }
  return { t: tNode, ...best, expected: bestCost };
}

/** Retro burn to lower the periapsis to `peAlt` half an orbit from now (or `delay`). */
export function planDeorbit(ref, pos, vel, t0, peAlt, delay = 90) {
  const body = BODIES[ref];
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + delay);
  const mu = body.mu;
  const rb = r.len();
  const rp = body.radius + peAlt;
  if (rp >= rb) return null;
  const a = (rb + rp) / 2;
  const vNew = Math.sqrt(mu * (2 / rb - 1 / a));
  const horiz = new V3().crossVectors(new V3().crossVectors(r, v), r).normalize();
  const dv = horiz.scale(vNew).sub(v);
  return { t: t0 + delay, ...decompose(dv, r, v) };
}

export { clamp };
