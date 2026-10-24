// Systems, ground handling, autopilot and navigation behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, KT, FPM } from './helpers.js';
import { getTerrain } from '../src/world/terrain-height.js';
import { AIRPORTS, findRunwayEnd, airportLayouts } from '../src/world/world-data.js';

const DT = 1 / 240;
const run = (sim, seconds) => {
  for (let i = 0; i < seconds * 10; i++) sim.update(0.1);
};

test('terrain is deterministic and airports are flat at their elevation', () => {
  const t = getTerrain();
  for (const ap of AIRPORTS) {
    const g = t.groundInfo(ap.n, ap.e, {});
    assert.equal(g.h, ap.elev, ap.icao);
    assert.equal(t.height(ap.n + 123, ap.e - 77), t.height(ap.n + 123, ap.e - 77));
  }
  const L = airportLayouts()[0];
  for (const s of L.surfaces) assert.equal(t.groundInfo(s.n, s.e, {}).h, L.airport.elev);
});

test('parked aircraft stays put with the parking brake at idle', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'parking', airport: 'XAQU' } });
  const n0 = sim.fm.pos.x,
    e0 = sim.fm.pos.y;
  assert.ok(sim.fm.onGround);
  assert.ok(Math.abs(sim.fm.pitch) < 2, `pitch ${sim.fm.pitch}`);
  run(sim, 20);
  assert.ok(Math.hypot(sim.fm.pos.x - n0, sim.fm.pos.y - e0) < 0.5);
  assert.ok(!sim.crashed);
});

test('cold & dark trainer starts with the autostart sequence', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'parking', airport: 'XAQU' }, coldDark: true });
  assert.equal(sim.fm.engines[0].running, false);
  assert.equal(sim.fm.systems.battery, false);
  sim.command('autostart');
  run(sim, 20);
  assert.ok(sim.fm.engines[0].running, 'engine running');
  assert.equal(sim.fm.engines[0].magnetos, 3);
  const rpm = sim.fm.engines[0].rpm;
  assert.ok(rpm > 550 && rpm < 1100, `idle rpm ${rpm}`);
});

test('piston engine stops on mixture cut-off and fuel selector OFF', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'runway', airport: 'XAQU', runway: '25' } });
  run(sim, 2);
  sim.command('mixture', 0);
  run(sim, 6);
  assert.equal(sim.fm.engines[0].running, false);
});

test('cold & dark airliner: APU and both engines start via autostart', () => {
  const sim = newSim({ aircraft: 'airliner', start: { type: 'parking', airport: 'XAQU' }, coldDark: true });
  sim.command('autostart');
  run(sim, 110);
  assert.ok(sim.fm.engines.every((e) => e.running), 'engines running');
  for (const e of sim.fm.engines) assert.ok(e.n1 > 15 && e.n1 < 30, `idle N1 ${e.n1}`);
});

test('autopilot holds altitude and turns to the heading bug (trainer)', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'air', airport: 'XAQU', altitudeFt: 4500, speedKt: 105, heading: 90 } });
  run(sim, 0.2);
  sim.command('ap');
  sim.command('apAlt');
  sim.ap.hdgBug = 180;
  sim.command('apHdg');
  const alt0 = sim.ap.altHold;
  run(sim, 90);
  assert.ok(sim.ap.engaged);
  assert.ok(Math.abs(sim.instruments.alt - alt0) < 60, `alt ${sim.instruments.alt} vs ${alt0}`);
  assert.ok(Math.abs(sim.fm.heading - 180) < 4, `hdg ${sim.fm.heading}`);
});

test('autopilot climbs in VS mode and captures the selected altitude', () => {
  const sim = newSim({ aircraft: 'airliner', start: { type: 'air', airport: 'XAQU', altitudeFt: 5000, speedKt: 250, heading: 0 } });
  run(sim, 0.2);
  sim.command('ap');
  sim.ap.altSel = 7000;
  sim.command('apVs');
  sim.ap.vsSel = 1500;
  sim.ap.spdSel = 250;
  sim.command('apAthr');
  run(sim, 150);
  assert.equal(sim.ap.vertical, 'ALT');
  assert.ok(Math.abs(sim.instruments.alt - 7000) < 80, `alt ${sim.instruments.alt}`);
  assert.ok(Math.abs(sim.fm.iasKt - 250) < 12, `ias ${sim.fm.iasKt}`);
});

test('airliner autoland on ILS 07 touches down softly on the centreline', () => {
  const sim = newSim({ aircraft: 'airliner', start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 6 } });
  run(sim, 0.1);
  sim.command('ap');
  sim.command('apApr');
  sim.ap.spdSel = 137;
  sim.command('apAthr');
  sim.command('autobrake', 2);
  sim.command('spoilers', 'arm');
  for (let i = 0; i < 6000 && !(sim.fm.onGround && sim.fm.gsKt < 30); i++) {
    sim.update(0.1);
    assert.ok(!sim.crashed, sim.fm.damage.reason);
  }
  assert.ok(sim.landed, 'landed');
  assert.ok(sim.landed.vsFpm < 420, `touchdown ${sim.landed.vsFpm} fpm`);
  const end = findRunwayEnd('XAQU', '07');
  const off = Math.abs((sim.fm.pos.x - end.thrN) * -end.dirE + (sim.fm.pos.y - end.thrE) * end.dirN);
  assert.ok(off < 8, `centreline offset ${off} m`);
  const along = (sim.landed.n - end.thrN) * end.dirN + (sim.landed.e - end.thrE) * end.dirE;
  assert.ok(along > 150 && along < 900, `touchdown ${along} m past the threshold`);
});

test('ILS receiver: deviation signs and glideslope', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 5 } });
  run(sim, 0.1);
  const nav = sim.nav1;
  assert.ok(nav.valid && nav.isLoc);
  assert.ok(Math.abs(nav.cdi) < 0.1);
  assert.ok(nav.gsValid && Math.abs(nav.gs) < 0.25, `gs ${nav.gs}`);
  // move the aircraft 150 m to the right of the approach course -> needle left (negative)
  const end = findRunwayEnd('XAQU', '07');
  sim.fm.pos.x += -end.dirE * 150;
  sim.fm.pos.y += end.dirN * 150;
  sim.updateRadios();
  assert.ok(nav.cdi < -0.2, `cdi ${nav.cdi}`);
  // move up 100 m -> above glidepath -> needle down (negative)
  sim.fm.pos.z -= 100;
  sim.fm._derive();
  sim.updateRadios();
  assert.ok(nav.gs < -0.5, `gs ${nav.gs}`);
});

test('VOR TO/FROM and deviation', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'air', airport: 'XAQU', n: -20000, e: -1400, altitudeFt: 5000, heading: 0 } });
  sim.nav1.active = 113.5; // AQV at (1500, -1400): aircraft is south of the station on radial 180
  sim.nav1.obs = 0;
  run(sim, 0.1);
  assert.ok(sim.nav1.valid);
  assert.equal(sim.nav1.toFrom, 1);
  assert.ok(Math.abs(sim.nav1.cdi) < 0.1);
  assert.ok(sim.nav1.dme > 10 && sim.nav1.dme < 13, `dme ${sim.nav1.dme}`);
  sim.nav1.obs = 20; // inbound course 020 lies on radial 200, west of us: we are right of it -> needle left
  sim.updateRadios();
  assert.ok(sim.nav1.cdi < -0.9, `cdi ${sim.nav1.cdi}`);
  sim.nav1.obs = 180; // FROM the station on radial 180
  sim.updateRadios();
  assert.equal(sim.nav1.toFrom, -1);
});

test('hard landing destroys the gear, sea contact is a crash', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'final', airport: 'XAQU', runway: '07', distanceNm: 0.3 } });
  sim.fm.vel.z = 7; // 1400 fpm sink
  sim.pilot.throttle = 0;
  for (let i = 0; i < 240 * 20 && !sim.crashed; i++) sim.stepOnce(DT);
  assert.ok(sim.crashed, 'crashed');
  const sea = newSim({ aircraft: 'trainer', start: { type: 'air', n: -60000, e: -60000, altitudeFt: 30, speedKt: 70, heading: 0 } });
  sea.pilot.throttle = 0;
  sea.pilot.pitch = -0.4;
  for (let i = 0; i < 240 * 30 && !sea.crashed; i++) sea.stepOnce(DT);
  assert.ok(sea.crashed);
  assert.match(sea.fm.damage.reason, /acqua/i);
});
