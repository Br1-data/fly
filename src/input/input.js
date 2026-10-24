// Keyboard, pointer and gamepad inputs share the same normalised pilot controls.
const STORAGE_KEY = 'cieli-aperti.input';
const AXES = ['roll', 'pitch', 'yaw', 'throttle', 'throttle2', 'mixture', 'brakeL', 'brakeR'];
const BIPOLAR = new Set(['roll', 'pitch', 'yaw']);
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const defaults = () => ({ axes: Object.fromEntries(AXES.map((k) => [k, null])), deadzone: 0.05, expo: 0.3, keyboardSensitivity: 1, gamepadEnabled: true, mouseYoke: false });
const modifiers = (e) => `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
const isField = (el) => !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);

// Entries power both dispatch and the help screen, keeping the displayed controls accurate.
const BINDINGS = [
  ['Volo', 'Manetta minima', ['F1'], 'throttle', 0],
  ['Volo', 'Manetta massima', ['F4'], 'throttle', 1],
  ['Volo', 'Flap retratti', ['F5'], 'flaps', 'up'],
  ['Volo', 'Riduci flap', ['F6'], 'flaps', 'dec'],
  ['Volo', 'Estendi flap', ['F7'], 'flaps', 'inc'],
  ['Volo', 'Flap completi', ['F8'], 'flaps', 'full'],
  ['Volo', 'Carrello', ['KeyG'], 'gear'],
  ['Volo', 'Freno di parcheggio', ['Ctrl+Period'], 'parkingBrake'],
  ['Volo', 'Aerofreni', ['Slash'], 'spoilers'],
  ['Volo', 'Arma spoiler', ['Shift+Slash'], 'spoilers', 'arm'],
  ['Volo', 'Autobrake', ['Ctrl+KeyB'], 'autobrake', 'next'],
  ['Motori e impianti', 'Avviamento automatico', ['Ctrl+KeyE'], 'autostart'],
  ['Motori e impianti', 'Spegnimento motori', ['Ctrl+Shift+KeyE'], 'shutdown'],
  ['Motori e impianti', 'Master elettrico', ['Shift+KeyM'], 'master'],
  ['Motori e impianti', 'Avionica', ['Shift+KeyA'], 'avionics'],
  ['Motori e impianti', 'Pompa carburante', ['Shift+KeyF'], 'fuelPump'],
  ['Motori e impianti', 'Riscaldamento Pitot', ['Shift+KeyP'], 'pitotHeat'],
  ['Motori e impianti', 'Anti-ghiaccio', ['Shift+KeyI'], 'antiIce'],
  ['Motori e impianti', 'Riscaldamento carburatore', ['Shift+KeyH'], 'carbHeat'],
  ['Motori e impianti', 'Miscela ricca / magra', ['Ctrl+Shift+F4', 'Ctrl+Shift+F1'], 'mixtureKeys'],
  ['Motori e impianti', 'Magneti / avviamento', ['KeyI'], 'magnetos', 'inc'],
  ['Motori e impianti', 'Riduci magneti', ['Shift+KeyO'], 'magnetos', 'dec'],
  ['Motori e impianti', 'Luci', ['KeyL'], 'allLights'],
  ['Motori e impianti', 'Fumogeni', ['Shift+KeyS'], 'smoke'],
  ['Strumenti e autopilota', 'Altimetro QNH locale', ['KeyB'], 'kollsman', 'local'],
  ['Strumenti e autopilota', 'Altimetro standard', ['Shift+KeyB'], 'kollsman', 'std'],
  ['Strumenti e autopilota', 'Allinea giroscopio', ['KeyD'], 'dgSync'],
  ['Strumenti e autopilota', 'Autopilota', ['KeyZ'], 'ap'],
  ['Strumenti e autopilota', 'Modo HDG', ['Ctrl+KeyH'], 'apHdg'],
  ['Strumenti e autopilota', 'Modo ALT', ['Ctrl+KeyZ'], 'apAlt'],
  ['Strumenti e autopilota', 'Modo NAV', ['Ctrl+KeyN'], 'apNav'],
  ['Strumenti e autopilota', 'Modo APR', ['Ctrl+KeyA'], 'apApr'],
  ['Strumenti e autopilota', 'Modo VS', ['Ctrl+KeyV'], 'apVs'],
  ['Strumenti e autopilota', 'Modo FLC', ['Ctrl+KeyF'], 'apFlc'],
  ['Strumenti e autopilota', 'Autothrottle', ['Ctrl+KeyT'], 'apAthr'],
  ['Strumenti e autopilota', 'Sorgente NAV1 / GPS', ['Ctrl+KeyS'], 'apNavSource'],
  ['Interfaccia', 'Pausa', ['KeyP'], '@pause'],
  ['Interfaccia', 'Menu', ['Escape'], '@menu'],
  ['Interfaccia', 'Vista successiva / precedente', ['KeyS', 'Shift+KeyS'], '@views'],
  ['Interfaccia', 'Vista cockpit', ['F9'], '@view-cockpit'],
  ['Interfaccia', 'Vista esterna', ['F10'], '@view-chase'],
  ['Interfaccia', 'Pannello strumenti', ['KeyW'], '@panel-cycle'],
  ['Interfaccia', 'Informazioni / HUD', ['KeyH'], '@hud-toggle'],
  ['Interfaccia', 'Mappa', ['KeyM'], '@map'],
  ['Interfaccia', 'Checklist', ['KeyK'], '@checklist'],
  ['Interfaccia', 'Velocità simulazione', ['KeyR'], '@sim-rate'],
  ['Interfaccia', 'Riavvia volo', ['Ctrl+Semicolon'], '@restart'],
  ['Interfaccia', 'Ripristina vista', ['Backspace'], '@reset-view'],
  ['Interfaccia', 'Cloche col mouse', ['KeyY'], '@mouse-yoke'],
  ['Interfaccia', 'Ripeti ATIS', ['Shift+KeyT'], '@atis-repeat'],
];
// Shift+S is reserved for the previous view; smoke has its own shortcut.
BINDINGS.find((b) => b[3] === 'smoke')[2] = ['Ctrl+Shift+KeyS'];
const PRESS_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6', 'Numpad5', 'KeyQ', 'KeyE', 'Numpad0', 'NumpadEnter', 'Home', 'End', 'Numpad7', 'Numpad1', 'F2', 'F3', 'Period', 'Space', 'Comma', 'KeyX', 'ShiftLeft', 'ShiftRight']);

export class InputManager {
  constructor(sim, { onAction = () => {} } = {}) {
    this.sim = sim;
    this.onAction = onAction;
    this.enabled = false;
    this.keys = new Set();
    this.values = {};
    this.mouse = { roll: 0, pitch: 0 };
    this._buttons = new Set();
    this._listeners = [];
    this.settings = defaults();
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        this.settings = { ...this.settings, ...saved, axes: { ...this.settings.axes, ...saved.axes } };
      }
    } catch { /* Storage is optional in private browsing. */ }
    this.settings.deadzone = clamp(Number(this.settings.deadzone) || 0, 0, 0.3);
    this.settings.expo = clamp(Number(this.settings.expo) || 0, 0, 1);
    this.settings.keyboardSensitivity = clamp(Number(this.settings.keyboardSensitivity) || 1, 0.3, 2);
  }

  attach(target, canvas) {
    this.detach();
    this.target = target;
    this.canvas = canvas;
    const listen = (el, type, fn, options) => {
      el?.addEventListener(type, fn, options);
      this._listeners.push(() => el?.removeEventListener(type, fn, options));
    };
    listen(target, 'keydown', (e) => this._keyDown(e));
    listen(target, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyI') this.sim?.command('magnetoRelease');
    });
    listen(target, 'blur', () => this._release());
    listen(target?.document, 'visibilitychange', () => { if (target.document.hidden) this._release(); });
    listen(canvas, 'contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    listen(canvas, 'pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) { this._looking = true; this._lastPointer = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); }
    });
    const stopLook = () => { this._looking = false; };
    listen(canvas, 'pointerup', stopLook);
    listen(canvas, 'pointercancel', stopLook);
    listen(canvas, 'lostpointercapture', stopLook);
    listen(canvas, 'pointermove', (e) => {
      if (!this.enabled) return;
      if (this._looking) {
        const [x, y] = this._lastPointer;
        this.onAction('look', { dx: e.clientX - x, dy: e.clientY - y });
        this._lastPointer = [e.clientX, e.clientY];
      } else if (this.settings.mouseYoke) {
        const r = canvas.getBoundingClientRect();
        this.mouse.roll = clamp((e.clientX - r.left - r.width / 2) / (r.width * 0.3));
        this.mouse.pitch = clamp((e.clientY - r.top - r.height / 2) / (r.height * 0.3));
      }
    });
    listen(canvas, 'pointerleave', () => { if (!this._looking) this.mouse = { roll: 0, pitch: 0 }; });
    listen(canvas, 'wheel', (e) => { if (this.enabled) { e.preventDefault(); this.onAction('zoom', { delta: e.deltaY }); } }, { passive: false });
  }

  detach() { this._listeners.forEach((remove) => remove()); this._listeners = []; this._release(); }
  setSim(sim) { this._release(); this.sim = sim; }
  setEnabled(enabled) { this.enabled = !!enabled; if (!this.enabled) this._release(); }
  _release() {
    this.keys.clear();
    this._buttons.clear();
    this._looking = false;
    this.mouse = { roll: 0, pitch: 0 };
    if (!this.sim?.pilot) return;
    for (const k of ['pitch', 'roll', 'yaw', 'brakeL', 'brakeR', 'trimRate', 'ailTrimRate', 'rudTrimRate']) this.sim.pilot[k] = 0;
    this.sim.pilot.reverse = false;
    this.sim.command('magnetoRelease');
  }

  _keyDown(e) {
    if (!this.enabled || isField(e.target) || e.metaKey) return;
    if (e.target?.tagName === 'BUTTON' && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
    const combo = modifiers(e);
    const b = BINDINGS.find((b) => b[2].includes(combo));
    if (b) {
      e.preventDefault();
      if (e.repeat) return;
      const command = b[3];
      if (command === 'throttle') { this.sim.pilot.throttle = b[4]; delete this.sim.pilot.throttle2; }
      else if (command === 'mixtureKeys') this.sim.command('mixture', e.code === 'F4' ? 1 : 0);
      else if (command === '@views') this.onAction(e.shiftKey ? 'view-prev' : 'view-next');
      else if (command === '@mouse-yoke') {
        this.settings.mouseYoke = !this.settings.mouseYoke;
        this.mouse = { roll: 0, pitch: 0 };
        this.onAction('mouse-yoke', { enabled: this.settings.mouseYoke });
        this.saveSettings();
      } else if (command.startsWith('@')) this.onAction(command.slice(1));
      else this.sim.command(command, b[4]);
    } else if (!e.ctrlKey && !e.altKey && PRESS_KEYS.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Numpad5') { this.sim.pilot.pitch = 0; this.sim.pilot.roll = 0; this.sim.pilot.yaw = 0; this.mouse = { roll: 0, pitch: 0 }; }
    }
  }

  _pads() { return this.settings.gamepadEnabled === false ? [] : Array.from(globalThis.navigator?.getGamepads?.() || []).filter(Boolean); }
  _curve(value) {
    const d = this.settings.deadzone;
    if (Math.abs(value) <= d) return 0;
    const x = clamp((Math.abs(value) - d) / (1 - d), 0, 1);
    return Math.sign(value) * (x * (1 - this.settings.expo) + x ** 3 * this.settings.expo);
  }
  _readAxes(pads) {
    const out = {};
    for (const key of AXES) {
      const b = this.settings.axes[key];
      if (!b || !Number.isInteger(b.axis) || b.axis < 0) continue;
      const pad = pads.find((p) => p.id === b.gamepadId);
      const v = pad?.axes[b.axis];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const raw = clamp(b.invert ? -v : v);
      out[key] = BIPOLAR.has(key) ? this._curve(raw) : (raw + 1) / 2;
    }
    const standard = pads.find((p) => p.mapping === 'standard');
    if (standard) {
      for (const [key, axis] of [['roll', 0], ['pitch', 1], ['yaw', 2]]) {
        if (!this.settings.axes[key] && typeof standard.axes[axis] === 'number') out[key] = this._curve(standard.axes[axis]);
      }
      if (!this.settings.axes.brakeL) out.brakeL = standard.buttons[6]?.value || 0;
      if (!this.settings.axes.brakeR) out.brakeR = standard.buttons[7]?.value || 0;
    }
    return out;
  }

  update(dt) {
    const pads = this._pads();
    this.values = this._readAxes(pads);
    if (!this.enabled || !this.sim?.pilot || dt <= 0) return;
    const p = this.sim.pilot;
    const has = (...keys) => keys.some((k) => this.keys.has(k));
    const damp = (current, target) => current + (target - current) * Math.min(1, dt * 7 * this.settings.keyboardSensitivity);
    const desired = {
      pitch: Number(has('ArrowDown', 'Numpad2')) - Number(has('ArrowUp', 'Numpad8')),
      roll: Number(has('ArrowRight', 'Numpad6')) - Number(has('ArrowLeft', 'Numpad4')),
      yaw: Number(has('KeyE', 'NumpadEnter')) - Number(has('KeyQ', 'Numpad0')),
    };
    for (const key of ['pitch', 'roll', 'yaw']) {
      let v = desired[key];
      if (v === 0 && this.settings.mouseYoke && key !== 'yaw') v = this.mouse[key];
      if (v === 0 && typeof this.values[key] === 'number') v = this.values[key];
      p[key] = damp(p[key] || 0, v);
    }
    if (typeof this.values.throttle === 'number') p.throttle = this.values.throttle;
    p.throttleAxis = typeof this.values.throttle === 'number';
    if (typeof this.values.throttle2 === 'number') p.throttle2 = this.values.throttle2;
    else delete p.throttle2;
    if (typeof this.values.mixture === 'number') p.mixture = this.values.mixture;
    p.throttle = clamp(p.throttle + (Number(has('F3')) - Number(has('F2'))) * dt * 0.25, 0, 1);
    p.trimRate = Number(has('Home', 'Numpad7')) - Number(has('End', 'Numpad1'));
    const braking = has('Period', 'Space');
    p.brakeL = braking || has('Comma') ? 1 : this.values.brakeL || 0;
    p.brakeR = braking || has('KeyX') ? 1 : this.values.brakeR || 0;
    p.reverse = has('F2') && has('ShiftLeft', 'ShiftRight');
    const next = new Set();
    for (const pad of pads.filter((pad) => pad.mapping === 'standard')) {
      const actions = { 1: () => this.sim.command('gear'), 2: () => this.sim.command('flaps', 'inc'), 3: () => this.onAction('view-next'), 8: () => this.onAction('map'), 9: () => this.onAction('menu'), 10: () => this.sim.command('apDisconnect') };
      pad.buttons.forEach((button, i) => {
        if (!button.pressed) return;
        const id = `${pad.index}:${i}`;
        next.add(id);
        if (!this._buttons.has(id)) actions[i]?.();
      });
      if (!this.enabled) return;
      if (pad.buttons[0]?.pressed) p.brakeL = p.brakeR = 1;
      p.throttle = clamp(p.throttle + ((pad.buttons[5]?.value || 0) - (pad.buttons[4]?.value || 0)) * dt * 0.25, 0, 1);
    }
    this._buttons = next;
  }

  getBindingsList() {
    const label = (s) => s.replaceAll('Key', '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('Period', '.').replace('Slash', '/').replace('Semicolon', ';');
    return [
      { group: 'Volo', label: 'Beccheggio / rollio', keys: ['Frecce', 'Num 8/2/4/6'] },
      { group: 'Volo', label: 'Pedaliera', keys: ['Q / E', 'Num 0 / Invio'] },
      { group: 'Volo', label: 'Aumenta / riduci manetta', keys: ['F3 / F2'] },
      { group: 'Volo', label: 'Trim a cabrare / picchiare', keys: ['Home / End', 'Num 7 / Num 1'] },
      { group: 'Volo', label: 'Freni ruote', keys: ['.', 'Spazio'] },
      { group: 'Volo', label: 'Freni differenziali sinistro / destro', keys: [', / X'] },
      { group: 'Volo', label: 'Inversori di spinta', keys: ['Shift+F2 (tieni premuto)'] },
      ...BINDINGS.map(([group, title, keys]) => ({ group, label: title, keys: keys.map(label) })),
    ];
  }
  listGamepads() { return this._pads().map((p) => ({ index: p.index, id: p.id, axes: p.axes.length, buttons: p.buttons.length })); }
  getAxisValues() { return { ...this.values }; }
  setAxisBinding(target, binding) {
    if (!AXES.includes(target)) return;
    this.settings.axes[target] = binding && Number.isInteger(binding.axis) && binding.axis >= 0 && typeof binding.gamepadId === 'string' ? { gamepadId: binding.gamepadId, axis: binding.axis, invert: !!binding.invert } : null;
  }
  captureAxis() {
    if (this._captureCancel) this._captureCancel();
    const initial = new Map(this._pads().map((p) => [p.id, [...p.axes]]));
    return new Promise((resolve) => {
      const finish = (result) => { clearInterval(timer); this._captureCancel = null; resolve(result); };
      const start = Date.now();
      const timer = setInterval(() => {
        for (const pad of this._pads()) {
          const old = initial.get(pad.id);
          if (!old) { initial.set(pad.id, [...pad.axes]); continue; }
          const axis = pad.axes.findIndex((v, i) => Math.abs(v - (old[i] || 0)) > 0.45);
          if (axis !== -1) return finish({ gamepadId: pad.id, index: pad.index, axis });
        }
        if (Date.now() - start >= 8000) finish(null);
      }, 50);
      this._captureCancel = () => finish(null);
    });
  }
  saveSettings() { try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* Optional storage. */ } }
  resetDefaults() { this.settings = defaults(); this._release(); }
  destroy() { this.detach(); this._captureCancel?.(); }
}
