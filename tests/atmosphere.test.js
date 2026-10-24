import test from 'node:test';
import assert from 'node:assert/strict';
import { Atmosphere, indicatedAltitude, casFromQc, impactPressure } from '../src/sim/atmosphere.js';
import { CALM } from './helpers.js';

test('ISA sea level and tropopause values', () => {
  const atm = new Atmosphere(CALM);
  const sl = atm.sample(0);
  assert.ok(Math.abs(sl.T - 288.15) < 0.01);
  assert.ok(Math.abs(sl.p - 101325) < 1);
  assert.ok(Math.abs(sl.rho - 1.225) < 0.001);
  assert.ok(Math.abs(sl.a - 340.3) < 0.2);
  const tp = atm.sample(11000);
  assert.ok(Math.abs(tp.T - 216.65) < 0.05);
  assert.ok(Math.abs(tp.p - 22632) < 30);
});

test('altimeter reads true altitude with correct QNH, and errs low in cold air', () => {
  const atm = new Atmosphere({ ...CALM, qnhHpa: 1000 });
  const p = atm.sample(1500).p;
  assert.ok(Math.abs(indicatedAltitude(p, 100000) - 1500) < 1);
  // wrong setting: 1013 set while QNH is 1000 -> over-reads ~ 13 hPa * 8.3 m ("high to low, look out below")
  assert.ok(indicatedAltitude(p, 101325) > 1500 + 90);
  const cold = new Atmosphere({ ...CALM, tempC: -15 });
  const pc = cold.sample(3000).p;
  // altimeter shows more than the true altitude when it is cold
  assert.ok(indicatedAltitude(pc, 101325) > 3000 + 200);
});

test('calibrated airspeed equals TAS at sea level', () => {
  const atm = new Atmosphere(CALM);
  const s = atm.sample(0);
  for (const v of [30, 100, 200]) {
    const cas = casFromQc(impactPressure(v, s.p, s.a));
    assert.ok(Math.abs(cas - v) < 0.05, `v=${v} cas=${cas}`);
  }
  const hi = atm.sample(10000);
  const cas = casFromQc(impactPressure(230, hi.p, hi.a));
  assert.ok(cas < 150 && cas > 130, `cas at 10 km for 230 m/s TAS: ${cas}`);
});
