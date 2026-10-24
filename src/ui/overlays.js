// Blocking overlays: pause menu, crash screen, mission debrief; non-blocking landing report.
import { h, button, num, stars, timeStr } from './dom.js';
import { allRunwayEnds } from '../world/world-data.js';

class Overlay {
  constructor(root, content, cls = '') {
    this.el = h('div.overlay' + (cls ? '.' + cls : ''), content);
    root.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('visible'));
  }
  destroy() {
    this.el.classList.remove('visible');
    const el = this.el;
    setTimeout(() => el.remove(), 250);
  }
}

export class PauseMenu extends Overlay {
  constructor(root, app, a) {
    const sim = app.flightSim;
    const fm = sim.fm;
    const title = app.mission ? app.mission.title : 'Volo libero';
    super(
      root,
      h(
        'div.dialog.pause',
        h('h1', 'Pausa'),
        h('div.muted', `${title} · ${sim.def.name}`),
        h(
          'div.pause-stats',
          h('div', h('small', 'Tempo di volo'), h('b', timeStr(sim.flightTime || 0))),
          h('div', h('small', 'Distanza'), h('b', `${num((sim.distanceFlown || 0) / 1852, 1)} NM`)),
          h('div', h('small', 'Carburante usato'), h('b', `${num(Math.max(0, (sim.fuelStart || 0) - fm.systems.fuelTotal))} kg`)),
          h('div', h('small', 'G max'), h('b', num(fm.maxG, 1))),
        ),
        h(
          'div.dialog-actions.vertical',
          button('▶  Riprendi', a.resume, 'primary'),
          button('↺  Ricomincia', a.restart),
          button('🕹  Comandi', a.controls),
          button('⚙  Impostazioni', a.settings),
          button('⌂  Menu principale', a.menu, 'ghost'),
        ),
      ),
    );
    this._key = (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        a.resume();
      }
    };
    window.addEventListener('keydown', this._key);
  }
  destroy() {
    window.removeEventListener('keydown', this._key);
    super.destroy();
  }
}

export class CrashScreen extends Overlay {
  constructor(root, { reason, retry, menu }) {
    super(
      root,
      h(
        'div.dialog.crash',
        h('div.crash-icon', '💥'),
        h('h1', 'Incidente'),
        h('p', reason || 'Il velivolo è andato distrutto.'),
        h('div.dialog-actions', button('↺  Riprova', retry, 'primary'), button('⌂  Menu principale', menu, 'ghost')),
      ),
      'crash-bg',
    );
  }
}

export class DebriefScreen extends Overlay {
  constructor(root, { mission, debrief, retry, missions, cont }) {
    const d = debrief;
    const rows = (d.breakdown || []).map((b) => h('tr', h('td', b.label), h('td', b.value ?? ''), h('td.pts', b.points !== undefined ? (b.points > 0 ? '+' : '') + b.points : '')));
    super(
      root,
      h(
        'div.dialog.debrief' + (d.success ? '.ok' : '.ko'),
        h('div.debrief-head', h('h1', d.success ? 'Missione completata' : 'Missione fallita'), stars(d.stars || 0)),
        h('div.muted', mission?.title || d.title || ''),
        d.text ? h('p', d.text) : null,
        h('div.score', h('b', num(d.score || 0)), h('small', d.maxScore ? ` / ${num(d.maxScore)} punti` : ' punti')),
        rows.length ? h('table.breakdown', rows) : null,
        h('div.dialog-actions', button('↺  Riprova', retry, 'primary'), button('🎯  Missioni', missions), cont ? button('Continua a volare', cont, 'ghost') : null),
      ),
    );
  }
}

/** Free-flight landing analysis card (non-blocking). */
export class LandingReport {
  constructor(root) {
    this.root = root;
    this.el = h('div.landing-report');
    this.el.addEventListener('click', () => this.hide());
    root.appendChild(this.el);
  }
  show(sim) {
    const t = sim.landed;
    if (!t) return;
    const fpm = Math.round(t.vsFpm);
    const grade = fpm < 120 ? ['Burro! ⭐⭐⭐', 'ok'] : fpm < 250 ? ['Ottimo ⭐⭐', 'ok'] : fpm < 450 ? ['Accettabile ⭐', 'mid'] : ['Duro', 'ko'];
    // centreline offset on the nearest runway end
    let off = null,
      along = null,
      rwName = '';
    let best = Infinity;
    {
      for (const end of allRunwayEnds()) {
        const dn = t.n - end.thrN,
          de = t.e - end.thrE;
        const al = dn * end.dirN + de * end.dirE;
        const cr = -dn * end.dirE + de * end.dirN;
        if (al > -100 && al < end.length + 100 && Math.abs(cr) < 200 && Math.abs(cr) < best) {
          best = Math.abs(cr);
          off = cr;
          along = al;
          rwName = `${end.airport.icao} ${end.ident}`;
        }
      }
      this.el.innerHTML = '';
      this.el.append(
        h('div.lr-head', h('b', 'Analisi dell\'atterraggio'), h('span.lr-grade.' + grade[1], grade[0])),
        h(
          'div.lr-grid',
          h('div', h('small', 'Rateo di contatto'), h('b', `${fpm} ft/min`)),
          h('div', h('small', 'Fattore di carico'), h('b', `${num(t.g || 1, 2)} g`)),
          h('div', h('small', 'Velocità'), h('b', `${Math.round(t.ias)} kt`)),
          h('div', h('small', 'Assetto / inclinazione'), h('b', `${num(t.pitch, 1)}° / ${num(t.roll, 1)}°`)),
          off !== null ? h('div', h('small', `Pista ${rwName}`), h('b', `${Math.abs(off) < 1 ? 'in asse' : `${num(Math.abs(off), 1)} m ${off > 0 ? 'a destra' : 'a sinistra'}`}`)) : h('div', h('small', 'Pista'), h('b', 'fuori pista')),
          along !== null ? h('div', h('small', 'Dalla soglia'), h('b', `${Math.round(along)} m`)) : null,
        ),
        h('small.muted', 'clic per chiudere'),
      );
      this.el.classList.add('visible');
      clearTimeout(this._t);
      this._t = setTimeout(() => this.hide(), 15000);
    }
  }
  hide() {
    this.el.classList.remove('visible');
  }
}
