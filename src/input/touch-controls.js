// Multitouch flight controls: rotation stick, RCS translation stick with forward / back,
// throttle lever and quick buttons. Each control captures its own pointer, so several
// fingers work together. Values are written in the pilot frame to app.input.touch.
import { isTouchDevice } from '../core/device.js';
import { insideRect, swallowNextClick } from '../ui/dom.js';

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

export const TOUCH_RESPONSES = {
  precise: { label: 'Precisa', travel: 0.46, expo: 0.6 },
  normal: { label: 'Normale', travel: 0.42, expo: 0.45 },
  direct: { label: 'Diretta', travel: 0.34, expo: 0.15 },
};

/** Finger offset from the touch point (px) → {x, y} in -1..1 with a radial dead zone. */
export function stickResponse(dx, dy, radius, response = TOUCH_RESPONSES.normal) {
  let x = dx / Math.max(1, radius), y = dy / Math.max(1, radius);
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  if (l < 0.04) return { x: 0, y: 0 };
  const e = response.expo;
  const c = (v) => Math.sign(v) * (Math.abs(v) * (1 - e) + Math.abs(v) ** 3 * e);
  return { x: clamp(c(x)), y: clamp(c(y)) };
}

export class TouchControls {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.doc = root.ownerDocument;
    this.win = this.doc.defaultView;
    this.enabled = false;
    this.listeners = [];
    if (!this.doc.getElementById('ca-touch-styles')) {
      const css = this.doc.createElement('link');
      css.id = 'ca-touch-styles';
      css.rel = 'stylesheet';
      css.href = new URL('../../styles/touch.css', import.meta.url).href;
      this.doc.head.append(css);
    }
    const el = (tag, cls, text) => {
      const e = this.doc.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    this.el = el('section', 'touch-controls');
    this.el.setAttribute('aria-label', 'Comandi di volo touch');
    this.el.hidden = true;
    // Left: rotation
    const left = el('div', 'touch-left');
    this.rot = this.stick(el, 'ROTAZIONE', 'Rotazione: trascina in basso per cabrare, in alto per picchiare, ai lati per virare');
    const rollRow = el('div', 'touch-row');
    this.rollL = this.holdButton(el, '⟲', 'Rollio a sinistra', (on) => (this.rollHeld = on ? -1 : 0));
    this.rollR = this.holdButton(el, '⟳', 'Rollio a destra', (on) => (this.rollHeld = on ? 1 : 0));
    rollRow.append(this.rollL, this.rollR);
    left.append(this.rot.box, rollRow);
    // Right: translation + throttle
    const right = el('div', 'touch-right');
    const transCol = el('div', 'touch-col');
    this.trans = this.stick(el, 'RCS', 'Traslazione RCS: su, giù, sinistra, destra');
    const fbRow = el('div', 'touch-row');
    this.fwd = this.holdButton(el, 'AVANTI', 'Traslazione avanti', (on) => (this.fwdHeld = on ? 1 : this.fwdHeld === 1 ? 0 : this.fwdHeld));
    this.back = this.holdButton(el, 'INDIETRO', 'Traslazione indietro', (on) => (this.fwdHeld = on ? -1 : this.fwdHeld === -1 ? 0 : this.fwdHeld));
    // Short labels for narrow screens (see touch.css).
    this.back.dataset.short = 'IND.';
    this.fwd.dataset.short = 'AV.';
    fbRow.append(this.back, this.fwd);
    transCol.append(this.trans.box, fbRow);
    const power = el('div', 'touch-power');
    this.powerValue = el('output', 'touch-power-value', '0%');
    this.throttle = el('div', 'touch-throttle');
    this.throttle.setAttribute('role', 'slider');
    this.throttle.setAttribute('aria-label', 'Manetta del motore principale');
    this.throttleFill = el('span', 'touch-throttle-fill');
    this.throttle.append(this.throttleFill);
    this.bindThrottle();
    power.append(this.powerValue, this.throttle, el('span', 'touch-label', 'MANETTA'));
    right.append(transCol, power);
    // Quick buttons
    const bar = el('div', 'touch-bar');
    this.buttons = {};
    const quick = [
      ['sas', 'SAS', 'Stabilizzazione SAS', () => app.flightSim.command('sas')],
      ['rcs', 'RCS', 'Propulsori RCS', () => app.flightSim.command('rcs')],
      ['kill', 'STOP', 'Annulla la velocità relativa (tieni premuto)', null],
      ['action', 'AZIONE', 'Separa lo stadio, apri il paracadute o sgancia', () => app.flightSim.command('action')],
      ['view', 'VISTA', 'Cambia vista', () => app.onAction('view-next')],
      ['map', 'MAPPA', 'Mappa orbitale', () => app.onAction('map')],
      ['nav', 'NAV', 'Computer di navigazione', () => app.onAction('nav')],
      ['slower', '⏪', 'Rallenta il tempo', () => app.flightSim.command('warp', -1)],
      ['faster', '⏩', 'Accelera il tempo', () => app.flightSim.command('warp', 1)],
    ];
    for (const [id, text, label, fn] of quick) {
      const b = fn ? this.tapButton(el, text, label, fn) : this.holdButton(el, text, label, (on) => (this.killHeld = on));
      b.dataset.id = id;
      this.buttons[id] = b;
      bar.append(b);
    }
    this.el.append(left, right, bar);
    root.append(this.el);
    this.listen(this.el, 'contextmenu', (e) => e.preventDefault());
    this.listen(this.win, 'blur', () => this.reset());
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.reset(); });
    this.reset();
  }

  listen(t, type, fn, opt) {
    t?.addEventListener?.(type, fn, opt);
    this.listeners.push(() => t?.removeEventListener?.(type, fn, opt));
  }

  stick(el, label, aria) {
    const box = el('div', 'touch-stick');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', aria);
    box.append(el('span', 'touch-stick-label', label));
    const thumb = el('span', 'touch-stick-thumb');
    box.append(thumb);
    const s = { box, thumb, x: 0, y: 0, id: null, ox: 0, oy: 0 };
    const move = (e) => {
      const r = box.getBoundingClientRect();
      const radius = r.width * (TOUCH_RESPONSES[this.app.input?.settings?.touchResponse] || TOUCH_RESPONSES.normal).travel;
      const v = stickResponse(e.clientX - s.ox, e.clientY - s.oy, radius, TOUCH_RESPONSES[this.app.input?.settings?.touchResponse] || TOUCH_RESPONSES.normal);
      s.x = v.x;
      s.y = v.y;
      thumb.style.transform = `translate(${v.x * radius * 0.8}px, ${v.y * radius * 0.8}px)`;
    };
    this.listen(box, 'pointerdown', (e) => {
      if (!this.enabled || s.id !== null) return;
      e.preventDefault();
      s.id = e.pointerId;
      s.ox = e.clientX;
      s.oy = e.clientY;
      box.setPointerCapture?.(e.pointerId);
      box.classList.add('active');
    });
    this.listen(box, 'pointermove', (e) => { if (e.pointerId === s.id) move(e); });
    const end = (e) => {
      if (e.pointerId !== s.id) return;
      s.id = null;
      s.x = s.y = 0;
      thumb.style.transform = '';
      box.classList.remove('active');
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(box, t, end);
    return s;
  }

  holdButton(el, text, label, fn) {
    const b = el('button', 'touch-button', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    let id = null;
    this.listen(b, 'pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      id = e.pointerId;
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('active');
      fn(true);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      b.classList.remove('active');
      fn(false);
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(b, t, end);
    return b;
  }

  tapButton(el, text, label, fn) {
    const b = el('button', 'touch-button', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    let id = null;
    this.listen(b, 'pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      id = e.pointerId;
      b.setPointerCapture?.(e.pointerId);
    });
    this.listen(b, 'pointerup', (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (insideRect(b, e.clientX, e.clientY)) {
        fn();
        swallowNextClick(this.doc, e.clientX, e.clientY);
      }
    });
    this.listen(b, 'pointercancel', () => (id = null));
    this.listen(b, 'click', (e) => { if (e.detail === 0 && this.enabled) fn(); });
    return b;
  }

  bindThrottle() {
    let id = null;
    const set = (e) => {
      const r = this.throttle.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - r.top) / Math.max(1, r.height), 0, 1);
      this.app.flightSim.command('throttle', v < 0.03 ? 0 : v);
    };
    this.listen(this.throttle, 'pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      id = e.pointerId;
      this.throttle.setPointerCapture?.(e.pointerId);
      set(e);
    });
    this.listen(this.throttle, 'pointermove', (e) => { if (e.pointerId === id) set(e); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(this.throttle, t, (e) => { if (e.pointerId === id) id = null; });
  }

  get visible() {
    return this.enabled && isTouchDevice();
  }

  setEnabled(on) {
    const v = !!on && isTouchDevice();
    if (v === this.enabled) return;
    this.enabled = v;
    this.el.hidden = !v;
    if (!v) this.reset();
  }

  reset() {
    this.rollHeld = 0;
    this.fwdHeld = 0;
    this.killHeld = false;
    for (const s of [this.rot, this.trans]) {
      if (!s) continue;
      s.x = s.y = 0;
      s.id = null;
      s.thumb.style.transform = '';
      s.box.classList.remove('active');
    }
    this.write();
  }

  /** Write the touch state to the input manager (pilot frame); refresh the lever display. */
  write() {
    const input = this.app.input;
    if (!input) return;
    const style = this.app.flightSim?.def?.controlStyle || 'spacecraft';
    const side = style === 'spacecraft' ? 'yaw' : 'roll';
    const other = side === 'yaw' ? 'roll' : 'yaw';
    const t = input.touch;
    t.pitch = this.rot ? this.rot.y : 0;
    t[side] = this.rot ? this.rot.x : 0;
    t[other] = this.rollHeld || 0;
    t.right = this.trans ? this.trans.x : 0;
    t.up = this.trans ? -this.trans.y : 0;
    t.fwd = this.fwdHeld || 0;
    t.kill = !!this.killHeld;
  }

  update() {
    if (!this.enabled) return;
    this.write();
    const sim = this.app.flightSim;
    const thr = sim.pilot.throttle || 0;
    this.throttleFill.style.height = `${Math.round(thr * 100)}%`;
    this.powerValue.textContent = `${Math.round(thr * 100)}%`;
    this.buttons.sas.classList.toggle('on', !!sim.sas?.on);
    this.buttons.rcs.classList.toggle('on', !!sim.ship?.rcsEnabled);
    const label = sim.docked ? 'SGANCIO' : sim.ship?.actionLabel() ? 'AZIONE' : 'AZIONE';
    this.buttons.action.textContent = label;
    this.buttons.action.disabled = !sim.docked && !sim.ship?.actionLabel();
    const side = (sim.def?.controlStyle || 'spacecraft') === 'spacecraft' ? 'Rollio' : 'Imbardata';
    this.rollL.setAttribute('aria-label', `${side} a sinistra`);
    this.rollR.setAttribute('aria-label', `${side} a destra`);
  }

  destroy() {
    this.listeners.forEach((f) => f());
    this.el.remove();
  }
}
