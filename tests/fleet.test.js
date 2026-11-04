// Every aircraft in the hangar must start, take off, fly hands-off and land like its type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborneModel, newSim, KT } from './helpers.js';
import { AIRCRAFT_LIST } from '../src/sim/aircraft/index.js';
import { findRunwayEnd } from '../src/world/world-data.js';

const DT = 1 / 120;

function minTrimIas(id, cfg) {
  const fm = airborneModel(id);
  for (let kt = 30; kt < 300; kt += 2) {
    fm.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 50 });
    cfg?.(fm);
    const r = fm.trimLevel(kt * KT, 0);
    if (r.ok && r.alpha < 25 && fm.stallFactor < 0.5) return fm.iasKt;
  }
  return Infinity;
}

test('the hangar has civil and military aircraft with unique ids and complete data', () => {
  assert.ok(AIRCRAFT_LIST.length >= 11);
  assert.equal(new Set(AIRCRAFT_LIST.map((d) => d.id)).size, AIRCRAFT_LIST.length);
  assert.ok(AIRCRAFT_LIST.filter((d) => d.role === 'military').length >= 5);
  for (const def of AIRCRAFT_LIST) {
    for (const key of ['name', 'category', 'description', 'panel', 'model']) assert.ok(def[key], `${def.id}.${key}`);
    assert.ok(def.specs.length >= 3, def.id);
    for (const s of def.surfaces) for (const v of [...s.pos, s.area, s.chord]) assert.ok(Number.isFinite(v), `${def.id}.${s.name}`);
  }
});

for (const def of AIRCRAFT_LIST) {
  if (!def.rotor) {
  test(`${def.name}: stall speed and top speed match its class`, () => {
    const vs1 = minTrimIas(def.id);
    assert.ok(Math.abs(vs1 - def.speeds.vs1) < Math.max(12, def.speeds.vs1 * 0.2), `Vs1 ${vs1} vs ${def.speeds.vs1}`);
    const fm = airborneModel(def.id);
    fm.place({ n: -40000, e: 0, alt: def.speeds.cruiseAlt ?? 1000, heading: 90, speed: 50 });
    const r = fm.trimLevel((def.speeds.cruise * KT) / Math.sqrt(fm.env.rho / 1.225), 0);
    assert.ok(r.throttle < 1 && Math.abs(r.trim) < 1, `cruise ${def.speeds.cruise} kt: throttle ${r.throttle}, trim ${r.trim}`);
  });

  test(`${def.name}: takes off from Aquila 07 and climbs away straight`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'runway', airport: 'XAQU', runway: '07' } });
    const fm = sim.fm;
    const rw = findRunwayEnd('XAQU', '07');
    sim.command('flaps', Math.min(1, def.controls.flapDetents.length - 1));
    sim.command('parkingBrake', false);
    for (let i = 0; i < 120 * 2; i++) sim.stepOnce(DT);
    const n0 = fm.pos.x, e0 = fm.pos.y;
    sim.pilot.throttle = 1;
    let lift = null, maxOff = 0;
    for (let i = 0; i < 120 * 90 && fm.aglFt < 200; i++) {
      const hdgErr = ((rw.heading - fm.heading + 540) % 360) - 180;
      sim.pilot.yaw = Math.max(-1, Math.min(1, hdgErr * 0.15 - fm.omega.z * 2 + (fm.onGround ? 0 : 6 * fm.beta)));
      sim.pilot.roll = Math.max(-1, Math.min(1, -0.04 * fm.roll - 0.3 * fm.omega.x));
      const pitchTarget = fm.iasKt > def.speeds.vr ? 10 : null;
      sim.pilot.pitch = pitchTarget === null ? (def.taildragger ? 0 : -0.1) : Math.max(-1, Math.min(1, 0.08 * (pitchTarget - fm.pitch) - 0.8 * fm.omega.y));
      sim.stepOnce(DT);
      const dn = fm.pos.x - n0, de = fm.pos.y - e0;
      if (fm.onGround) maxOff = Math.max(maxOff, Math.abs(-dn * rw.dirE + de * rw.dirN));
      if (!lift && !fm.onGround && fm.agl > 0.5) lift = dn * rw.dirN + de * rw.dirE;
      assert.ok(!sim.crashed && !fm.damage.crashed, fm.damage.reason);
    }
    assert.ok(lift && lift < rw.length - 300, `lift-off after ${lift} m`);
    assert.ok(fm.aglFt >= 200, `climb ${fm.aglFt} ft`);
    assert.ok(maxOff < 14, `drifted ${maxOff} m from the centreline`);
  });

  test(`${def.name}: in-air start flies hands-off without diverging`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'air', airport: 'XAQU', n: 0, e: 8000, heading: 90, altitudeFt: 6000 } });
    const fm = sim.fm, alt0 = fm.altFt;
    for (let i = 0; i < 120 * 30; i++) sim.stepOnce(DT);
    assert.ok(!sim.crashed);
    assert.ok(Math.abs(fm.altFt - alt0) < 900, `altitude change ${fm.altFt - alt0} ft`);
    assert.ok(Math.abs(fm.roll) < 30 && Math.abs(fm.pitch) < 20, `attitude ${fm.pitch} / ${fm.roll}`);
    assert.ok(fm.iasKt > def.speeds.vs1, `speed ${fm.iasKt}`);
  });

  test(`${def.name}: a final-approach start holds its approach speed hands-off`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'final', airport: 'XAQU', runway: '25', distanceNm: 6 } });
    const fm = sim.fm, v0 = fm.iasKt;
    for (let i = 0; i < 120 * 20; i++) {
      sim.stepOnce(DT);
      assert.ok(Math.abs(fm.iasKt - v0) < v0 * 0.1, `speed ${fm.iasKt} from ${v0}`);
    }
    assert.ok(Math.abs(fm.roll) < 10 && fm.pitch > -8 && fm.pitch < 14, `attitude ${fm.pitch} / ${fm.roll}`);
    assert.ok(fm.vs < 0 && fm.vs > -8, `descent ${fm.vs} m/s`);
  });

  }

  test(`${def.name}: cold & dark autostart runs every engine`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'parking', airport: 'XAQU' }, coldDark: true });
    assert.ok(sim.fm.engines.every((e) => !e.running));
    sim.autostart();
    for (let i = 0; i < 120 * 320 && !sim.fm.engines.every((e) => e.running); i++) sim.stepOnce(DT);
    assert.ok(sim.fm.engines.every((e) => e.running), 'engines running');
  });
}
