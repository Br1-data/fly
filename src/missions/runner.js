import { FT, NM } from '../core/units.js';
import { clamp, wrap180 } from '../core/math.js';
import { findRunwayEnd } from '../world/world-data.js';

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
    let done = false;
    switch (o.type) {
      case 'climb':
        done = !fm.onGround && fm.aglFt >= o.aglFt;
        break;
      case 'hold':
        done = this.hold(!fm.onGround && Math.abs(fm.altFt - o.altFt) <= o.toleranceFt && Math.abs(fm.roll) < 15 && Math.abs(fm.vs) < 4, o.duration, dt);
        break;
      case 'waypoint': {
        const tuned = !o.frequency || Math.abs(sim.nav1.active - o.frequency) < 0.005;
        const level = !o.toleranceFt || Math.abs(fm.altFt - o.alt / FT) <= o.toleranceFt;
        done = !fm.onGround && tuned && level && segmentDistance(this._lastPos, pos, o) <= o.radius;
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

  advance() {
    this.objectives[this.index].state = 'done';
    this.index++;
    this._hold = 0;
    this._roll = 0;
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
    } else if (o.duration) this.hint = `${o.text} · ${Math.floor(this._hold)}/${o.duration} s consecutivi`;
    else if (o.type === 'roll') this.hint = `Rotazione: ${Math.round(Math.abs(this._roll))}° / 360° · Quota minima ${o.minAglFt} ft AGL`;
    else if (o.type === 'land') this.hint = `Pista ${o.runway} di ${o.airport} · ${o.maxAlong ? `contatto entro ${o.maxAlong} m · ` : ''}K: checklist · M: mappa`;
    else this.hint = `${o.text} · Quota attuale ${Math.round(fm.aglFt)} ft AGL`;
  }

  getMarkers() {
    return this.objectives.flatMap((o, i) => {
      if (o.type === 'waypoint') return [{ type: this.mission.id === 'percorso-anelli' ? 'ring' : 'waypoint', n: o.n, e: o.e, alt: o.alt,
        radius: o.radius, heading: this.mission.setup.start.heading || 0, active: i === this.index, done: o.state === 'done' }];
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
