import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS } from '../src/missions/missions.js';
import { MissionRunner } from '../src/missions/runner.js';
import { getChecklists } from '../src/missions/checklists.js';
import { loadResults, saveResult } from '../src/missions/progress.js';
import { AIRCRAFT_LIST } from '../src/sim/aircraft/index.js';
import { Simulation } from '../src/sim/simulation.js';
import { findRunwayEnd } from '../src/world/world-data.js';

function fakeSim() {
  return { paused: false, crashed: false, nav1: { active: 115.2 }, fm: {
    pos: { x: 0, y: 0 }, alt: 1000, altFt: 3281, aglFt: 3000, roll: 0, vs: 0, onGround: false, gsKt: 100,
    iasKt: 100, damage: {}, engines: [{ running: true }], systems: { avionicsPowered: true },
  } };
}
function runner(objectives, sim = fakeSim()) {
  const r = new MissionRunner({ id: 'test', title: 'Test', setup: { start: {} }, objectives }, sim);
  r.start();
  return r;
}

test('all 13 missions have valid simulation setups, goals, marker geometry and checklists', () => {
  assert.equal(MISSIONS.length, 13);
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, 13);
  for (const m of MISSIONS) {
    const sim = new Simulation().setup(m.setup);
    const r = new MissionRunner(m, sim);
    r.start(); r.update(0.01);
    assert.equal(r.status, 'running', m.id);
    assert.equal(m.objectivesPreview.length, m.objectives.length);
    for (const p of r.getMarkers()) for (const key of ['n', 'e', 'alt', 'radius']) assert.ok(Number.isFinite(p[key]), `${m.id}.${key}`);
  }
  for (const def of AIRCRAFT_LIST) {
    const sim = new Simulation().setup({ aircraft: def.id, start: { type: 'parking', airport: 'XAQU' }, coldDark: true });
    for (const list of getChecklists(def)) for (const it of list.items) if (it.check) assert.equal(typeof it.check(sim), 'boolean');
  }
});

test('mission objectives require ordered completion and sustained stable flight', () => {
  const sim = fakeSim();
  const r = runner([{ type: 'climb', text: 'Climb', aglFt: 3500 }, { type: 'hold', text: 'Hold', altFt: 3281, toleranceFt: 100, duration: 2 }], sim);
  r.update(5); assert.equal(r.index, 0);
  sim.fm.aglFt = 3600; r.update(0.1); assert.equal(r.index, 1);
  r.update(1); sim.fm.roll = 25; r.update(1); assert.equal(r._hold, 0);
  sim.fm.roll = 0; r.update(1); assert.equal(r.status, 'running');
  r.update(1); assert.equal(r.status, 'success'); assert.equal(r.debrief.score, 1000);
});

test('waypoint segment crossing registers but passing outside its altitude does not', () => {
  const sim = fakeSim();
  const r = runner([{ type: 'waypoint', text: 'Gate', n: 1000, e: 0, alt: 1000, radius: 50 }], sim);
  sim.fm.pos.x = 2000; r.update(0.1); assert.equal(r.status, 'success');
  sim.fm.pos.x = 0; sim.fm.alt = 1300;
  const miss = runner([{ type: 'waypoint', n: 1000, e: 0, alt: 1000, radius: 50 }], sim);
  sim.fm.pos.x = 2000; miss.update(0.1); assert.equal(miss.status, 'running');
});

test('landings require target runway and stopping after the accepted contact', () => {
  const sim = fakeSim(), end = findRunwayEnd('XAQU', '07');
  const r = runner([{ type: 'land', text: 'Land', airport: 'XAQU', runway: '07', maxAlong: 800, maxOffset: 10 }, { type: 'stop', text: 'Stop', duration: 2 }], sim);
  sim.fm.onGround = true; sim.fm.gsKt = 0;
  r.update(5); assert.equal(r.index, 0, 'parked aircraft is not a landing');
  r.handleEvent({ type: 'touchdown', data: { n: end.thrN + end.dirN * 200, e: end.thrE + end.dirE * 200, heading: end.heading, vsFpm: 180 } });
  r.update(0.1); assert.equal(r.index, 1); r.update(2); assert.equal(r.status, 'success');
  assert.ok(r.debrief.score > 900);
  const bad = runner([{ type: 'land', text: 'Land', airport: 'XAQU', runway: '07' }]);
  bad.handleEvent({ type: 'touchdown', data: { n: end.thrN, e: end.thrE + 500, heading: end.heading } });
  assert.equal(bad.status, 'failed'); assert.equal(bad.debrief.stars, 0);
});

test('crashes fail a mission and paused time does not advance its timer', () => {
  const sim = fakeSim(), r = runner([{ type: 'climb', text: 'Climb', aglFt: 4000 }], sim);
  sim.paused = true; r.update(100); assert.equal(r.elapsed, 0);
  sim.paused = false; r.handleEvent({ type: 'crash', reason: 'Impatto' });
  assert.equal(r.status, 'failed'); assert.equal(r.debrief.text, 'Impatto');
  r.update(1); assert.equal(r.elapsed, 0);
});

test('roll challenge uses net rotation rather than accumulating back-and-forth motion', () => {
  const sim = fakeSim(), r = runner([{ type: 'roll', text: 'Roll', minAglFt: 1500 }], sim);
  for (let i = 0; i < 10; i++) { sim.fm.roll = 90; r.update(0.1); sim.fm.roll = 0; r.update(0.1); }
  assert.equal(r.status, 'running');
  for (const roll of [90, 179, -90, 0]) { sim.fm.roll = roll; r.update(0.1); }
  assert.equal(r.status, 'success');
});

test('progress preserves successful personal bests, ignores failure and tolerates unavailable storage', () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(saveResult('first', { success: false, score: 0, stars: 0 }), false);
  assert.deepEqual(loadResults(), {});
  assert.equal(saveResult('first', { success: true, score: 800, stars: 2 }), true);
  saveResult('first', { success: true, score: 700, stars: 1 }); assert.equal(loadResults().first.score, 800);
  saveResult('first', { success: true, score: 1000, stars: 3 }); assert.equal(loadResults().first.best, 1000);
  values.set('cieli-aperti.missions', '{broken'); assert.deepEqual(loadResults(), {});
  globalThis.localStorage.setItem = () => { throw new Error('Quota'); };
  assert.equal(saveResult('first', { success: true, score: 800, stars: 2 }), false);
  delete globalThis.localStorage;
});

test('the fog ILS mission can be completed through real autoland and runway braking', () => {
  const mission = MISSIONS.find((m) => m.id === 'ils-nebbia');
  const sim = new Simulation().setup(mission.setup);
  const r = new MissionRunner(mission, sim); r.start();
  sim.update(0.1); // instruments and radio reception settle before selecting APR
  sim.command('ap'); sim.command('apApr'); sim.ap.spdSel = 137;
  sim.command('apAthr'); sim.command('autobrake', 2); sim.command('spoilers', 'arm');
  for (let i = 0; i < 4000 && r.status === 'running'; i++) {
    sim.update(0.1); r.update(0.1);
    for (const ev of sim.events) r.handleEvent(ev);
    sim.events.length = 0;
    if (sim.landed) { sim.pilot.throttle = 0; sim.pilot.brakeL = 1; sim.pilot.brakeR = 1; }
  }
  assert.equal(r.status, 'success', r.debrief?.text);
  assert.ok(sim.landed.vsFpm < 300);
  assert.ok(sim.fm.gsKt < 5);
  assert.ok(r.debrief.score >= 900);
});
