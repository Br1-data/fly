import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../src/input/input.js';

function fixture() {
  const calls = [];
  const actions = [];
  const sim = {
    pilot: { pitch: 0, roll: 0, yaw: 0, throttle: 0.4, mixture: 1, brakeL: 0, brakeR: 0, trimRate: 0 },
    command: (...args) => calls.push(args),
  };
  const input = new InputManager(sim, { onAction: (...args) => actions.push(args) });
  input.setEnabled(true);
  const key = (code, options = {}) => {
    const event = { code, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, prevented: false, preventDefault() { this.prevented = true; }, ...options };
    input._keyDown(event);
    return event;
  };
  return { sim, input, key, calls, actions };
}

test('keyboard inputs ramp, release and clear on menus without changing throttle', () => {
  const { sim, input, key } = fixture();
  key('ArrowDown'); key('ArrowRight'); key('KeyE'); key('Period'); key('Home');
  input.update(0.1);
  assert.ok(sim.pilot.pitch > 0 && sim.pilot.roll > 0 && sim.pilot.yaw > 0);
  assert.equal(sim.pilot.brakeL, 1);
  assert.equal(sim.pilot.brakeR, 1);
  assert.equal(sim.pilot.trimRate, 1);
  input.setEnabled(false);
  for (const control of ['pitch', 'roll', 'yaw', 'brakeL', 'brakeR', 'trimRate']) assert.equal(sim.pilot[control], 0);
  assert.equal(sim.pilot.throttle, 0.4);
  key('F4'); input.update(1);
  assert.equal(sim.pilot.throttle, 0.4);
  input.setEnabled(true); input.update(0.1);
  assert.equal(sim.pilot.pitch, 0);
});

test('shortcuts distinguish modifiers, ignore repeat and preserve form interaction', () => {
  const { sim, input, key, calls, actions } = fixture();
  key('KeyE', { ctrlKey: true });
  assert.deepEqual(calls.at(-1), ['autostart', undefined]);
  assert.ok(!input.keys.has('KeyE'));
  key('KeyG'); key('KeyG', { repeat: true });
  assert.equal(calls.filter(([command]) => command === 'gear').length, 1);
  key('KeyS', { shiftKey: true });
  assert.deepEqual(actions.at(-1), ['view-prev']);
  key('KeyS', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(calls.at(-1), ['smoke', undefined]);
  key('F4', { target: { tagName: 'INPUT' } });
  assert.equal(sim.pilot.throttle, 0.4);
  key('KeyG', { target: { tagName: 'BUTTON' } });
  assert.equal(calls.filter(([command]) => command === 'gear').length, 2);
  key('Space', { target: { tagName: 'BUTTON' } }); input.update(0.1);
  assert.equal(sim.pilot.brakeL, 0);
  key('F4'); assert.equal(sim.pilot.throttle, 1);
});

test('blur and pointer disabling release control state', () => {
  const { sim, input } = fixture();
  const target = new EventTarget();
  const canvas = new EventTarget();
  input.attach(target, canvas);
  const down = new Event('keydown', { cancelable: true });
  Object.defineProperty(down, 'code', { value: 'ArrowDown' });
  target.dispatchEvent(down);
  input.update(0.1);
  assert.ok(sim.pilot.pitch > 0);
  target.dispatchEvent(new Event('blur'));
  assert.equal(sim.pilot.pitch, 0);
  input.destroy();
  target.dispatchEvent(down);
  input.update(0.1);
  assert.equal(sim.pilot.pitch, 0);
});

test('gamepad axes apply inversion and deadzone, then release on disconnect', () => {
  const { sim, input } = fixture();
  const pad = { id: 'Test HOTAS', index: 0, mapping: '', axes: [0.8, -1, 0.03], buttons: [] };
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let pads = [pad];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  try {
    input.setAxisBinding('roll', { gamepadId: pad.id, axis: 0, invert: true });
    input.setAxisBinding('throttle2', { gamepadId: pad.id, axis: 1, invert: true });
    input.setAxisBinding('yaw', { gamepadId: pad.id, axis: 2 });
    input.update(0.2);
    assert.ok(sim.pilot.roll < -0.5);
    assert.equal(sim.pilot.throttle2, 1);
    assert.equal(sim.pilot.yaw, 0);
    const previousRoll = sim.pilot.roll;
    pads = [];
    input.update(0.1);
    assert.ok(Math.abs(sim.pilot.roll) < Math.abs(previousRoll));
    assert.equal(sim.pilot.throttle2, undefined);
    assert.deepEqual(input.getAxisValues(), {});
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  }
});

test('settings preview polls axes without flying or triggering gamepad actions', () => {
  const { sim, input, actions } = fixture();
  const pad = { id: 'Gamepad', index: 0, mapping: 'standard', axes: [1, 0, 0, 0], buttons: Array.from({ length: 10 }, (_, i) => ({ pressed: i === 9, value: i === 9 ? 1 : 0 })) };
  input._pads = () => [pad];
  input.setEnabled(false);
  input.update(0);
  assert.equal(input.getAxisValues().roll, 1);
  assert.equal(sim.pilot.roll, 0);
  assert.equal(actions.length, 0);
  input.setEnabled(true);
  input.update(0.1);
  input.update(0.1);
  assert.deepEqual(actions, [['menu']]);
});

test('opening menu from a gamepad releases even concurrently held brakes', () => {
  const { sim, input } = fixture();
  const buttons = Array.from({ length: 10 }, (_, i) => ({ pressed: i === 0 || i === 9, value: 0 }));
  input._pads = () => [{ id: 'Pad', index: 0, mapping: 'standard', axes: [0, 0, 0], buttons }];
  input.onAction = () => input.setEnabled(false);
  input.update(0.1);
  assert.equal(input.enabled, false);
  assert.equal(sim.pilot.brakeL, 0);
  assert.equal(sim.pilot.brakeR, 0);
});

test('reversers allow simultaneous braking and steering with Shift held', () => {
  const { sim, input, key } = fixture();
  key('ShiftLeft', { shiftKey: true });
  key('F2', { shiftKey: true });
  key('Space', { shiftKey: true });
  key('ArrowLeft', { shiftKey: true });
  key('KeyQ', { shiftKey: true });
  input.update(0.1);
  assert.equal(sim.pilot.reverse, true);
  assert.equal(sim.pilot.brakeL, 1);
  assert.equal(sim.pilot.brakeR, 1);
  assert.ok(sim.pilot.roll < 0);
  assert.ok(sim.pilot.yaw < 0);
});
