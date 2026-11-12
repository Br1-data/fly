import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, CATEGORIES } from '../src/missions/missions.js';
import { MissionRunner, M } from '../src/missions/runner.js';
import { SHIPS } from '../src/sim/ships.js';
import { STARTS } from '../src/ui/freeflight.js';
import { newSim, run } from './helpers.js';

test('mission catalogue is complete and consistent', () => {
  assert.ok(MISSIONS.length >= 15);
  const ids = new Set();
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const m of MISSIONS) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.ok(cats.has(m.category) && m.category !== 'all', `${m.id}: category ${m.category}`);
    assert.ok(m.title && m.subtitle && m.briefing.length > 80, `${m.id}: texts`);
    assert.ok(m.difficulty >= 1 && m.difficulty <= 5, m.id);
    assert.equal(m.setup.ship, m.ship, `${m.id}: ship`);
    assert.ok(SHIPS.some((s) => s.id === m.ship), m.id);
    assert.ok(m.objectives.length >= 1 && m.objectives.every((o) => o.text && typeof o.check === 'function'), m.id);
  }
  for (const c of CATEGORIES.filter((c) => c.id !== 'all')) assert.ok(MISSIONS.some((m) => m.category === c.id), `empty category ${c.id}`);
});

test('every mission lists the commands it needs, with SAS modes that exist', async () => {
  const { SAS_HELP, TOP_BUTTONS, tip } = await import('../src/ui/flight-commands.js');
  const { SAS_MODES } = await import('../src/sim/assist.js');
  for (const m of MISSIONS) {
    assert.ok(m.controls.length >= 3, `${m.id}: controls`);
    assert.ok(m.controls.every((c) => c.keys && c.text), m.id);
  }
  for (const mode of SAS_MODES) assert.ok(SAS_HELP[mode.id]?.text, `SAS ${mode.id}: instructions`);
  for (const id of ['sas', 'rcs']) assert.ok(SAS_HELP[id].label && SAS_HELP[id].keys, id);
  assert.ok(Object.values(TOP_BUTTONS).every((b) => b.label && b.keys && tip(b).includes(b.keys)));
});

test('every mission starts and flies a few seconds without failing', async () => {
  for (const m of MISSIONS) {
    const sim = await newSim(m.setup);
    const runner = new MissionRunner(m, sim);
    runner.start();
    run(sim, 3, 1 / 30, (s, ev) => {
      for (const e of ev.splice(0)) runner.handleEvent(e);
      runner.update(1 / 30);
    });
    assert.ok(!sim.crashed, `${m.id}: crashed (${sim.ship.destroyed})`);
    assert.notEqual(runner.status, 'failed', `${m.id}: ${runner.debrief?.text}`);
    assert.ok(Array.isArray(runner.getMarkers()), m.id);
  }
});

test('mission runner: sequential objectives, score and stars', async () => {
  const sim = await newSim({ ship: 'pod', start: { type: 'orbit', body: 'earth', altitude: 400e3 } });
  let flag = false;
  const mission = {
    id: 'test', title: 'Prova', objectives: [{ text: 'A', check: () => true }, { text: 'B', check: () => flag }],
    score: () => ({ items: [{ label: 'x', value: '', points: M.grade(0.2, 0, 1, 500) }] }),
  };
  const r = new MissionRunner(mission, sim);
  r.start();
  r.update(0.1);
  assert.deepEqual(r.objectives.map((o) => o.state), ['done', 'active']);
  assert.equal(r.status, 'running');
  flag = true;
  r.update(0.1);
  assert.equal(r.status, 'success');
  assert.equal(r.debrief.score, 400 + 400);
  assert.equal(r.debrief.stars, 2);
  assert.equal(M.grade(5, 10, 0, 100), 50);
  assert.equal(M.grade(-1, 10, 0, 100), 0);
});

test('mission runner: a crash fails the mission', async () => {
  const sim = await newSim({ ship: 'pod', start: { type: 'orbit', body: 'earth', altitude: 400e3 } });
  const r = new MissionRunner({ id: 't', title: 'T', objectives: [{ text: 'A', check: () => false }] }, sim);
  r.start();
  r.handleEvent({ type: 'crash', reason: 'Impatto' });
  assert.equal(r.status, 'failed');
  assert.equal(r.debrief.text, 'Impatto');
});

test('every free-flight start works with every vehicle offered for it', async () => {
  for (const s of STARTS) {
    assert.ok(s.label && s.desc && s.ships.length, s.id);
    for (const ship of s.ships) {
      const sim = await newSim({ ship, start: { ...s.start }, target: s.target, date: s.date || '2031-05-20T08:00:00Z', fuel: 1, legs: s.legs });
      run(sim, 2, 1 / 30);
      assert.ok(!sim.crashed, `${s.id} / ${ship}: ${sim.ship.destroyed}`);
      assert.equal(sim.ship.def.id, ship);
      if (s.start.body) assert.equal(sim.ship.ref, s.start.body, `${s.id} / ${ship}`);
    }
  }
});
