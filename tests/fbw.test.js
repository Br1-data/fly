import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim } from './helpers.js';

const DT = 1 / 120;
const DEG = 180 / Math.PI;

function fly(id, altitudeFt, speedKt, stick, seconds, sample) {
  const sim = newSim({ aircraft: id, start: { type: 'air', airport: 'XAQU', altitudeFt, speedKt, heading: 72 } });
  sim.pilot.throttle = 1;
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    sim.pilot.pitch = stick(t);
    sim.pilot.roll = 0;
    sim.stepOnce(DT);
    sample?.(sim.fm, t);
  }
  return sim;
}

for (const id of ['fighter', 'eurofighter']) {
  test(`${id}: fighter law damps a pitch disturbance anywhere in the envelope`, () => {
    for (const [alt, kt] of [[1000, 200], [1000, 450], [6000, 650], [20000, 500], [35000, 600]]) {
      let qMax = 0;
      const sim = fly(id, alt, kt, (t) => (t > 1 && t < 1.5 ? 0.5 : 0), 9, (fm, t) => {
        if (t > 6.5) qMax = Math.max(qMax, Math.abs(fm.omega.y) * DEG);
      });
      assert.ok(!sim.crashed, `${alt} ft ${kt} kt: no crash`);
      assert.ok(qMax < 1.5, `${alt} ft ${kt} kt: pitch settles hands-off (|q| ${qMax.toFixed(1)}°/s)`);
    }
  });

  test(`${id}: full aft stick reaches but respects 9 g and the AoA limit`, () => {
    let nzMax = 0;
    const fast = fly(id, 6000, 500, (t) => (t > 0.5 && t < 3 ? 1 : 0), 5, (fm) => { nzMax = Math.max(nzMax, fm.nz); });
    assert.ok(!fast.crashed);
    assert.ok(nzMax > 8.3 && nzMax < 9.6, `peak load factor ${nzMax.toFixed(2)} g`);
    let alphaMax = 0;
    const slow = fly(id, 6000, 180, (t) => (t > 0.5 && t < 4 ? 1 : 0), 5, (fm) => { alphaMax = Math.max(alphaMax, fm.alpha * DEG); });
    assert.ok(!slow.crashed);
    assert.ok(alphaMax < 28, `peak AoA ${alphaMax.toFixed(1)}°`);
  });
}
