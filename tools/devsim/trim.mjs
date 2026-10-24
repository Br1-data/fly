import { FlightModel } from '../../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
import { getTerrain } from '../../src/world/terrain-height.js';
import { getAircraft } from '../../src/sim/aircraft/index.js';
import { KT, FT } from '../../src/core/units.js';
const id = process.argv[2] || 'trainer';
const def = getAircraft(id);
const atm = new Atmosphere({ ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0, tempC: 15, qnhHpa: 1013.25 });
const fm = new FlightModel(def, getTerrain(), atm);
fm.systems.reset(true, { inAir: true, fuel: def.fuel.defaultFraction ?? 0.8 }); fm.gear.position = fm.systems.gearPos;
for (const e of fm.engines) e.reset(true);
if (fm.engines[0].type==='piston') fm.engines[0].mixture = 1;
fm.updateMass();
console.log('mass', fm.mass.toFixed(0));
const alts = id === 'airliner' ? [1000, 3000, 10000] : [1000, 2500];
for (const alt of alts) {
  fm.place({ n: -40000, e: 0, alt, heading: 90, speed: 50 });
  const speeds = id === 'trainer' ? [50, 60, 70, 80, 90, 100, 110, 120] : id === 'airliner' ? [140, 160, 180, 220, 250, 300, 350, 450] : [110, 130, 160, 200, 250, 300, 400, 480];
  for (const kt of speeds) {
    const r = fm.trimLevel(kt * KT, 0);
    const e = fm.engines[0];
    console.log(`alt ${alt} TAS ${kt}kt ok=${r.ok} alpha=${r.alpha.toFixed(2)} trim=${r.trim.toFixed(3)} thr=${r.throttle.toFixed(3)} ${e.type==='piston' ? 'rpm=' + e.rpm.toFixed(0) : 'N1=' + e.n1.toFixed(1)} elev=${(fm.defl.elevator*57.3).toFixed(1)} stab=${(fm.defl.stab*57.3).toFixed(2)} CL=${fm.wingCL.toFixed(3)} T=${fm.engines.reduce((a,e)=>a+e.thrust,0).toFixed(0)} ias=${fm.iasKt.toFixed(0)}`);
  }
}
