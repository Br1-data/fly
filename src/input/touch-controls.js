// Independent pointer captures let the pilot steer, brake and adjust power together.
import { isTouchDevice } from '../core/device.js';
import { insideRect, swallowNextClick } from '../ui/dom.js';
const HELD_AXES = ['pitch', 'roll', 'yaw', 'brakeL', 'brakeR'];
const clamp = (value, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, value));

/**
 * Stick responses: travel is the finger distance for full deflection (fraction of the stick
 * size), expo softens the centre so small corrections stay small.
 */
export const TOUCH_RESPONSES = {
  precise: { label: 'Precisa', travel: 0.46, expo: 0.6 },
  normal: { label: 'Normale', travel: 0.42, expo: 0.45 },
  direct: { label: 'Diretta', travel: 0.34, expo: 0.15 },
};

/** Finger offset from the neutral point (px) -> { roll, pitch } in -1..1. */
export function stickResponse(dx, dy, radius, response = TOUCH_RESPONSES.normal) {
  let x = dx / Math.max(1, radius), y = dy / Math.max(1, radius);
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  // Radial dead zone: resting a finger never disturbs trimmed flight.
  if (length < 0.035) return { roll: 0, pitch: 0 };
  const e = response.expo;
  const curve = (v) => Math.sign(v) * (Math.abs(v) * (1 - e) + Math.abs(v) ** 3 * e);
  return { roll: clamp(curve(x)), pitch: clamp(curve(y)) };
}

export class TouchControls {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.document = root.ownerDocument;
    this.window = this.document.defaultView;
    this.requested = false;
    this.enabled = false;
    this.pointers = new Map();
    this.tapTargets = new Set();
    this.owned = new Map();
    this.ownedSim = null;
    this.listeners = [];
    this.media = this.window.matchMedia?.('(pointer: coarse)');
    if (!this.document.getElementById('ca-touch-styles')) {
      const css = this.element('link');
      css.id = 'ca-touch-styles';
      css.rel = 'stylesheet';
      css.href = new URL('../../styles/touch.css', import.meta.url).href;
      this.document.head.append(css);
    }
    this.el = this.element('section', 'touch-controls');
    this.el.setAttribute('aria-label', 'Comandi di volo touch');
    this.el.hidden = true;
    const left = this.element('div', 'touch-flight-left');
    this.stick = this.element('div', 'touch-stick');
    this.stick.setAttribute('role', 'group');
    this.stick.setAttribute('aria-label', 'Cloche: trascina in basso per cabrare, in alto per picchiare, a destra o sinistra per virare');
    this.stick.append(this.element('span', 'touch-stick-label', 'CLOCHE'));
    this.stickOrigin = this.element('span', 'touch-stick-origin');
    this.stickThumb = this.element('span', 'touch-stick-thumb');
    this.stick.append(this.stickOrigin, this.stickThumb);
    this._bindPointer(this.stick, 'stick');
    const rudder = this.element('div', 'touch-rudder');
    rudder.append(this.button('PEDALE ←', 'Pedaliera sinistra: tieni premuto', 'yaw-left'), this.button('PEDALE →', 'Pedaliera destra: tieni premuto', 'yaw-right'));
    left.append(this.stick, rudder);
    const right = this.element('div', 'touch-flight-right');
    const power = this.element('div', 'touch-power');
    this.powerValue = this.element('output', 'touch-power-value', '0%');
    this.throttle = this.element('div', 'touch-throttle');
    this.throttle.tabIndex = 0;
    this.throttle.setAttribute('role', 'slider');
    this.throttle.setAttribute('aria-label', 'Potenza motori');
    this.throttle.setAttribute('aria-orientation', 'vertical');
    this.throttle.setAttribute('aria-valuemin', '0');
    this.throttle.setAttribute('aria-valuemax', '100');
    this.throttleFill = this.element('span', 'touch-throttle-fill');
    this.throttleThumb = this.element('span', 'touch-throttle-thumb');
    this.throttle.append(this.throttleFill, this.throttleThumb);
    this._bindPointer(this.throttle, 'throttle');
    this.listen(this.throttle, 'keydown', (event) => {
      if (!this._canControl() || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      const current = this.app.flightSim.pilot.throttle || 0;
      this._power(event.code === 'Home' ? 0 : event.code === 'End' ? 1 : current + (event.code === 'ArrowUp' ? 0.05 : -0.05));
    });
    power.append(this.powerValue, this.throttle, this.element('span', 'touch-power-label', 'POTENZA'));
    const actions = this.element('div', 'touch-actions');
    this.flaps = this.button('FLAP +', 'Flap: posizione successiva; dopo il massimo tornano retratti', 'flaps');
    this.gear = this.button('Carrello', 'Estendi o ritrai il carrello', 'gear');
    this.view = this.button('VISTA', 'Cambia vista', 'view');
    this.panel = this.button('Pannello', 'Mostra o riduci il pannello strumenti', 'panel');
    this.trim = this.button('TRIM', 'Compensa: mantiene l’assetto attuale, poi puoi rilasciare la cloche', 'trim', 'touch-trim');
    this.brake = this.button('FRENI', 'Freni ruote: tieni premuto', 'brake', 'touch-brake');
    actions.append(this.flaps, this.gear, this.view, this.panel, this.trim, this.brake);
    right.append(power, actions);
    this.el.append(left, right);
    root.append(this.el);
    this.listen(this.el, 'contextmenu', (event) => event.preventDefault());
    this.listen(this.window, 'blur', () => this.reset());
    this.listen(this.document, 'visibilitychange', () => { if (this.document.hidden) this.reset(); });
    this.listen(this.window, 'orientationchange', () => this.reset());
    this.listen(this.window.screen?.orientation, 'change', () => this.reset());
    this.listen(this.media, 'change', () => this.update());
    this.update();
  }

  element(tag, className = '', text = '') {
    const element = this.document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    this.listeners.push(() => target?.removeEventListener?.(type, handler, options));
  }
  button(text, label, kind, className = '') {
    const button = this.element('button', `touch-button ${className}`.trim(), text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    this._bindPointer(button, kind);
    return button;
  }
  _canControl() {
    return this.enabled && this.app.state === 'flight' && !this.app.overlay && !this.app.flightSim?.paused && !this.app.flightSim?.crashed;
  }
  // Fingers, pens and the primary button of a mouse or trackpad (iPad with a keyboard).
  _isPointer(event) { return event.pointerType === 'touch' || event.pointerType === 'pen' || (event.pointerType === 'mouse' && event.button === 0); }
  _response() { return TOUCH_RESPONSES[this.app.input?.settings?.touchResponse] || TOUCH_RESPONSES.normal; }
  _bindPointer(element, kind) {
    const discrete = ['flaps', 'gear', 'view', 'panel', 'trim'].includes(kind);
    this.listen(element, 'pointerdown', (event) => {
      if (!this._isPointer(event) || !this._canControl() || element.disabled || element.hidden) return;
      // A second finger must not take over an already held stick or throttle.
      if (['stick', 'throttle'].includes(kind) && [...this.pointers.values()].some((pointer) => pointer.kind === kind)) return;
      event.preventDefault(); event.stopPropagation();
      const pointer = { element, kind, values: {} };
      this.pointers.set(event.pointerId, pointer);
      element.setPointerCapture?.(event.pointerId);
      element.classList.add('touch-held');
      if (kind === 'stick' || kind === 'throttle') this._move(event, pointer);
      else if (kind === 'yaw-left' || kind === 'yaw-right') pointer.values.yaw = kind === 'yaw-left' ? -1 : 1;
      else if (kind === 'brake') pointer.values.brakeL = pointer.values.brakeR = 1;
      else if (discrete) this.tapTargets.add(element);
      this._applyHeld();
    });
    this.listen(element, 'pointermove', (event) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer || pointer.element !== element) return;
      event.preventDefault(); event.stopPropagation();
      if (!this._canControl()) return this.reset();
      this._move(event, pointer);
      this._applyHeld();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(element, type, (event) => {
        if (type === 'pointercancel' || (type === 'lostpointercapture' && this.pointers.has(event.pointerId))) this.tapTargets.delete(element);
        const tapped = type === 'pointerup' && discrete && this.pointers.get(event.pointerId)?.element === element && this.tapTargets.delete(element);
        this._releasePointer(event.pointerId);
        // Act on release (no click arrives for a tap made while another finger holds the
        // stick); sliding the finger off the button cancels. The click that may still
        // follow is swallowed so a panel that moves cannot pass the tap on.
        if (tapped && this._canControl() && insideRect(element, event.clientX, event.clientY)) {
          swallowNextClick(this.document, event.clientX, event.clientY);
          this._action(kind);
          this.update();
        }
      });
    }
    // Keyboard and assistive technology activate the buttons with a click (detail 0).
    if (discrete) this.listen(element, 'click', (event) => {
      if (!this._canControl() || element.disabled || element.hidden || event.detail !== 0) return;
      event.preventDefault(); event.stopPropagation();
      this._action(kind);
      this.update();
    });
  }
  _move(event, pointer) {
    const rect = pointer.element.getBoundingClientRect();
    if (pointer.kind === 'stick') {
      // The neutral point is where the finger lands: touching off-centre never jerks the
      // aircraft, deflection grows with the distance the finger then travels.
      pointer.origin ||= { x: event.clientX, y: event.clientY };
      pointer.last = { x: event.clientX, y: event.clientY };
      const response = this._response();
      const size = Math.min(rect.width, rect.height);
      const out = stickResponse(event.clientX - pointer.origin.x, event.clientY - pointer.origin.y, size * response.travel, response);
      pointer.values.roll = out.roll;
      pointer.values.pitch = out.pitch;
      this._drawStick(pointer, rect);
    } else if (pointer.kind === 'throttle') {
      this._power(1 - (event.clientY - rect.top) / Math.max(1, rect.height));
    }
  }
  _drawStick(pointer, rect) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const limit = rect.width / 2 - 24;
    const place = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > limit) { dx *= limit / l; dy *= limit / l; }
      return `translate(${dx}px, ${dy}px)`;
    };
    this.stickThumb.style.transform = place(pointer.last.x, pointer.last.y);
    this.stickOrigin.style.transform = place(pointer.origin.x, pointer.origin.y);
    this.stick.classList.add('touch-stick-active');
  }
  /** After trimming, the current finger position becomes the new pitch neutral. */
  rebaseStick() {
    for (const pointer of this.pointers.values()) {
      if (pointer.kind !== 'stick' || !pointer.last) continue;
      pointer.origin.y = pointer.last.y;
      pointer.values.pitch = 0;
      this._drawStick(pointer, pointer.element.getBoundingClientRect());
    }
    this._applyHeld();
  }
  _power(value) {
    const sim = this.app.flightSim;
    if (!sim?.pilot) return;
    sim.pilot.throttle = clamp(value, 0, 1);
    // A shared touch throttle explicitly controls both engines together.
    delete sim.pilot.throttle2;
    if (sim.cockpitInput) delete sim.cockpitInput.throttle2;
    this._updatePower();
  }
  _action(kind) {
    const sim = this.app.flightSim;
    if (kind === 'gear' && sim.def?.controls?.retractableGear) sim.command('gear');
    if (kind === 'flaps') {
      const last = (sim.def?.controls?.flapDetents?.length || 1) - 1;
      if (last > 0) sim.command('flaps', sim.fm?.systems.flapsLever >= last ? 'up' : 'inc');
    }
    if (kind === 'trim') {
      this.app.input?.trimHold ? this.app.input.trimHold() : sim.command('trimHold');
      this.rebaseStick();
    }
    if (kind === 'view') this.app.onAction('view-next');
    if (kind === 'panel') this.app.onAction('panel-cycle');
  }
  _applyHeld() {
    const sim = this.app.flightSim;
    if (!sim) return;
    const held = {};
    for (const pointer of this.pointers.values()) {
      for (const [key, value] of Object.entries(pointer.values)) held[key] = clamp((held[key] || 0) + value);
    }
    if (this.ownedSim && this.ownedSim !== sim) return this.reset();
    this.ownedSim = sim;
    const target = sim.cockpitInput ||= {};
    for (const [key, previous] of this.owned) {
      if (!(key in held) && target[key] === previous) delete target[key];
    }
    this.owned.clear();
    for (const [key, value] of Object.entries(held)) { target[key] = value; this.owned.set(key, value); }
  }
  _releasePointer(id) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    if (![...this.pointers.values()].some((p) => p.element === pointer.element)) pointer.element.classList.remove('touch-held');
    if (pointer.kind === 'stick') this._centreStick();
    if (pointer.element.hasPointerCapture?.(id)) pointer.element.releasePointerCapture(id);
    this._applyHeld();
  }
  _updatePower() {
    const fraction = clamp(this.app.flightSim?.pilot?.throttle || 0, 0, 1);
    const percent = Math.round(fraction * 100);
    if (percent === this._lastPower) return;
    this._lastPower = percent;
    this.powerValue.textContent = `${percent}%`;
    this.throttle.setAttribute('aria-valuenow', String(percent));
    this.throttle.setAttribute('aria-valuetext', `${percent} per cento`);
    this.throttleFill.style.height = `${percent}%`;
    this.throttleThumb.style.bottom = `${percent}%`;
  }
  setEnabled(enabled) { this.requested = !!enabled; this.update(); }
  update() {
    const setting = this.app.input?.settings?.touchEnabled;
    const supported = setting === true || (setting !== false && isTouchDevice());
    const sim = this.app.flightSim;
    if (this.ownedSim && this.ownedSim !== sim) this.reset();
    const active = this.requested && supported && this.app.state === 'flight' && !this.app.overlay && !sim?.paused && !sim?.crashed;
    if (!active && (this.enabled || this.pointers.size)) this.reset();
    this.enabled = active;
    this.el.hidden = !active;
    this.el.setAttribute('aria-hidden', String(!active));
    this.gear.hidden = !sim?.def?.controls?.retractableGear;
    this.gear.setAttribute('aria-pressed', String(!!sim?.fm?.systems.gearLever));
    this.flaps.disabled = (sim?.def?.controls?.flapDetents?.length || 1) < 2;
    const detent = sim?.fm?.systems.flapsLever || 0;
    const last = (sim?.def?.controls?.flapDetents?.length || 1) - 1;
    this.flaps.textContent = detent >= last && last > 0 ? 'FLAP 0' : 'FLAP +';
    // Fly-by-wire in normal law trims itself.
    this.trim.hidden = sim?.fm?.fcs?.mode === 'normal';
    this._updatePower();
  }
  reset() {
    this.tapTargets.clear();
    const sim = this.ownedSim || this.app.flightSim;
    for (const [key, previous] of this.owned) {
      if (sim?.cockpitInput?.[key] === previous) {
        delete sim.cockpitInput[key];
        if (sim.pilot && HELD_AXES.includes(key)) sim.pilot[key] = 0;
      }
    }
    this.owned.clear();
    this.ownedSim = null;
    const pointers = [...this.pointers];
    this.pointers.clear();
    for (const [id, pointer] of pointers) {
      pointer.element.classList.remove('touch-held');
      if (pointer.element.hasPointerCapture?.(id)) pointer.element.releasePointerCapture(id);
    }
    this._centreStick();
  }
  _centreStick() {
    this.stickThumb.style.transform = 'translate(0px, 0px)';
    this.stickOrigin.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('touch-stick-active');
  }
  destroy() {
    this.reset();
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    this.el.remove();
    this.enabled = false;
  }
}
