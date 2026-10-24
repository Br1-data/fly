import { FlightModel } from '../../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
import { getTerrain } from '../../src/world/terrain-height.js';
import { getAircraft } from '../../src/sim/aircraft/index.js';
import { KT } from '../../src/core/units.js';
const id = process.argv[2] || 'airliner';
const def = getAircraft(id);
const atm = new Atmosphere({ ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0 });
const fm = new FlightModel(def, getTerrain(), atm);
fm.systems.reset(true, { inAir: true, fuel: def.fuel.defaultFraction ?? 0.8 }); fm.gear.position = fm.systems.gearPos;
for (const e of fm.engines) e.reset(true);
fm.updateMass();
fm.place({ n: -40000, e: 0, alt: 3000, heading: 90, speed: 50 });
const sp = +(process.argv[3] || 250);
const r = fm.trimLevel(sp * KT, 0);
console.log('trim', JSON.stringify(r));
const DT = 1/240;
const sched = (t) => {
  if (t > 10 && t < 13) return { pitch: 0.5 };
  if (t > 30 && t < 33) return { pitch: -0.5 };
  if (t > 50 && t < 52) return { roll: 1 };
  if (t > 70 && t < 74) return { roll: 1 };
  if (t > 90 && t < 92) return { roll: -1 };
  return {};
};
for (let i = 0; i < 240 * 120; i++) {
  const t = i * DT; const s = sched(t);
  fm.input.pitch = s.pitch || 0; fm.input.roll = s.roll || 0; fm.input.yaw = 0;
  fm.step(DT);
  if (i % 480 === 0) console.log(`t=${t.toFixed(0)} ias=${fm.iasKt.toFixed(0)} alt=${fm.altFt.toFixed(0)} pitch=${fm.pitch.toFixed(1)} roll=${fm.roll.toFixed(1)} hdg=${fm.heading.toFixed(0)} vs=${(fm.vs/0.00508).toFixed(0)} nz=${fm.nz.toFixed(2)} elev=${(fm.defl.elevator*57.3).toFixed(1)} stab=${(fm.defl.stab*57.3).toFixed(2)} ail=${(fm.defl.aileron*57.3).toFixed(1)} rud=${(fm.defl.rudder*57.3).toFixed(1)} beta=${(fm.beta*57.3).toFixed(1)}`);
  if (fm.damage.crashed) { console.log('CRASH', fm.damage.reason); break; }
}
