import test from 'node:test';
import assert from 'node:assert/strict';
import { getCockpitGuide } from '../src/cockpit/control-catalog.js';
import { getAircraft } from '../src/sim/aircraft/index.js';
import { GLOSSARY } from '../src/ui/help-data.js';

test('menu help covers all aircraft while in-flight help filters unavailable equipment', () => {
  const all = getCockpitGuide(null);
  const ga = getCockpitGuide(getAircraft('trainer'));
  const liner = getCockpitGuide(getAircraft('airliner'));
  assert.ok(all.some((c) => c.label === 'Miscela'));
  assert.ok(all.some((c) => c.label === 'APU master'));
  assert.ok(ga.some((c) => c.label === 'Miscela'));
  assert.ok(!ga.some((c) => c.label === 'APU master'));
  assert.ok(liner.some((c) => c.label === 'APU master'));
  assert.ok(!liner.some((c) => c.label === 'Miscela'));
  for (const list of [all, ga, liner]) {
    assert.equal(new Set(list.map((c) => c.group + c.label)).size, list.length);
    assert.ok(list.every((c) => c.description.length > 15));
  }
});

test('glossary explains the main flight and navigation acronyms without duplicate terms', () => {
  const terms = new Set(GLOSSARY.map((e) => e.term.toLowerCase()));
  assert.equal(terms.size, GLOSSARY.length);
  for (const required of ['IAS', 'TAS', 'GS', 'QNH', 'QFE', 'ILS', 'VOR', 'DME', 'ADF', 'OBS', 'CDI', 'Trim', 'Stallo']) {
    const entry = GLOSSARY.find((e) => e.term.toLowerCase() === required.toLowerCase());
    assert.ok(entry?.description.length > 50, required);
  }
});
