import { FlightModel } from '../../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
import { getTerrain } from '../../src/world/terrain-height.js';
import { getAircraft } from '../../src/sim/aircraft/index.js';
import { findRunwayEnd } from '../../src/world/world-data.js';
import { KT, FT } from '../../src/core/units.js';
const id = process.argv[2] || 'trainer';
const def = getAircraft(id);
const atm = new Atmosphere({ ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0, tempC: 15, qnhHpa: 1013.25 });
const T = getTerrain();
const fm = new FlightModel(def, T, atm);
fm.systems.reset(true, { inAir: true, fuel: def.fuel.defaultFraction ?? 0.8 }); fm.gear.position = fm.systems.gearPos;
for (const e of fm.engines) e.reset(true);
fm.updateMass();
const DT = 1 / 240;
// 1) free response from trim: phugoid & stability
fm.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 50 });
const sp = def.speeds.cruise * KT * (id==='airliner'?1.2:1);
const tr = fm.trimLevel(sp, 0);
console.log('trim', tr);
fm.omega.y = 0.02; // small pitch disturbance
let log = [];
for (let i = 0; i < 240 * 90; i++) {
  fm.step(DT);
  if (i % (240 * 5) === 0) log.push(`t=${(i * DT).toFixed(0)} ias=${fm.iasKt.toFixed(1)} alt=${fm.altFt.toFixed(0)} pitch=${fm.pitch.toFixed(1)} roll=${fm.roll.toFixed(1)} hdg=${fm.heading.toFixed(1)} vs=${(fm.vs/0.00508).toFixed(0)} nz=${fm.nz.toFixed(2)}`);
}
console.log(log.join('\n'));
// 2) climb at Vy full power with speed hold
fm.place({ n: -40000, e: 0, alt: 300, heading: 90, speed: 50 });
const vy = (def.speeds.vy || def.speeds.climb) * KT * (id === 'airliner' ? 1 : 1);
fm.trimLevel(vy, 0);
for (const e of fm.engines) { e.throttle = 1; }
let iErr = 0;
let t0alt = 0;
for (let i = 0; i < 240 * 120; i++) {
  const err = (fm.iasKt - vy / KT);
  iErr += err * DT;
  fm.input.pitch = Math.max(-1, Math.min(1, 0.04 * err + 0.004 * iErr - 0.5 * fm.omega.y));
  fm.input.roll = -0.05 * fm.roll - 0.2 * fm.omega.x;
  fm.step(DT);
  if (i === 240 * 60) t0alt = fm.altFt;
}
console.log(`climb at ${(vy / KT).toFixed(0)} kt: ${((fm.altFt - t0alt)).toFixed(0)} fpm  (ias ${fm.iasKt.toFixed(1)}, alt ${fm.altFt.toFixed(0)}, pitch ${fm.pitch.toFixed(1)}, rpm/N1 ${(fm.engines[0].rpm||fm.engines[0].n1).toFixed(0)})`);
