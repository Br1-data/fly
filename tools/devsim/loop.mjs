import { airborneModel, KT } from '../../tests/helpers.js';
const fm = airborneModel('jet');
fm.place({ n: -40000, e: 0, alt: 2000, heading: 90, speed: 50 });
fm.trimLevel(380 * KT, 0);
for (const e of fm.engines) e.throttle = 1;
const DT = 1 / 240; let pitchAcc = 0, prevTheta = fm.euler.theta, maxG = 0, loopDone = false;
for (let i = 0; i < 240 * 40; i++) {
  // G-limited pull: target 5 g
  const err = 5 - fm.nz;
  fm.input.pitch = Math.max(-1, Math.min(1, (fm.input.pitch || 0) + err * 0.4 * DT));
  fm.input.roll = Math.max(-1, Math.min(1, -0.02 * (Math.abs(fm.roll) > 90 ? 0 : fm.roll) - 0.2 * fm.omega.x));
  fm.step(DT);
  maxG = Math.max(maxG, fm.nz);
  pitchAcc += fm.omega.y * DT;
  if (i % 240 === 0) console.log(`t=${(i*DT).toFixed(0)} ias=${fm.iasKt.toFixed(0)} alt=${fm.altFt.toFixed(0)} pitch=${fm.pitch.toFixed(0)} roll=${fm.roll.toFixed(0)} nz=${fm.nz.toFixed(1)} pin=${fm.input.pitch.toFixed(2)} loop=${(pitchAcc*57.3).toFixed(0)} aoa=${(fm.alpha*57.3).toFixed(1)}`);
  if (pitchAcc > 2 * Math.PI) { console.log('LOOP complete at', (i*DT).toFixed(1), 's, ias', fm.iasKt.toFixed(0), 'alt', fm.altFt.toFixed(0), 'maxG', maxG.toFixed(1)); break; }
  if (fm.damage.crashed) { console.log('CRASH', fm.damage.reason); break; }
}
// max G available at 400 kt with full aft stick
const f2 = airborneModel('jet'); f2.place({ n: -40000, e: 0, alt: 2000, heading: 90, speed: 50 }); f2.trimLevel(400 * KT, 0);
let mg = 0; for (let i = 0; i < 240 * 1.5; i++) { f2.input.pitch = Math.min(1, i / 60); f2.step(DT); mg = Math.max(mg, f2.nz); }
console.log('jet max G full aft at 400 kt:', mg.toFixed(1), f2.damage.crashed ? f2.damage.reason : '');
