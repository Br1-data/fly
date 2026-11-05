// Keyboard, mouse and gamepad: rotation (pitch / yaw / roll), RCS translation, throttle and
// the ship and interface functions. Inputs are read in the pilot's frame and converted to
// the vehicle body frame (landers are flown looking out of a side window).
const STORAGE_KEY = 'cieli-aperti-space.input';
const AXES = ['pitch', 'yaw', 'roll', 'throttle', 'tx', 'ty', 'tz'];
const BIPOLAR = new Set(['pitch', 'yaw', 'roll', 'tx', 'ty', 'tz']);
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const defaults = () => ({ axes: Object.fromEntries(AXES.map((k) => [k, null])), deadzone: 0.08, expo: 0.35, keyboardSensitivity: 1, gamepadEnabled: true, touchResponse: 'normal' });
const modifiers = (e) => `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
const isField = (el) => !!el && !el.dataset?.pointerFocus && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);

// [group, label, keys, command, argument]. '@' commands are interface actions.
const BINDINGS = [
  ['Propulsione', 'Manetta al massimo', ['KeyZ', 'F4'], '@throttle', 1],
  ['Propulsione', 'Spegni il motore', ['KeyX', 'F1'], '@throttle', 0],
  ['Propulsione', 'Azione: separa lo stadio · paracadute · sgancio', ['Space'], 'action'],
  ['Propulsione', 'RCS acceso / spento', ['KeyR'], 'rcs'],
  ['Propulsione', 'Assistenza al volo (Colibrì)', ['KeyY'], 'fa'],
  ['Propulsione', 'Controllo velocità verticale (atterraggio)', ['KeyV'], 'vsHold'],
  ['Propulsione', 'Autopilota di ascesa', ['Shift+KeyA'], 'ascent'],
  ['Propulsione', 'Esegui la manovra (autopilota)', ['Enter'], 'autoBurn'],
  ['Assetto (SAS)', 'SAS acceso / spento', ['KeyT'], 'sas'],
  ['Assetto (SAS)', 'Stabilizza', ['Digit1'], 'sasMode', 'stab'],
  ['Assetto (SAS)', 'Prograde', ['Digit2'], 'sasMode', 'prograde'],
  ['Assetto (SAS)', 'Retrograde', ['Digit3'], 'sasMode', 'retrograde'],
  ['Assetto (SAS)', 'Normale', ['Digit4'], 'sasMode', 'normal'],
  ['Assetto (SAS)', 'Antinormale', ['Digit5'], 'sasMode', 'antinormal'],
  ['Assetto (SAS)', 'Radiale esterno', ['Digit6'], 'sasMode', 'radialOut'],
  ['Assetto (SAS)', 'Radiale interno', ['Digit7'], 'sasMode', 'radialIn'],
  ['Assetto (SAS)', 'Verso il bersaglio', ['Digit8'], 'sasMode', 'target'],
  ['Assetto (SAS)', 'Opposto al bersaglio', ['Digit9'], 'sasMode', 'antiTarget'],
  ['Assetto (SAS)', 'Vettore di manovra', ['Digit0'], 'sasMode', 'maneuver'],
  ['Assetto (SAS)', 'Allinea alla porta di attracco', ['Shift+Digit8'], 'sasMode', 'port'],
  ['Assetto (SAS)', 'Verticale locale', ['Shift+Digit6'], 'sasMode', 'up'],
  ['Veicolo', 'Gambe / carrello', ['KeyG'], 'legs'],
  ['Veicolo', 'Luci', ['Shift+KeyL'], 'lights'],
  ['Navigazione', 'Bersaglio successivo / precedente', ['Tab', 'Shift+Tab'], '@target'],
  ['Navigazione', 'Porta di attracco successiva', ['Shift+KeyT'], 'target', 'port'],
  ['Navigazione', 'Computer di navigazione (manovre)', ['KeyO'], '@nav'],
  ['Navigazione', 'Mappa orbitale', ['KeyM'], '@map'],
  ['Tempo', 'Accelera il tempo', ['Period'], 'warp', 1],
  ['Tempo', 'Rallenta il tempo', ['Comma'], 'warp', -1],
  ['Tempo', 'Tempo reale', ['Slash'], 'warp', 0],
  ['Interfaccia', 'Pausa', ['KeyP'], '@pause'],
  ['Interfaccia', 'Menu', ['Escape'], '@menu'],
  ['Interfaccia', 'Vista successiva / precedente', ['KeyC', 'Shift+KeyC'], '@views'],
  ['Interfaccia', 'Vista cockpit', ['F9'], '@view-cockpit'],
  ['Interfaccia', 'Vista esterna', ['F10'], '@view-chase'],
  ['Interfaccia', 'Strumenti di bordo', ['KeyU'], '@panel-cycle'],
  ['Interfaccia', 'Simboli HUD', ['Shift+KeyU'], '@hud-toggle'],
  ['Interfaccia', 'Riavvia', ['Ctrl+Semicolon'], '@restart'],
  ['Interfaccia', 'Ripristina vista', ['Backspace'], '@reset-view'],
  ['Interfaccia', 'Aiuto e glossario', ['F12'], '@help'],
];
const HELD = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyH', 'KeyN', 'Equal', 'Minus', 'F2', 'F3', 'NumpadAdd', 'NumpadSubtract', 'KeyF', 'KeyB']);

/** Pilot-frame rotation / translation → body frame, by cockpit orientation. */
export function pilotToBody(def, r, t) {
  if (def?.camera?.look === 'belly') {
    // Look along body +z, up along +x, right along +y.
    return { roll: -r.yaw, pitch: r.pitch, yaw: r.roll, tx: t.up, ty: t.right, tz: t.fwd };
  }
  return { roll: r.roll, pitch: r.pitch, yaw: r.yaw, tx: t.fwd, ty: t.right, tz: -t.up };
}

export class InputManager {
  constructor(sim, { onAction = () => {} } = {}) {
    this.sim = sim;
    this.onAction = onAction;
    this.enabled = false;
    this.keys = new Set();
    this.values = {};
    this.kb = { pitch: 0, yaw: 0, roll: 0 };
    this.touch = { pitch: 0, yaw: 0, roll: 0, fwd: 0, right: 0, up: 0, kill: false };
    this._buttons = new Set();
    this._listeners = [];
    this.settings = defaults();
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') this.settings = { ...this.settings, ...saved, axes: { ...this.settings.axes, ...saved.axes } };
    } catch { /* optional storage */ }
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
    listen(target, 'keyup', (e) => this.keys.delete(e.code));
    listen(target, 'blur', () => this._release());
    listen(target?.document, 'visibilitychange', () => { if (target.document.hidden) this._release(); });
    listen(canvas, 'contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    listen(canvas, 'pointerdown', (e) => {
      if (!this.enabled || this._looking) return;
      if (e.button === 2 || e.button === 0 || e.pointerType === 'touch') {
        this._looking = true;
        this._lookPointer = e.pointerId;
        this._lastPointer = [e.clientX, e.clientY];
        canvas.setPointerCapture?.(e.pointerId);
        if (e.pointerType !== 'touch') e.preventDefault();
      }
    });
    const stopLook = (e) => { if (e.pointerId === this._lookPointer) { this._looking = false; this._lookPointer = null; } };
    listen(canvas, 'pointerup', stopLook);
    listen(canvas, 'pointercancel', stopLook);
    listen(canvas, 'lostpointercapture', stopLook);
    listen(canvas, 'pointermove', (e) => {
      if (!this.enabled || !this._looking || e.pointerId !== this._lookPointer) return;
      const [x, y] = this._lastPointer;
      this.onAction('look', { dx: e.clientX - x, dy: e.clientY - y });
      this._lastPointer = [e.clientX, e.clientY];
    });
    listen(canvas, 'wheel', (e) => { if (this.enabled) { e.preventDefault(); this.onAction('zoom', { delta: e.deltaY }); } }, { passive: false });
  }

  detach() { this._listeners.forEach((remove) => remove()); this._listeners = []; this._release(); }
  setSim(sim) { this._release(); this.sim = sim; }
  setEnabled(enabled) { this.enabled = !!enabled; if (!this.enabled) this._release(); }

  _release() {
    this.keys.clear();
    this._buttons.clear();
    this._looking = false;
    this._lookPointer = null;
    this.kb = { pitch: 0, yaw: 0, roll: 0 };
    const p = this.sim?.pilot;
    if (!p) return;
    for (const k of ['pitch', 'yaw', 'roll', 'tx', 'ty', 'tz']) p[k] = 0;
    p.killVel = false;
    p.brake = false;
  }

  _keyDown(e) {
    if (!this.enabled || isField(e.target) || e.metaKey) return;
    if (e.target?.tagName === 'BUTTON' && !e.target.dataset?.pointerFocus && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
    const combo = modifiers(e);
    const b = BINDINGS.find((x) => x[2].includes(combo));
    if (b) {
      e.preventDefault();
      if (e.repeat) return;
      const cmd = b[3];
      if (cmd === '@throttle') this.sim.command('throttle', b[4]);
      else if (cmd === '@views') this.onAction(e.shiftKey ? 'view-prev' : 'view-next');
      else if (cmd === '@target') this.sim.command('target', e.shiftKey ? 'prev' : 'next');
      else if (cmd.startsWith('@')) this.onAction(cmd.slice(1));
      else this.sim.command(cmd, b[4]);
      return;
    }
    if (!e.ctrlKey && !e.altKey && HELD.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
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
      if (!b || !Number.isInteger(b.axis)) continue;
      const pad = pads.find((p) => p.id === b.gamepadId);
      const v = pad?.axes[b.axis];
      if (typeof v !== 'number') continue;
      const raw = clamp(b.invert ? -v : v);
      out[key] = BIPOLAR.has(key) ? this._curve(raw) : (raw + 1) / 2;
    }
    return out;
  }

  update(dt) {
    const pads = this._pads();
    this.values = this._readAxes(pads);
    if (!this.enabled || !this.sim?.pilot || dt <= 0) return;
    const sim = this.sim;
    const p = sim.pilot;
    const def = sim.def;
    const has = (...k) => k.some((c) => this.keys.has(c));
    const style = def?.controlStyle || 'spacecraft';
    // Keyboard rotation builds up while held and recentres on release.
    const kbAxis = (key, pos, neg) => {
      const dir = Number(has(...pos)) - Number(has(...neg));
      const s = this.settings.keyboardSensitivity;
      if (dir) {
        if (this.kb[key] * dir < 0) this.kb[key] *= 0.2;
        this.kb[key] = clamp(this.kb[key] + dir * 2.6 * s * dt);
      } else {
        const back = 5 * dt;
        this.kb[key] = Math.abs(this.kb[key]) <= back ? 0 : this.kb[key] - Math.sign(this.kb[key]) * back;
      }
      return this.kb[key];
    };
    const side = style === 'spacecraft' ? 'yaw' : 'roll';
    const other = side === 'yaw' ? 'roll' : 'yaw';
    const r = { pitch: 0, yaw: 0, roll: 0 };
    r.pitch = kbAxis('pitch', ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    r[side] = kbAxis(side, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    r[other] = kbAxis(other, ['KeyE'], ['KeyQ']);
    const t = {
      fwd: Number(has('KeyH')) - Number(has('KeyN')),
      right: Number(has('KeyL')) - Number(has('KeyJ')),
      up: Number(has('KeyI')) - Number(has('KeyK')),
    };
    // Touch controls (already in the pilot frame).
    const tc = this.touch;
    for (const k of ['pitch', 'yaw', 'roll']) if (Math.abs(tc[k]) > 0.01) r[k] = tc[k];
    for (const k of ['fwd', 'right', 'up']) if (Math.abs(tc[k]) > 0.01) t[k] = tc[k];
    // Gamepad (standard mapping).
    const std = pads.find((pad) => pad.mapping === 'standard');
    let gpKill = false;
    if (std) {
      const ax = (i) => this._curve(std.axes[i] || 0);
      if (Math.abs(ax(1)) > 0) r.pitch = ax(1);
      if (Math.abs(ax(0)) > 0) r[side] = ax(0);
      if (Math.abs(ax(2)) > 0) t.right = ax(2);
      if (Math.abs(ax(3)) > 0) t.up = -ax(3);
      const lt = std.buttons[6]?.value || 0, rt = std.buttons[7]?.value || 0;
      if (lt > 0.05 || rt > 0.05) t.fwd = rt - lt;
      const lb = std.buttons[4]?.pressed ? 1 : 0, rb = std.buttons[5]?.pressed ? 1 : 0;
      if (lb || rb) r[other] = rb - lb;
      if (std.buttons[12]?.pressed) p.throttle = clamp(p.throttle + dt * 0.5, 0, 1);
      if (std.buttons[13]?.pressed) p.throttle = clamp(p.throttle - dt * 0.5, 0, 1);
      gpKill = !!std.buttons[10]?.pressed;
      const next = new Set();
      const actions = { 0: () => sim.command('action'), 1: () => sim.command('sas'), 2: () => sim.command('rcs'), 3: () => this.onAction('view-next'), 8: () => this.onAction('map'), 9: () => this.onAction('menu'), 11: () => sim.command('target', 'next'), 14: () => sim.command('warp', -1), 15: () => sim.command('warp', 1) };
      std.buttons.forEach((btn, i) => {
        if (!btn.pressed) return;
        const id = `${std.index}:${i}`;
        next.add(id);
        if (!this._buttons.has(id)) actions[i]?.();
      });
      this._buttons = next;
    }
    // Explicitly bound axes override.
    for (const k of ['pitch', 'yaw', 'roll']) if (typeof this.values[k] === 'number' && Math.abs(this.values[k]) > 0) r[k] = this.values[k];
    if (typeof this.values.throttle === 'number') p.throttle = this.values.throttle;
    const body = pilotToBody(def, r, t);
    p.pitch = body.pitch;
    p.yaw = body.yaw;
    p.roll = body.roll;
    p.tx = clamp(body.tx);
    p.ty = clamp(body.ty);
    p.tz = clamp(body.tz);
    const up = has('Equal', 'F3', 'NumpadAdd'), down = has('Minus', 'F2', 'NumpadSubtract');
    if (up || down) {
      p.throttle = clamp(p.throttle + (Number(up) - Number(down)) * dt * 0.4, 0, 1);
      sim.autoBurn = false;
    }
    p.killVel = has('KeyF') || gpKill || !!tc.kill;
    p.brake = has('KeyB') || !!tc.brake;
  }

  getBindingsList() {
    const label = (s) => s.replace('Key', '').replace('Digit', '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('Period', '.').replace('Comma', ',').replace('Slash', '/').replace('Semicolon', ';').replace('Space', 'Spazio').replace('Escape', 'Esc').replace('Enter', 'Invio').replace('Backspace', 'Backspace').replace('Shift+', 'Maiusc+');
    return [
      { group: 'Assetto (rotazione)', label: 'Beccheggio: muso giù / su', keys: ['W / S', '↑ / ↓'] },
      { group: 'Assetto (rotazione)', label: 'Imbardata (rollio per Albatro, Grillo)', keys: ['A / D', '← / →'] },
      { group: 'Assetto (rotazione)', label: 'Rollio (imbardata per Albatro, Grillo)', keys: ['Q / E'] },
      { group: 'Traslazione RCS', label: 'Su / giù', keys: ['I / K'] },
      { group: 'Traslazione RCS', label: 'Sinistra / destra', keys: ['J / L'] },
      { group: 'Traslazione RCS', label: 'Avanti / indietro', keys: ['H / N'] },
      { group: 'Traslazione RCS', label: 'Annulla la velocità relativa (tieni premuto)', keys: ['F'] },
      { group: 'Propulsione', label: 'Aumenta / riduci la manetta', keys: ['= / -', 'F3 / F2'] },
      { group: 'Veicolo', label: 'Freni delle ruote (Albatro)', keys: ['B'] },
      ...BINDINGS.map(([group, title, keys]) => ({ group, label: title, keys: keys.map(label) })),
      { group: 'Mouse', label: 'Guardarsi intorno / ruotare la vista', keys: ['Trascina sulla vista 3D'] },
      { group: 'Mouse', label: 'Zoom (e campo visivo nel cockpit)', keys: ['Rotella'] },
      { group: 'Touch', label: 'Rotazione', keys: ['Leva sinistra'] },
      { group: 'Touch', label: 'Traslazione', keys: ['Leva destra · AVANTI / INDIETRO'] },
      { group: 'Touch', label: 'Manetta', keys: ['Cursore verticale'] },
      { group: 'Gamepad standard', label: 'Beccheggio / imbardata', keys: ['Stick sinistro'] },
      { group: 'Gamepad standard', label: 'Traslazione laterale e verticale', keys: ['Stick destro'] },
      { group: 'Gamepad standard', label: 'Traslazione avanti / indietro', keys: ['RT / LT'] },
      { group: 'Gamepad standard', label: 'Rollio', keys: ['LB / RB'] },
      { group: 'Gamepad standard', label: 'Manetta', keys: ['Croce su / giù'] },
      { group: 'Gamepad standard', label: 'Tempo più lento / più veloce', keys: ['Croce sinistra / destra'] },
      { group: 'Gamepad standard', label: 'Azione · SAS · RCS · Vista', keys: ['A · B · X · Y'] },
      { group: 'Gamepad standard', label: 'Mappa · Menu', keys: ['Back · Start'] },
      { group: 'Gamepad standard', label: 'Annulla velocità relativa · bersaglio', keys: ['L3 · R3'] },
    ];
  }

  listGamepads() { return this._pads().map((p) => ({ index: p.index, id: p.id, axes: p.axes.length, buttons: p.buttons.length })); }
  getAxisValues() { return { ...this.values }; }
  setAxisBinding(target, binding) {
    if (!AXES.includes(target)) return;
    this.settings.axes[target] = binding && Number.isInteger(binding.axis) && typeof binding.gamepadId === 'string' ? { gamepadId: binding.gamepadId, axis: binding.axis, invert: !!binding.invert } : null;
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
  saveSettings() { try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* optional */ } }
  resetDefaults() { this.settings = defaults(); this._release(); }
  destroy() { this.detach(); this._captureCancel?.(); }
}

export { BINDINGS, AXES };
