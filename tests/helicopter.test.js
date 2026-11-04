// Helicopters: rotor trim across the speed range, AFCS hover hold, take-off and
// landing, autorotation after an engine failure and rotor spin-up from cold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborneModel, newSim, KT } from './helpers.js';
import { AIRCRAFT_LIST } from '../src/sim/aircraft/index.js';

const DT = 1 / 120;
const HELIS = AIRCRAFT_LIST.filter((d) => d.rotor);

test('the hangar has civil and military helicopters', () => {
  assert.ok(HELIS.length >= 3);
  assert.ok(HELIS.some((d) => d.role === 'civil') && HELIS.some((d) => d.role === 'military'));
});

for (const def of HELIS) {
  test(`${def.name}: trims from the hover to cruise within power and control limits`, () => {
    for (const kt of [0, 40, 80, def.speeds.cruise]) {
      const fm = airborneModel(def.id);
      fm.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 0 });
      const r = fm.trimHeli(kt * KT);
      assert.ok(r.ok, `${kt} kt trim`);
      assert.ok(r.power < def.rotor.maxPower, `${kt} kt needs ${Math.round(r.power / 1000)} kW`);
      assert.ok(r.collective > 0.2 && r.collective < 0.95, `collective ${r.collective}`);
      assert.ok(Math.abs(r.theta) < 12 && Math.abs(r.phi) < 6, `attitude ${r.theta} / ${r.phi}`);
    }
    // Hover power is well above cruise power (the power bucket).
    const hover = airborneModel(def.id);
    hover.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 0 });
    const ph = hover.trimHeli(0).power;
    const mid = airborneModel(def.id);
    mid.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 0 });
    assert.ok(mid.trimHeli(60 * KT).power < ph * 0.9);
  });

  test(`${def.name}: AFCS holds an in-air start hands-off (hover and cruise)`, () => {
    for (const speedKt of [0, def.speeds.cruise * 0.8]) {
      const sim = newSim({ aircraft: def.id, start: { type: 'air', airport: 'XAQU', n: 0, e: 5000, heading: 90, altitudeFt: 3000, speedKt } });
      const fm = sim.fm, alt0 = fm.altFt;
      for (let i = 0; i < 120 * 25; i++) sim.stepOnce(DT);
      assert.ok(!sim.crashed);
      assert.ok(Math.abs(fm.altFt - alt0) < 350, `${speedKt} kt: altitude change ${fm.altFt - alt0}`);
      assert.ok(Math.abs(fm.roll) < 8 && Math.abs(((fm.heading - 90 + 540) % 360) - 180) < 10, `attitude ${fm.roll} / ${fm.heading}`);
      assert.ok(Math.abs(fm.rotor.rpmPct - 100) < 4, `NR ${fm.rotor.rpmPct}`);
      if (speedKt === 0) assert.ok(fm.gsKt < 6, `hover drift ${fm.gsKt} kt`);
    }
  });

  test(`${def.name}: lifts off, hovers at 30 ft and lands again`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'runway', airport: 'XAQU', runway: '07' } });
    const fm = sim.fm;
    sim.command('parkingBrake', false);
    for (let i = 0; i < 120 * 3; i++) sim.stepOnce(DT);
    let maxAgl = 0;
    for (let i = 0; i < 120 * 45; i++) {
      const target = i < 120 * 25 ? 30 : -5;
      sim.pilot.throttle = Math.max(0, Math.min(1, sim.pilot.throttle + ((target - fm.aglFt) * 0.004 - fm.vs * 0.03) * DT * 4));
      sim.stepOnce(DT);
      if (i > 120 * 15 && i < 120 * 25) assert.ok(Math.abs(fm.aglFt - 30) < 8 && fm.gsKt < 6, `hover ${fm.aglFt} ft, ${fm.gsKt} kt`);
      maxAgl = Math.max(maxAgl, fm.aglFt);
      assert.ok(!sim.crashed, fm.damage.reason);
    }
    assert.ok(maxAgl > 25 && fm.onGround, 'landed after the hover');
  });

  test(`${def.name}: autorotation keeps the rotor turning after an engine failure`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'air', airport: 'XAQU', n: 0, e: 5000, heading: 90, altitudeFt: 4000, speedKt: 70 } });
    const fm = sim.fm;
    for (const e of fm.engines) e.failed = true;
    // Lower the collective at once, as the pilot must.
    sim.pilot.throttle = 0.05;
    for (let i = 0; i < 120 * 25; i++) sim.stepOnce(DT);
    assert.ok(!sim.crashed);
    assert.ok(fm.rotor.rpmPct > 85, `NR ${fm.rotor.rpmPct}`);
    assert.ok(fm.vs < -4 && fm.vs > -20, `descent ${fm.vs} m/s`);
  });

  test(`${def.name}: cold start spins the rotor up to 100 %`, () => {
    const sim = newSim({ aircraft: def.id, start: { type: 'parking', airport: 'XAQU' }, coldDark: true });
    assert.ok(sim.fm.rotor.rpmPct < 1);
    sim.autostart();
    for (let i = 0; i < 120 * 160 && sim.fm.rotor.rpmPct < 97; i++) sim.stepOnce(DT);
    assert.ok(sim.fm.rotor.rpmPct >= 97, `NR ${sim.fm.rotor.rpmPct}`);
    assert.ok(sim.fm.onGround && !sim.crashed);
  });
}
