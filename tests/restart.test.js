import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/simulation.js';
import { getAircraft } from '../src/sim/aircraft/index.js';

const runway = { aircraft: 'trainer', start: { type: 'runway', airport: 'XAQU', runway: '07' } };
const parking = { aircraft: 'trainer', start: { type: 'parking', airport: 'XCST' } };

test('a new flight clears controls, engine sequences and departure-specific navigation', () => {
  const sim = new Simulation().setup({ ...runway, coldDark: true });
  sim.command('autostart');
  sim.command('starter');
  Object.assign(sim.pilot, { pitch: 1, roll: -1, yaw: 0.4, reverse: true, brakeL: 1, trimRate: 1, throttle2: 1 });
  sim.cockpitInput = { roll: 1, brakeL: 1, reverse: true, throttle2: 0.8 };
  sim.nav1.active = 109.5;
  sim.xpdr.code = 1234;
  sim.setup(parking);
  assert.equal(sim._sequence, null);
  assert.equal(sim._starterTimer, 0);
  assert.equal(sim.runwayEnd, null);
  assert.equal(sim.nav1.active, 113.5);
  assert.equal(sim.xpdr.code, 7000);
  for (const key of ['pitch', 'roll', 'yaw', 'brakeL', 'trimRate']) assert.equal(sim.pilot[key], 0);
  assert.equal(sim.pilot.reverse, false);
  assert.equal(sim.pilot.throttle2, undefined);
  assert.deepEqual(sim.cockpitInput, {});
  sim.update(0.1);
  assert.ok(sim.fm.engines[0].running);
});

test('shutdown from a previous flight cannot stop the new engine', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sim = new Simulation().setup(runway);
  sim.shutdown();
  sim.setup(runway);
  t.mock.timers.tick(3000);
  assert.equal(sim.fm.engines[0].magnetos, 3);
  assert.ok(sim.fm.engines[0].running);
});

test('payload overrides belong to one simulation and preserve aircraft defaults', () => {
  const expected = getAircraft('trainer').mass.payload;
  const custom = new Simulation().setup({ ...runway, payload: 50 });
  assert.equal(custom.def.mass.payload, 50);
  assert.equal(getAircraft('trainer').mass.payload, expected);
  const standard = new Simulation().setup(runway);
  assert.equal(standard.def.mass.payload, expected);
});
