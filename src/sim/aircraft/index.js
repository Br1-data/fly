import trainer from './trainer.js';
import aerobatic from './aerobatic.js';
import twin from './twin.js';
import bizjet from './bizjet.js';
import airliner from './airliner.js';
import jet from './jet.js';
import turboprop from './turboprop.js';
import warbird from './warbird.js';
import fighter from './fighter.js';
import eurofighter from './eurofighter.js';
import transport from './transport.js';
import heli from './heli.js';
import heliutility from './heliutility.js';
import heliattack from './heliattack.js';

// Civil aircraft first, then military ones, each roughly from slow to fast; helicopters last.
export const AIRCRAFT_LIST = [trainer, aerobatic, twin, bizjet, airliner, turboprop, jet, warbird, transport, fighter, eurofighter, heli, heliutility, heliattack];
export const AIRCRAFT = Object.fromEntries(AIRCRAFT_LIST.map((def) => [def.id, def]));
export function getAircraft(id) {
  return AIRCRAFT[id] || trainer;
}

/** Large aircraft (airliners, transports): longer runway set-back, higher chase camera. */
export function isLarge(def) {
  return def.large ?? def.wing.span > 25;
}
