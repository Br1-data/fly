// Controls help + joystick / gamepad configuration.
import { h, button, clear, slider, checkbox } from './dom.js';

const AXES = [
  { key: 'roll', label: 'Alettoni (rollio)' },
  { key: 'pitch', label: 'Equilibratore (beccheggio)' },
  { key: 'yaw', label: 'Timone (pedaliera)' },
  { key: 'throttle', label: 'Manetta' },
  { key: 'throttle2', label: 'Manetta motore 2' },
  { key: 'mixture', label: 'Miscela' },
  { key: 'brakeL', label: 'Freno sinistro' },
  { key: 'brakeR', label: 'Freno destro' },
];

export class ControlsScreen {
  constructor(app, { back }) {
    this.app = app;
    this.input = app.input;
    this.tabKeys = h('div.tab-page');
    this.tabJoy = h('div.tab-page');
    this.tab = 'keys';
    const tabs = h(
      'div.tabs',
      button('Tastiera e mouse', () => this.setTab('keys'), 'tab active'),
      button('Joystick e gamepad', () => this.setTab('joy'), 'tab'),
    );
    this.tabsEl = tabs;
    this.el = h('div.screen.controls', h('div.panel.wide', h('header.panel-head', button('← Indietro', back, 'ghost'), h('h1', 'Comandi'), h('div.spacer'), tabs), h('div.panel-body', this.tabKeys, this.tabJoy)));
    this.renderKeys();
    this.renderJoy();
    this.setTab('keys');
    this._raf = requestAnimationFrame(() => this.tick());
  }

  setTab(t) {
    this.tab = t;
    this.tabKeys.style.display = t === 'keys' ? '' : 'none';
    this.tabJoy.style.display = t === 'joy' ? '' : 'none';
    const btns = this.tabsEl.querySelectorAll('button');
    btns[0].classList.toggle('active', t === 'keys');
    btns[1].classList.toggle('active', t === 'joy');
  }

  renderKeys() {
    const list = this.input?.getBindingsList?.() || [];
    const groups = new Map();
    for (const b of list) {
      if (!groups.has(b.group)) groups.set(b.group, []);
      groups.get(b.group).push(b);
    }
    const cols = h('div.keys-grid');
    for (const [g, items] of groups) {
      cols.appendChild(
        h(
          'section.key-group',
          h('h3', g),
          h(
            'table',
            items.map((b) => h('tr', h('td', b.label), h('td.keys', (b.keys || []).map((k, i) => [i ? h('span.or', ' / ') : null, h('kbd', k)])))),
          ),
        ),
      );
    }
    cols.appendChild(
      h(
        'section.key-group',
        h('h3', 'Mouse'),
        h(
          'table',
          h('tr', h('td', 'Guardarsi intorno'), h('td.keys', h('kbd', 'Tasto destro + trascina'))),
          h('tr', h('td', 'Zoom'), h('td.keys', h('kbd', 'Rotella'))),
          h('tr', h('td', 'Interruttori, manopole, leve del cockpit'), h('td.keys', h('kbd', 'Clic'), h('span.or', ' / '), h('kbd', 'Rotella'), h('span.or', ' / '), h('kbd', 'Trascina'))),
          h('tr', h('td', 'Cloche col mouse'), h('td.keys', h('kbd', 'Y'))),
        ),
      ),
    );
    clear(this.tabKeys).appendChild(cols);
  }

  renderJoy() {
    const inp = this.input;
    const page = clear(this.tabJoy);
    if (!inp?.settings) {
      page.appendChild(h('p.muted', 'Gestione input non disponibile.'));
      return;
    }
    const st = inp.settings;
    this.padList = h('div.pad-list');
    page.appendChild(h('section', h('h3', 'Dispositivi collegati'), this.padList, h('p.muted', 'Collega il joystick o il gamepad e premi un pulsante per attivarlo. I gamepad standard (Xbox, PlayStation) funzionano senza configurazione.')));
    this.axisRows = {};
    const table = h('table.axis-table');
    for (const a of AXES) {
      const bar = h('div.axis-bar', h('div.axis-fill'));
      const bindLabel = h('span.axis-bind');
      const invert = h('input', { type: 'checkbox' });
      invert.addEventListener('change', () => {
        const b = st.axes?.[a.key];
        if (b) {
          b.invert = invert.checked;
          inp.setAxisBinding(a.key, b);
          inp.saveSettings();
        }
      });
      const assign = button('Assegna', async () => {
        assign.textContent = 'Muovi l\'asse…';
        assign.disabled = true;
        const r = await inp.captureAxis();
        assign.disabled = false;
        assign.textContent = 'Assegna';
        if (r) {
          inp.setAxisBinding(a.key, { gamepadId: r.gamepadId, axis: r.axis, invert: invert.checked });
          inp.saveSettings();
        }
        this.refreshBindings();
      }, 'small');
      const clr = button('✕', () => {
        inp.setAxisBinding(a.key, null);
        inp.saveSettings();
        this.refreshBindings();
      }, 'small ghost');
      this.axisRows[a.key] = { bar, bindLabel, invert };
      table.appendChild(h('tr', h('td', a.label), h('td', bindLabel), h('td', bar), h('td', h('label.inline', invert, ' inverti')), h('td', assign, clr)));
    }
    page.appendChild(h('section', h('h3', 'Assi'), table));
    page.appendChild(
      h(
        'section.joy-tuning',
        slider({ label: 'Zona morta', min: 0, max: 0.3, step: 0.01, value: st.deadzone ?? 0.05, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => {
          st.deadzone = v;
          inp.saveSettings();
        } }),
        slider({ label: 'Curva di risposta (esponenziale)', min: 0, max: 1, step: 0.05, value: st.expo ?? 0.3, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => {
          st.expo = v;
          inp.saveSettings();
        } }),
        slider({ label: 'Sensibilità tastiera', min: 0.3, max: 2, step: 0.1, value: st.keyboardSensitivity ?? 1, format: (v) => `×${v.toFixed(1)}`, onInput: (v) => {
          st.keyboardSensitivity = v;
          inp.saveSettings();
        } }),
        checkbox({ label: 'Joystick / gamepad abilitati', checked: st.gamepadEnabled !== false, onChange: (v) => {
          st.gamepadEnabled = v;
          inp.saveSettings();
        } }),
        h('div.btn-row', button('Ripristina predefiniti', () => {
          inp.resetDefaults();
          inp.saveSettings();
          this.renderJoy();
        }, 'ghost')),
      ),
    );
    this.refreshBindings();
  }

  refreshBindings() {
    const st = this.input.settings;
    for (const a of AXES) {
      const row = this.axisRows[a.key];
      const b = st.axes?.[a.key];
      row.bindLabel.textContent = b ? `${shortId(b.gamepadId)} · asse ${b.axis}` : '—';
      row.invert.checked = !!b?.invert;
    }
  }

  tick() {
    if (!this.el.isConnected) return;
    this._raf = requestAnimationFrame(() => this.tick());
    if (this.tab !== 'joy' || !this.input) return;
    try {
      this.input.update?.(0);
    } catch {
      // ignore
    }
    const pads = this.input.listGamepads?.() || [];
    const sig = pads.map((p) => p.id).join('|');
    if (sig !== this._padSig) {
      this._padSig = sig;
      clear(this.padList);
      if (!pads.length) this.padList.appendChild(h('div.muted', 'Nessun dispositivo rilevato.'));
      for (const p of pads) this.padList.appendChild(h('div.pad', h('b', shortId(p.id)), ` — ${p.axes} assi, ${p.buttons} pulsanti`));
    }
    const vals = this.input.getAxisValues?.() || {};
    for (const a of AXES) {
      const v = vals[a.key];
      const fill = this.axisRows[a.key].bar.firstChild;
      if (typeof v !== 'number') {
        fill.style.width = '0';
        continue;
      }
      const bipolar = a.key === 'roll' || a.key === 'pitch' || a.key === 'yaw';
      if (bipolar) {
        fill.style.left = `${50 + Math.min(v, 0) * 50}%`;
        fill.style.width = `${Math.abs(v) * 50}%`;
      } else {
        fill.style.left = '0';
        fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
  }
}

function shortId(id) {
  if (!id) return '?';
  return String(id).replace(/\(.*?\)/g, '').trim().slice(0, 32) || String(id).slice(0, 32);
}
