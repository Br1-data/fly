// Shared helpers for the test-suite: real planet data and a stepped simulation.
import { Simulation } from '../src/sim/simulation.js';
import { loadPlanetDataNode } from '../src/sim/planet-data.js';

globalThis.performance ??= { now: () => Date.now() };

/** Real heightmaps (Earth ETOPO1, Moon, Mars), loaded once per test file. */
export const planetData = loadPlanetDataNode();

export async function newSim(opts) {
  await planetData;
  const sim = new Simulation();
  sim.setup(opts);
  return sim;
}

/**
 * Step the simulation for `seconds` at a fixed dt, collecting its events. `each(sim)`
 * runs after every step; returning true stops early.
 */
export function run(sim, seconds, dt = 1 / 60, each = null) {
  const events = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.update(dt);
    if (sim.events.length) {
      events.push(...sim.events);
      sim.events.length = 0;
    }
    if (each && each(sim, events)) break;
  }
  return events;
}

export const types = (events) => events.map((e) => e.type);
