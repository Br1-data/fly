import { Simulation } from '../../src/sim/simulation.js';
import { WEATHER_PRESETS } from '../../src/sim/atmosphere.js';
globalThis.performance ??= { now: () => Date.now() };
const sim = new Simulation();
sim.setup({ aircraft: 'airliner', start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 2 }, weather: { ...WEATHER_PRESETS.sereno, windSpeedKt: 0, turbulence: 0 }, time: 11 });
const fm = sim.fm; sim.update(0.05); sim.command('ap'); sim.command('apApr'); sim.ap.spdSel = 137; sim.command('apAthr');
for (let i = 0; i < 2400; i++) { sim.update(0.05); if (fm.aglFt < 90 && i % 3 === 0) console.log(`agl=${fm.aglFt.toFixed(0)} vs=${(fm.vs/0.00508).toFixed(0)} vsCmd=${sim.ap.vsCmd.toFixed(0)} th=${fm.pitch.toFixed(2)} thCmd=${sim.ap.thetaCmd.toFixed(2)} elev=${(fm.defl.elevator*57.3).toFixed(1)} pin=${fm.input.pitch.toFixed(2)} flare=${fm.fcs.flare} al=${sim.ap.autoland}`); if (fm.onGround) break; }
console.log(sim.landed?.vsFpm);
