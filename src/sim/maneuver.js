// Trajectory prediction with patched conics over the body hierarchy (Sun → planets →
// moons), maneuver nodes and automatic burn planning (circularisation, apsis changes, plane
// changes, rendezvous, transfers to a moon or a planet, returns, course corrections).
import { V3, G0 } from '../core/math.js';
import { propagate, elements, orbitalFrame } from './orbit.js';
import { BODIES, childrenOf, relativeState } from './system.js';

const TAU = Math.PI * 2;

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

/** Time (s) from the current true anomaly to nuTarget, in the future (Infinity if never). */
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

/** First time (s from t0) the trajectory around `ref` enters the sphere of a child body. */
function findEncounter(ref, r, v, t0, span, mu, exclude) {
  if (!(span > 0)) return null;
  const el = elements(r, v, mu);
  let best = null;
  for (const c of childrenOf(ref)) {
    if (c.id === exclude) continue;
    const a = c.orbit.a, s = c.soi;
    const ap = c.orbit.a * (1 + (c.orbit.e || 0)), pe = c.orbit.a * (1 - (c.orbit.e || 0));
    if (el.e < 1 && el.ra < pe - s) continue;
    if (el.rp > ap + s) continue;
    const limit = best ? best.dt : span;
    const n = Math.min(1400, Math.max(160, Math.ceil(limit / Math.max(60, (c.soi / 8000)))));
    const dt = limit / n;
    const pr = new V3(), pv = new V3();
    const dist = (sec) => {
      propagate(r, v, sec, mu, pr, pv);
      const cs = relativeState(c.id, ref, t0 + sec).pos;
      return Math.hypot(pr.x - cs.x, pr.y - cs.y, pr.z - cs.z);
    };
    if (dist(0) < s) continue;
    void a;
    let prev = 0;
    for (let i = 1; i <= n; i++) {
      const sec = i * dt;
      if (dist(sec) < s) {
        let lo = prev, hi = sec;
        for (let j = 0; j < 40; j++) {
          const mid = (lo + hi) / 2;
          if (dist(mid) < s) hi = mid;
          else lo = mid;
        }
        if (!best || hi < best.dt) best = { dt: hi, body: c.id };
        break;
      }
      prev = sec;
    }
  }
  return best;
}

/**
 * Patched-conic prediction from (pos, vel) relative to `ref` at time t0.
 * Segments [{ref, el, t0, pos, vel, tEnd, end: 'none'|'soi-exit'|'encounter'|'impact'|'atmosphere', next}].
 */
export function predict(ref, pos, vel, t0, _unused, { maxSegments = 4, horizon } = {}) {
  const segments = [];
  let r = pos.clone(), v = vel.clone(), t = t0, cur = ref, from = null;
  for (let k = 0; k < maxSegments; k++) {
    const body = BODIES[cur];
    const el = elements(r, v, body.mu);
    const seg = { ref: cur, el, t0: t, pos: r.clone(), vel: v.clone(), tEnd: Infinity, end: 'none', next: null };
    segments.push(seg);
    let tEvent = Infinity, kind = 'none', next = null;
    const floor = body.radius + (body.atmosphere ? Math.min(body.atmosphere.height, 120e3) : (body.terrain?.maxHeight || 0) * 0.5 + 2000);
    if (el.rp < floor && cur !== 'sun') {
      const rNow = r.len();
      const tf = rNow > floor ? timeToRadius(el, floor, false) : 0;
      const ti = timeToRadius(el, body.radius + 100, false);
      if (body.atmosphere && tf < Infinity && rNow > floor) {
        tEvent = tf;
        kind = 'atmosphere';
      } else if (ti < Infinity && el.rp < body.radius) {
        tEvent = ti;
        kind = 'impact';
      }
    }
    if (body.parent && (el.e >= 1 || el.ra > body.soi)) {
      const tx = timeToRadius(el, body.soi, true);
      if (tx < tEvent) {
        tEvent = tx;
        kind = 'soi-exit';
        next = body.parent;
      }
    }
    const span = Math.min(horizon || (cur === 'sun' ? 3.2e7 * 1.5 : 30 * 86400), el.e < 1 ? el.period * 1.02 : Infinity, tEvent);
    const enc = findEncounter(cur, r, v, t, Number.isFinite(span) ? span : 3e7, body.mu, from);
    if (enc && enc.dt < tEvent) {
      tEvent = enc.dt;
      kind = 'encounter';
      next = enc.body;
    }
    if (kind === 'none' || !Number.isFinite(tEvent)) break;
    seg.tEnd = t + tEvent;
    seg.end = kind;
    seg.next = next;
    if (kind === 'impact' || kind === 'atmosphere') break;
    const nr = new V3(), nv = new V3();
    if (!propagate(r, v, tEvent, body.mu, nr, nv)) break;
    t += tEvent;
    const rel = relativeState(next, cur, t);
    nr.sub(rel.pos);
    nv.sub(rel.vel);
    from = kind === 'soi-exit' ? cur : null;
    cur = next;
    r = nr;
    v = nv;
  }
  return segments;
}

export function stateAt(ref, pos, vel, t0, t) {
  const mu = BODIES[ref].mu;
  const r = new V3(), v = new V3();
  propagate(pos, vel, t - t0, mu, r, v);
  return { r, v };
}

export function nodeVector(node, r, v) {
  const { pro, nor, rad } = orbitalFrame(r, v);
  return new V3().addScaled(pro, node.pro).addScaled(nor, node.nor).addScaled(rad, node.rad);
}

export function decompose(dv, r, v) {
  const { pro, nor, rad } = orbitalFrame(r, v);
  return { pro: dv.dot(pro), nor: dv.dot(nor), rad: dv.dot(rad) };
}

export function burnTime(ship, dv) {
  const st = ship.engineStage;
  if (!st || st.fuelLeft <= 0 || dv <= 0) return 0;
  const ve = st.engine.ispVac * G0;
  const m1 = ship.mass * Math.exp(-dv / ve);
  if (ship.mass - m1 > st.fuelLeft) return Infinity;
  return ((ship.mass - m1) * ve) / st.engine.thrustVac;
}

export function predictWithNode(ref, pos, vel, t0, node) {
  const { r, v } = stateAt(ref, pos, vel, t0, node.t);
  return predict(ref, r, v.clone().add(nodeVector(node, r, v)), node.t);
}

/** Closest approach to a target on rails within `span` seconds (same reference). */
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
  return { t: t0 + s, dist: d, relSpeed: Math.hypot(pv.x - ts.vel.x, pv.y - ts.vel.y, pv.z - ts.vel.z) };
}


// ---------------------------------------------------------------- Lambert's problem

function stumpffCS(z) {
  if (z > 1e-6) {
    const q = Math.sqrt(z);
    return [(1 - Math.cos(q)) / z, (q - Math.sin(q)) / (q * q * q)];
  }
  if (z < -1e-6) {
    const q = Math.sqrt(-z);
    return [(Math.cosh(q) - 1) / -z, (Math.sinh(q) - q) / (q * q * q)];
  }
  return [0.5, 1 / 6];
}

/**
 * Single-revolution Lambert solution (universal variables, Curtis alg. 5.2) from R1 to R2
 * in time dt, prograde with respect to the normal `href`. Returns {v1, v2} or null.
 */
export function lambert(R1, R2, dt, mu, href) {
  const r1 = R1.len(), r2 = R2.len();
  const cross = new V3().crossVectors(R1, R2);
  let th = Math.acos(Math.max(-1, Math.min(1, R1.dot(R2) / (r1 * r2))));
  if (cross.dot(href) < 0) th = TAU - th;
  const A = Math.sin(th) * Math.sqrt((r1 * r2) / (1 - Math.cos(th)));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9) return null;
  const y = (z) => {
    const [C, S] = stumpffCS(z);
    return r1 + r2 + (A * (z * S - 1)) / Math.sqrt(C);
  };
  const F = (z) => {
    const [C, S] = stumpffCS(z);
    const yz = y(z);
    if (yz < 0) return -Infinity;
    return Math.pow(yz / C, 1.5) * S + A * Math.sqrt(yz) - Math.sqrt(mu) * dt;
  };
  // Bracket and bisect (F increases with z on the single-revolution branch).
  let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI * 0.999;
  while (y(lo) < 0 && lo < hi) lo += 0.1;
  if (F(lo) > 0 || F(hi) < 0) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (F(mid) < 0) lo = mid;
    else hi = mid;
  }
  const yz = y((lo + hi) / 2);
  const f = 1 - yz / r1, g = A * Math.sqrt(yz / mu), gd = 1 - yz / r2;
  const v1 = R2.clone().addScaled(R1, -f).scale(1 / g);
  const v2 = R2.clone().scale(gd).sub(R1).scale(1 / g);
  return { v1, v2 };
}

/**
 * Interplanetary departure from a circular-ish parking orbit around `ref` towards the
 * planet `target` (both orbiting the same parent): porkchop search with Lambert for the
 * departure date and flight time, then the burn point on the parking orbit that puts the
 * escape asymptote along the required hyperbolic excess velocity.
 */
/** Best departure (Lambert porkchop) from `ref` to the planet `target` after t0. */
export function porkchop(ref, target, t0) {
  const body = BODIES[ref];
  const P = BODIES[body.parent];
  const tb = BODIES[target];
  const sA = relativeState(ref, body.parent, t0);
  const r1 = sA.pos.len(), r2 = tb.orbit.a;
  const tH = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / P.mu);
  const n1 = Math.sqrt(P.mu / r1 ** 3), n2 = tb.orbit.n;
  const href = new V3().crossVectors(sA.pos, sA.vel).normalize();
  const dn = n1 - n2;
  const syn = TAU / Math.abs(dn);
  const sB = relativeState(target, body.parent, t0);
  let wait = (((phaseAngle(sA.pos, sB.pos, href) - (Math.PI - n2 * tH)) / dn) % syn + syn) % syn;
  if (wait < 5 * 86400) wait += syn;
  const departure = (td, tof) => {
    const a = relativeState(ref, body.parent, td), b = relativeState(target, body.parent, td + tof);
    const sol = lambert(a.pos, b.pos, tof, P.mu, href);
    if (!sol) return null;
    const vinf = sol.v1.clone().sub(a.vel);
    const varr = sol.v2.clone().sub(b.vel);
    return { td, tof, vinf, varr, cost: vinf.len() + 0.35 * varr.len() };
  };
  let best = null;
  for (let d = -70; d <= 70; d += 5) {
    for (let k = 0.7; k <= 1.31; k += 0.05) {
      const c = departure(t0 + wait + d * 86400, tH * k);
      if (c && c.td > t0 + 86400 && (!best || c.cost < best.cost)) best = c;
    }
  }
  if (!best) return null;
  for (let it = 0; it < 30; it++) {
    let improved = false;
    for (const [dd, dk] of [[86400, 0], [-86400, 0], [0, tH * 0.01], [0, -tH * 0.01]]) {
      const c = departure(best.td + dd / (1 + it * 0.2), best.tof + dk / (1 + it * 0.2));
      if (c && c.td > t0 + 86400 && c.cost < best.cost) {
        best = c;
        improved = true;
      }
    }
    if (!improved && it > 6) break;
  }
  return best;
}

function planInterplanetary(ref, pos, vel, t0, target, wantR) {
  const body = BODIES[ref];
  const best = porkchop(ref, target, t0);
  if (!best) return null;
  if (best.td < t0 + 3600) return null;
  // Burn on the parking orbit about 1.5 days before the heliocentric departure (escape time).
  const el = elements(pos, vel, body.mu);
  const h = new V3().crossVectors(pos, vel).normalize();
  const vin = best.vinf.len();
  const rp = el.a;
  const e = 1 + (rp * vin * vin) / body.mu;
  const nuInf = Math.acos(-1 / e);
  const a = best.vinf.clone().addScaled(h, -best.vinf.dot(h)).normalize();
  const peri = a.clone().scale(Math.cos(nuInf)).sub(new V3().crossVectors(h, a).scale(Math.sin(nuInf))).normalize();
  // Time (near the departure) when the ship passes over `peri`.
  const tGuess = best.td - 1.2 * 86400;
  const sg = stateAt(ref, pos, vel, t0, Math.max(t0 + 120, tGuess));
  const eg = elements(sg.r, sg.v, body.mu);
  const { P: Pp, Q: Qp } = perifocalOf(eg);
  const nuP = Math.atan2(peri.dot(Qp), peri.dot(Pp));
  let tBurn = Math.max(t0 + 120, tGuess) + timeToTrueAnomaly(eg, nuP < 0 ? nuP + TAU : nuP);
  const dv0 = Math.sqrt(vin * vin + (2 * body.mu) / rp) - Math.sqrt(body.mu / rp);
  const cost = (node) => encounterCost(predictWithNode(ref, pos, vel, t0, node), target, wantR, ref);
  const res = refine({ t: tBurn, pro: dv0, nor: 0, rad: 0 }, ['pro', 't', 'nor', 'rad'], { t: el.period / 40, pro: 10, nor: 20, rad: 20 }, cost, t0, 80, 5e4);
  return { ...res.node, expected: res.cost, window: best.td, tof: best.tof, vinf: vin };
}

// ---------------------------------------------------------------- planning

function horizontal(r, v) {
  return new V3().crossVectors(new V3().crossVectors(r, v), r).normalize();
}

export function planCircularize(ref, pos, vel, t0, at = 'ap') {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  let dt = at === 'ap' ? (el.e < 1 ? el.timeToAp : NaN) : el.timeToPe;
  if (!Number.isFinite(dt)) return null;
  if (el.e < 0.002) dt = 60;
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + dt);
  const dv = horizontal(r, v).scale(Math.sqrt(mu / r.len())).sub(v);
  return { t: t0 + dt, ...decompose(dv, r, v) };
}

export function planApsis(ref, pos, vel, t0, rTarget) {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  if (el.e >= 1) return null;
  let dt = rTarget > el.a ? el.timeToPe : el.timeToAp;
  if (el.e < 0.003) dt = 60;
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + dt);
  const rb = r.len();
  const a = (rb + rTarget) / 2;
  const dv = horizontal(r, v).scale(Math.sqrt(mu * (2 / rb - 1 / a))).sub(v);
  return { t: t0 + dt, ...decompose(dv, r, v) };
}

function perifocalOf(el) {
  const { lan: O, i, argp: w } = el;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return { P: new V3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si), Q: new V3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si) };
}

export function planMatchPlane(ref, pos, vel, t0, targetH) {
  const mu = BODIES[ref].mu;
  const h = new V3().crossVectors(pos, vel);
  const line = new V3().crossVectors(h, targetH);
  if (line.len() < 1e-9 * h.len() * targetH.len()) return null;
  line.normalize();
  const el = elements(pos, vel, mu);
  const { P, Q } = perifocalOf(el);
  const best = [line, line.clone().scale(-1)].map((d) => {
    const nu = Math.atan2(d.dot(Q), d.dot(P));
    return { dt: timeToTrueAnomaly(el, nu < 0 ? nu + TAU : nu) };
  }).sort((a, b) => a.dt - b.dt)[0];
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + best.dt);
  const nT = targetH.clone().normalize();
  const vr = r.clone().normalize().scale(v.dot(r) / r.len());
  const vh = v.clone().sub(vr);
  const dirH = new V3().crossVectors(nT, r).normalize();
  if (dirH.dot(vh) < 0) dirH.scale(-1);
  const dv = dirH.scale(vh.len()).add(vr).sub(v);
  return { t: t0 + best.dt, ...decompose(dv, r, v) };
}

function phaseAngle(a, b, h) {
  const n = h.clone().normalize();
  const x = a.clone().normalize();
  const y = new V3().crossVectors(n, x);
  let ang = Math.atan2(b.dot(y), b.dot(x));
  if (ang < 0) ang += TAU;
  return ang;
}

/** Pattern search on node parameters: steps grow after a success and shrink after a miss. */
function refine(start, keys, steps, cost, t0, iterations = 30, stop = -Infinity) {
  let best = { ...start };
  let bestCost = cost(best);
  const st = { ...steps };
  for (let it = 0; it < iterations; it++) {
    let improved = false;
    for (const k of keys) {
      if (!st[k]) continue;
      for (const sgn of [-1, 1]) {
        const cand = { ...best, [k]: best[k] + sgn * st[k] };
        if (cand.t < t0 + 15) continue;
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
          st[k] *= 1.6;
          break;
        }
      }
    }
    if (!improved) for (const k of keys) st[k] *= 0.45;
    if (bestCost < stop) break;
  }
  return { node: best, cost: bestCost };
}

export function planRendezvous(ref, pos, vel, t0, targetState) {
  const mu = BODIES[ref].mu;
  const el = elements(pos, vel, mu);
  const t1 = targetState(t0);
  const r1 = el.a > 0 ? el.a : pos.len();
  const r2 = t1.pos.len();
  const h = new V3().crossVectors(pos, vel);
  const n1 = Math.sqrt(mu / r1 ** 3), n2 = Math.sqrt(mu / r2 ** 3);
  const tt = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / mu);
  const lead = Math.PI - n2 * tt;
  const dn = n1 - n2;
  if (Math.abs(dn) < 1e-12) return null;
  const syn = TAU / Math.abs(dn);
  let wait = (((phaseAngle(pos, t1.pos, h) - lead) / dn) % syn + syn) % syn;
  if (wait < 30) wait += syn;
  const dv0 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const cost = (node) => {
    const { r, v } = stateAt(ref, pos, vel, t0, node.t);
    const nv = v.clone().add(nodeVector(node, r, v));
    return closestApproach(ref, r, nv, node.t, targetState, tt * 1.4).dist;
  };
  const res = refine({ t: t0 + wait, pro: dv0, nor: 0, rad: 0 }, ['t', 'pro', 'rad'], { t: 60, pro: Math.abs(dv0) * 0.04 + 0.5, rad: Math.abs(dv0) * 0.04 + 0.5 }, cost, t0, 26);
  return { ...res.node, expected: res.cost };
}

/** Periapsis error at `target` for a prediction (Infinity-like penalty without encounter). */
function encounterCost(segs, target, wantR, ref) {
  const s = segs.find((x) => x.ref === target);
  if (!s) {
    // No encounter: closest approach of the arc that should reach the target, as penalty.
    const arc = segs.find((x) => x.ref === BODIES[target].parent) || segs[0];
    const span = arc.el.e < 1 ? Math.min(arc.el.period, 4e7) : 4e7;
    const ca = closestApproach(arc.ref, arc.pos, arc.vel, arc.t0, (tt) => relativeState(target, arc.ref, tt), span);
    return 1e9 + ca.dist;
  }
  // Prefer prograde capture orbits (same sense as the body's rotation is not required).
  void ref;
  return Math.abs(s.el.rp - wantR);
}

/**
 * Transfer to `target`: a moon of the current body (e.g. the Moon from Earth orbit) or a
 * planet sharing the same parent (e.g. Mars from Earth orbit, departing on a hyperbola).
 */
export function planTransfer(ref, pos, vel, t0, target, peAlt) {
  const body = BODIES[ref];
  const tb = BODIES[target];
  if (!tb || target === ref) return null;
  const wantR = tb.radius + peAlt;
  const el = elements(pos, vel, body.mu);
  if (el.e >= 1) return null;
  if (tb.parent === ref) {
    // Moon transfer: Hohmann in the parent frame, then search.
    const r1 = el.a, r2 = tb.orbit.a;
    const tt = Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / body.mu);
    const h = new V3().crossVectors(pos, vel);
    const n1 = Math.sqrt(body.mu / r1 ** 3), n2 = tb.orbit.n;
    const lp = relativeState(target, ref, t0).pos;
    const dn = n1 - n2;
    const syn = TAU / dn;
    let wait = (((phaseAngle(pos, lp, h) - (Math.PI - n2 * tt)) / dn) % syn + syn) % syn;
    if (wait < 120) wait += syn;
    const dv0 = Math.sqrt(body.mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
    const cost = (node) => encounterCost(predictWithNode(ref, pos, vel, t0, { ...node, nor: 0, rad: 0 }), target, wantR, ref);
    const res = refine({ t: t0 + wait, pro: dv0 }, ['t', 'pro'], { t: 90, pro: 8 }, cost, t0, 40, 3000);
    return { t: res.node.t, pro: res.node.pro, nor: 0, rad: 0, expected: res.cost };
  }
  if (tb.parent === body.parent && body.parent) return planInterplanetary(ref, pos, vel, t0, target, wantR);
  return null;
}

/** Leave a moon (or a planet) towards its parent's body with a periapsis at `peAlt`. */
export function planReturn(ref, pos, vel, t0, home, peAlt) {
  const body = BODIES[ref];
  const el = elements(pos, vel, body.mu);
  if (el.e >= 1) return null;
  const hb = BODIES[home];
  const wantR = hb.radius + peAlt;
  if (body.parent === home) {
    const vEsc = Math.sqrt((2 * body.mu) / el.a);
    const cost = (node) => {
      const segs = predictWithNode(ref, pos, vel, t0, { ...node, nor: 0, rad: 0 });
      const s = segs.find((x) => x.ref === home);
      return s ? Math.abs(s.el.rp - wantR) : 1e9;
    };
    let best = null, bestCost = Infinity;
    for (let k = 0; k < 24; k++) {
      for (const extra of [60, 140, 260, 420]) {
        const cand = { t: t0 + 60 + (k / 24) * el.period, pro: vEsc - Math.sqrt(body.mu / el.a) + extra };
        const c = cost(cand);
        if (c < bestCost) {
          best = cand;
          bestCost = c;
        }
      }
    }
    if (!best) return null;
    const res = refine(best, ['t', 'pro'], { t: el.period / 48, pro: 20 }, cost, t0, 36);
    return { t: res.node.t, pro: res.node.pro, nor: 0, rad: 0, expected: res.cost };
  }
  // Planet → planet (e.g. Mars → Earth): same machinery as an outbound transfer.
  return planTransfer(ref, pos, vel, t0, home, peAlt);
}

/** Small burn in a minute that sets the periapsis at the next encountered body. */
export function planCourseCorrection(ref, pos, vel, t0, peAltFor) {
  const segs = predict(ref, pos, vel, t0);
  const target = segs.find((s, i) => i > 0 && s.ref !== 'sun' && s.ref !== ref)?.ref || segs[0].next;
  if (!target) return null;
  const wantR = BODIES[target].radius + peAltFor(target);
  const tNode = t0 + 60;
  const cost = (node) => encounterCost(predictWithNode(ref, pos, vel, t0, { ...node, t: tNode }), target, wantR, ref) + Math.hypot(node.pro, node.nor, node.rad) * 150;
  const res = refine({ t: tNode, pro: 0, nor: 0, rad: 0 }, ['pro', 'rad', 'nor'], { t: 0, pro: 6, rad: 6, nor: 6 }, cost, t0 - 100, 60);
  return { ...res.node, t: tNode, target, expected: res.cost };
}

export function planDeorbit(ref, pos, vel, t0, peAlt, delay = 90) {
  const body = BODIES[ref];
  const { r, v } = stateAt(ref, pos, vel, t0, t0 + delay);
  const rb = r.len();
  const rp = body.radius + peAlt;
  if (rp >= rb) return null;
  const a = (rb + rp) / 2;
  const dv = horizontal(r, v).scale(Math.sqrt(body.mu * (2 / rb - 1 / a))).sub(v);
  return { t: t0 + delay, ...decompose(dv, r, v) };
}
