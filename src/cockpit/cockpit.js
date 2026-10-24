// Instrument panels share the simulation's instruments and commands; no independent flight state.
import { h } from '../ui/dom.js';
import { clamp } from '../core/math.js';

const STYLE = `
.ca-panel{position:absolute;bottom:0;left:0;right:0;color:#dce7eb;border-top:3px solid #34434a;background:linear-gradient(155deg,#243139,#111b20 55%,#17252c);box-shadow:0 -7px 24px #0008;font:11px var(--mono,monospace)}
.ca-panel header{height:27px;padding:4px 18px;display:flex;align-items:center;gap:16px;letter-spacing:1.5px;color:#9eafb8;background:#101a20;border-bottom:1px solid #ffffff12}.ca-panel header b{color:#e9eff2;font-size:11px}.ca-panel header .ca-status{flex:1;text-align:right;color:#9bdba4;letter-spacing:.5px}.ca-panel header button{padding:2px 7px;font-size:10px;border-radius:3px}
.ca-body{display:grid;grid-template-columns:minmax(350px,1fr) minmax(350px,430px);grid-template-rows:minmax(0,1fr);height:204px}.ca-instruments{width:100%;height:100%;display:block;min-width:0;min-height:0}.ca-controls{min-height:0;padding:6px 12px;overflow:auto;border-left:1px solid #ffffff12;display:flex;flex-direction:column;gap:7px}.ca-row{display:flex;gap:5px;align-items:center;flex-wrap:wrap}.ca-caption{color:#8c9ea7;letter-spacing:1.3px;font-size:9px;width:100%;margin-top:2px}.ca-controls button,.ca-footer button{background:#0c151a;border:1px solid #40515c;border-radius:3px;font:10px var(--mono,monospace);padding:5px 7px;color:#bac7ce;white-space:nowrap}.ca-controls button[aria-pressed=true]{border-color:#75b58f;color:#adf3bc;box-shadow:inset 0 2px 6px #68b68922}.ca-controls button:hover,.ca-footer button:hover{background:#263e48;border-color:#9cc7d9}.ca-knob{display:flex;align-items:center;border:1px solid #354b58;border-radius:4px;overflow:hidden}.ca-knob button{border:0;border-radius:0;padding:5px 7px}.ca-knob span{min-width:66px;text-align:center;color:#7ad9ff;font-size:11px}.ca-footer{display:flex;align-items:center;gap:16px;border-top:1px solid #ffffff15;padding:6px 18px;min-height:38px;background:#10191e}.ca-lever{display:flex;align-items:center;gap:7px;white-space:nowrap}.ca-lever input{width:100px;accent-color:#a7d5df;margin:0}.ca-lever output{color:#dfeef1;min-width:34px}.ca-footer .ca-help{margin-left:auto;color:#869ca7;font-size:10px}.ca-mini .ca-body{height:65px;display:block}.ca-mini .ca-controls,.ca-mini .ca-footer{display:none}.ca-mini header{height:25px}.ca-panel[hidden]{display:none}.ca-jet-hud{position:absolute;left:calc(50% - 180px);top:12%;width:360px;height:230px;pointer-events:none!important}.ca-jet-hud[hidden]{display:none}
@media(max-width:1050px){.ca-body{grid-template-columns:minmax(320px,1fr) 355px}.ca-controls{padding:5px 7px}.ca-controls button{padding:4px}.ca-footer{gap:10px}.ca-lever input{width:75px}.ca-help{display:none}}@media(max-height:720px){.ca-body{height:175px}.ca-controls{gap:4px}.ca-footer{min-height:34px;padding:4px 12px}}@media(max-width:700px){.ca-body{grid-template-columns:1fr;height:180px}.ca-controls{display:none}.ca-footer{flex-wrap:wrap;gap:6px}.ca-panel header{padding:4px 8px;gap:8px}.ca-panel header .ca-status{font-size:9px}.ca-lever{font-size:10px}.ca-lever input{width:65px}}
`;

const num = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—';
const heading = (v) => String(Math.round(v || 0) % 360 || 360).padStart(3, '0');

export class Cockpit {
  constructor(root, sim) {
    this.root = root;
    this.sim = sim;
    this.mode = 'full';
    this.view = 'orbit';
    this.night = 0;
    this.hudVisible = true;
    this.switches = [];
    this.readouts = [];
    if (!document.getElementById('ca-cockpit-style')) {
      document.head.appendChild(h('style#ca-cockpit-style', STYLE));
    }
    this.canvas = h('canvas.ca-instruments', { role: 'img', 'aria-label': 'Strumenti di volo: velocità, assetto, altitudine, prua e motore' });
    this.controls = h('div.ca-controls', { 'aria-label': 'Comandi del cockpit' });
    this.footer = h('div.ca-footer');
    this.name = h('b');
    this.status = h('span.ca-status');
    this.el = h('section.ca-panel', { 'aria-label': 'Pannello strumenti' },
      h('header', this.name, h('span', 'PANNELLO DI VOLO'), this.status, h('button', { type: 'button', title: 'Cambia dimensione del pannello (W)', onclick: () => this.cycleMode() }, 'W · vista')),
      h('div.ca-body', this.canvas, this.controls), this.footer);
    this.hud = h('canvas.ca-jet-hud', { width: 720, height: 460, 'aria-hidden': 'true' });
    root.append(this.el, this.hud);
    for (const event of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
      this.el.addEventListener(event, (e) => e.stopPropagation());
    }
    this.el.addEventListener('wheel', (e) => { if (!this.controls.contains(e.target)) e.preventDefault(); }, { passive: false });
    this.ctx = this.canvas.getContext('2d');
    this.resize(window.innerWidth, window.innerHeight);
    this.setAircraft(sim.def || { name: 'Cieli Aperti', panel: 'ga', controls: {} });
    this._visibility();
  }

  get panelFraction() {
    return this.view === 'cockpit' && this.mode !== 'hidden' ? this.el.getBoundingClientRect().height / Math.max(1, this.height) : 0;
  }

  command(name, value, kind = 'switch') {
    this.sim.command(name, value);
    window.dispatchEvent(new CustomEvent('cieli:click', { detail: { kind } }));
    this.update(0);
  }

  toggle(label, name, read, arg) {
    const b = h('button', { type: 'button', 'aria-label': label, title: label, onclick: () => this.command(name, arg) }, label);
    this.switches.push({ b, read });
    return b;
  }

  knob(label, read, command, step) {
    const value = h('span');
    const adjust = (delta) => {
      if (typeof command === 'function') command(delta);
      else this.command(command, delta, 'knob');
    };
    const el = h('div.ca-knob', { title: `${label}: pulsanti o rotella`, onwheel: (e) => { e.preventDefault(); adjust(e.deltaY < 0 ? step : -step); } },
      h('button', { type: 'button', 'aria-label': `Riduci ${label}`, onclick: () => adjust(-step) }, '−'), value,
      h('button', { type: 'button', 'aria-label': `Aumenta ${label}`, onclick: () => adjust(step) }, '+'));
    this.readouts.push(() => { value.textContent = `${label} ${read()}`; });
    return el;
  }

  lever(label, read, write, { min = 0, max = 1, step = 0.01, format = (v) => `${Math.round(v * 100)}%` } = {}) {
    const output = h('output');
    const input = h('input', { type: 'range', min, max, step, 'aria-label': label, oninput: (e) => {
      write(Number(e.target.value));
      output.textContent = format(Number(e.target.value));
      window.dispatchEvent(new CustomEvent('cieli:click', { detail: { kind: 'lever' } }));
    } });
    this.readouts.push(() => {
      const v = read();
      if (document.activeElement !== input) input.value = v;
      output.textContent = format(v);
    });
    return h('label.ca-lever', label, input, output);
  }

  setAircraft(def) {
    this.def = def;
    this.name.textContent = def.name;
    this.switches = [];
    this.readouts = [];
    this.controls.replaceChildren();
    this.footer.replaceChildren();
    const sim = this.sim;
    const sys = () => sim.fm?.systems || {};
    const ap = () => sim.ap || {};
    const row = (...children) => this.controls.appendChild(h('div.ca-row', ...children));
    row(h('span.ca-caption', 'IMPIANTI / AVVIAMENTO'));
    row(this.toggle('BAT', 'battery', () => sys().battery), this.toggle('GEN', 'alternator', () => sys().alternator),
      this.toggle('AVIONICA', 'avionics', () => sys().avionics), this.toggle('PITOT', 'pitotHeat', () => sys().pitotHeat),
      this.toggle('LUCI', 'allLights', () => sys().lights?.nav),
      h('button', { type: 'button', title: 'Avviamento automatico (Ctrl+E)', onclick: () => this.command('autostart', undefined, 'button') }, 'AVVIA'));
    if (def.panel === 'ga') {
      row(this.toggle('POMPA', 'fuelPump', () => sys().fuelPump), this.toggle('ARIA CARB.', 'carbHeat', () => sim.fm?.engines[0]?.carbHeat),
        this.knob('MAG', () => ['OFF', 'R', 'L', 'BOTH', 'START'][sim.fm?.engines[0]?.magnetos ?? 0], (delta) => this.command('magnetos', clamp((sim.fm?.engines[0]?.magnetos ?? 0) + delta, 0, 3), 'knob'), 1),
        this.toggle('SERBATOIO', 'fuelSelector', () => sys().fuelSelector !== 'off', 'next'));
      // The starter switch is spring loaded and must return to BOTH when released.
      const starter = h('button', { type: 'button', 'aria-label': 'Avviatore motore', onpointerdown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); this.command('magnetos', 4); }, onpointerup: () => this.command('magnetoRelease'), onpointercancel: () => this.command('magnetoRelease') }, 'START');
      this.controls.lastChild.appendChild(starter);
    } else {
      row(this.toggle('APU', 'apuMaster', () => sys().apuMaster), this.toggle('BLEED', 'apuBleed', () => sys().apuBleed),
        this.toggle('IGN', 'engineStartSel', () => sys().engineStartSel === 'ign'),
        ...Array.from({ length: def.engines?.length || 1 }, (_, index) => this.toggle(`ENG ${index + 1}`, 'engineMaster', () => sim.engineMaster?.[index], { index })),
        ...(def.panel === 'jet' ? [h('button', { type: 'button', onclick: () => this.command('starter') }, 'START')] : []));
    }
    row(h('span.ca-caption', 'AUTOPILOTA / DIRETTORE DI VOLO'));
    row(this.toggle('AP', 'ap', () => ap().engaged), this.toggle('HDG', 'apHdg', () => ap().lateral === 'HDG'),
      this.toggle('NAV', 'apNav', () => ap().lateral === 'NAV' || ap().armedNav), this.toggle('APR', 'apApr', () => ap().armedApr || ap().lateral === 'LOC'),
      this.toggle('ALT', 'apAlt', () => ap().vertical === 'ALT'), this.toggle('V/S', 'apVs', () => ap().vertical === 'VS'),
      ...(def.autopilot?.autothrottle ? [this.toggle('A/THR', 'apAthr', () => ap().athr)] : []));
    row(this.knob('HDG', () => heading(ap().hdgBug), 'hdgBug', 1), this.knob('ALT', () => num(ap().altSel), 'altSel', 100), this.knob('V/S', () => num(ap().vsSel), 'vsSel', 100),
      ...(def.autopilot?.autothrottle ? [this.knob('SPD', () => num(ap().spdSel), 'spdSel', 1)] : []));
    row(h('span.ca-caption', 'RADIO / ALTIMETRO'));
    row(this.knob('NAV', () => num(sim.nav1?.standby, 2), 'nav1Tune', 0.05), h('button', { type: 'button', 'aria-label': 'Scambia frequenze NAV1', onclick: () => this.command('nav1Swap', undefined, 'button') }, 'NAV ⇄'),
      this.knob('QNH', () => num((sim.fm?.kollsman || 101325) / 100), 'kollsman', 1));
    row(this.knob('COM', () => num(sim.com1?.standby, 2), 'com1Tune', 0.025), h('button', { type: 'button', 'aria-label': 'Scambia frequenze COM1', onclick: () => this.command('com1Swap', undefined, 'button') }, 'COM ⇄'),
      this.knob('OBS', () => heading(sim.nav1?.obs), 'obs', 1));
    this.footer.append(this.lever('MANETTA', () => sim.pilot.throttle, (v) => { sim.pilot.throttle = v; }),
      ...(def.panel === 'ga' ? [this.lever('MISCELA', () => sim.pilot.mixture, (v) => sim.command('mixture', v))] : []),
      this.lever('FLAP', () => sys().flapsLever || 0, (v) => sim.command('flaps', v), { min: 0, max: Math.max(1, (def.controls?.flapDetents?.length || 2) - 1), step: 1, format: (v) => def.controls?.flapDetents?.[v]?.name || String(v) }),
      this.toggle('FRENO P', 'parkingBrake', () => sys().parkingBrake),
      ...(def.controls?.retractableGear ? [this.toggle('CARRELLO', 'gear', () => sys().gearLever)] : []),
      ...(def.controls?.spoilers ? [this.toggle('AEROFRENI', 'spoilers', () => sys().spoilerLever > 0)] : []),
      h('span.ca-help', 'Frecce · assetto   F2/F3 · potenza   W · pannello'));
    this._visibility();
    this.update(0);
  }

  setMode(mode) { if (['full', 'mini', 'hidden'].includes(mode)) this.mode = mode; this._visibility(); }
  cycleMode() { this.setMode(['full', 'mini', 'hidden'][(['full', 'mini', 'hidden'].indexOf(this.mode) + 1) % 3]); }
  setView(view) { this.view = view; this._visibility(); }
  setHudVisible(visible) { this.hudVisible = !!visible; this._visibility(); }
  setNight(night) {
    this.night = clamp(night, 0, 1);
    this.el.style.filter = `brightness(${1 - this.night * (this.sim.fm?.systems.lights.panel ? 0.08 : 0.28)})`;
  }
  resize(width, height) { this.width = width; this.height = height; }

  _visibility() {
    this.el.hidden = this.view !== 'cockpit' || this.mode === 'hidden';
    this.el.classList.toggle('ca-mini', this.mode === 'mini');
    this.hud.hidden = this.view !== 'cockpit' || this.def?.panel !== 'jet' || !this.hudVisible;
    document.documentElement.style.setProperty('--panel-h', `${this.el.hidden ? 0 : this.el.getBoundingClientRect().height}px`);
  }

  update() {
    const { fm, instruments: i, ap } = this.sim;
    if (!fm) return;
    document.documentElement.style.setProperty('--panel-h', `${this.el.hidden ? 0 : this.el.getBoundingClientRect().height}px`);
    if (!this.el.hidden) {
      for (const { b, read } of this.switches) b.setAttribute('aria-pressed', String(!!read()));
      for (const read of this.readouts) read();
      const sys = fm.systems;
      const engine = fm.engines[0];
      this.status.textContent = `${sys.busVolts.toFixed(0)} V · ${sys.parkingBrake ? 'FRENO INSERITO' : 'FRENO LIBERO'} · ${ap.engaged ? `AP ${ap.lateral} ${ap.vertical}` : 'VOLO MANUALE'}`;
      this.status.style.color = sys.parkingBrake || sys.busVolts < 18 ? '#ffbd6a' : '#9bdba4';
      const rect = this.canvas.getBoundingClientRect();
      // Loading screens hide the complete cockpit root; defer drawing until layout exists.
      if (rect.width < 100 || rect.height < 40) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, rect.width), hh = Math.max(1, rect.height);
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hh * dpr)) {
        this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hh * dpr);
      }
      const c = this.ctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, hh);
      if (this.mode === 'mini') this.drawMini(c, w, hh, i, fm);
      else if (this.def.panel === 'ga') this.drawAnalog(c, w, hh, i, fm, engine);
      else this.drawGlass(c, w, hh, i, fm);
    }
    if (!this.hud.hidden) this.drawHud(i, fm);
  }

  text(c, text, x, y, size = 11, color = '#dce7eb', align = 'center') {
    c.font = `${size}px 'Consolas', monospace`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(text, x, y);
  }

  drawMini(c, w, hh, i, fm) {
    const cells = [['IAS', num(i.asi), 'kt'], ['ALT', num(i.alt), 'ft'], ['PRUA', heading(i.dg), '°'], ['V/S', num(i.vsi), 'ft/min'], ['POTENZA', num(this.sim.pilot.throttle * 100), '%'], ['CARBURANTE', num(fm.systems.fuelTotal), 'kg']];
    cells.forEach(([label, value, unit], index) => {
      const x = w / cells.length * (index + 0.5);
      this.text(c, label, x, 12, 9, '#91a5ae'); this.text(c, value, x, 32, 20, '#9bf0c0'); this.text(c, unit, x, 51, 9, '#91a5ae');
    });
  }

  dial(c, x, y, r, label, value, unit, needle, min, max, options = {}) {
    if (!Number.isFinite(r) || r <= 22) return;
    c.save(); c.translate(x, y);
    c.fillStyle = '#080e12'; c.strokeStyle = '#4b5b63'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
    const sweep = Math.PI * 1.5, start = Math.PI * 0.75;
    if (options.arc) {
      c.strokeStyle = options.arc; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, r - 7, start + sweep * 0.18, start + sweep * 0.72); c.stroke();
    }
    c.lineWidth = 1;
    for (let n = 0; n <= 10; n++) {
      const a = start + n / 10 * sweep;
      c.strokeStyle = '#b0c2ca'; c.beginPath(); c.moveTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5)); c.lineTo(Math.cos(a) * (r - (n % 2 ? 9 : 12)), Math.sin(a) * (r - (n % 2 ? 9 : 12))); c.stroke();
      if (n % 2 === 0) this.text(c, num(min + n / 10 * (max - min)), Math.cos(a) * (r - 21), Math.sin(a) * (r - 21), 8, '#aebdc4');
    }
    const a = start + clamp((needle - min) / (max - min), 0, 1) * sweep;
    c.strokeStyle = '#f8f6de'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-Math.cos(a) * 6, -Math.sin(a) * 6); c.lineTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12)); c.stroke();
    c.fillStyle = '#91a4ad'; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill();
    this.text(c, label, 0, -r * 0.3, 8, '#a5b6bf');
    c.fillStyle = '#132329'; c.fillRect(-26, r * .32 - 6, 52, 13);
    this.text(c, `${value}`, 0, r * .32, 11, '#e3f1ef'); this.text(c, unit, 0, r * .68, 7, '#8b9ca8');
    c.restore();
  }

  attitude(c, x, y, w, hh, i, round = false) {
    c.save(); c.translate(x, y);
    c.beginPath(); if (round) c.arc(0, 0, w / 2, 0, 7); else c.rect(-w/2, -hh/2, w, hh); c.clip();
    c.fillStyle = '#338cc6'; c.fillRect(-w, -hh, w * 2, hh * 2);
    c.save(); c.rotate(-i.aiRoll * Math.PI / 180); c.translate(0, i.aiPitch * hh / 50);
    c.fillStyle = '#98734a'; c.fillRect(-w * 4, 0, w * 8, hh * 10);
    c.strokeStyle = '#f2f1dc'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-w * 4, 0); c.lineTo(w * 4, 0); c.stroke();
    for (let pitch = -30; pitch <= 30; pitch += 5) {
      if (!pitch) continue;
      const yy = -pitch * hh / 50, size = pitch % 10 ? w * .12 : w * .25;
      c.beginPath(); c.moveTo(-size, yy); c.lineTo(size, yy); c.stroke();
      if (pitch % 10 === 0) this.text(c, String(Math.abs(pitch)), size + 10, yy, 8, '#fff');
    }
    c.restore();
    c.strokeStyle = '#ffe876'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-w*.3, 0); c.lineTo(-w*.10, 0); c.lineTo(-w*.07, 5); c.lineTo(0,0); c.lineTo(w*.07,5); c.lineTo(w*.10,0); c.lineTo(w*.3,0); c.stroke();
    this.text(c, '▼', 0, -hh * .42, 11, '#ffdf6e');
    c.restore();
    c.strokeStyle = '#4b5b63'; c.lineWidth = 3; c.beginPath(); if (round) c.arc(x, y, w / 2, 0, 7); else c.rect(x-w/2, y-hh/2,w,hh); c.stroke();
  }

  drawAnalog(c, w, hh, i, fm, engine) {
    const pack = Math.min(w * .60, 430), radius = Math.min((hh - 16) / 4, (pack - 24) / 6);
    const centers = [pack/6, pack/2, pack*5/6], ys = [hh/4, hh*3/4];
    this.dial(c, centers[0], ys[0], radius, 'ANEMOMETRO', num(i.asi), 'KT', i.asi, 0, 200, { arc: '#70c28c' });
    this.attitude(c, centers[1], ys[0], radius*2, radius*2, i, true);
    this.dial(c, centers[2], ys[0], radius, 'ALTIMETRO', num(i.alt), 'FT', ((i.alt % 1000) + 1000) % 1000, 0, 1000);
    this.dial(c, centers[0], ys[1], radius, 'VIROMETRO', num(i.turnRate,1), '° / SEC', i.turnRate, -6, 6);
    this.dial(c, centers[1], ys[1], radius, 'DIREZIONALE', heading(i.dg), 'PRUA', i.dg, 0, 360);
    this.dial(c, centers[2], ys[1], radius, 'VARIOMETRO', num(i.vsi), 'FT / MIN', i.vsi, -2000, 2000);
    const x = pack + 12, ww = w - x - 12;
    c.fillStyle = '#071012'; c.fillRect(x, 10, ww, hh-20); c.strokeStyle = '#3b5159'; c.strokeRect(x, 10, ww, hh-20);
    this.text(c, 'NAV / COM', x + 12, 25, 10, '#72919c','left');
    if (fm.systems.avionicsPowered) {
      this.text(c, `${num(this.sim.nav1.active,2)}  NAV1  ${num(this.sim.nav1.standby,2)}`, x + 12, 45, 12, '#ffd28b','left');
      this.text(c, `${num(this.sim.com1.active,2)}  COM1 ${num(this.sim.com1.standby,2)}`, x + 12, 65, 12, '#ffd28b','left');
      this.text(c, `${this.sim.nav1.ident || '—'} · ${this.sim.nav1.valid ? num(this.sim.nav1.dme,1) + ' NM' : 'NESSUN SEGNALE'}`, x+12, 86, 10, '#a1d3c3','left');
    } else this.text(c, 'AVIONICA SPENTA', x + ww/2, 60, 12, '#866e54');
    c.strokeStyle = '#2b4148'; c.beginPath(); c.moveTo(x+10,98); c.lineTo(x+ww-10,98); c.stroke();
    const rows = [[`RPM  ${num(engine.rpm)}`, `MISCELA ${num(this.sim.pilot.mixture*100)}%`], [`CARB. ${num(fm.systems.fuelTotal)} kg`, `OLIO ${num(engine.oilPress)} psi`], [`QNH ${num(fm.kollsman/100)} hPa`, `${this.sim.nav1.valid ? 'CDI ' + num(this.sim.nav1.cdi, 2) : 'FLAP ' + this.def.controls.flapDetents[fm.systems.flapsLever].name}`]];
    rows.forEach(([a,b], index) => { this.text(c,a,x+12,116+index*24,10,'#b7c9c8','left'); if (ww > 235) this.text(c,b,x+ww*.52,116+index*24,10,'#b7c9c8','left'); });
  }

  drawGlass(c,w,hh,i,fm) {
    if (!fm.systems.avionicsPowered) { this.text(c, 'AVIONICA SPENTA', w/2,hh/2,14,'#a9845b'); return; }
    const x = w * .3, ww = Math.min(w * .40, 260), ah = hh - 38;
    this.attitude(c,x,hh/2,ww,ah,i);
    const tape = (xx,label,val,unit) => { c.fillStyle='#0b171c';c.fillRect(xx-37,12,74,hh-24);this.text(c,label,xx,26,9,'#8cb7cd');this.text(c,num(val),xx,hh/2,22,'#f3faf8');this.text(c,unit,xx,hh-22,9,'#88a3b5'); };
    tape(42,'IAS',i.asi,'KT'); tape(w*.58,'ALT',i.alt,'FT');
    this.text(c, `HDG ${heading(i.dg)}    V/S ${num(i.vsi)}`, x,hh-8,11,'#a1e4f2');
    const xx=w*.69, tx=w*.98;
    this.text(c, 'MOTORE / SISTEMI', xx,18,10,'#7ec6d4','left');
    fm.engines.forEach((engine,index) => {
      const y=45+index*32;
      this.text(c,`N1 ${index+1}`,xx,y,10,'#adbdc5','left');
      this.text(c,`${num(engine.n1,1)} %`,tx,y,17,'#8ef7ae','right');
      c.fillStyle='#20373b';c.fillRect(xx,y+11,tx-xx,3);c.fillStyle='#8ef7ae';c.fillRect(xx,y+11,(tx-xx)*clamp(engine.n1/100,0,1),3);
    });
    this.text(c,`CARB. ${num(fm.systems.fuelTotal)} KG`,xx,hh-62,11,'#d5e5e9','left');
    this.text(c,`TRAIN ${fm.systems.gearPos>.98?'▼ ▼ ▼':fm.systems.gearPos<.02?'RENT.':'TRANSIT'}`,xx,hh-41,11,fm.systems.gearPos>.98?'#91eea8':'#ffd06d','left');
    this.text(c,`FLAP ${this.def.controls.flapDetents[fm.systems.flapsLever].name}`,xx,hh-21,11,'#d5e5e9','left');
  }

  drawHud(i, fm) {
    const c = this.hud.getContext('2d'); c.setTransform(2,0,0,2,0,0); c.clearRect(0,0,360,230);
    if (!fm.systems.avionicsPowered) return;
    c.strokeStyle='#9bff9e'; c.lineWidth=1; c.shadowColor='#43e85f';c.shadowBlur=3;
    this.text(c,`${heading(fm.heading)}`,180,18,15,'#a6ff9b');this.text(c,`${num(i.asi)} KT`,38,65,14,'#a6ff9b');this.text(c,`${num(i.alt)} FT`,316,65,14,'#a6ff9b');
    c.save();c.translate(180,115);c.rotate(-fm.roll*Math.PI/180);
    for(let p=-20;p<=20;p+=10){const yy=(fm.pitch-p)*3;if(Math.abs(yy)>90)continue;c.beginPath();c.moveTo(-50,yy);c.lineTo(-15,yy);c.moveTo(15,yy);c.lineTo(50,yy);c.stroke();this.text(c,String(p),-65,yy,10,'#a6ff9b');}c.restore();
    c.beginPath();c.moveTo(150,115);c.lineTo(170,115);c.moveTo(190,115);c.lineTo(210,115);c.moveTo(180,105);c.lineTo(180,115);c.stroke();
    this.text(c,`${num(fm.nz,1)} G`,40,203,12,'#a6ff9b');this.text(c,`RA ${num(fm.aglFt)}`,300,203,12,'#a6ff9b');
    c.shadowBlur=0;
  }
}
