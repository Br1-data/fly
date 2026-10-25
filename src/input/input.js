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
  ['Motori e impianti', 'Fumogeni', ['Ctrl+Shift+KeyS'], 'smoke'],
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
  ['Interfaccia', 'Aiuto e glossario', ['F12'], '@help'],
];
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
      if (e.button === 2 || e.pointerType === 'touch') {
        if (this._looking) return;
        this._looking = true;
        this._lookPointer = e.pointerId;
        this._lastPointer = [e.clientX, e.clientY];
        canvas.setPointerCapture?.(e.pointerId);
        // touch-action:none on the canvas already prevents browser panning.
        // Keep touch compatibility clicks intact for the next UI interaction.
        if (e.pointerType !== 'touch') e.preventDefault();
      }
    });
    const stopLook = (e) => { if (e.pointerId === this._lookPointer) { this._looking = false; this._lookPointer = null; } };
    listen(canvas, 'pointerup', stopLook);
    listen(canvas, 'pointercancel', stopLook);
    listen(canvas, 'lostpointercapture', stopLook);
    listen(canvas, 'pointermove', (e) => {
      if (!this.enabled) return;
      if (this._looking) {
        if (e.pointerId !== this._lookPointer) return;
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
  setSim(sim) { this._release(true); this.sim = sim; this._release(true); }
  setEnabled(enabled) { this.enabled = !!enabled; if (!this.enabled) this._release(); }
  _release(resetThrottle = false) {
    this.keys.clear();
    this._buttons.clear();
    this._looking = false;
    this._lookPointer = null;
    this.mouse = { roll: 0, pitch: 0 };
    if (this.sim?.cockpitInput) {
      for (const key of Object.keys(this.sim.cockpitInput)) {
        if (key !== 'throttle2' || resetThrottle) delete this.sim.cockpitInput[key];
      }
    }
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
      if (command === 'throttle') {
        this.sim.pilot.throttle = b[4];
        delete this.sim.pilot.throttle2;
        if (this.sim.cockpitInput) delete this.sim.cockpitInput.throttle2;
      }
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
    const cockpit = this.sim.cockpitInput || {};
    const consoleValue = (key, lo = -1, hi = 1) => Number.isFinite(cockpit[key]) ? clamp(cockpit[key], lo, hi) : 0;
    const axisKeys = {
      pitch: [['ArrowDown', 'Numpad2'], ['ArrowUp', 'Numpad8']],
      roll: [['ArrowRight', 'Numpad6'], ['ArrowLeft', 'Numpad4']],
      yaw: [['KeyE', 'NumpadEnter'], ['KeyQ', 'Numpad0']],
    };
    for (const key of ['pitch', 'roll', 'yaw']) {
      const [positive, negative] = axisKeys[key];
      const keyboardActive = has('Numpad5', ...positive, ...negative);
      const mouseValue = this.settings.mouseYoke && key !== 'yaw' ? this.mouse[key] : 0;
      const gamepadValue = this.values[key] || 0;
      // A centred physical controller leaves the pointer-held console available.
      let v = consoleValue(key);
      if (Math.abs(gamepadValue) > 0) v = gamepadValue;
      if (Math.abs(mouseValue) > 0) v = mouseValue;
      if (keyboardActive) v = has('Numpad5') ? 0 : Number(has(...positive)) - Number(has(...negative));
      p[key] = damp(p[key] || 0, v);
    }
    if (typeof this.values.throttle === 'number') p.throttle = this.values.throttle;
    p.throttleAxis = typeof this.values.throttle === 'number';
    if (has('F2', 'F3')) delete cockpit.throttle2;
    if (typeof this.values.throttle2 === 'number') p.throttle2 = this.values.throttle2;
    else if (Number.isFinite(cockpit.throttle2)) p.throttle2 = clamp(cockpit.throttle2, 0, 1);
    else delete p.throttle2;
    if (typeof this.values.mixture === 'number') p.mixture = this.values.mixture;
    p.throttle = clamp(p.throttle + (Number(has('F3')) - Number(has('F2'))) * dt * 0.25, 0, 1);
    p.trimRate = Number(has('Home', 'Numpad7')) - Number(has('End', 'Numpad1'));
    const braking = has('Period', 'Space');
    p.brakeL = braking || has('Comma') ? 1 : this.values.brakeL > 0 ? this.values.brakeL : consoleValue('brakeL', 0, 1);
    p.brakeR = braking || has('KeyX') ? 1 : this.values.brakeR > 0 ? this.values.brakeR : consoleValue('brakeR', 0, 1);
    p.reverse = (has('F2') && has('ShiftLeft', 'ShiftRight')) || cockpit.reverse === true;
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
      const shoulderInput = (pad.buttons[5]?.value || 0) - (pad.buttons[4]?.value || 0);
      if (pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) {
        delete cockpit.throttle2;
        if (typeof this.values.throttle2 !== 'number') delete p.throttle2;
      }
      p.throttle = clamp(p.throttle + shoulderInput * dt * 0.25, 0, 1);
    }
    this._buttons = next;
  }

  getBindingsList() {
    const label = (s) => s.replaceAll('Key', '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('Period', '.').replace('Slash', '/').replace('Semicolon', ';');
    return [
      { group: 'Volo', label: 'Beccheggio / rollio', keys: ['Frecce', 'Num 8/2/4/6'] },
      { group: 'Volo', label: 'Pedaliera', keys: ['Q / E', 'Num 0 / Invio'] },
      { group: 'Volo', label: 'Centra cloche e pedaliera', keys: ['Num 5'] },
      { group: 'Volo', label: 'Aumenta / riduci manetta', keys: ['F3 / F2'] },
      { group: 'Volo', label: 'Trim a cabrare / picchiare', keys: ['Home / End', 'Num 7 / Num 1'] },
      { group: 'Volo', label: 'Freni ruote', keys: ['.', 'Spazio'] },
      { group: 'Volo', label: 'Freni differenziali sinistro / destro', keys: [', / X'] },
      { group: 'Volo', label: 'Inversori di spinta', keys: ['Shift+F2 (tieni premuto)'] },
      ...BINDINGS.map(([group, title, keys]) => ({ group, label: title, keys: keys.map(label) })),
      { group: 'Mouse', label: 'Guardarsi intorno', keys: ['Tasto destro + trascina'] },
      { group: 'Mouse', label: 'Zoom', keys: ['Rotella sulla vista 3D'] },
      { group: 'Mouse', label: 'Interruttori e pulsanti del cockpit', keys: ['Clic'] },
      { group: 'Mouse', label: 'Manopole del cockpit', keys: ['Clic su − / +', 'Rotella'] },
      { group: 'Mouse', label: 'Leve del cockpit', keys: ['Trascina cursore'] },
      { group: 'Mouse', label: 'Cloche, pedaliera e freni nelle console', keys: ['Trascina cloche', 'Tieni premuto il pulsante'] },
      { group: 'Mouse', label: 'Cloche col mouse (attiva con Y)', keys: ['Muovi il puntatore sulla vista 3D'] },
      { group: 'Touch', label: 'Beccheggio e rollio', keys: ['Trascina la cloche virtuale'] },
      { group: 'Touch', label: 'Potenza', keys: ['Cursore manetta touch'] },
      { group: 'Touch', label: 'Pedaliera e freni', keys: ['Tieni premuti i pulsanti touch'] },
      { group: 'Touch', label: 'Guardarsi intorno', keys: ['Trascina il panorama con un dito'] },
      { group: 'Touch', label: 'Flap e carrello', keys: ['Pulsanti FLAP + / FLAP 0 e CARRELLO'] },
      { group: 'Touch', label: 'Vista e strumenti', keys: ['Pulsanti VISTA e PANNELLO'] },
      { group: 'Touch', label: 'Sposta e ingrandisci la mappa', keys: ['Trascina', 'Allarga o avvicina due dita'] },
      { group: 'Gamepad standard', label: 'Beccheggio / rollio', keys: ['Stick sinistro'] },
      { group: 'Gamepad standard', label: 'Pedaliera', keys: ['Stick destro orizzontale'] },
      { group: 'Gamepad standard', label: 'Freni differenziali', keys: ['LT / RT (pulsanti 6 / 7)'] },
      { group: 'Gamepad standard', label: 'Freni ruote', keys: ['A / Croce (pulsante 0)'] },
      { group: 'Gamepad standard', label: 'Carrello', keys: ['B / Cerchio (pulsante 1)'] },
      { group: 'Gamepad standard', label: 'Estendi flap', keys: ['X / Quadrato (pulsante 2)'] },
      { group: 'Gamepad standard', label: 'Vista successiva', keys: ['Y / Triangolo (pulsante 3)'] },
      { group: 'Gamepad standard', label: 'Riduci / aumenta manetta', keys: ['LB / RB (pulsanti 4 / 5)'] },
      { group: 'Gamepad standard', label: 'Mappa', keys: ['Back / Select (pulsante 8)'] },
      { group: 'Gamepad standard', label: 'Menu', keys: ['Start / Options (pulsante 9)'] },
      { group: 'Gamepad standard', label: 'Disconnetti autopilota', keys: ['Premi stick sinistro (pulsante 10)'] },
      { group: 'App desktop', label: 'Schermo intero', keys: ['Alt+Invio'] },
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
