// Shared helpers for the physics test-suite.
import { FlightModel } from '../src/sim/flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from '../src/sim/atmosphere.js';
import { getTerrain } from '../src/world/terrain-height.js';
import { getAircraft } from '../src/sim/aircraft/index.js';
import { Simulation } from '../src/sim/simulation.js';

globalThis.performance ??= { now: () => Date.now() };

export const CALM = { ...WEATHER_PRESETS.sereno, windSpeedKt: 0, gustKt: 0, turbulence: 0, tempC: 15, qnhHpa: 1013.25, clouds: [] };

/** Flight model in the air with engines running, gear up, no wind. */
export function airborneModel(id, { fuel } = {}) {
  const def = getAircraft(id);
  const atm = new Atmosphere(CALM);
  const fm = new FlightModel(def, getTerrain(), atm);
  fm.systems.reset(true, { inAir: true, fuel: fuel ?? def.fuel.defaultFraction ?? 0.8 });
  fm.gear.position = fm.systems.gearPos;
  for (const e of fm.engines) e.reset(true);
  fm.updateMass();
  return fm;
}

export function newSim(opts) {
  const sim = new Simulation();
  sim.setup({ weather: CALM, time: 11, ...opts });
  return sim;
}

export const KT = 0.514444;
export const FPM = 0.00508;
