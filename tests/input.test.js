import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager, pilotToBody, BINDINGS } from '../src/input/input.js';
import { stickResponse, TOUCH_RESPONSES } from '../src/input/touch-controls.js';
import { getShip } from '../src/sim/ships.js';
import { isTouchDevice, defaultQuality, deviceClass } from '../src/core/device.js';
import { loadSettings } from '../src/ui/settings-store.js';

function fakeSim(shipId) {
  const commands = [];
  return {
    def: getShip(shipId),
    pilot: { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0 },
    command: (name, arg) => commands.push([name, arg]),
    commands,
  };
}

const key = (code, extra = {}) => ({ code, preventDefault() {}, target: null, ...extra });

test('every key combination is bound to one command only', () => {
  const seen = new Map();
  for (const [, label, keys] of BINDINGS) {
    for (const k of keys) {
      assert.ok(!seen.has(k), `${k}: "${label}" and "${seen.get(k)}"`);
      seen.set(k, label);
    }
  }
  assert.ok(BINDINGS.every((b) => b[0] && b[1] && b[2].length && b[3]));
});

test('keyboard commands reach the simulation, interface actions the app', () => {
  const actions = [];
  const sim = fakeSim('capsule');
  const input = new InputManager(sim, { onAction: (a) => actions.push(a) });
  input.setEnabled(true);
  input._keyDown(key('Digit2'));
  input._keyDown(key('Space'));
  input._keyDown(key('KeyZ'));
  input._keyDown(key('KeyA', { shiftKey: true }));
  input._keyDown(key('KeyM'));
  input._keyDown(key('KeyC', { shiftKey: true }));
  input._keyDown(key('Tab'));
  input._keyDown(key('Period'));
  assert.deepEqual(sim.commands, [['sasMode', 'prograde'], ['action', undefined], ['throttle', 1], ['ascent', undefined], ['target', 'next'], ['warp', 1]]);
  assert.deepEqual(actions, ['map', 'view-prev']);
  // Disabled input (menus, loading) does nothing.
  input.setEnabled(false);
  input._keyDown(key('Digit3'));
  assert.equal(sim.commands.length, 6);
});

test('held keys rotate and translate in the pilot frame and recentre on release', () => {
  const sim = fakeSim('capsule');
  const input = new InputManager(sim);
  input.setEnabled(true);
  input._keyDown(key('KeyW'));
  input._keyDown(key('KeyH'));
  for (let i = 0; i < 30; i++) input.update(1 / 60);
  assert.ok(sim.pilot.pitch < -0.5, `nose down ${sim.pilot.pitch}`);
  assert.equal(sim.pilot.tx, 1, 'forward translation along the thrust axis');
  input.keys.clear();
  for (let i = 0; i < 30; i++) input.update(1 / 60);
  assert.equal(sim.pilot.pitch, 0);
  assert.equal(sim.pilot.tx, 0);
  // A/D yaw a spacecraft but roll the spaceplane, like an aircraft.
  const plane = fakeSim('spaceplane');
  const pi = new InputManager(plane);
  pi.setEnabled(true);
  pi._keyDown(key('KeyD'));
  for (let i = 0; i < 20; i++) pi.update(1 / 60);
  assert.ok(plane.pilot.roll > 0.3 && plane.pilot.yaw === 0, JSON.stringify(plane.pilot));
});

test('the lander is flown looking out of its front window', () => {
  const lander = getShip('lander');
  const r = { pitch: 0.5, yaw: 0, roll: 0 };
  const b = pilotToBody(lander, r, { fwd: 1, right: 0, up: 0 });
  assert.equal(b.pitch, 0.5);
  assert.equal(b.tz, 1, 'forward = out of the window (body +z)');
  const c = pilotToBody(getShip('capsule'), r, { fwd: 0, right: 0, up: 1 });
  assert.equal(c.tz, -1, 'up = body −z');
});

test('touch sticks: dead zone, expo and saturation', () => {
  assert.deepEqual(stickResponse(1, 1, 60), { x: 0, y: 0 });
  const full = stickResponse(200, 0, 60);
  assert.equal(full.x, 1);
  const half = stickResponse(30, 0, 60, TOUCH_RESPONSES.precise);
  const direct = stickResponse(30, 0, 60, TOUCH_RESPONSES.direct);
  assert.ok(half.x > 0 && half.x < direct.x && direct.x < 0.5, `${half.x} ${direct.x}`);
  const diag = stickResponse(100, 100, 60);
  assert.ok(Math.hypot(diag.x, diag.y) <= 1.0001);
});

test('coarse-pointer defaults are lightweight while explicit quality choices survive', (t) => {
  let coarse = true;
  let stored = null;
  const previous = Object.fromEntries(['matchMedia', 'window', 'screen'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: coarse }) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => stored } } });
  Object.defineProperty(globalThis, 'screen', { configurable: true, value: { width: 390, height: 844 } });
  t.after(() => {
    for (const [k, d] of Object.entries(previous)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });
  assert.equal(deviceClass(), 'phone');
  assert.equal(isTouchDevice(), true);
  assert.equal(defaultQuality(), 'low');
  assert.equal(loadSettings().quality, 'low');
  stored = JSON.stringify({ quality: 'high', realism: { crashes: false } });
  const s = loadSettings();
  assert.equal(s.quality, 'high');
  assert.equal(s.realism.crashes, false);
  assert.equal(s.realism.autoWarpStop, true, 'missing realism keys get their defaults');
  stored = JSON.stringify({ quality: 'invalid' });
  assert.equal(loadSettings().quality, 'low');
  stored = '{corrupted';
  assert.equal(loadSettings().quality, 'low');
  coarse = false;
  stored = null;
  assert.equal(deviceClass(), 'desktop');
  assert.equal(defaultQuality(), 'medium');
});
