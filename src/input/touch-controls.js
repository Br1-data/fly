// Independent pointer captures let the pilot steer, brake and adjust power together.
import { isTouchDevice } from '../core/device.js';
const HELD_AXES = ['pitch', 'roll', 'yaw', 'brakeL', 'brakeR'];
const clamp = (value, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, value));

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
    this.stickThumb = this.element('span', 'touch-stick-thumb');
    this.stick.append(this.stickThumb);
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
    this.brake = this.button('FRENI', 'Freni ruote: tieni premuto', 'brake', 'touch-brake');
    actions.append(this.flaps, this.gear, this.view, this.panel, this.brake);
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
  _isTouch(event) { return event.pointerType === 'touch' || event.pointerType === 'pen'; }
  _bindPointer(element, kind) {
    const discrete = ['flaps', 'gear', 'view', 'panel'].includes(kind);
    this.listen(element, 'pointerdown', (event) => {
      if (!this._isTouch(event) || !this._canControl() || element.disabled || element.hidden) return;
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
        this._releasePointer(event.pointerId);
      });
    }
    if (discrete) this.listen(element, 'click', (event) => {
      if (!this._canControl() || element.disabled || element.hidden) return;
      if (event.pointerType === 'mouse' && event.detail !== 0) return;
      if (!this.tapTargets.delete(element) && event.detail !== 0) return;
      event.preventDefault(); event.stopPropagation();
      // Layout-changing actions run after click targeting, so a moved panel cannot
      // redirect the same tap onto the cockpit underneath it.
      this._action(kind);
      this.update();
    });
  }
  _move(event, pointer) {
    const rect = pointer.element.getBoundingClientRect();
    if (pointer.kind === 'stick') {
      const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.36);
      let roll = (event.clientX - rect.left - rect.width / 2) / radius;
      let pitch = (event.clientY - rect.top - rect.height / 2) / radius;
      const length = Math.hypot(roll, pitch);
      if (length > 1) { roll /= length; pitch /= length; }
      // Small accidental movements near centre should not disturb trimmed flight.
      pointer.values.roll = Math.abs(roll) < 0.04 ? 0 : clamp(roll);
      pointer.values.pitch = Math.abs(pitch) < 0.04 ? 0 : clamp(pitch);
      this.stickThumb.style.transform = `translate(${roll * radius}px, ${pitch * radius}px)`;
    } else if (pointer.kind === 'throttle') {
      this._power(1 - (event.clientY - rect.top) / Math.max(1, rect.height));
    }
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
    if (pointer.kind === 'stick') this.stickThumb.style.transform = 'translate(0px, 0px)';
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
    this.stickThumb.style.transform = 'translate(0px, 0px)';
  }
  destroy() {
    this.reset();
    this.listeners.forEach((remove) => remove());
    this.listeners = [];
    this.el.remove();
    this.enabled = false;
  }
}
