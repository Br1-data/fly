import { airborneModel, KT } from '../../tests/helpers.js';
const fm = airborneModel('jet');
fm.place({ n: -40000, e: 0, alt: 2000, heading: 90, speed: 50 });
const r = fm.trimLevel(380 * KT, 0);
console.log(r, 'elevTrim', fm.input.elevTrim, 'defl', fm.defl.elevator*57.3);
const DT = 1/240;
for (let i = 0; i < 240; i++) {
  fm.step(DT);
  if (i % 12 === 0) console.log(`i=${i} pitch=${fm.pitch.toFixed(2)} q=${(fm.omega.y*57.3).toFixed(2)} aoa=${(fm.alpha*57.3).toFixed(2)} nz=${fm.nz.toFixed(2)} elev=${(fm.defl.elevator*57.3).toFixed(2)} vs=${fm.vs.toFixed(1)} ias=${fm.iasKt.toFixed(0)} eps=${(fm.epsLag*57.3).toFixed(2)} thr=${fm.engines[0].thrust.toFixed(0)} n2=${fm.engines[0].n2.toFixed(1)}`);
}
