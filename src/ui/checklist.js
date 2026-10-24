// Checklist overlay (K): aircraft checklists with automatic ticks from the simulation state.
import { h, button, clear } from './dom.js';

export class ChecklistOverlay {
  constructor(root, app) {
    this.app = app;
    this.visible = false;
    this.idx = 0;
    this.manual = new Set();
    this.title = h('div.cl-title');
    this.list = h('ol.cl-items');
    this.counter = h('span.cl-counter');
    this.el = h(
      'div.checklist-overlay',
      h('div.cl-head', button('‹', () => this.go(-1), 'small ghost'), this.title, button('›', () => this.go(1), 'small ghost'), button('✕', () => this.hide(), 'small ghost')),
      this.list,
      h('div.cl-foot', this.counter, h('small.muted', 'K: mostra/nascondi · clic su una voce per spuntarla')),
    );
    root.appendChild(this.el);
    this._t = 0;
  }

  get lists() {
    const def = this.app.flightSim.def;
    if (!def) return [];
    if (this._def !== def) {
      this._def = def;
      try {
        this._lists = this.app.deps.getChecklists?.(def) || [];
      } catch (e) {
        console.warn(e);
        this._lists = [];
      }
      this.idx = 0;
      this.manual.clear();
    }
    return this._lists;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.el.classList.add('visible');
    this.render();
  }

  hide() {
    this.visible = false;
    this.el.classList.remove('visible');
  }

  go(d) {
    const n = this.lists.length;
    if (!n) return;
    this.idx = (this.idx + d + n) % n;
    this.render();
  }

  render() {
    const lists = this.lists;
    const cl = lists[this.idx];
    clear(this.list);
    if (!cl) {
      this.title.textContent = 'Checklist non disponibile';
      return;
    }
    this.title.textContent = `${cl.title}  (${this.idx + 1}/${lists.length})`;
    this.rows = cl.items.map((it, i) => {
      const key = `${cl.id}:${i}`;
      const li = h('li', { onclick: () => {
        if (this.manual.has(key)) this.manual.delete(key);
        else this.manual.add(key);
        this.refresh();
      } }, h('span.cl-box'), h('span.cl-text', it.text), h('span.cl-dots'), h('span.cl-value', it.value || ''));
      this.list.appendChild(li);
      return { li, it, key };
    });
    this.refresh();
  }

  refresh() {
    if (!this.rows) return;
    const sim = this.app.flightSim;
    let done = 0;
    let firstOpen = null;
    for (const r of this.rows) {
      let ok = this.manual.has(r.key);
      let auto = false;
      if (!ok && r.it.check) {
        try {
          ok = !!r.it.check(sim);
          auto = ok;
        } catch {
          ok = false;
        }
      }
      r.li.classList.toggle('done', ok);
      r.li.classList.toggle('auto', auto);
      r.li.classList.remove('next');
      if (ok) done++;
      else if (!firstOpen) firstOpen = r.li;
    }
    firstOpen?.classList.add('next');
    this.counter.textContent = `${done}/${this.rows.length} completate`;
  }

  update(dt) {
    if (!this.visible) return;
    this._t += dt;
    if (this._t > 0.3) {
      this._t = 0;
      if (this._def !== this.app.flightSim.def) this.render();
      else this.refresh();
    }
  }
}
