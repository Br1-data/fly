import trainer from './trainer.js';
import airliner from './airliner.js';
import jet from './jet.js';

export const AIRCRAFT = { trainer, airliner, jet };
export const AIRCRAFT_LIST = [trainer, airliner, jet];
export function getAircraft(id) {
  return AIRCRAFT[id] || trainer;
}
