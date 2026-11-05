// In-flight interface: top bar, navball with the orbital markers and SAS modes, orbit /
// surface / target / docking panels, propellant and limits, warnings, messages, HUD symbols
// over the 3D view, navigation computer (maneuver planning) and map labels.
import { h, clear, num, timeStr } from './dom.js';
import { V3, clamp } from '../core/math.js';
import { SAS_MODES } from '../sim/assist.js';
import { orbitalFrame } from '../sim/orbit.js';
import { BODIES, bodySpin, bodyOrientation } from '../sim/system.js';
import { fmtTime, WARP_LEVELS } from '../sim/simulation.js';

const km = (m) => (Math.abs(m) >= 1e7 ? `${num(m / 1e3, 0)} km` : Math.abs(m) >= 1e5 ? `${num(m / 1e3, 1)} km` : Math.abs(m) >= 1e4 ? `${num(m / 1e3, 2)} km` : `${num(m, 0)} m`);
const dist = (m) => (m >= 1.4959787e10 ? `${num(m / 1.495978707e11, 3)} UA` : m >= 1e6 ? `${num(m / 1e3, 0)} km` : m >= 1e4 ? `${num(m / 1e3, 1)} km` : m >= 100 ? `${num(m, 0)} m` : `${num(m, 1)} m`);
const speed = (v) => (Math.abs(v) >= 1000 ? `${num(v / 1000, 2)} km/s` : Math.abs(v) >= 10 ? `${num(v, 0)} m/s` : `${num(v, 2)} m/s`);

const MARKER = {
  prograde: '#e8d84a', retrograde: '#e8d84a', normal: '#c86bff', antinormal: '#c86bff', radialOut: '#46e0ff', radialIn: '#46e0ff', target: '#ff5ed2', antiTarget: '#ff5ed2', maneuver: '#3d8bff',
};

export class FlightUI {
  constructor(root, app) {
    this.app = app;
    this.root = root;
    this.mode = 'full';
    this.showHud = true;
    this.navOpen = false;
    this.el = h('div.fu');
    // Top bar
    this.timeEl = h('span.fu-time');
    this.warpEl = h('span.fu-warp');
    this.titleEl = h('span.fu-title');
    this.top = h('div.fu-top',
      h('button.fu-btn.fu-menu', { type: 'button', onclick: () => app.openPauseMenu(), 'aria-label': 'Menu e pausa (Esc)' }, '☰'),
      this.titleEl, h('div.spacer'), this.warpEl, this.timeEl,
      h('button.fu-btn.fu-opt.fu-optnav', { type: 'button', onclick: () => app.onAction('nav'), 'aria-label': 'Computer di navigazione (O)' }, 'NAV'),
      h('button.fu-btn.fu-opt.fu-optmap', { type: 'button', onclick: () => app.onAction('map'), 'aria-label': 'Mappa orbitale (M)' }, 'MAPPA'),
      h('button.fu-btn.fu-opt', { type: 'button', onclick: () => app.onAction('view-next'), 'aria-label': 'Cambia vista (C)' }, 'VISTA'),
      h('button.fu-btn.fu-help', { type: 'button', onclick: () => app.openHelp(), 'aria-label': 'Aiuto e glossario (F12)' }, '?'));
    // Left: orbit / surface
    this.orbitBox = h('div.fu-box.fu-orbit');
    // Right: target / docking
    this.targetBox = h('div.fu-box.fu-target');
    this.dockCanvas = h('canvas.fu-dock', { width: 180, height: 180 });
    // Bottom: navball and gauges
    this.ball = h('canvas.fu-ball', { width: 180, height: 180, 'aria-label': 'Sfera di assetto' });
    this.ballInfo = h('div.fu-ballinfo');
    this.sasBar = h('div.fu-sas');
    for (const m of SAS_MODES) {
      const b = h('button.fu-sasbtn', { type: 'button', title: `${m.name}`, onclick: () => app.flightSim.command('sasMode', m.id) }, m.label);
      b.dataset.mode = m.id;
      this.sasBar.appendChild(b);
    }
    this.sasToggle = h('button.fu-sasbtn.fu-sason', { type: 'button', onclick: () => app.flightSim.command('sas') }, 'SAS');
    this.rcsToggle = h('button.fu-sasbtn.fu-sason', { type: 'button', onclick: () => app.flightSim.command('rcs') }, 'RCS');
    this.sasBar.prepend(this.sasToggle, this.rcsToggle);
    this.gauges = h('div.fu-gauges');
    this.bottom = h('div.fu-bottom', h('div.fu-ballwrap', this.ball, this.ballInfo), h('div.fu-right', this.sasBar, this.gauges));
    this.warnEl = h('div.fu-warn');
    this.toasts = h('div.fu-toasts', { role: 'status', 'aria-live': 'polite' });
    this.missionEl = h('div.fu-mission');
    this.flashEl = h('div.fu-flash');
    this.hudCanvas = h('canvas.fu-hud');
    this.navEl = h('div.fu-nav');
    this.mapLabels = h('div.fu-maplabels');
    this.el.append(this.hudCanvas, this.mapLabels, this.top, this.orbitBox, this.targetBox, this.bottom, this.warnEl, this.toasts, this.missionEl, this.flashEl, this.navEl);
    root.appendChild(this.el);
    this.ctx = this.ball.getContext('2d');
    this.hctx = this.hudCanvas.getContext('2d');
    this.dctx = this.dockCanvas.getContext('2d');
    this._ballImg = this.ctx.createImageData(180, 180);
    this._acc = 0;
    this.hide();
  }

  show() {
    this.el.classList.add('visible');
  }

  hide() {
    this.el.classList.remove('visible');
  }

  reset() {
    // No HUD symbols from the previous flight until the first frame of the new one.
    this.hctx?.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
    clear(this.toasts);
    this.flashEl.classList.remove('show');
    this.navOpen = false;
    this.renderNav();
    this.show();
  }

  setMission(runner) {
    this.runner = runner;
    this.missionEl.hidden = !runner;
  }

  cycleMode() {
    this.mode = this.mode === 'full' ? 'mini' : this.mode === 'mini' ? 'hidden' : 'full';
    this.el.dataset.mode = this.mode;
    this.flash(this.mode === 'full' ? 'Strumenti completi' : this.mode === 'mini' ? 'Strumenti essenziali' : 'Strumenti nascosti');
  }

  toggleNav(force) {
    this.navOpen = force ?? !this.navOpen;
    this.renderNav();
  }

  flash(text) {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => this.flashEl.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const app = this.app;
    const sim = app.flightSim;
    if (!sim.ship) return;
    this._acc += dt;
    const info = sim.info;
    // Messages
    for (const m of sim.messages.splice(0)) this.toast(m.text, m.kind, m.duration);
    // Top bar
    const d = sim.date;
    this.timeEl.textContent = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
    this.warpEl.textContent = sim.timeWarp > 1 ? `⏩ ×${num(sim.timeWarp)}${sim.onRails ? '' : ' (fisica)'}` : sim.paused ? 'PAUSA' : '';
    this.warpEl.classList.toggle('on', sim.timeWarp > 1 || sim.paused);
    this.titleEl.textContent = `${sim.def.name} · ${info.refName}${app.runner ? ` · ${app.mission.title}` : ''}`;
    if (this._acc > 0.1) {
      this._acc = 0;
      this.renderPanels(sim, info);
      this.renderGauges(sim, info);
      this.renderWarnings(sim, info);
      if (this.navOpen) this.renderNavInfo(sim);
      this.renderMission();
    }
    this.renderBall(sim);
    this.renderHud(sim);
    this.renderMapLabels(sim);
    this.sasToggle.classList.toggle('on', sim.sas.on);
    this.rcsToggle.classList.toggle('on', sim.ship.rcsEnabled);
    for (const b of this.sasBar.querySelectorAll('[data-mode]')) b.classList.toggle('active', sim.sas.on && sim.sas.mode === b.dataset.mode);
  }

  toast(text, kind = 'info', duration = 4) {
    const t = h('div.fu-toast.' + kind, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, duration * 1000);
  }

  row(label, value, cls = '') {
    return h('div.fu-row' + (cls ? '.' + cls : ''), h('small', label), h('b', value));
  }

  renderPanels(sim, info) {
    const s = sim.ship;
    const body = BODIES[info.ref];
    const low = info.agl < 40e3 || s.landed;
    const rows = [h('div.fu-head', `${body.name}${s.landed ? ' · al suolo' : sim.docked ? ' · agganciato' : ''}`)];
    if (low) {
      rows.push(this.row('Quota sul suolo', km(Math.max(0, info.agl))), this.row('Velocità verticale', speed(info.vs), info.vs < -15 && info.agl < 3000 ? 'alert' : ''), this.row('Velocità orizzontale', speed(info.hspeed)));
      rows.push(this.row('Velocità sul suolo', speed(info.surfaceSpeed)));
      if (body.atmosphere && s.airspeed !== undefined) rows.push(this.row('Mach', num(s.mach || 0, 2)));
      rows.push(this.row('Lat / Long', `${num(info.lat, 2)}° ${num(info.lon, 2)}°`));
    } else {
      rows.push(this.row('Quota', km(info.altitude)), this.row('Velocità orbitale', speed(info.speed)));
    }
    rows.push(this.row('Apoasse', Number.isFinite(info.ap) ? km(info.ap) : 'fuga'), this.row('Periasse', km(info.pe), info.pe < 0 ? 'alert' : ''));
    if (Number.isFinite(info.period)) rows.push(this.row('Periodo', fmtTime(info.period)));
    rows.push(this.row('Inclinazione', `${num(info.inclination, 2)}°`));
    if (info.el.e < 1 && Number.isFinite(info.timeToAp)) rows.push(this.row('Apoasse tra', fmtTime(info.timeToAp)));
    if (Number.isFinite(info.timeToPe)) rows.push(this.row('Periasse tra', fmtTime(info.timeToPe)));
    const seg = sim.prediction?.[0];
    if (seg && seg.end !== 'none') {
      const what = { encounter: `Incontro con ${BODIES[seg.next]?.name}`, 'soi-exit': `Uscita verso ${BODIES[seg.next]?.name}`, atmosphere: 'Ingresso in atmosfera', impact: 'Impatto con la superficie' }[seg.end];
      rows.push(this.row(what, fmtTime(seg.tEnd - sim.t), seg.end === 'impact' ? 'alert' : 'warn'));
      if (seg.end === 'encounter') {
        const nx = sim.prediction[1];
        if (nx) rows.push(this.row(`Periasse a ${BODIES[nx.ref].name}`, km(nx.el.rp - BODIES[nx.ref].radius)));
      }
    }
    clear(this.orbitBox).append(...rows);
    // Target / docking
    const t = info.target;
    this.targetBox.hidden = !t;
    if (t) {
      const tr = [h('div.fu-head', `Bersaglio: ${t.name}`), this.row('Distanza', dist(t.distance)), this.row('Velocità relativa', speed(t.relSpeed)), this.row(t.closing < 0 ? 'Avvicinamento' : 'Allontanamento', speed(Math.abs(t.closing)))];
      if (sim.approach) tr.push(this.row('Minima distanza', `${dist(sim.approach.dist)} tra ${fmtTime(sim.approach.t - sim.t)}`));
      const p = info.port;
      if (p) {
        tr.push(h('div.fu-head.small', p.name), this.row('Distanza porta', `${num(p.range, 2)} m`), this.row('Fuori asse ↔ / ↕', `${num(p.x, 2)} / ${num(p.y, 2)} m`), this.row('Avvicinamento', `${num(p.closing, 2)} m/s`, p.closing > 0.6 && p.range < 30 ? 'alert' : ''), this.row('Errore di assetto', `${num(p.yawErr, 1)}° ${num(p.pitchErr, 1)}° rollio ${num(p.rollErr, 0)}°`));
        tr.push(this.dockCanvas);
        this.drawDock(p);
      }
      clear(this.targetBox).append(...tr);
    }
  }

  drawDock(p) {
    const c = this.dctx, W = 180, H = 180;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(5,12,22,0.75)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(140,200,255,0.4)';
    c.lineWidth = 1;
    for (const r of [20, 45, 75]) {
      c.beginPath();
      c.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(W / 2, 8); c.lineTo(W / 2, H - 8); c.moveTo(8, H / 2); c.lineTo(W - 8, H / 2);
    c.stroke();
    // Lateral offset (scaled: 1 m = 18 px near, compressed beyond).
    const sc = (v) => Math.sign(v) * Math.min(80, Math.sqrt(Math.abs(v)) * 25);
    const x = W / 2 + sc(p.x), y = H / 2 - sc(p.y);
    const ok = Math.hypot(p.x, p.y) < 0.25;
    c.strokeStyle = ok ? '#3cff8a' : '#ffd34a';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14);
    c.stroke();
    // Attitude error.
    const ax = W / 2 + clamp(p.yawErr * 4, -80, 80), ay = H / 2 - clamp(p.pitchErr * 4, -80, 80);
    c.fillStyle = Math.hypot(p.yawErr, p.pitchErr) < 3 ? '#3cff8a' : '#ff5ed2';
    c.beginPath();
    c.moveTo(ax, ay - 7); c.lineTo(ax + 6, ay + 5); c.lineTo(ax - 6, ay + 5); c.closePath();
    c.fill();
    c.fillStyle = '#cfe6ff';
    c.font = '11px system-ui';
    c.fillText(`${num(p.range, 1)} m · ${num(p.closing, 2)} m/s`, 8, H - 8);
  }

  bar(label, frac, text, cls = '') {
    return h('div.fu-gauge' + (cls ? '.' + cls : ''), h('small', label), h('div.fu-bar', h('span', { style: { width: `${Math.round(clamp(frac, 0, 1) * 100)}%` } })), h('b', text));
  }

  renderGauges(sim, info) {
    const s = sim.ship;
    const st = s.engineStage;
    const items = [];
    items.push(this.bar('Manetta', s.throttle, `${Math.round(s.throttle * 100)}%${s.engineOn ? ' 🔥' : ''}`, s.engineOn ? 'on' : ''));
    if (st) items.push(this.bar(st.engine.name, st.fuelLeft / Math.max(1, st.fuel), `${num(st.fuelLeft, 0)} kg`, st.fuelLeft / Math.max(1, st.fuel) < 0.1 ? 'alert' : ''));
    else items.push(h('div.fu-gauge', h('small', 'Motore'), h('b', 'nessuno (solo RCS)')));
    items.push(this.bar('Monopropellente RCS', s.mono / s.def.rcs.fuel, `${num(s.mono, 0)} kg`, s.mono / s.def.rcs.fuel < 0.1 ? 'alert' : ''));
    items.push(h('div.fu-gauge.fu-pair', h('div', h('small', 'Δv stadio'), h('b', speed(info.deltaV))), h('div', h('small', 'Spinta/peso'), h('b', num(info.twr, 2)))));
    const heat = s.tempLimit ? s.temperature / s.tempLimit : 0;
    items.push(this.bar(s.shieldFacing ? 'Temperatura (scudo)' : 'Temperatura scafo', heat, `${num(s.temperature, 0)} K`, heat > 0.8 ? 'alert' : heat > 0.6 ? 'warn' : ''));
    items.push(h('div.fu-gauge.fu-pair', h('div', h('small', 'Accelerazione'), h('b', `${num(s.gForce, 2)} g`)), h('div', h('small', 'Massa'), h('b', `${num(s.mass / 1000, 2)} t`))));
    const action = sim.docked ? 'Spazio: sgancio' : s.actionLabel();
    if (action) items.push(h('div.fu-gauge.fu-action', h('small', 'Azione (Spazio)'), h('b', action.replace('Spazio: ', ''))));
    const flags = [sim.fa ? 'FA' : null, sim.vsHold ? 'VS' : null, sim.autoBurn ? 'AUTO-MAN' : null, sim.ascent ? 'ASCESA' : null, s.legsDeployed && (s.hasLegs || s.def.gearContacts) ? (s.def.gearContacts ? 'CARRELLO' : 'GAMBE') : null, s.lights ? 'LUCI' : null].filter(Boolean);
    if (flags.length) items.push(h('div.fu-flags', flags.map((f) => h('span', f))));
    clear(this.gauges).append(...items);
  }

  renderWarnings(sim) {
    const s = sim.ship;
    const w = [];
    const heat = s.tempLimit ? s.temperature / s.tempLimit : 0;
    if (heat > 0.85) w.push('TEMPERATURA');
    if (s.gForce > (s.def.gLimit || 12) * 0.85) w.push('SOVRACCARICO');
    const st = s.engineStage;
    if (st && st.fuel > 0 && st.fuelLeft / st.fuel < 0.05) w.push('PROPELLENTE');
    if (s.mono < s.def.rcs.fuel * 0.05) w.push('RCS');
    const up = s.pos.clone().normalize();
    const vs = s.vel.clone().sub(new V3().crossVectors(bodySpin(s.ref, sim.t), s.pos)).dot(up);
    if (!s.landed && s.agl < 500 && vs < -20) w.push('QUOTA');
    if (s.integrity < 60) w.push(`DANNI ${Math.round(s.integrity)}%`);
    if (s.stalled) w.push('STALLO');
    this.warnEl.textContent = w.join(' · ');
    this.warnEl.classList.toggle('visible', w.length > 0);
  }

  renderMission() {
    const r = this.app.runner;
    if (!r) return;
    clear(this.missionEl).append(
      h('div.fu-head', this.app.mission.title, h('span.fu-mtime', timeStr(r.elapsed))),
      h('ol.fu-obj', r.objectives.map((o) => h('li.' + o.state, o.text))),
      r.hint ? h('div.fu-hint', r.hint) : '',
    );
  }

  // ------------------------------------------------------------------ navball
  /** Navball axes in the body frame: centre = thrust axis, screen up / right. */
  ballAxes(def) {
    if (def.camera.look === 'belly') return { fwd: new V3(1, 0, 0), up: new V3(0, 0, 1), right: new V3(0, -1, 0) };
    return { fwd: new V3(1, 0, 0), up: new V3(0, 0, -1), right: new V3(0, 1, 0) };
  }

  renderBall(sim) {
    const s = sim.ship;
    const W = 180, R = 86, cx = 90, cy = 90;
    const ax = this.ballAxes(s.def);
    const fwd = s.q.rotate(ax.fwd, new V3()), up = s.q.rotate(ax.up, new V3()), right = s.q.rotate(ax.right, new V3());
    // Local horizon frame.
    const radial = s.pos.clone().normalize();
    const pole = bodyOrientation(s.ref, sim.t).rotate(new V3(0, 0, 1), new V3());
    let east = new V3().crossVectors(pole, radial);
    if (east.len() < 1e-6) east = new V3(0, 1, 0);
    east.normalize();
    const north = new V3().crossVectors(radial, east);
    // Every second frame is enough.
    this._ballFlip = !this._ballFlip;
    if (this._ballFlip || !this._ballDrawn) {
      this._ballDrawn = true;
      const img = this._ballImg.data;
      const step = 1;
      for (let py = 0; py < W; py += step) {
        for (let px = 0; px < W; px += step) {
          const x = (px - cx) / R, y = (cy - py) / R;
          const rr = x * x + y * y;
          const i = (py * W + px) * 4;
          if (rr > 1) {
            img[i + 3] = 0;
            continue;
          }
          const z = Math.sqrt(1 - rr);
          // World direction of this point on the ball.
          const dx = fwd.x * z + right.x * x + up.x * y, dy = fwd.y * z + right.y * x + up.y * y, dz = fwd.z * z + right.z * x + up.z * y;
          const el = dx * radial.x + dy * radial.y + dz * radial.z;
          const n = dx * north.x + dy * north.y + dz * north.z, e = dx * east.x + dy * east.y + dz * east.z;
          const elev = Math.asin(clamp(el, -1, 1));
          const az = Math.atan2(e, n);
          let r, g, b;
          if (el >= 0) { r = 46; g = 118; b = 190; } else { r = 150; g = 96; b = 52; }
          // Grid: elevation every 10°, azimuth every 30°.
          const ed = Math.abs(((elev * 180) / Math.PI + 90) % 10 - 5);
          const ad = Math.abs((((az * 180) / Math.PI + 360) % 30) - 15);
          const line = ed > 4.6 || (ad > 14.3 && Math.abs(elev) < 1.35) || Math.abs(el) < 0.012;
          if (line) { r = Math.min(255, r + 70); g = Math.min(255, g + 70); b = Math.min(255, b + 70); }
          if (Math.abs(el) < 0.012) { r = g = b = 235; }
          const shade = 0.55 + 0.45 * z;
          img[i] = r * shade;
          img[i + 1] = g * shade;
          img[i + 2] = b * shade;
          img[i + 3] = 255;
        }
      }
      this.ctx.putImageData(this._ballImg, 0, 0);
      const c = this.ctx;
      // Markers.
      const ts = sim.targetState();
      let vRef = s.vel.clone(), refName = 'ORBITA';
      if (ts && sim.target.kind === 'object' && ts.pos.clone().sub(s.pos).len() < 50e3) {
        vRef = s.vel.clone().sub(ts.vel);
        refName = 'BERSAGLIO';
      } else if (s.agl < 30e3) {
        vRef = s.vel.clone().sub(new V3().crossVectors(bodySpin(s.ref, sim.t), s.pos));
        refName = 'SUPERFICIE';
      }
      const { nor, rad } = orbitalFrame(s.pos, s.vel);
      const marks = [];
      if (vRef.len() > 0.05) {
        const vn = vRef.clone().normalize();
        marks.push(['prograde', vn], ['retrograde', vn.clone().scale(-1)]);
      }
      marks.push(['normal', nor], ['antinormal', nor.clone().scale(-1)], ['radialOut', rad], ['radialIn', rad.clone().scale(-1)]);
      if (ts) {
        const td = ts.pos.clone().sub(s.pos).normalize();
        marks.push(['target', td], ['antiTarget', td.clone().scale(-1)]);
      }
      const ni = sim.info.node;
      if (ni && ni.remaining > 0.01) marks.push(['maneuver', ni.dir]);
      for (const [kind, dir] of marks) {
        const zf = dir.dot(fwd);
        if (zf < 0) continue;
        const mx = cx + dir.dot(right) * R, my = cy - dir.dot(up) * R;
        drawMarker(c, kind, mx, my, 9);
      }
      // Fixed reference: the vehicle nose.
      c.strokeStyle = '#ffb000';
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(cx - 24, cy); c.lineTo(cx - 8, cy); c.lineTo(cx, cy + 7); c.lineTo(cx + 8, cy); c.lineTo(cx + 24, cy);
      c.stroke();
      c.strokeStyle = 'rgba(200,220,255,0.5)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, R + 1, 0, Math.PI * 2);
      c.stroke();
      this.ballInfo.textContent = `${refName} · ${speed(vRef.len())}`;
    }
  }

  // ------------------------------------------------------------------ HUD over the 3D view
  renderHud(sim) {
    const r = this.app.renderer;
    const cv = this.hudCanvas;
    const w = Math.round(cv.clientWidth * (globalThis.devicePixelRatio || 1)), hh = Math.round(cv.clientHeight * (globalThis.devicePixelRatio || 1));
    if (cv.width !== w || cv.height !== hh) {
      cv.width = w;
      cv.height = hh;
    }
    const c = this.hctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    if (!this.showHud || r.view === 'map' || sim.crashed) return;
    const k = cv.width / Math.max(1, r.width);
    c.scale(k, k);
    const s = sim.ship;
    const shipAbs = sim.absolute(s.ref, s.pos);
    const far = 1e6;
    const proj = (dir) => r.project(shipAbs.clone().addScaled(dir, far));
    const ts = sim.targetState();
    let vRef = s.vel.clone();
    if (ts && sim.target.kind === 'object' && ts.pos.clone().sub(s.pos).len() < 50e3) vRef = s.vel.clone().sub(ts.vel);
    else if (s.agl < 30e3) vRef = s.vel.clone().sub(new V3().crossVectors(bodySpin(s.ref, sim.t), s.pos));
    if (vRef.len() > 0.05) {
      const vn = vRef.clone().normalize();
      for (const [kind, d] of [['prograde', vn], ['retrograde', vn.clone().scale(-1)]]) {
        const p = proj(d);
        if (p) drawMarker(c, kind, p.x, p.y, 13);
      }
    }
    const ni = sim.info.node;
    if (ni && ni.remaining > 0.01) {
      const p = proj(ni.dir);
      if (p) drawMarker(c, 'maneuver', p.x, p.y, 14);
    }
    if (ts) {
      const tAbs = sim.absolute(s.ref, ts.pos);
      const p = r.project(tAbs);
      const d = sim.info.target.distance;
      if (p) {
        c.strokeStyle = MARKER.target;
        c.lineWidth = 1.5;
        const b = 16;
        c.strokeRect(p.x - b, p.y - b, b * 2, b * 2);
        c.fillStyle = MARKER.target;
        c.font = '12px system-ui';
        c.fillText(`${sim.info.target.name} · ${dist(d)}`, p.x + b + 4, p.y + 4);
      }
      const tp = sim.targetPort();
      if (tp && d < 2000) {
        const pp = r.project(sim.absolute(s.ref, tp.pos));
        if (pp) {
          c.strokeStyle = '#3cff8a';
          c.beginPath();
          c.arc(pp.x, pp.y, 8, 0, Math.PI * 2);
          c.moveTo(pp.x - 14, pp.y); c.lineTo(pp.x + 14, pp.y); c.moveTo(pp.x, pp.y - 14); c.lineTo(pp.x, pp.y + 14);
          c.stroke();
        }
      }
    }
    // Nose reticle in the cockpit.
    if (r.view === 'cockpit') {
      const p = proj(s.forward(new V3()));
      if (p) {
        c.strokeStyle = 'rgba(255,176,0,0.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(p.x - 18, p.y); c.lineTo(p.x - 6, p.y); c.moveTo(p.x + 6, p.y); c.lineTo(p.x + 18, p.y); c.moveTo(p.x, p.y - 6); c.lineTo(p.x, p.y - 12);
        c.stroke();
      }
    }
  }

  renderMapLabels(sim) {
    const r = this.app.renderer;
    const show = r.view === 'map';
    this.mapLabels.hidden = !show;
    this.el.classList.toggle('map-view', show);
    if (!show) return;
    if (!this._labels) this._labels = new Map();
    const want = [];
    for (const b of Object.values(BODIES)) {
      const p = r.project(sim.bodyPos(b.id));
      if (p) want.push({ id: b.id, text: b.name, x: p.x, y: p.y, cls: 'body' });
    }
    const s = sim.ship;
    const sp = r.project(sim.absolute(s.ref, s.pos));
    if (sp) want.push({ id: 'ship', text: s.def.name, x: sp.x, y: sp.y, cls: 'ship' });
    const aps = r._apsides;
    const bp = sim.bodyPos(s.ref);
    if (aps) {
      const a = r.project(bp.clone().add(aps.ap)), pe = r.project(bp.clone().add(aps.pe));
      if (a && Number.isFinite(sim.info.ap)) want.push({ id: 'ap', text: `Ap ${km(sim.info.ap)}`, x: a.x, y: a.y, cls: 'ap' });
      if (pe) want.push({ id: 'pe', text: `Pe ${km(sim.info.pe)}`, x: pe.x, y: pe.y, cls: 'pe' });
    }
    const seen = new Set();
    for (const l of want) {
      seen.add(l.id);
      let el = this._labels.get(l.id);
      if (!el) {
        el = h('span.fu-maplabel.' + l.cls);
        this._labels.set(l.id, el);
        this.mapLabels.appendChild(el);
      }
      el.textContent = l.text;
      el.style.transform = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px)`;
      el.hidden = false;
    }
    for (const [id, el] of this._labels) if (!seen.has(id)) el.hidden = true;
  }

  // ------------------------------------------------------------------ navigation computer
  renderNav() {
    const el = this.navEl;
    el.classList.toggle('open', this.navOpen);
    clear(el);
    if (!this.navOpen) return;
    const sim = this.app.flightSim;
    const cmd = (name, arg) => () => {
      sim.command(name, arg);
      this.renderNavInfo(sim);
    };
    const adj = (key, label) => h('div.fu-adj', h('small', label),
      ...[-10, -1, -0.1, 0.1, 1, 10].map((d) => h('button.fu-mini', { type: 'button', onclick: cmd('node', { [key]: d }) }, `${d > 0 ? '+' : ''}${d}`)));
    const tb = (d, label) => h('button.fu-mini', { type: 'button', onclick: cmd('node', { dt: d }) }, label);
    const plan = (id, label) => h('button.fu-plan', { type: 'button', onclick: () => {
      this.flash('Calcolo della manovra…');
      setTimeout(() => {
        sim.command('plan', id);
        this.renderNavInfo(sim);
      }, 30);
    } }, label);
    this.navInfo = h('div.fu-navinfo');
    el.append(
      h('div.fu-head', 'Computer di navigazione', h('button.fu-mini', { type: 'button', onclick: () => this.toggleNav(false), 'aria-label': 'Chiudi' }, '✕')),
      h('div.fu-plans',
        plan('circAp', 'Circolarizza all’apoasse'), plan('circPe', 'Circolarizza al periasse'), plan('raiseAp', 'Alza l’apoasse'), plan('lowerPe', 'Abbassa il periasse'),
        plan('deorbit', 'Rientro / deorbita'), plan('rendezvous', 'Rendezvous col bersaglio'), plan('plane', 'Allinea il piano al bersaglio'),
        plan('transfer', 'Trasferimento verso il bersaglio'), plan('return', 'Ritorno al pianeta madre'), plan('correction', 'Correzione di rotta')),
      this.navInfo,
      adj('pro', 'Prograde (m/s)'), adj('nor', 'Normale (m/s)'), adj('rad', 'Radiale (m/s)'),
      h('div.fu-adj', h('small', 'Tempo del nodo'), tb(-600, '−10 min'), tb(-60, '−1 min'), tb(-10, '−10 s'), tb(10, '+10 s'), tb(60, '+1 min'), tb(600, '+10 min')),
      h('div.fu-navactions',
        h('button.primary', { type: 'button', onclick: cmd('autoBurn') }, 'Esegui (autopilota)'),
        h('button', { type: 'button', onclick: cmd('warpTo', 'node') }, 'Warp al nodo'),
        h('button', { type: 'button', onclick: cmd('warpTo', 'soi') }, 'Warp all’incontro'),
        h('button.ghost', { type: 'button', onclick: cmd('node', 'delete') }, 'Elimina nodo')),
    );
    this.renderNavInfo(sim);
  }

  renderNavInfo(sim) {
    if (!this.navInfo) return;
    const n = sim.node;
    const ni = sim.info.node;
    const rows = [];
    if (!n || !ni) rows.push(h('p.muted', 'Nessun nodo. Scegli un calcolo automatico (sopra) o crea un nodo con i pulsanti di regolazione. Per i trasferimenti seleziona come bersaglio la Luna o un pianeta con Tab.'));
    else {
      rows.push(this.row('Δv totale', speed(ni.dvTotal)), this.row('Prograde / normale / radiale', `${num(n.pro, 1)} / ${num(n.nor, 1)} / ${num(n.rad, 1)} m/s`), this.row('Tra', fmtTime(ni.timeTo)), this.row('Durata accensione', Number.isFinite(ni.burnTime) ? fmtTime(ni.burnTime) : 'propellente insufficiente', Number.isFinite(ni.burnTime) ? '' : 'alert'));
      if (ni.remaining < ni.dvTotal - 0.05) rows.push(this.row('Δv residuo', speed(ni.remaining)));
      const segs = sim.nodePrediction || [];
      const s0 = segs[0];
      if (s0) {
        const b = BODIES[s0.ref];
        rows.push(this.row('Nuova orbita', `${Number.isFinite(s0.el.ra) && s0.el.e < 1 ? km(s0.el.ra - b.radius) : 'fuga'} × ${km(s0.el.rp - b.radius)}`));
        for (const sg of segs.slice(1)) rows.push(this.row(`${BODIES[sg.ref].name}: periasse`, `${km(sg.el.rp - BODIES[sg.ref].radius)} tra ${fmtTime(sg.t0 - sim.t)}`));
      }
      if (sim.approach) rows.push(this.row('Minima distanza dal bersaglio', `${dist(sim.approach.dist)} a ${speed(sim.approach.relSpeed)}`));
    }
    clear(this.navInfo).append(...rows);
  }
}

export function drawMarker(c, kind, x, y, s) {
  const col = MARKER[kind] || '#fff';
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = 2;
  c.beginPath();
  switch (kind) {
    case 'prograde':
      c.arc(x, y, s * 0.55, 0, Math.PI * 2);
      c.moveTo(x - s, y); c.lineTo(x - s * 0.55, y);
      c.moveTo(x + s * 0.55, y); c.lineTo(x + s, y);
      c.moveTo(x, y - s * 0.55); c.lineTo(x, y - s);
      c.moveTo(x + 1.5, y); c.arc(x, y, 1.5, 0, Math.PI * 2);
      break;
    case 'retrograde':
      c.arc(x, y, s * 0.55, 0, Math.PI * 2);
      c.moveTo(x - s * 0.4, y - s * 0.4); c.lineTo(x + s * 0.4, y + s * 0.4);
      c.moveTo(x + s * 0.4, y - s * 0.4); c.lineTo(x - s * 0.4, y + s * 0.4);
      c.moveTo(x, y - s * 0.55); c.lineTo(x, y - s);
      break;
    case 'normal':
    case 'antinormal': {
      const k = kind === 'normal' ? -1 : 1;
      c.moveTo(x, y + k * s * 0.7); c.lineTo(x + s * 0.65, y - k * s * 0.45); c.lineTo(x - s * 0.65, y - k * s * 0.45); c.closePath();
      break;
    }
    case 'radialOut':
    case 'radialIn':
      c.arc(x, y, s * 0.5, 0, Math.PI * 2);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4, r0 = kind === 'radialOut' ? s * 0.5 : s * 0.15, r1 = kind === 'radialOut' ? s : s * 0.42;
        c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      }
      break;
    case 'target':
    case 'antiTarget':
      c.arc(x, y, s * 0.55, 0, Math.PI * 2);
      if (kind === 'target') { c.moveTo(x + 2.5, y); c.arc(x, y, 2.5, 0, Math.PI * 2); }
      else { c.moveTo(x - s * 0.4, y - s * 0.4); c.lineTo(x + s * 0.4, y + s * 0.4); c.moveTo(x + s * 0.4, y - s * 0.4); c.lineTo(x - s * 0.4, y + s * 0.4); }
      break;
    case 'maneuver':
      c.arc(x, y, s * 0.5, 0, Math.PI * 2);
      c.moveTo(x - s, y - s); c.lineTo(x - s * 0.4, y - s * 0.4);
      c.moveTo(x + s, y - s); c.lineTo(x + s * 0.4, y - s * 0.4);
      c.moveTo(x, y + s); c.lineTo(x, y + s * 0.5);
      break;
    default:
      c.arc(x, y, s * 0.5, 0, Math.PI * 2);
  }
  c.stroke();
}

export { WARP_LEVELS };
