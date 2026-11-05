// Mission runner: sequential objectives with checks on the simulation, failure conditions,
// markers for the renderer, scoring and the debrief.
import { V3 } from '../core/math.js';

export class MissionRunner {
  constructor(mission, sim) {
    this.mission = mission;
    this.sim = sim;
    this.status = 'idle';
    this.elapsed = 0;
    this.debrief = null;
    this.ctx = { events: [], data: {} };
    this.objectives = (mission.objectives || []).map((o) => ({ ...o, state: 'pending' }));
    this.hint = '';
  }

  start() {
    this.status = 'running';
    this.index = 0;
    if (this.objectives[0]) this.objectives[0].state = 'active';
    this.mission.init?.(this.sim, this.ctx);
  }

  handleEvent(ev) {
    if (this.status !== 'running') return;
    this.ctx.events.push({ ...ev, t: this.elapsed });
    if (ev.type === 'crash') this.fail(ev.reason || 'Veicolo distrutto');
  }

  update(dt) {
    if (this.status !== 'running') return;
    this.elapsed += dt;
    const sim = this.sim;
    const ctx = this.ctx;
    ctx.elapsed = this.elapsed;
    ctx.maxG = Math.max(ctx.maxG || 0, sim.ship.gForce || 0);
    if (sim.crashed) return this.fail(sim.ship.destroyed);
    const reason = this.mission.fail?.(sim, ctx);
    if (reason) return this.fail(reason);
    if (this.mission.timeLimit && this.elapsed > this.mission.timeLimit) return this.fail('Tempo scaduto');
    const o = this.objectives[this.index];
    if (!o) return;
    this.hint = o.hint ? o.hint(sim, ctx) || '' : '';
    if (o.check(sim, ctx)) {
      o.state = 'done';
      ctx.data[`t${this.index}`] = this.elapsed;
      this.index++;
      if (this.objectives[this.index]) this.objectives[this.index].state = 'active';
      else this.succeed();
    }
  }

  getMarkers() {
    return this.mission.markers ? this.mission.markers(this.sim, this.ctx, this.index) : [];
  }

  fail(reason) {
    if (this.status !== 'running') return;
    this.status = 'failed';
    const o = this.objectives[this.index];
    if (o) o.state = 'failed';
    this.debrief = { success: false, title: this.mission.title, score: 0, maxScore: 1000, stars: 0, breakdown: [], text: reason };
  }

  succeed() {
    this.status = 'success';
    const res = this.mission.score ? this.mission.score(this.sim, this.ctx) : { items: [] };
    const items = res.items || [];
    const base = 400;
    const total = Math.round(base + items.reduce((a, b) => a + (b.points || 0), 0));
    const max = 1000;
    const score = Math.max(0, Math.min(max, total));
    const stars = score >= 880 ? 3 : score >= 700 ? 2 : 1;
    this.debrief = {
      success: true,
      title: this.mission.title,
      score,
      maxScore: max,
      stars,
      breakdown: [{ label: 'Missione completata', value: '', points: base }, ...items],
      text: res.text || this.mission.success || '',
    };
  }
}

/** Helpers shared by the mission scripts. */
export const M = {
  /** Points from a value: best (or better) → full, worst (or worse) → 0, linear in between. */
  grade(value, best, worst, points) {
    const t = (value - worst) / (best - worst);
    return Math.round(Math.max(0, Math.min(1, t)) * points);
  },
  /** Position of a point given in an object's body frame, relative to the ship's reference. */
  objectPoint(sim, id, local) {
    const o = sim.objects.find((x) => x.id === id);
    if (!o) return null;
    const rs = sim.relToShipRef(o);
    return o.q.rotate(new V3(...local), new V3()).add(rs.pos);
  },
  distanceTo(sim, p) {
    return p.clone().sub(sim.ship.pos).len();
  },
};
