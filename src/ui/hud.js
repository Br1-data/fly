// In-flight overlay: info strip (external views), toasts, warnings, mission panel, ATIS box.
import { h, button, clear, num, pad3, timeStr } from './dom.js';
import { FT, FPM } from '../core/units.js';

export class FlightHud {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.cells = {};
    const cell = (key, label) => {
      const v = h('b', '—');
      this.cells[key] = v;
      return h('div.hud-cell', h('small', label), v);
    };
    this.strip = h(
      'div.hud-strip',
      cell('ias', 'IAS kt'),
      cell('gs', 'GS kt'),
      cell('alt', 'ALT ft'),
      cell('vs', 'V/S ft/min'),
      cell('hdg', 'PRUA'),
      cell('thr', 'MANETTA'),
      cell('flaps', 'FLAP'),
      cell('gear', 'CARRELLO'),
      cell('brk', 'FRENI'),
      cell('ap', 'AUTOPILOTA'),
      cell('fuel', 'CARB. kg'),
    );
    this.warn = h('div.hud-warn');
    this.flashEl = h('div.hud-flash');
    this.toasts = h('div.hud-toasts');
    this.missionEl = h('div.hud-mission');
    this.atisEl = h('div.hud-atis');
    this.rateEl = h('div.hud-rate');
    const toolbar = h('nav.flight-toolbar', { 'aria-label': 'Strumenti di volo e aiuto' },
      button('? Aiuto · F12', () => app.openHelp(), 'flight-help'),
      button('Mappa · M', () => app.onAction('map')),
      button('Checklist · K', () => app.onAction('checklist')),
      button('Pausa · Esc', () => app.openPauseMenu()));
    this.el = h('div.hud', toolbar, this.toasts, this.warn, this.flashEl, this.missionEl, this.atisEl, this.rateEl, this.strip);
    root.appendChild(this.el);
    this._t = 0;
    this._toastMap = new Map();
    this.hide();
  }

  reset() {
    clear(this.toasts);
    this._toastMap.clear();
    this.atisEl.classList.remove('visible');
    this.el.style.display = '';
  }

  hide() {
    this.el.style.display = 'none';
  }

  setMission(runner) {
    this.runner = runner;
    this._objSig = '';
    this.missionEl.style.display = runner ? '' : 'none';
    clear(this.missionEl);
    if (runner) {
      this.mTitle = h('div.hm-title', runner.mission?.title || '');
      this.mTimer = h('span.hm-timer', '00:00');
      this.mObj = h('ol.hm-objectives');
      this.mHint = h('div.hm-hint', '');
      this.missionEl.append(h('div.hm-head', this.mTitle, this.mTimer), this.mObj, this.mHint);
    }
  }

  flash(text) {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
  }

  showAtis(text) {
    clear(this.atisEl).append(h('div.atis-head', '📻 ATIS'), h('div', text));
    this.atisEl.classList.add('visible');
    clearTimeout(this._atisT);
    this._atisT = setTimeout(() => this.atisEl.classList.remove('visible'), 25000);
  }

  update(dt) {
    const app = this.app;
    const sim = app.flightSim;
    const fm = sim.fm;
    if (!fm) return;
    // ---- toasts from sim.messages ----
    const now = performance.now();
    for (const m of sim.messages) {
      if (m._shown) continue;
      m._shown = true;
      const el = h('div.toast.' + (m.kind || 'info'), m.text);
      this.toasts.appendChild(el);
      this._toastMap.set(el, now + (m.duration || 4) * 1000);
      while (this.toasts.children.length > 5) {
        this._toastMap.delete(this.toasts.firstChild);
        this.toasts.firstChild.remove();
      }
    }
    sim.messages.length = 0;
    for (const [el, until] of this._toastMap) {
      if (now > until) {
        el.classList.add('out');
        if (now > until + 400) {
          el.remove();
          this._toastMap.delete(el);
        }
      }
    }

    // ---- warnings (every frame) ----
    const sys = fm.systems;
    let w = '';
    if (sim.paused) w = 'PAUSA';
    else if (fm.stallWarning) w = 'STALLO';
    else if (fm.overspeed) w = 'OVERSPEED';
    else if (sys.warnings.gear) w = 'CARRELLO!';
    else if (fm.damage.crashed) w = 'INCIDENTE';
    if (w !== this._lastWarn) {
      this._lastWarn = w;
      this.warn.textContent = w;
      this.warn.className = 'hud-warn' + (w ? ' visible' : '') + (w === 'PAUSA' ? ' pause' : '');
    }
    const rate = sim.simRate !== 1 ? `×${sim.simRate}` : '';
    if (rate !== this._rate) {
      this._rate = rate;
      this.rateEl.textContent = rate;
      this.rateEl.style.display = rate ? '' : 'none';
    }

    // ---- text at 10 Hz ----
    this._t += dt;
    if (this._t < 0.1) return;
    this._t = 0;
    const external = app.view !== 'cockpit';
    this.strip.style.display = external && app.showHud ? '' : 'none';
    if (this.strip.style.display === '') {
      const c = this.cells;
      c.ias.textContent = num(fm.iasKt);
      c.gs.textContent = num(fm.gsKt);
      c.alt.textContent = num(sim.instruments.alt);
      c.vs.textContent = (fm.vs >= 0 ? '+' : '') + num(Math.round(fm.vs / FPM / 10) * 10);
      c.hdg.textContent = pad3(fm.heading) + '°';
      const e0 = fm.engines[0];
      c.thr.textContent = `${Math.round(sim.pilot.throttle * 100)}%` + (e0.type === 'piston' ? ` · ${num(e0.rpm)} rpm` : ` · N1 ${num(e0.n1)}`);
      c.flaps.textContent = sim.def.controls.flapDetents[sys.flapsLever].name;
      c.gear.textContent = !sim.def.controls.retractableGear ? 'fisso' : sys.gearPos > 0.99 ? 'GIÙ' : sys.gearPos < 0.01 ? 'su' : 'in transito';
      c.gear.parentNode.classList.toggle('alert', sys.warnings.gear);
      c.brk.textContent = sys.parkingBrake ? 'PARCHEGGIO' : fm.brakeLeft > 0.1 || fm.brakeRight > 0.1 ? 'ON' : sys.spoilers > 0.1 ? 'spoiler' : '—';
      const ap = sim.ap;
      c.ap.textContent = ap.engaged ? `${ap.lateral} · ${ap.vertical}${ap.athr ? ' · A/THR' : ''}` : ap.athr ? 'A/THR' : 'OFF';
      c.fuel.textContent = num(sys.fuelTotal);
    }
    // ---- mission ----
    const r = this.runner;
    if (r) {
      this.mTimer.textContent = timeStr(r.elapsed || 0);
      const objs = r.objectives || [];
      const sig = objs.map((o) => o.state + o.text).join('|');
      if (sig !== this._objSig) {
        this._objSig = sig;
        clear(this.mObj);
        for (const o of objs) this.mObj.appendChild(h('li.' + o.state, h('span.ob-mark', o.state === 'done' ? '✓' : o.state === 'failed' ? '✕' : o.state === 'active' ? '▶' : '•'), o.text));
      }
      this.mHint.textContent = r.hint || '';
    }
  }
}
