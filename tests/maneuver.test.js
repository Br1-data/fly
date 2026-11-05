import test from 'node:test';
import assert from 'node:assert/strict';
import { BODIES } from '../src/sim/system.js';
import { elements } from '../src/sim/orbit.js';
import { newSim, run } from './helpers.js';

const alt = (seg) => seg.el.rp - BODIES[seg.ref].radius;

test('Hohmann: raising the apoapsis and circularizing there', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 300e3 } });
  sim.plan('raiseAp');
  assert.ok(sim.node, 'node planned');
  const after = sim.nodePrediction[0].el;
  const target = after.ra - BODIES.earth.radius;
  assert.ok(target > 390e3 && target < 700e3, `new apoapsis ${target}`);
  // Vis-viva: Δv of the first Hohmann impulse from a circular orbit.
  const mu = BODIES.earth.mu, r1 = BODIES.earth.radius + 300e3, r2 = after.ra;
  const dv = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  assert.ok(Math.abs(sim.nodeInfo().dvTotal - dv) < 0.05 * dv, `Δv ${sim.nodeInfo().dvTotal} vs ${dv}`);
  sim.command('autoBurn', true);
  run(sim, 4000, 1 / 30, (s) => !s.node);
  assert.ok(!sim.node, 'burn complete');
  const el = elements(sim.ship.pos, sim.ship.vel, mu);
  assert.ok(Math.abs(el.ra - r2) < 25e3, `apoapsis after burn ${(el.ra - BODIES.earth.radius) / 1e3} km`);
});

test('trans-lunar injection: ≈ 3.1 km/s from a 300 km orbit, encounter with the Moon', async () => {
  const sim = await newSim({ ship: 'translunar', start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 28 }, target: 'moon' });
  sim.plan('transfer');
  assert.ok(sim.node, 'TLI node');
  const dv = sim.nodeInfo().dvTotal;
  assert.ok(dv > 3000 && dv < 3250, `TLI Δv ${dv}`);
  const segs = sim.nodePrediction;
  assert.equal(segs[0].end, 'encounter');
  const moon = segs.find((s) => s.ref === 'moon');
  assert.ok(moon, 'enters the lunar sphere of influence');
  assert.ok(alt(moon) > 20e3 && alt(moon) < 500e3, `lunar periapsis ${alt(moon) / 1e3} km`);
  // Coast time to the Moon: about three to five days.
  const days = (moon.t0 - sim.t) / 86400;
  assert.ok(days > 2 && days < 6, `flight time ${days} d`);
});

test('trans-Mars injection in the 2033 window reaches Mars', async () => {
  const sim = await newSim({ ship: 'ntr', date: '2033-02-01T00:00:00Z', start: { type: 'orbit', body: 'earth', altitude: 400e3, departureTo: 'mars' }, target: 'mars' });
  sim.plan('transfer');
  assert.ok(sim.node, 'TMI node');
  const dv = sim.nodeInfo().dvTotal;
  assert.ok(dv > 3300 && dv < 4600, `TMI Δv ${dv}`);
  const segs = sim.nodePrediction;
  const mars = segs.find((s) => s.ref === 'mars');
  assert.ok(mars, `segments: ${segs.map((s) => `${s.ref}:${s.end}`).join(' ')}`);
  const days = (mars.t0 - sim.t) / 86400;
  assert.ok(days > 120 && days < 330, `cruise ${days} d`);
});

test('deorbit from the station orbit lowers the periapsis into the atmosphere', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 410e3, inclination: 6 } });
  sim.plan('deorbit');
  const pe = alt(sim.nodePrediction[0]);
  assert.ok(pe > 0 && pe < 80e3, `periapsis ${pe}`);
  assert.ok(sim.nodeInfo().dvTotal > 60 && sim.nodeInfo().dvTotal < 200);
});

test('rendezvous plan brings the capsule close to the station', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 6, lan: 40, argLat: -0.21 }, target: { id: 'aurora', port: 'prua' }, objects: ['aurora'] });
  sim.plan('rendezvous');
  assert.ok(sim.node, 'node');
  sim.refreshPrediction?.(true);
  assert.ok(sim.approach, 'closest approach computed');
  assert.ok(sim.approach.dist < 30e3, `closest approach ${sim.approach.dist / 1e3} km`);
});
