import test from 'node:test';
import assert from 'node:assert/strict';
import { V3 } from '../src/core/math.js';
import { propagate, elements, circularState, stateFromElements, conicPoints } from '../src/sim/orbit.js';
import { lambert } from '../src/sim/maneuver.js';

const MU_EARTH = 3.986004418e14;
const R_EARTH = 6.371e6;

test('circular low Earth orbit: speed and period follow Kepler', () => {
  const r = R_EARTH + 400e3;
  const { pos, vel } = circularState(MU_EARTH, r, { inclination: 0.9, lan: 1.2, argLat: 0.4 });
  assert.ok(Math.abs(pos.len() - r) < 1e-3);
  assert.ok(Math.abs(vel.len() - 7672.6) < 0.5, `v = ${vel.len()}`);
  assert.ok(Math.abs(pos.dot(vel)) < 1e-3 * r, 'velocity is horizontal');
  const el = elements(pos, vel, MU_EARTH);
  assert.ok(el.e < 1e-9);
  assert.ok(Math.abs(el.a - r) < 1e-3);
  assert.ok(Math.abs(el.period - 5544.9) < 1, `period ${el.period}`);
  assert.ok(Math.abs(el.i - 0.9) < 1e-9);
});

test('propagation returns to the start after one period and conserves energy and momentum', () => {
  for (const e of [0, 0.3, 0.75, 0.97]) {
    const a = 2e7;
    const s = stateFromElements(MU_EARTH, { a, e, i: 0.5, lan: 2, argp: 1 }, 0.7);
    const el = elements(s.pos, s.vel, MU_EARTH);
    const r = new V3(), v = new V3();
    propagate(s.pos, s.vel, el.period, MU_EARTH, r, v);
    assert.ok(r.clone().sub(s.pos).len() < 1e-3 * a, `e=${e}: position after one period off by ${r.clone().sub(s.pos).len()} m`);
    propagate(s.pos, s.vel, el.period * 0.37, MU_EARTH, r, v);
    const el2 = elements(r, v, MU_EARTH);
    assert.ok(Math.abs(el2.energy / el.energy - 1) < 1e-8, `e=${e}: energy drift`);
    assert.ok(el2.h.clone().sub(el.h).len() / el.h.len() < 1e-8, `e=${e}: angular momentum drift`);
  }
});

test('hyperbolic escape keeps the excess speed', () => {
  // Trans-Mars injection from a 400 km parking orbit: v∞ ≈ 3 km/s.
  const rp = R_EARTH + 400e3;
  const vinf = 3000;
  const vp = Math.sqrt(vinf * vinf + (2 * MU_EARTH) / rp);
  const pos = new V3(rp, 0, 0), vel = new V3(0, vp, 0);
  const r = new V3(), v = new V3();
  propagate(pos, vel, 3 * 86400, MU_EARTH, r, v);
  const venergy = Math.sqrt(2 * (v.lenSq() / 2 - MU_EARTH / r.len()));
  assert.ok(Math.abs(venergy - vinf) < 1e-3, `v∞ ${venergy}`);
  assert.ok(r.len() > 7e8, 'well on its way out after three days');
  const el = elements(pos, vel, MU_EARTH);
  assert.ok(el.e > 1 && Math.abs(el.rp - rp) < 1);
  assert.ok(conicPoints(el, 64, 5e8).every((p) => p.len() <= 5e8 * 1.001));
});

test('elements round-trip through the state vector', () => {
  const src = { a: 4.2e7, e: 0.42, i: 0.3, lan: 4.1, argp: 2.2 };
  const s = stateFromElements(MU_EARTH, src, 1.3);
  const el = elements(s.pos, s.vel, MU_EARTH);
  for (const k of ['e', 'i', 'lan', 'argp']) assert.ok(Math.abs(el[k] - src[k]) < 1e-9, `${k}: ${el[k]} vs ${src[k]}`);
  assert.ok(Math.abs(el.a / src.a - 1) < 1e-12);
  assert.ok(Math.abs(el.nu - 1.3) < 1e-9);
});

test('Lambert solution flies from r1 to r2 in the requested time', () => {
  const r1 = new V3(R_EARTH + 300e3, 0, 0);
  const r2 = new V3(-3.0e8, 2.2e8, 1.2e7);
  const dt = 4.2 * 86400;
  const sol = lambert(r1, r2, dt, MU_EARTH, new V3(0, 0, 1));
  assert.ok(sol, 'solution found');
  const r = new V3(), v = new V3();
  propagate(r1, sol.v1, dt, MU_EARTH, r, v);
  assert.ok(r.clone().sub(r2).len() < 1e-5 * r2.len(), `miss ${r.clone().sub(r2).len()} m`);
  assert.ok(v.clone().sub(sol.v2).len() < 1e-3 * sol.v2.len());
});
