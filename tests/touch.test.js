import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchControls } from '../src/input/touch-controls.js';
import { InputManager } from '../src/input/input.js';

// Minimal DOM adapter keeps the interaction tests runnable in Node-only CI too.
class Element extends EventTarget {
  constructor(document, tag) {
    super();
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.classes = new Set();
    this.classList = { add: (s) => this.classes.add(s), remove: (s) => this.classes.delete(s), contains: (s) => this.classes.has(s) };
    this.captures = new Set();
    this.rect = { left: 10, top: 20, width: 120, height: 120 };
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

function fixture(coarse = true) {
  const document = new EventTarget();
  const window = new EventTarget();
  const media = new EventTarget();
  media.matches = coarse;
  window.matchMedia = () => media;
  window.screen = { orientation: new EventTarget() };
  document.defaultView = window;
  document.createElement = (tag) => new Element(document, tag);
  document.head = document.createElement('head');
  document.getElementById = (id) => document.head.children.find((child) => child.id === id);
  const root = document.createElement('div');
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = window.matchMedia;
  const calls = [];
  const actions = [];
  const sim = {
    pilot: { throttle: 0.4, pitch: 0, roll: 0, yaw: 0, brakeL: 0, brakeR: 0 },
    def: { controls: { retractableGear: true, flapDetents: [{ name: '0' }, { name: '15' }, { name: '30' }] } },
    fm: { systems: { gearLever: 1, flapsLever: 0 } },
    cockpitInput: {},
    command: (...args) => calls.push(args),
  };
  const input = new InputManager(sim);
  input.setEnabled(true);
  const app = { state: 'flight', flightSim: sim, input, onAction: (action) => actions.push(action) };
  const controls = new TouchControls(root, app);
  controls.setEnabled(true);
  const pointer = (element, type, id, x = 70, y = 80, pointerType = 'touch', button = 0) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: id, pointerType, clientX: x, clientY: y, button });
    element.dispatchEvent(event);
    return event;
  };
  const rudder = controls.el.children[0].children[1].children;
  return { sim, app, input, controls, window, document, root, media, calls, actions, pointer, rudder,
    cleanup() { controls.destroy(); if (originalMatchMedia) globalThis.matchMedia = originalMatchMedia; else delete globalThis.matchMedia; } };
}

test('independent fingers can steer, use rudder, brake and adjust power together', () => {
  const f = fixture();
  try {
    const { pointer, controls: c, input, sim, rudder } = f;
    pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 110, 120);
    pointer(c.brake, 'pointerdown', 2);
    pointer(rudder[0], 'pointerdown', 3);
    sim.cockpitInput.throttle2 = 0.2;
    pointer(c.throttle, 'pointerdown', 4, 70, 50);
    input.update(0.2);
    assert.ok(sim.pilot.pitch > 0.5 && sim.pilot.roll > 0.5);
    assert.equal(sim.pilot.yaw, -1);
    assert.equal(sim.pilot.brakeL, 1);
    assert.equal(sim.pilot.brakeR, 1);
    assert.equal(sim.pilot.throttle, 0.75);
    assert.equal(sim.cockpitInput.throttle2, undefined);
    assert.equal(c.pointers.size, 4);
    pointer(c.stick, 'pointercancel', 1);
    input.update(0.2);
    assert.equal(sim.pilot.pitch, 0);
    assert.equal(sim.pilot.roll, 0);
    assert.equal(sim.pilot.yaw, -1);
    assert.equal(sim.pilot.brakeL, 1);
    pointer(c.brake, 'pointerup', 2);
    pointer(rudder[0], 'pointerup', 3);
    pointer(c.throttle, 'pointerup', 4);
    input.update(0.2);
    assert.equal(sim.pilot.yaw, 0);
    assert.equal(sim.pilot.brakeL, 0);
    assert.equal(sim.pilot.throttle, 0.75, 'throttle stays in position after release');
  } finally { f.cleanup(); }
});

test('a second stick finger cannot steal control and opposite pedals cancel safely', () => {
  const f = fixture();
  try {
    const { controls: c, pointer, sim, rudder } = f;
    pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 100, 80);
    const roll = sim.cockpitInput.roll;
    assert.ok(roll > 0.2);
    pointer(c.stick, 'pointerdown', 2, 20, 80);
    pointer(c.stick, 'pointermove', 2, 20, 80);
    assert.equal(sim.cockpitInput.roll, roll);
    pointer(rudder[0], 'pointerdown', 3);
    pointer(rudder[1], 'pointerdown', 4);
    assert.equal(sim.cockpitInput.yaw, 0);
    pointer(rudder[0], 'pointerup', 3);
    assert.equal(sim.cockpitInput.yaw, 1);
    pointer(rudder[1], 'lostpointercapture', 4);
    assert.equal(sim.cockpitInput.yaw, undefined);
  } finally { f.cleanup(); }
});

for (const reason of ['disable', 'blur', 'hidden', 'orientation', 'overlay', 'pause']) {
  test(`${reason} releases every owned held input and pointer capture`, () => {
    const f = fixture();
    try {
      const { controls: c, pointer, sim, input } = f;
      pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 110, 120);
      pointer(c.brake, 'pointerdown', 2);
      sim.cockpitInput.throttle2 = 0.6;
      input.update(0.2);
      assert.ok(sim.pilot.roll > 0);
      if (reason === 'disable') c.setEnabled(false);
      if (reason === 'blur') f.window.dispatchEvent(new Event('blur'));
      if (reason === 'hidden') { f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); }
      if (reason === 'orientation') f.window.dispatchEvent(new Event('orientationchange'));
      if (reason === 'overlay') { f.app.overlay = {}; c.update(); }
      if (reason === 'pause') { sim.paused = true; c.update(); }
      assert.deepEqual(sim.cockpitInput, { throttle2: 0.6 });
      assert.equal(sim.pilot.roll, 0);
      assert.equal(sim.pilot.brakeL, 0);
      assert.equal(c.pointers.size, 0);
      assert.equal(c.stick.captures.size, 0);
      assert.equal(c.brake.captures.size, 0);
    } finally { f.cleanup(); }
  });
}

test('hidden on desktop; when shown, a trackpad or mouse can use them with the primary button only', () => {
  const f = fixture(false);
  try {
    const { controls: c, pointer, sim } = f;
    assert.equal(c.el.hidden, true);
    pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 110, 120);
    assert.deepEqual(sim.cockpitInput, {});
    f.app.input.settings.touchEnabled = true; c.update();
    assert.equal(c.el.hidden, false);
    pointer(c.throttle, 'pointerdown', 3, 70, 20, 'mouse', 2);
    assert.equal(sim.pilot.throttle, 0.4, 'right button ignored');
    pointer(c.stick, 'pointerdown', 2, 70, 80, 'mouse');
    pointer(c.stick, 'pointermove', 2, 110, 80, 'mouse');
    assert.ok(sim.cockpitInput.roll > 0.4, 'iPad trackpad steers the stick');
    pointer(c.stick, 'pointerup', 2, 110, 80, 'mouse');
    pointer(c.throttle, 'pointerdown', 4, 70, 50, 'mouse');
    assert.equal(sim.pilot.throttle, 0.75);
    f.app.input.settings.touchEnabled = false; c.update();
    assert.equal(c.el.hidden, true);
  } finally { f.cleanup(); }
});

test('the stick deflects from where the finger lands, with a soft centre', async () => {
  const { stickResponse, TOUCH_RESPONSES } = await import('../src/input/touch-controls.js');
  const f = fixture();
  try {
    const { controls: c, pointer, sim } = f;
    pointer(c.stick, 'pointerdown', 1, 120, 30); // landing near the rim
    assert.equal(sim.cockpitInput.roll || 0, 0, 'no jump on first contact');
    assert.equal(sim.cockpitInput.pitch || 0, 0);
    pointer(c.stick, 'pointermove', 1, 125, 30);
    assert.ok(sim.cockpitInput.roll > 0 && sim.cockpitInput.roll < 0.08, `small finger motion, small input (${sim.cockpitInput.roll})`);
    pointer(c.stick, 'pointerup', 1);
  } finally { f.cleanup(); }
  const r = TOUCH_RESPONSES.normal;
  assert.deepEqual(stickResponse(1, 1, 100, r), { roll: 0, pitch: 0 }, 'dead zone');
  assert.ok(stickResponse(20, 0, 100, r).roll < 0.15, 'expo softens the centre');
  assert.equal(stickResponse(300, 0, 100, r).roll, 1, 'full deflection at the travel');
  assert.ok(stickResponse(20, 0, 100, TOUCH_RESPONSES.precise).roll < stickResponse(20, 0, 100, TOUCH_RESPONSES.direct).roll);
});

test('TRIM keeps the attitude: the held pitch becomes trim and the stick re-centres', () => {
  const f = fixture();
  try {
    const { controls: c, pointer, sim, input } = f;
    let trimmed = 0;
    sim.command = (name) => { if (name === 'trimHold') { trimmed = sim.pilot.pitch; sim.lastTrimAbsorbed = sim.pilot.pitch; sim.pilot.pitch = 0; } };
    pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 70, 110);
    input.update(0.5);
    assert.ok(sim.pilot.pitch > 0.2);
    pointer(c.trim, 'pointerdown', 2);
    pointer(c.trim, 'pointerup', 2);
    pointer(c.trim, 'click', 2);
    assert.ok(trimmed > 0.2, 'trim absorbed the held pitch');
    assert.equal(sim.cockpitInput.pitch, 0, 'the finger position is the new neutral');
    pointer(c.stick, 'pointermove', 1, 70, 110);
    assert.equal(sim.cockpitInput.pitch, 0, 'holding still does not double the input');
    pointer(c.stick, 'pointermove', 1, 70, 130);
    assert.ok(sim.cockpitInput.pitch > 0, 'further pull still works');
    sim.fm.fcs = { mode: 'normal' }; c.update();
    assert.equal(c.trim.hidden, true, 'fly-by-wire trims itself');
  } finally { f.cleanup(); }
});

test('aircraft-specific actions and flap retraction remain reachable', () => {
  const f = fixture();
  try {
    const { controls: c, pointer, sim, calls, actions } = f;
    pointer(c.flaps, 'pointerdown', 1);
    assert.equal(calls.filter(([name]) => name === 'flaps').length, 0, 'pointerdown only presses the button');
    pointer(c.flaps, 'pointerup', 1);
    pointer(c.flaps, 'click', 1);
    assert.deepEqual(calls.at(-1), ['flaps', 'inc']);
    sim.fm.systems.flapsLever = 2; c.update();
    assert.equal(c.flaps.textContent, 'FLAP 0');
    pointer(c.flaps, 'pointerdown', 2);
    pointer(c.flaps, 'pointerup', 2);
    pointer(c.flaps, 'click', 2);
    assert.deepEqual(calls.at(-1), ['flaps', 'up']);
    pointer(c.gear, 'pointerdown', 3);
    pointer(c.gear, 'pointerup', 3);
    pointer(c.gear, 'click', 3);
    assert.deepEqual(calls.at(-1), ['gear']);
    pointer(c.view, 'pointerdown', 4);
    assert.deepEqual(actions, []);
    pointer(c.view, 'pointerup', 4);
    pointer(c.view, 'click', 4);
    pointer(c.panel, 'pointerdown', 5);
    assert.deepEqual(actions, ['view-next']);
    pointer(c.panel, 'pointerup', 5);
    pointer(c.panel, 'click', 5);
    assert.deepEqual(actions, ['view-next', 'panel-cycle']);
    sim.def.controls.retractableGear = false; c.update();
    assert.equal(c.gear.hidden, true);
    const count = calls.length;
    pointer(c.gear, 'pointerdown', 6);
    assert.equal(calls.length, count);
  } finally { f.cleanup(); }
});

test('reset preserves controls owned by another source and destroy removes handlers', () => {
  const f = fixture();
  try {
    const { controls: c, pointer, sim } = f;
    pointer(c.stick, 'pointerdown', 1, 70, 80);
    pointer(c.stick, 'pointermove', 1, 110, 120);
    sim.cockpitInput.pitch = -0.9;
    c.reset();
    assert.equal(sim.cockpitInput.pitch, -0.9);
    assert.equal(sim.cockpitInput.roll, undefined);
    c.destroy();
    assert.equal(f.root.children.length, 0);
    pointer(c.brake, 'pointerdown', 2);
    assert.equal(sim.cockpitInput.brakeL, undefined);
  } finally { f.cleanup(); }
});
