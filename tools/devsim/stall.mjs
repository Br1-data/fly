import { airborneModel, KT } from '../../tests/helpers.js';
const id = process.argv[2] || 'trainer', mode = process.argv[3] || 'stall';
const fm = airborneModel(id);
fm.place({ n: -40000, e: 0, alt: 2500, heading: 90, speed: 50 });
fm.trimLevel((id === 'trainer' ? 70 : 160) * KT, 0);
for (const e of fm.engines) e.throttle = mode === 'spin' ? 0 : 0.2;
const DT = 1/240;
for (let i = 0; i < 240 * 40; i++) {
  const t = i * DT;
  if (mode === 'stall') { fm.input.pitch = t < 25 ? Math.min(1, t / 12) : 0; fm.input.roll = 0; fm.input.yaw = 0; }
  else { // spin entry at stall with full rudder, recovery at t=22 (PARE)
    fm.input.pitch = t < 22 ? Math.min(1, t / 8) : (t < 24 ? 0 : -0.3); fm.input.yaw = t > 9 && t < 22 ? 1 : (t < 24 ? -1 : 0); fm.input.roll = 0;
  }
  fm.step(DT);
  if (i % 240 === 0) console.log(`t=${t.toFixed(0)} ias=${fm.iasKt.toFixed(0)} alt=${fm.altFt.toFixed(0)} pitch=${fm.pitch.toFixed(0)} roll=${fm.roll.toFixed(0)} hdg=${fm.heading.toFixed(0)} vs=${(fm.vs/0.00508).toFixed(0)} aoa=${(fm.alpha*57.3).toFixed(1)} stall=${fm.stallFactor.toFixed(2)} warn=${fm.stallWarning} r=${(fm.omega.z*57.3).toFixed(0)} p=${(fm.omega.x*57.3).toFixed(0)}`);
}
