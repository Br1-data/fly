import { FlightModel } from '../../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
import { getTerrain } from '../../src/world/terrain-height.js';
import { getAircraft } from '../../src/sim/aircraft/index.js';
import { findRunwayEnd } from '../../src/world/world-data.js';
import { KT, FT } from '../../src/core/units.js';
const id = process.argv[2] || 'trainer';
const flaps = +(process.argv[3] || 0);
const def = getAircraft(id);
const atm = new Atmosphere({ ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0, tempC: 15, qnhHpa: 1013.25 });
const fm = new FlightModel(def, getTerrain(), atm);
fm.systems.reset(true, { inAir: false, fuel: def.fuel.defaultFraction ?? 0.8 });
for (const e of fm.engines) e.reset(true);
fm.updateMass();
const rw = findRunwayEnd('XAQU', '07');
const n0 = rw.thrN + rw.dirN * 30, e0 = rw.thrE + rw.dirE * 30;
fm.systems.flapsLever = flaps;
fm.placeOnGround({ n: n0, e: e0, heading: rw.heading });
for (let i = 0; i < 240 * 10; i++) fm.step(1/240); // flaps extend
console.log('on ground: pitch', fm.pitch.toFixed(2), 'agl', fm.agl.toFixed(3), 'legs', fm.gear.legs.map(l => (l.force/1000).toFixed(1)+'kN').join(' '), 'flaps', fm.systems.flaps.toFixed(2));
const DT = 1 / 240;
fm.systems.parkingBrake = false;
for (const e of fm.engines) e.throttle = 1;
if (def.fbw) fm.input.elevTrim = 0.3;
let t = 0, liftoff = null, d50 = null, vrT = null;
const vr = def.speeds.vr;
for (let i = 0; i < 240 * 90; i++) {
  t += DT;
  // centerline keep with rudder
  const hdgErr = ((rw.heading - fm.heading + 540) % 360) - 180;
  const cross = (fm.pos.x - n0) * -rw.dirE + (fm.pos.y - e0) * rw.dirN;
  fm.input.yaw = Math.max(-1, Math.min(1, hdgErr * 0.15 - cross * 0.05 - fm.omega.z * 2 + (fm.onGround ? 0 : 6 * fm.beta)));
  fm.input.roll = Math.max(-1, Math.min(1, -0.04 * fm.roll - 0.3 * fm.omega.x));
  if (fm.iasKt > vr) { vrT ??= t; const thCmd = def.id==='airliner' ? 12 : 9; fm.input.pitch = Math.max(-1, Math.min(1, 0.08 * (thCmd - fm.pitch) - 0.8 * fm.omega.y)); }
  else fm.input.pitch = def.id==='airliner'? 0 : -0.1;
  fm.step(DT);
  const dist = (fm.pos.x - n0) * rw.dirN + (fm.pos.y - e0) * rw.dirE;
  if (!liftoff && !fm.onGround && fm.agl > 0.3) liftoff = { t, dist, ias: fm.iasKt };
  if (!d50 && fm.aglFt > 50) d50 = { t, dist, ias: fm.iasKt };
  if (fm.damage.crashed) { console.log('CRASH', fm.damage.reason, t.toFixed(1)); break; }
  if (d50 && t > d50.t + 20) break;
}
console.log('Vr reached at', vrT?.toFixed(1), 's');
console.log('liftoff', liftoff && `${liftoff.t.toFixed(1)}s ${liftoff.dist.toFixed(0)} m (${(liftoff.dist/FT).toFixed(0)} ft) ias ${liftoff.ias.toFixed(0)}`);
console.log('50 ft', d50 && `${d50.t.toFixed(1)}s ${d50.dist.toFixed(0)} m (${(d50.dist/FT).toFixed(0)} ft) ias ${d50.ias.toFixed(0)}`);
console.log('final: ias', fm.iasKt.toFixed(0), 'alt', fm.aglFt.toFixed(0), 'vs', (fm.vs/0.00508).toFixed(0), 'pitch', fm.pitch.toFixed(1), 'roll', fm.roll.toFixed(1), 'hdg', fm.heading.toFixed(1));
