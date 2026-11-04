import { FT, NM } from '../core/units.js';
import { clamp, wrap180, RAD } from '../core/math.js';
import { findRunwayEnd } from '../world/world-data.js';
import { getTerrain } from '../world/terrain-height.js';

// Segment proximity catches fast aircraft crossing a gate between rendered frames.
function segmentDistance(a, b, p) {
  const dx = b.n - a.n, dy = b.e - a.e, dz = b.alt - a.alt;
  const len = dx * dx + dy * dy + dz * dz;
  const t = len ? clamp(((p.n - a.n) * dx + (p.e - a.e) * dy + (p.alt - a.alt) * dz) / len, 0, 1) : 0;
  return Math.hypot(a.n + t * dx - p.n, a.e + t * dy - p.e, a.alt + t * dz - p.alt);
}

export class MissionRunner {
  constructor(mission, sim) {
    this.mission = mission;
    this.sim = sim;
    this.status = 'pending';
    this.elapsed = 0;
    this.debrief = null;
    this.objectives = mission.objectives.map((o) => ({ ...o, state: 'pending' }));
    this.index = 0;
    this.hint = '';
    this._hold = 0;
    this._roll = 0;
    this._loop = 0;
    this._objTime = 0;
    this._target = null;
    this._unsafe = 0;
    this._failure = new Set();
    this._lastLanding = null;
  }

  start() {
    if (this.status !== 'pending') return;
    this.status = 'running';
    this._lastPos = this.position();
    this._lastRoll = this.sim.fm.roll;
    if (!this.objectives.length) return this.finish(false, 'A questa missione mancano gli obiettivi.');
    this.objectives[0].state = 'active';
    this.updateHint();
  }

  position() {
    const fm = this.sim.fm;
    return { n: fm.pos.x, e: fm.pos.y, alt: fm.alt };
  }

  update(dt) {
    if (this.status !== 'running' || this.sim.paused || !Number.isFinite(dt) || dt <= 0) return;
    const sim = this.sim, fm = sim.fm;
    this.elapsed += dt;
    if (sim.crashed || fm.damage?.crashed) return this.finish(false, fm.damage?.reason || 'Il velivolo è precipitato.');
    if (this.elapsed > (this.mission.timeLimit || 2400)) return this.finish(false, 'Tempo disponibile esaurito. Riprova seguendo gli obiettivi in ordine.');
    if (!fm.onGround && (fm.overspeed || fm.stallWarning)) this._unsafe += dt;
    const o = this.objectives[this.index];
    const pos = this.position();
    // Timed objectives (scramble, time-to-climb) fail once their window has passed.
    this._objTime += dt;
    if (o.within && this._objTime > o.within) return this.finish(false, `Tempo scaduto: «${o.text}» andava completato entro ${o.within} s.`);
    let done = false;
    switch (o.type) {
      case 'climb':
        done = !fm.onGround && (o.altFt ? fm.altFt >= o.altFt : fm.aglFt >= o.aglFt);
        break;
      case 'speed': {
        const fast = (!o.minMach || fm.mach >= o.minMach) && (!o.minKt || fm.iasKt >= o.minKt);
        const band = (!o.minAltFt || fm.altFt >= o.minAltFt) && (!o.maxAltFt || fm.altFt <= o.maxAltFt);
        const dry = !o.noAfterburner || fm.engines.every((e) => !(e.afterburner > 0.02));
        done = this.hold(!fm.onGround && fast && band && dry, o.duration || 0.01, dt);
        break;
      }
      case 'loop': {
        // Net pitch rotation about the wings, with the wings roughly level throughout.
        if (fm.aglFt < o.minAglFt || fm.onGround) this._loop = 0;
        else this._loop += fm.omega.y * dt * RAD;
        done = this._loop >= 340 && Math.abs(fm.pitch) < 30 && (Math.abs(fm.roll) < 45 || Math.abs(fm.roll) > 135);
        break;
      }
      case 'inverted':
        done = this.hold(!fm.onGround && Math.abs(fm.roll) > 150 && fm.aglFt >= (o.minAglFt || 0) && (!o.altFt || Math.abs(fm.altFt - o.altFt) <= o.toleranceFt), o.duration, dt);
        break;
      case 'gload':
        done = this.hold(!fm.onGround && fm.nz >= o.minG && fm.aglFt >= (o.minAglFt || 0), o.duration, dt);
        break;
      case 'intercept': {
        const t = this.target(dt);
        const dn = pos.n - t.n, de = pos.e - t.e, dz = pos.alt - t.alt;
        const range = Math.hypot(dn, de, dz);
        const h = t.heading / RAD;
        const behind = (dn * Math.cos(h) + de * Math.sin(h)) / Math.max(range, 1) < -0.5;
        t.range = range;
        done = this.hold(!fm.onGround && range <= o.range && (!o.behind || behind), o.duration, dt);
        break;
      }
      case 'hold':
        done = this.hold(!fm.onGround && Math.abs(fm.altFt - o.altFt) <= o.toleranceFt && Math.abs(fm.roll) < 15 && Math.abs(fm.vs) < 4, o.duration, dt);
        break;
      case 'waypoint': {
        const tuned = !o.frequency || Math.abs(sim.nav1.active - o.frequency) < 0.005;
        const level = (!o.toleranceFt || Math.abs(fm.altFt - o.alt / FT) <= o.toleranceFt) && (!o.maxAglFt || fm.aglFt <= o.maxAglFt);
        const speed = (!o.minKt || fm.iasKt >= o.minKt) && (!o.maxKt || fm.iasKt <= o.maxKt);
        // Low-level gates are judged in plan view; the altitude window is checked above.
        const flat = o.horizontal ? { ...o, alt: pos.alt } : o;
        done = !fm.onGround && tuned && level && speed && segmentDistance(this._lastPos, pos, flat) <= o.radius;
        break;
      }
      case 'systems':
        done = this.hold(fm.engines.every((e) => e.running) && fm.systems.avionicsPowered, o.duration, dt);
        break;
      case 'failure':
        done = this.hold(this._failure.has(o.system) && !fm.onGround && fm.iasKt >= o.minSpeed && fm.iasKt <= o.maxSpeed, o.duration, dt);
        break;
      case 'roll': {
        const delta = wrap180(fm.roll - this._lastRoll);
        if (fm.aglFt < o.minAglFt || fm.onGround) this._roll = 0;
        else this._roll += delta;
        done = Math.abs(this._roll) >= 350 && Math.abs(fm.roll) < 25;
        break;
      }
      case 'land':
        // The application dispatches events after update; inspect its current touchdown too.
        if (sim.landed && sim.landed !== this._observedLanding) this.recordLanding(sim.landed);
        done = !!this._landingAccepted;
        break;
      case 'stop':
        done = this.hold(!!this._lastLanding && fm.onGround && fm.gsKt < 5, o.duration, dt);
        break;
      case 'hover': {
        // Stable hover: height window, nearly no ground speed, over the point if given.
        const near = o.n === undefined || Math.hypot(pos.n - o.n, pos.e - o.e) <= o.radius;
        done = this.hold(!fm.onGround && near && fm.aglFt >= o.minAglFt && fm.aglFt <= o.maxAglFt && fm.gsKt <= (o.maxGsKt ?? 4), o.duration, dt);
        break;
      }
      case 'touchdown': {
        // Helicopter landing on a pad (or anywhere within `radius`), then settled.
        const dist = Math.hypot(pos.n - o.n, pos.e - o.e);
        const settled = fm.onGround && dist <= o.radius && fm.gsKt < 2;
        done = this.hold(settled, o.duration || 2, dt);
        if (done) this._lastLanding = { vsFpm: sim.landed?.vsFpm ?? 0, offset: dist, along: 0 };
        break;
      }
    }
    this._lastPos = pos;
    this._lastRoll = fm.roll;
    if (done) this.advance();
    this.updateHint();
  }

  hold(condition, duration, dt) {
    this._hold = condition ? this._hold + dt : 0;
    return this._hold >= duration;
  }

  recordLanding(t) {
    this._observedLanding = t;
    const o = this.objectives[this.index];
    if (o?.type !== 'land') return;
    const end = findRunwayEnd(o.airport, o.runway);
    if (!end) return;
    const dn = t.n - end.thrN, de = t.e - end.thrE;
    const along = dn * end.dirN + de * end.dirE;
    const offset = -dn * end.dirE + de * end.dirN;
    const headingOK = Number.isFinite(t.heading) && Math.abs(wrap180(t.heading - end.heading)) < 45;
    if (along >= 0 && along <= (o.maxAlong || end.length) && Math.abs(offset) <= (o.maxOffset || end.width / 2) && headingOK) {
      this._lastLanding = { ...t, along, offset };
      this._landingAccepted = true;
    } else {
      this.finish(false, `Contatto fuori dalla zona richiesta della pista ${o.runway}: ${Math.round(along)} m dalla soglia, ${Math.round(Math.abs(offset))} m dall’asse. Riprova curando il finale.`);
    }
  }

  handleEvent(ev) {
    if (this.status !== 'running') return;
    if (ev.type === 'crash') this.finish(false, ev.reason || 'Il velivolo è precipitato.');
    else if (ev.type === 'failure') this._failure.add(ev.what);
    else if (ev.type === 'touchdown' && ev.data !== this._observedLanding) this.recordLanding(ev.data);
  }

  /** Moving target of an intercept objective: straight legs or a steady turn. */
  target(dt = 0) {
    const o = this.objectives[this.index];
    if (!this._target) {
      if (!o?.target) return null;
      const t = o.target;
      this._target = { n: t.n, e: t.e, alt: t.altFt * FT, heading: t.heading, speed: t.speedKt * 0.514444, turn: t.turnRate || 0, model: t.model || 'jet', range: Infinity };
    }
    const t = this._target;
    if (dt > 0) {
      t.heading = (t.heading + t.turn * dt + 360) % 360;
      const h = t.heading / RAD;
      t.n += Math.cos(h) * t.speed * dt;
      t.e += Math.sin(h) * t.speed * dt;
    }
    return t;
  }

  advance() {
    this.objectives[this.index].state = 'done';
    this.index++;
    this._hold = 0;
    this._roll = 0;
    this._loop = 0;
    this._objTime = 0;
    this._target = null;
    this._landingAccepted = false;
    if (this.index === this.objectives.length) this.finish(true, 'Obiettivi completati. Ottimo lavoro!');
    else this.objectives[this.index].state = 'active';
  }

  updateHint() {
    if (this.status !== 'running') return;
    const o = this.objectives[this.index], fm = this.sim.fm;
    if (o.type === 'waypoint') {
      const dn = o.n - fm.pos.x, de = o.e - fm.pos.y;
      const bearing = (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
      this.hint = `${o.text}: ${(Math.hypot(dn, de) / NM).toFixed(1)} NM per ${Math.round(bearing).toString().padStart(3, '0')}° · ${Math.round(o.alt / FT)} ft`;
    } else if (o.type === 'intercept') {
      const t = this.target(), dn = t.n - fm.pos.x, de = t.e - fm.pos.y;
      const bearing = (Math.atan2(de, dn) * RAD + 360) % 360;
      const dist = Number.isFinite(t.range) ? t.range : Math.hypot(dn, de);
      this.hint = `Bersaglio: ${(dist / NM).toFixed(1)} NM per ${Math.round(bearing).toString().padStart(3, '0')}° · ${Math.round(t.alt / FT)} ft · avvicinati entro ${o.range} m${o.behind ? ' in coda' : ''} · ${Math.floor(this._hold)}/${o.duration} s`;
    } else if (o.type === 'speed') this.hint = `${o.text} · ora Mach ${fm.mach.toFixed(2)} · ${Math.round(fm.iasKt)} kt${o.duration ? ` · ${Math.floor(this._hold)}/${o.duration} s` : ''}`;
    else if (o.type === 'hover' || o.type === 'touchdown') {
      const d = o.n === undefined ? 0 : Math.hypot(o.n - fm.pos.x, o.e - fm.pos.y);
      const bearing = (Math.atan2(o.e - fm.pos.y, o.n - fm.pos.x) * RAD + 360) % 360;
      const where = o.n === undefined || o.radius >= 1000 ? '' : d > o.radius ? ` · piazzola a ${d > 900 ? `${(d / NM).toFixed(1)} NM` : `${Math.round(d)} m`} per ${Math.round(bearing).toString().padStart(3, '0')}°` : ' · sulla piazzola';
      this.hint = `${o.text}${where} · ${Math.round(fm.aglFt)} ft AGL · ${Math.round(fm.gsKt)} kt${o.type === 'hover' ? ` · ${Math.floor(this._hold)}/${o.duration} s` : ''}`;
    } else if (o.type === 'gload') this.hint = `${o.text} · ora ${fm.nz.toFixed(1)} g · ${Math.floor(this._hold)}/${o.duration} s`;
    else if (o.duration) this.hint = `${o.text} · ${Math.floor(this._hold)}/${o.duration} s consecutivi`;
    else if (o.type === 'roll') this.hint = `Rotazione: ${Math.round(Math.abs(this._roll))}° / 360° · Quota minima ${o.minAglFt} ft AGL`;
    else if (o.type === 'loop') this.hint = `Looping: ${Math.round(Math.max(0, this._loop))}° / 360° · tira la cloche, ali livellate · minimo ${o.minAglFt} ft AGL`;
    else if (o.type === 'land') this.hint = `Pista ${o.runway} di ${o.airport} · ${o.maxAlong ? `contatto entro ${o.maxAlong} m · ` : ''}K: checklist · M: mappa`;
    else this.hint = `${o.text} · Quota attuale ${Math.round(o.altFt ? fm.altFt : fm.aglFt)} ft${o.altFt ? '' : ' AGL'}`;
    if (o.within) this.hint += ` · ${Math.max(0, Math.ceil(o.within - this._objTime))} s rimasti`;
  }

  getMarkers() {
    return this.objectives.flatMap((o, i) => {
      if (o.type === 'waypoint') return [{ type: o.ring || this.mission.id === 'percorso-anelli' ? 'ring' : 'waypoint', n: o.n, e: o.e, alt: o.alt,
        radius: o.radius, heading: o.heading ?? this.mission.setup.start.heading ?? 0, active: i === this.index, done: o.state === 'done' }];
      if ((o.type === 'touchdown' || o.type === 'hover') && o.n !== undefined && o.radius < 1000) {
        return [{ type: 'pad', n: o.n, e: o.e, alt: Math.max(0, getTerrain().height(o.n, o.e)) + 0.5, radius: o.radius, heading: 0, active: i === this.index, done: o.state === 'done' }];
      }
      if (o.type === 'intercept' && i === this.index) {
        const t = this.target();
        return [{ type: 'target', n: t.n, e: t.e, alt: t.alt, heading: t.heading, model: t.model, radius: 60, active: true, done: false }];
      }
      if (o.type === 'land' && i === this.index) {
        const end = findRunwayEnd(o.airport, o.runway);
        return end ? [{ type: 'gate', n: end.thrN + end.dirN * 200, e: end.thrE + end.dirE * 200, alt: end.elev + 25, radius: end.width, heading: end.heading, active: true, done: false }] : [];
      }
      return [];
    });
  }

  finish(success, text) {
    if (this.status !== 'running') return;
    this.status = success ? 'success' : 'failed';
    const count = this.objectives.filter((o) => o.state === 'done').length;
    if (!success && this.objectives[this.index]) this.objectives[this.index].state = 'failed';
    const objectivePoints = Math.round(700 * count / this.objectives.length);
    const safetyPoints = success ? Math.round(clamp(100 - this._unsafe * 2, 0, 100)) : 0;
    const landing = this._lastLanding;
    const quality = landing ? clamp(1 - Math.max(0, landing.vsFpm - 120) / 600, 0, 1) : 1;
    const skillPoints = success ? Math.round(200 * quality) : 0;
    const score = objectivePoints + safetyPoints + skillPoints;
    this.debrief = { success, title: this.mission.title, score, maxScore: 1000, stars: success ? (score >= 900 ? 3 : score >= 750 ? 2 : 1) : 0,
      text, breakdown: [
        { label: 'Obiettivi completati', value: `${count}/${this.objectives.length}`, points: objectivePoints },
        { label: 'Volo sicuro', value: `${Math.round(this._unsafe)} s in stallo o overspeed`, points: safetyPoints },
        { label: landing ? 'Qualità del contatto' : 'Completamento della prova', value: landing ? `${Math.round(landing.vsFpm)} ft/min · ${Math.abs(landing.offset).toFixed(1)} m dall’asse` : success ? 'Completata' : 'Incompleta', points: skillPoints },
      ] };
    this.hint = text;
  }
}
