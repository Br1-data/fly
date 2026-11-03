// Tiny DOM helpers used by the UI screens.

/**
 * Create an element: h('div.card#id', { onclick, style, dataset, ... }, ...children)
 * Children may be strings, numbers, nodes, arrays or null/false (ignored).
 */
export function h(spec, attrs, ...children) {
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Format a number with Italian decimal separator. */
export function num(v, digits = 0) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pad3(v) {
  return String(Math.round(v) % 360 || 360).padStart(3, '0');
}

export function timeStr(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const hh = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function hourStr(hours) {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Simple segmented control: options [{value, label}], returns element with .value */
export function segmented(options, value, onChange) {
  const el = h('div.segmented');
  const set = (v) => {
    el.value = v;
    for (const b of el.children) b.classList.toggle('active', b.dataset.value === String(v));
  };
  for (const o of options) {
    el.appendChild(
      h('button', { type: 'button', dataset: { value: String(o.value) }, onclick: () => {
        set(o.value);
        onChange?.(o.value);
      } }, o.label),
    );
  }
  set(value);
  el.set = set;
  return el;
}

/** Labelled range slider. */
/**
 * Fingers and pens move a range lever by tapping or dragging anywhere on its track: iOS
 * Safari only moves a native range input by its small thumb and ignores taps on the track.
 * The mouse keeps the native behaviour.
 */
export function touchRange(input, min, max, step) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const setFrom = (event) => {
    const r = input.getBoundingClientRect();
    const fraction = clamp((event.clientX - r.left) / Math.max(1, r.width), 0, 1);
    const value = clamp(Math.round((min + fraction * (max - min) - min) / step) * step + min, min, max);
    if (Math.abs(value - Number(input.value)) < step / 2) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let active = null;
  const end = (event) => {
    if (event.pointerId !== active) return;
    active = null;
    input.releasePointerCapture?.(event.pointerId);
  };
  input.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || active !== null) return;
    event.preventDefault();
    active = event.pointerId;
    input.setPointerCapture?.(event.pointerId);
    setFrom(event);
  });
  input.addEventListener('pointermove', (event) => { if (event.pointerId === active) setFrom(event); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) input.addEventListener(type, end);
}

/**
 * Swallows the synthetic click that may follow a touch already handled on pointerup, so a
 * control that moves or hides itself cannot pass the same tap to whatever lies beneath.
 */
export function swallowNextClick(doc, x, y) {
  const until = performance.now() + 700;
  const handler = (event) => {
    doc.removeEventListener('click', handler, true);
    if (performance.now() > until || Math.hypot(event.clientX - x, event.clientY - y) > 40) return;
    event.preventDefault();
    event.stopPropagation();
  };
  doc.addEventListener('click', handler, true);
  setTimeout(() => doc.removeEventListener('click', handler, true), 750);
}

/**
 * Touch buttons act when the finger lifts inside them. Browsers (iOS Safari in particular)
 * produce no click for a tap made while another finger is down, e.g. while holding the stick.
 */
export function insideRect(element, x, y) {
  const r = element.getBoundingClientRect();
  return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

/**
 * Makes every button under `root` respond to a finger lifted inside it, even while other
 * fingers are on the screen (flying with one hand, flipping switches with the other).
 * Buttons that handle pointers themselves are skipped via `exclude`.
 */
export function installTouchTaps(root, exclude = '.ca-knob, .touch-controls') {
  const doc = root.ownerDocument;
  const pressed = new Map();
  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const button = event.target.closest?.('button');
    if (!button || button.disabled || (exclude && button.closest(exclude))) return;
    pressed.set(event.pointerId, button);
  }, true);
  root.addEventListener('pointercancel', (event) => pressed.delete(event.pointerId), true);
  root.addEventListener('pointerup', (event) => {
    const button = pressed.get(event.pointerId);
    pressed.delete(event.pointerId);
    if (!button || !button.isConnected || button.disabled || !insideRect(button, event.clientX, event.clientY)) return;
    button.click();
    swallowNextClick(doc, event.clientX, event.clientY);
  }, true);
}

export function slider({ label, min, max, step = 1, value, format = (v) => v, onInput }) {
  const out = h('span.slider-value', format(value));
  const input = h('input', { type: 'range', min, max, step, value });
  touchRange(input, Number(min), Number(max), Number(step));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput?.(v);
  });
  const el = h('label.field.slider', h('span.field-label', label, out), input);
  el.input = input;
  el.setValue = (v) => {
    input.value = v;
    out.textContent = format(Number(v));
  };
  return el;
}

export function checkbox({ label, checked, onChange, hint }) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange?.(input.checked));
  return h('label.field.check', input, h('span.check-box'), h('span.check-text', label, hint ? h('small', hint) : null));
}

export function select({ label, options, value, onChange }) {
  const sel = h('select');
  for (const o of options) sel.appendChild(h('option', { value: o.value }, o.label));
  sel.value = value;
  sel.addEventListener('change', () => onChange?.(sel.value));
  const el = h('label.field', h('span.field-label', label), sel);
  el.select = sel;
  return el;
}

export function button(label, onClick, cls = '') {
  return h('button' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick: onClick }, label);
}

export function stars(n, max = 3) {
  return h('span.stars', Array.from({ length: max }, (_, i) => h('span' + (i < n ? '.on' : ''), '★')));
}
