import { Simulation } from '../../src/sim/simulation.js';
import { WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
const ac = process.argv[2] || 'trainer';
const sim = new Simulation();
globalThis.performance ??= { now: () => Date.now() };
sim.setup({ aircraft: ac, start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 8 }, weather: { ...WEATHER_PRESETS.sereno, windSpeedKt: 8, windDir: 90 }, time: 11 });
const fm = sim.fm;
console.log('start', fm.iasKt.toFixed(0), 'alt', fm.altFt.toFixed(0), 'nav1', sim.nav1.ident, sim.nav1.valid, 'cdi', sim.nav1.cdi.toFixed(2), 'gs', sim.nav1.gs.toFixed(2));
sim.update(0.05); sim.command('ap');
sim.command('apApr');
if (sim.def.autopilot.autothrottle) { sim.ap.spdSel = sim.def.speeds.vapp; sim.command('apAthr'); }
let t = 0;
for (let i = 0; i < 6000; i++) {
  sim.update(0.1); t += 0.1;
  if (i % 300 === 0 || fm.aglFt < 120 && i % 10 === 0) console.log(`t=${t.toFixed(0)} ias=${fm.iasKt.toFixed(0)} alt=${fm.altFt.toFixed(0)} agl=${fm.aglFt.toFixed(0)} hdg=${fm.heading.toFixed(0)} vs=${(fm.vs/0.00508).toFixed(0)} lat=${sim.ap.lateral} vert=${sim.ap.vertical} ap=${sim.ap.engaged} cdi=${sim.nav1.cdi.toFixed(2)} gs=${sim.nav1.gs.toFixed(2)} thr=${sim.pilot.throttle.toFixed(2)} al=${sim.ap.autoland} ground=${fm.onGround}`);
  if (sim.crashed) { console.log('CRASH', fm.damage.reason); break; }
  if (fm.onGround && fm.gsKt < 5) break;
}
console.log('landed', sim.landed && { vsFpm: sim.landed.vsFpm.toFixed(0), ias: sim.landed.ias.toFixed(0) });
console.log('messages', sim.messages.map(m => m.text).join(' | '));
