// End-to-end physics scenarios: the vehicles fly real missions with the onboard automation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, run, types } from './helpers.js';

test('docking: a slow, aligned approach captures at the station port', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'near', object: 'aurora', port: 'prua', distance: 12, relVel: [0.2, 0, 0] }, target: 'aurora' });
  sim.command('sasMode', 'port');
  const ev = run(sim, 90, 1 / 60, (s) => s.docked);
  assert.ok(sim.docked, `not docked: ${types(ev).join(',')}`);
  assert.ok(sim.dockReport.closing < 0.5 && sim.dockReport.lateral < 0.25, JSON.stringify(sim.dockReport));
  assert.ok(types(ev).includes('dock'));
});

test('docking: a fast approach bounces off instead of capturing', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'near', object: 'aurora', port: 'prua', distance: 6, relVel: [1.4, 0, 0] }, target: 'aurora' });
  sim.command('sasMode', 'port');
  const ev = run(sim, 20, 1 / 60, (s) => s.docked);
  assert.ok(!sim.docked);
  assert.ok(types(ev).some((t) => t === 'dock-fail' || t === 'collision'), types(ev).join(','));
});

test('lunar landing with vertical-speed hold touches down gently', async () => {
  const sim = await newSim({ ship: 'lander', start: { type: 'hover', site: 'tranquillitatis', altitude: 200 } });
  sim.command('vsHold');
  sim.pilot.throttle = 0.35;
  const ev = run(sim, 200, 1 / 60, (s) => {
    if (s.ship.agl < 12) s.pilot.throttle = 0.44;
    return s.ship.landed && s.flightTime > 10;
  });
  const td = ev.find((e) => e.type === 'touchdown');
  assert.ok(td, types(ev).join(','));
  assert.ok(td.speed < 2.5, `touchdown at ${td.speed} m/s`);
  assert.ok(sim.ship.landed && !sim.crashed);
  // Real lunar gravity, no air: about 1.62 m/s².
  assert.ok(Math.abs(sim.info.gravity - 1.62) < 0.02);
});

test('a free fall onto the Moon is fatal', async () => {
  const sim = await newSim({ ship: 'lander', start: { type: 'hover', site: 'tranquillitatis', altitude: 300 } });
  sim.pilot.throttle = 0;
  run(sim, 60, 1 / 60, (s) => s.crashed);
  assert.ok(sim.crashed, 'crashed');
});

test('launch from Malindi: the ascent autopilot reaches orbit', async () => {
  const sim = await newSim({ ship: 'rocket', start: { type: 'surface', site: 'malindi' } });
  run(sim, 2);
  // On the pad the rocket moves with the ground: ≈ 464 m/s eastwards, inertially.
  assert.ok(sim.info.surfaceSpeed < 0.05 && Math.abs(sim.info.speed - 463.9) < 2, `${sim.info.surfaceSpeed} / ${sim.info.speed}`);
  sim.command('ascent', { inclination: 6 });
  const ev = run(sim, 1200, 1 / 60, (s) => s.crashed || (!s.ascent && !s.node && s.info.orbiting && s.flightTime > 200));
  assert.ok(!sim.crashed, `crashed: ${sim.ship.destroyed}`);
  assert.ok(types(ev).includes('stage'), 'first stage separated');
  assert.ok(sim.info.orbiting, `ap ${sim.info.ap} pe ${sim.info.pe}`);
  assert.ok(sim.info.pe > 100e3 && sim.info.ap < 700e3, `orbit ${sim.info.ap / 1e3} × ${sim.info.pe / 1e3} km`);
  assert.ok(Math.abs(sim.info.inclination - 6) < 2, `inclination ${sim.info.inclination}`);
});

test('reentry: deorbit burn, heat shield, parachute and splashdown', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 410e3, inclination: 6 } });
  sim.plan('deorbit');
  assert.ok(sim.node && sim.node.pro < -50, 'retrograde deorbit burn');
  sim.command('autoBurn', true);
  let phase = 'burn', maxT = 0, maxG = 0;
  const ev = run(sim, 6000, 1 / 30, (s) => {
    const ship = s.ship;
    if (phase === 'burn' && !s.node) {
      phase = 'coast';
      s.command('separate');
      s.command('sasMode', 'retrograde');
      s.changeWarp({ level: 100 });
    }
    if (phase === 'coast' && ship.altitude < 140e3 && s.warpIndex > 0) s.changeWarp(0);
    if (phase === 'coast' && ship.altitude < 6500 && ship.airspeed < 240) {
      phase = 'chute';
      s.command('parachute');
    }
    maxT = Math.max(maxT, ship.temperature);
    maxG = Math.max(maxG, ship.gForce);
    return s.crashed || ship.landed;
  });
  const t = types(ev);
  assert.ok(!sim.crashed, `destroyed: ${sim.ship.destroyed} (${t.join(',')})`);
  assert.ok(t.includes('parachute') && (t.includes('splashdown') || t.includes('touchdown')), t.join(','));
  assert.ok(maxT > 900 && maxT < 2900, `peak shield temperature ${maxT} K`);
  assert.ok(maxG > 3 && maxG < 12, `peak deceleration ${maxG} g`);
});

test('without the heat shield the capsule burns up', async () => {
  const sim = await newSim({ ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 410e3, inclination: 6 } });
  sim.plan('deorbit');
  sim.command('autoBurn', true);
  let phase = 'burn';
  run(sim, 6000, 1 / 30, (s) => {
    if (phase === 'burn' && !s.node) {
      phase = 'coast';
      s.command('separate');
      s.command('sasMode', 'prograde'); // shield facing backwards
      s.changeWarp({ level: 100 });
    }
    if (phase === 'coast' && s.ship.altitude < 140e3 && s.warpIndex > 0) s.changeWarp(0);
    return s.crashed || s.ship.landed;
  });
  assert.ok(sim.crashed, 'overheated');
});
