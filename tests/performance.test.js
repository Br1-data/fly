// Aircraft performance compared with real-world figures of comparable aircraft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborneModel, newSim, KT, FPM } from './helpers.js';
import { findRunwayEnd } from '../src/world/world-data.js';

const DT = 1 / 240;

function minTrimIas(fm, alt, speeds) {
  let min = Infinity;
  for (const kt of speeds) {
    fm.place({ n: -40000, e: 0, alt, heading: 90, speed: 50 });
    const r = fm.trimLevel(kt * KT, 0);
    if (r.ok && r.alpha < 20 && fm.stallFactor < 0.5) min = Math.min(min, fm.iasKt);
  }
  return min;
}

test('trainer: clean stall speed ~45-50 KIAS, full-flap stall lower', () => {
  const fm = airborneModel('trainer');
  const speeds = [];
  for (let k = 44; k <= 70; k += 1) speeds.push(k);
  const vs1 = minTrimIas(fm, 1000, speeds);
  assert.ok(vs1 > 42 && vs1 < 52, `Vs1 ${vs1}`);
  fm.systems.flapsLever = 3;
  fm.systems.flaps = 1;
  const vs0 = minTrimIas(fm, 1000, speeds.map((s) => s - 8));
  assert.ok(vs0 < vs1 - 4, `Vs0 ${vs0} vs Vs1 ${vs1}`);
});

test('trainer: cruise near 120 KTAS needs most of the available power', () => {
  const fm = airborneModel('trainer');
  fm.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 50 });
  const r = fm.trimLevel(115 * KT, 0);
  assert.ok(r.ok);
  assert.ok(r.throttle > 0.7 && r.throttle < 1, `throttle ${r.throttle}`);
  const rpm = fm.engines[0].rpm;
  assert.ok(rpm > 2300 && rpm < 2700, `rpm ${rpm}`);
  // fuel flow 7-12 gph
  const gph = (fm.engines[0].fuelFlow * 3600) / 0.72 / 3.785;
  assert.ok(gph > 6.5 && gph < 13, `gph ${gph}`);
});

test('trainer: climb rate at Vy between 650 and 950 fpm', () => {
  const fm = airborneModel('trainer');
  fm.place({ n: -40000, e: 0, alt: 300, heading: 90, speed: 50 });
  const vy = 74;
  fm.trimLevel(vy * KT, 0);
  for (const e of fm.engines) e.throttle = 1;
  let th = fm.pitch,
    integ = 0,
    a0 = 0;
  for (let i = 0; i < 240 * 90; i++) {
    th += (fm.iasKt - vy) * 0.25 * DT;
    integ += (th - fm.pitch) * DT;
    fm.input.pitch = Math.max(-1, Math.min(1, 0.06 * (th - fm.pitch) + 0.02 * integ - 0.6 * fm.omega.y));
    fm.input.roll = Math.max(-1, Math.min(1, -0.03 * fm.roll - 0.3 * fm.omega.x));
    fm.input.yaw = Math.max(-1, Math.min(1, 6 * fm.beta));
    fm.step(DT);
    if (i === 240 * 30) a0 = fm.altFt;
  }
  const fpm = (fm.altFt - a0);
  assert.ok(fpm > 650 && fpm < 950, `climb ${fpm} fpm`);
});

test('trainer: takeoff ground roll (flaps 10) 700-1150 ft, 50 ft obstacle < 1900 ft', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'runway', airport: 'XAQU', runway: '07' } });
  const fm = sim.fm;
  const rw = findRunwayEnd('XAQU', '07');
  sim.command('flaps', 1);
  sim.command('parkingBrake', false);
  for (let i = 0; i < 240 * 8; i++) sim.stepOnce(DT);
  const n0 = fm.pos.x,
    e0 = fm.pos.y;
  sim.pilot.throttle = 1;
  let lift = null,
    d50 = null;
  for (let i = 0; i < 240 * 60 && !d50; i++) {
    const hdgErr = ((rw.heading - fm.heading + 540) % 360) - 180;
    sim.pilot.yaw = Math.max(-1, Math.min(1, hdgErr * 0.15 - fm.omega.z * 2 + (fm.onGround ? 0 : 6 * fm.beta)));
    sim.pilot.roll = Math.max(-1, Math.min(1, -0.04 * fm.roll - 0.3 * fm.omega.x));
    sim.pilot.pitch = fm.iasKt > 55 ? Math.max(-1, Math.min(1, 0.08 * (9 - fm.pitch) - 0.8 * fm.omega.y)) : -0.1;
    sim.stepOnce(DT);
    const dist = (fm.pos.x - n0) * rw.dirN + (fm.pos.y - e0) * rw.dirE;
    if (!lift && !fm.onGround && fm.agl > 0.3) lift = dist;
    if (fm.aglFt > 50) d50 = dist;
    assert.ok(!sim.crashed, fm.damage.reason);
  }
  const rollFt = lift / 0.3048,
    obsFt = d50 / 0.3048;
  assert.ok(rollFt > 700 && rollFt < 1150, `ground roll ${rollFt} ft`);
  assert.ok(obsFt < 1900, `50 ft obstacle ${obsFt} ft`);
});

test('airliner: cruise FL330 M0.77 with realistic N1, L/D and fuel flow', () => {
  const fm = airborneModel('airliner');
  fm.place({ n: -40000, e: 0, alt: 10000, heading: 90, speed: 50 });
  const r = fm.trimLevel(450 * KT, 0);
  assert.ok(r.ok);
  assert.ok(fm.mach > 0.75 && fm.mach < 0.8);
  const n1 = fm.engines[0].n1;
  assert.ok(n1 > 75 && n1 < 90, `N1 ${n1}`);
  const thrust = fm.engines.reduce((a, e) => a + e.thrust, 0);
  const ld = (fm.mass * 9.81) / thrust;
  assert.ok(ld > 14 && ld < 19, `L/D ${ld}`);
  const ffKgH = fm.engines.reduce((a, e) => a + e.fuelFlow, 0) * 3600;
  assert.ok(ffKgH > 1900 && ffKgH < 3000, `fuel flow ${ffKgH} kg/h`);
});

test('airliner: clean stall ~ 130-150 KIAS at 64 t, CONF FULL much lower', () => {
  const fm = airborneModel('airliner');
  const speeds = [];
  for (let k = 110; k <= 190; k += 2) speeds.push(k);
  const clean = minTrimIas(fm, 1000, speeds);
  assert.ok(clean > 125 && clean < 155, `clean ${clean}`);
  fm.systems.flapsLever = 4;
  fm.systems.flaps = 1;
  fm.systems.slats = 1;
  const full = minTrimIas(fm, 1000, speeds.map((s) => s - 40));
  assert.ok(full < 115 && full > 90, `full ${full}`);
});

test('jet trainer: fast and agile (max speed > 440 kt, roll rate > 120 deg/s)', () => {
  const fm = airborneModel('jet');
  fm.place({ n: -40000, e: 0, alt: 1000, heading: 90, speed: 50 });
  const r = fm.trimLevel(450 * KT, 0);
  assert.ok(r.ok && r.throttle < 1, `450 kt needs throttle ${r.throttle}`);
  fm.place({ n: -40000, e: 0, alt: 2000, heading: 90, speed: 50 });
  fm.trimLevel(300 * KT, 0);
  let maxP = 0;
  for (let i = 0; i < 240 * 2; i++) {
    fm.input.roll = 1;
    fm.step(DT);
    maxP = Math.max(maxP, (fm.omega.x * 180) / Math.PI);
  }
  assert.ok(maxP > 120, `roll rate ${maxP}`);
});
