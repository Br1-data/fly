import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPS, getShip } from '../src/sim/ships.js';
import { BODIES } from '../src/sim/system.js';

const G0 = 9.80665;

/** Rocket-equation Δv of each powered stage, in vacuum, with everything above it attached. */
function stageDeltaV(def) {
  return def.stages.map((st, i) => {
    if (!st.engine || !st.fuel) return 0;
    const m0 = def.stages.slice(i).reduce((a, s) => a + s.dryMass + s.fuel, 0) + def.rcs.fuel;
    return st.engine.ispVac * G0 * Math.log(m0 / (m0 - st.fuel));
  });
}

const totalMass = (def) => def.stages.reduce((a, s) => a + s.dryMass + s.fuel, 0) + def.rcs.fuel;

test('every vehicle is complete and consistent', () => {
  const ids = new Set();
  for (const def of SHIPS) {
    assert.ok(!ids.has(def.id), `duplicate ${def.id}`);
    ids.add(def.id);
    assert.ok(def.name && def.category && def.description && def.specs.length >= 3, def.id);
    assert.ok(def.stages.length >= 1 && def.stages.every((s) => s.dryMass > 0 && s.fuel >= 0 && s.length > 0 && s.radius > 0), def.id);
    assert.ok(def.rcs.thrust > 0 && def.rcs.isp > 0 && def.rcs.fuel > 0, def.id);
    assert.ok(def.hull.length && def.contacts.length >= 3, `${def.id}: contact points`);
    assert.ok(def.camera.eye.length === 3 && def.camera.fov > 40, def.id);
    for (const st of def.stages) if (st.engine) assert.ok(st.engine.ispVac >= st.engine.ispSL && st.engine.thrustVac >= st.engine.thrustSL, `${def.id}/${st.id}: vacuum ≥ sea level`);
  }
  assert.equal(getShip('nope').id, SHIPS[0].id);
});

test('published Δv and masses match the rocket equation', () => {
  const near = (a, b, tol) => Math.abs(a - b) <= tol * b;
  const dv = Object.fromEntries(SHIPS.map((d) => [d.id, stageDeltaV(d)]));
  assert.ok(near(dv.pod[0], 560, 0.02), `pod ${dv.pod[0]}`);
  assert.ok(near(dv.capsule[0], 1320, 0.01), `capsule ${dv.capsule[0]}`);
  assert.ok(near(dv.translunar[0], 4200, 0.02), `TLI stage ${dv.translunar[0]}`);
  assert.ok(near(dv.lander[0], 2380, 0.01) && near(dv.lander[1], 2060, 0.01), `lander ${dv.lander}`);
  assert.ok(near(dv.spaceplane[0], 540, 0.02), `spaceplane ${dv.spaceplane[0]}`);
  assert.ok(near(dv.ntr[0], 9200, 0.02), `NTR ${dv.ntr[0]}`);
  // Launcher: about 10.8 km/s for the two stages (first stage between sea-level and vacuum Isp).
  const lv = dv.rocket[0] * (296.5 / 311) + dv.rocket[1];
  assert.ok(near(lv, 10800, 0.03), `launcher ${lv}`);
  assert.ok(near(totalMass(getShip('rocket')), 528e3, 0.01));
  assert.ok(near(totalMass(getShip('lander')), 15.1e3, 0.01));
  assert.ok(near(totalMass(getShip('ntr')), 92e3, 0.01));
});

test('thrust-to-weight: the launcher lifts off from Earth, the lander hovers on the Moon', () => {
  const rocket = getShip('rocket');
  const twr = rocket.stages[0].engine.thrustSL / (totalMass(rocket) * G0);
  assert.ok(twr > 1.3 && twr < 1.7, `lift-off TWR ${twr}`);
  const gMoon = BODIES.moon.mu / BODIES.moon.radius ** 2;
  assert.ok(Math.abs(gMoon - 1.62) < 0.01);
  const lander = getShip('lander');
  const full = lander.stages[0].engine.thrustVac / (totalMass(lander) * gMoon);
  const min = (lander.stages[0].engine.thrustVac * lander.stages[0].engine.minThrottle) / (totalMass(lander) * gMoon);
  assert.ok(full > 1.6 && min < 1, `lander TWR ${min}–${full}: can both hover and descend`);
  const ascent = lander.stages[1];
  assert.ok(ascent.engine.thrustVac / ((ascent.dryMass + ascent.fuel + lander.rcs.fuel) * gMoon) > 1.5);
  // The spaceplane cannot climb on its orbital engines: it lands as a glider.
  const sp = getShip('spaceplane');
  assert.ok(sp.stages[0].engine.thrustSL / (totalMass(sp) * G0) < 0.1);
});
