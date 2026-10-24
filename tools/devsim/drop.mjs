import { Simulation } from '../../src/sim/simulation.js';
import { WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
globalThis.performance ??= { now: () => Date.now() };
const ac = process.argv[2] || 'trainer';
const sim = new Simulation();
sim.setup({ aircraft: ac, start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 0.25 }, weather: { ...WEATHER_PRESETS.sereno, windSpeedKt: 0, turbulence: 0 }, time: 11 });
const fm = sim.fm;
sim.pilot.throttle = 0.3;
for (let i = 0; i < 240 * 30; i++) {
  // simple flare controller: hold pitch 4 deg
  sim.pilot.pitch = Math.max(-1, Math.min(1, 0.05 * (4 - fm.pitch) - 0.3 * fm.omega.y));
  if (fm.aglFt < 15) sim.pilot.throttle = 0;
  sim.stepOnce(1/240);
  const L = fm.gear.legs;
  if ((fm.aglFt < 6 || fm.onGround) && i % 12 === 0) console.log(`t=${(i/240).toFixed(2)} agl=${fm.agl.toFixed(2)} vs=${(fm.vs/0.00508).toFixed(0)} pitch=${fm.pitch.toFixed(1)} ias=${fm.iasKt.toFixed(0)} F=${L.map(l=>(l.force/1000).toFixed(1)).join('/')} comp=${L.map(l=>l.compression.toFixed(3)).join('/')} contacts=${fm.gear.contacts.filter(c=>c.contact).map(c=>c.name).join(',')} nz=${fm.nz.toFixed(2)} q=${(fm.omega.y*57.3).toFixed(1)}`);
  if (sim.crashed) { console.log('CRASH', fm.damage.reason); break; }
  if (fm.onGround && fm.gsKt < 20) break;
}
