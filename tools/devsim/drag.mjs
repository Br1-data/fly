import { FlightModel } from '../../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
import { getTerrain } from '../../src/world/terrain-height.js';
import { getAircraft } from '../../src/sim/aircraft/index.js';
import { KT } from '../../src/core/units.js';
const id = process.argv[2] || 'airliner', alt = +(process.argv[3] || 10000), kt = +(process.argv[4] || 450);
const def = getAircraft(id);
const atm = new Atmosphere({ ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0, tempC: 15, qnhHpa: 1013.25 });
const fm = new FlightModel(def, getTerrain(), atm);
fm.systems.reset(true, { inAir: true, fuel: def.fuel.defaultFraction ?? 0.8 });
for (const e of fm.engines) e.reset(true);
fm.updateMass();
fm.place({ n: -40000, e: 0, alt, heading: 90, speed: 50 });
const r = fm.trimLevel(kt * KT, 0);
console.log(r, 'mach', fm.mach.toFixed(3));
const V = fm.tas, qS = 0.5 * fm.env.rho * V * V * fm.wingArea;
let tot = 0;
for (const s of fm.surfaces) { const st = s.state; const d = st.cd * st.q * s.area; tot += d; console.log(s.name.padEnd(8), 'alpha', (st.alpha*57.3).toFixed(2), 'cl', st.cl.toFixed(3), 'cd', st.cd.toFixed(4), 'dragN', d.toFixed(0), 'liftN', (st.cl*st.q*s.area).toFixed(0)); }
console.log('surface drag', tot.toFixed(0), 'parasite', (qS / fm.wingArea * def.parasiteArea).toFixed(0), 'weight', (fm.mass*9.81).toFixed(0), 'CL', fm.wingCL.toFixed(3), 'L/D', (fm.mass*9.81/(tot + qS/fm.wingArea*def.parasiteArea)).toFixed(1));
