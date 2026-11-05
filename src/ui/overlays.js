// Blocking overlays: pause menu, crash screen, mission debrief; non-blocking landing report.
import { h, button, num, stars, timeStr } from './dom.js';

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
    const title = app.mission ? app.mission.title : 'Volo libero';
    super(
      root,
      h(
        'div.dialog.pause',
        h('h1', 'Pausa'),
        h('div.muted', `${title} · ${sim.def.name}`),
        h(
          'div.pause-stats',
          h('div', h('small', 'Tempo di missione'), h('b', timeStr(sim.flightTime || 0))),
          h('div', h('small', 'Distanza percorsa'), h('b', `${num((sim.distanceTravelled || 0) / 1000, 0)} km`)),
          h('div', h('small', 'Δv dello stadio'), h('b', `${num(sim.info?.deltaV || 0, 0)} m/s`)),
          h('div', h('small', 'Accelerazione max'), h('b', `${num(sim.ship?.maxG || 0, 1)} g`)),
        ),
        h(
          'div.dialog-actions.vertical',
          button('▶  Riprendi', a.resume, 'primary'),
          button('↺  Ricomincia', a.restart),
          button('🕹  Comandi', a.controls),
          button('?  Aiuto e glossario', a.help),
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
        h('h1', 'Missione perduta'),
        h('p', reason || 'Il veicolo è andato distrutto.'),
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
        h('div.dialog-actions', button('↺  Riprova', retry, 'primary'), button('🎯  Missioni', missions), cont ? button('Continua il volo', cont, 'ghost') : null),
      ),
    );
  }
}

