import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim } from './helpers.js';
import { InputManager } from '../src/input/input.js';

const DT = 1 / 120;

function holdPitch(sim, pitch, seconds) {
  for (let i = 0; i < seconds / DT; i++) {
    sim.pilot.pitch = pitch;
    sim.stepOnce(DT);
  }
}

test('trim to current: hands-off after trimming keeps the elevator where it was held', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'air', airport: 'XAQU', altitudeFt: 3000, speedKt: 95, heading: 72 } });
  holdPitch(sim, 0.12, 2);
  const elevator = sim.fm.defl.elevator;
  const trimBefore = sim.fm.input.elevTrim;
  sim.command('trimHold');
  assert.ok(sim.fm.input.elevTrim > trimBefore, 'nose-up input becomes nose-up trim');
  assert.ok(Math.abs(sim.pilot.pitch) < 1e-9, 'the held input was absorbed');
  holdPitch(sim, 0, 0.5);
  assert.ok(Math.abs(sim.fm.defl.elevator - elevator) < 0.3 * Math.PI / 180, `elevator unchanged hands-off (${sim.fm.defl.elevator} vs ${elevator})`);
  assert.ok(!sim.crashed);
});

test('trim saturates gracefully and fly-by-wire normal law is left alone', () => {
  const sim = newSim({ aircraft: 'trainer', start: { type: 'air', airport: 'XAQU', altitudeFt: 3000, speedKt: 95, heading: 72 } });
  sim.fm.input.elevTrim = 0.95;
  sim.pilot.pitch = 0.8;
  sim.command('trimHold');
  assert.equal(sim.fm.input.elevTrim, 1);
  assert.ok(sim.pilot.pitch > 0.7, 'what the trim cannot take stays on the stick');
  const airliner = newSim({ aircraft: 'airliner', start: { type: 'air', airport: 'XAQU', altitudeFt: 6000, speedKt: 250, heading: 72 } });
  const trim = airliner.fm.input.elevTrim;
  airliner.pilot.pitch = 0.3;
  airliner.command('trimHold');
  assert.equal(airliner.fm.input.elevTrim, trim);
  assert.equal(airliner.pilot.pitch, 0.3);
});

test('keyboard T and a spring-centred gamepad hand over to the trim without doubling', () => {
  let pitchAxis = 0.5;
  const pad = { id: 'Pad', index: 0, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  const sim = {
    pilot: { pitch: 0, roll: 0, yaw: 0, throttle: 0.5, brakeL: 0, brakeR: 0 },
    fm: { input: { elevTrim: 0 } },
    command(name) { if (name === 'trimHold') { this.lastTrimAbsorbed = this.pilot.pitch; this.pilot.pitch = 0; } },
  };
  const input = new InputManager(sim);
  input._pads = () => { pad.axes[1] = pitchAxis; return [pad]; };
  input.settings.deadzone = 0;
  input.settings.expo = 0;
  input.setEnabled(true);
  for (let i = 0; i < 20; i++) input.update(0.05);
  assert.ok(Math.abs(sim.pilot.pitch - 0.5) < 0.01);
  const ev = { code: 'KeyT', ctrlKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault() {} };
  input._keyDown(ev);
  for (let i = 0; i < 10; i++) input.update(0.05);
  assert.ok(Math.abs(sim.pilot.pitch) < 0.02, `still holding the stick: no extra input (${sim.pilot.pitch})`);
  pitchAxis = 0.25;
  for (let i = 0; i < 10; i++) input.update(0.05);
  assert.ok(Math.abs(sim.pilot.pitch) < 0.02, 'relaxing towards the centre stays hands-off');
  pitchAxis = 0;
  for (let i = 0; i < 10; i++) input.update(0.05);
  pitchAxis = 0.3;
  for (let i = 0; i < 20; i++) input.update(0.05);
  assert.ok(Math.abs(sim.pilot.pitch - 0.3) < 0.01, 'after re-centring the stick is normal again');
  pitchAxis = 0;
  pad.buttons[13].pressed = true;
  input.update(0.05);
  assert.equal(sim.pilot.trimRate, 1, 'D-pad down trims nose up');
});
