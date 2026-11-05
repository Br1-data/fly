// Missions list with briefing panel.
import { h, button, clear, stars, segmented, select } from './dom.js';
import { getShip, SHIPS } from '../sim/ships.js';
import { CATEGORIES } from '../missions/missions.js';

const FILTERS = [...CATEGORIES.map((c) => ({ value: c.id, label: c.label })), { value: 'todo', label: 'Da fare' }];

export class MissionsScreen {
  constructor(app, { back, start }) {
    this.app = app;
    this.missions = app.deps.MISSIONS || [];
    let results = {};
    try {
      results = app.deps.loadResults?.() || {};
    } catch {
      results = {};
    }
    this.results = results;
    this.list = h('div.mission-list');
    this.brief = h('div.mission-brief');
    this.filter = 'all';
    this.aircraft = '';
    const used = SHIPS.filter((d) => this.missions.some((m) => m.ship === d.id));
    this.filters = h('div.mission-filters',
      segmented(FILTERS, this.filter, (v) => { this.filter = v; this.render(); }),
      select({ label: 'Veicolo', options: [{ value: '', label: 'Tutti i veicoli' }, ...used.map((d) => ({ value: d.id, label: d.name }))], value: '', onChange: (v) => { this.aircraft = v; this.render(); } }));
    this.start = start;
    this.el = h(
      'div.screen.missions',
      h('div.panel.full', h('header.panel-head', button('← Menu', back, 'ghost'), h('h1', 'Missioni'), h('div.spacer'), h('span.muted', `${Object.keys(results).length} / ${this.missions.length} completate`)), h('div.missions-grid', h('div.mission-side', this.filters, this.list), this.brief)),
    );
    this.selected = this.missions[0]?.id;
    this.render();
  }

  visible() {
    return this.missions.filter((m) => {
      if (this.aircraft && m.ship !== this.aircraft) return false;
      if (this.filter === 'todo') return !this.results[m.id];
      return this.filter === 'all' || this.filter === m.category;
    });
  }

  render() {
    clear(this.list);
    const shown = this.visible();
    if (!shown.length) this.list.appendChild(h('p.muted', 'Nessuna missione con questi filtri.'));
    if (shown.length && !shown.some((m) => m.id === this.selected)) this.selected = shown[0].id;
    for (const m of shown) {
      const r = this.results[m.id];
      const def = getShip(m.ship);
      this.list.appendChild(
        h(
          'button.mission-card' + (m.id === this.selected ? '.active' : '') + (r ? '.done' : ''),
          { type: 'button', onclick: () => {
            this.selected = m.id;
            this.render();
          }, ondblclick: () => this.start(m) },
          h('div.mc-top', h('b', m.title), r ? stars(r.stars || 0) : h('span.mc-new', 'nuova')),
          h('div.mc-sub', m.subtitle || ''),
          h('div.mc-meta', h('span', def.name), h('span', '•'), h('span', m.duration || ''), h('span.difficulty', '●'.repeat(m.difficulty || 1) + '○'.repeat(5 - (m.difficulty || 1)))),
        ),
      );
    }
    const m = this.missions.find((x) => x.id === this.selected);
    clear(this.brief);
    if (!m) {
      this.brief.appendChild(h('p.muted', 'Nessuna missione disponibile.'));
      return;
    }
    const r = this.results[m.id];
    const def = getShip(m.ship);
    const paras = String(m.briefing || '').split(/\n\s*\n/);
    this.brief.appendChild(
      h(
        'div.brief-inner',
        h('h2', m.title),
        h('div.brief-meta', h('span', `🚀 ${def.name}`), h('span', `⏱ ${m.duration || '—'}`), h('span', `Difficoltà ${'★'.repeat(m.difficulty || 1)}`)),
        r ? h('div.brief-best', 'Miglior risultato: ', stars(r.stars || 0), ` ${r.best ?? r.score ?? 0} punti`) : null,
        h('div.brief-text', paras.map((p) => h('p', p.trim()))),
        m.objectivesPreview ? h('ul.brief-objectives', m.objectivesPreview.map((o) => h('li', o))) : null,
        h('div.brief-actions', button('Inizia la missione 🚀', () => this.start(m), 'primary big')),
      ),
    );
  }
}
