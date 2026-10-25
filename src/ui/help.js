// Searchable, keyboard-accessible help; the caller owns pausing and resuming the flight.
import { h, button, clear } from './dom.js';
import { GLOSSARY, QUICK_GUIDE } from './help-data.js';
import { getCockpitGuide } from '../cockpit/control-catalog.js';

const TABS = [
  { id: 'quick', label: 'Guida rapida' },
  { id: 'commands', label: 'Comandi' },
  { id: 'glossary', label: 'Glossario' },
];
const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it');
const matches = (query, ...values) => normalize(query).trim().split(/\s+/).every((word) => values.some((v) => normalize(v).includes(word)));
let dialogNumber = 0;

function ensureStyles() {
  if (document.querySelector('link[data-cieli-help]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../styles/help.css', import.meta.url).href;
  link.dataset.cieliHelp = '';
  document.head.appendChild(link);
}

// The input manager is the single source of keyboard, mouse and gamepad bindings.
function getCommands(input) {
  const list = input?.getBindingsList?.() || [];
  const help = { group: 'Interfaccia', label: 'Aiuto e glossario', keys: ['F12'], description: 'Apri o chiudi questa guida. Durante il volo la simulazione resta in pausa mentre consulti l’aiuto.' };
  return list.some((b) => b.keys?.some((key) => key === 'F12')) ? list : [...list, help];
}

export class HelpOverlay {
  constructor(root, app, { close } = {}) {
    ensureStyles();
    this.app = app;
    this.onClose = close;
    this.previousFocus = document.activeElement;
    this.tab = 'quick';
    this.query = '';
    this.destroyed = false;
    this.commands = getCommands(app.input);
    this.cockpit = getCockpitGuide(app.flightSim?.def || null);
    const id = `cieli-help-${++dialogNumber}`;
    this.tabs = new Map();
    this.closeButton = button('Chiudi', () => this.requestClose(), 'help-close');
    this.closeButton.setAttribute('aria-label', 'Chiudi l’aiuto (Esc o F12)');
    const tabList = h('div.help-tabs', { role: 'tablist', 'aria-label': 'Sezioni dell’aiuto' });
    for (const tab of TABS) {
      const el = button(tab.label, () => this.setTab(tab.id), 'help-tab');
      el.id = `${id}-${tab.id}`;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-controls', `${id}-panel`);
      el.addEventListener('keydown', (e) => this.tabKey(e, tab.id));
      this.tabs.set(tab.id, el);
      tabList.appendChild(el);
    }
    this.search = h('input.help-search', { type: 'search', placeholder: 'Cerca un comando, uno strumento o una sigla…', autocomplete: 'off', spellcheck: false });
    this.search.id = `${id}-search`;
    this.search.addEventListener('input', () => { this.query = this.search.value; this.render(); });
    this.resultStatus = h('span.help-result-status', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    this.searchBar = h('div.help-search-bar', h('label.help-search-label', { for: this.search.id }, 'Cerca nella sezione'), this.search, this.resultStatus);
    this.content = h('div.help-content', { id: `${id}-panel`, role: 'tabpanel', tabIndex: 0 });
    this.el = h('div.help-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-subtitle` },
      h('section.help-dialog',
        h('header.help-header',
          h('div', h('p.help-eyebrow', 'CIELI APERTI · MANUALE DI BORDO'), h('h1', { id: `${id}-title` }, 'Aiuto al volo'),
            h('p.help-subtitle', { id: `${id}-subtitle` }, 'Dai primi comandi agli strumenti: trova quello che ti serve per continuare a volare.')),
          this.closeButton),
        tabList, this.searchBar, this.content,
        h('footer.help-footer', h('span', h('kbd', 'F12'), ' apre e chiude l’aiuto'), h('span', h('kbd', 'Esc'), ' chiude · ', h('kbd', 'Tab'), ' sposta il focus'))));
    root.appendChild(this.el);
    this._key = (e) => {
      if (this.destroyed) return;
      if (e.code === 'Escape' || e.code === 'F12') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) this.requestClose();
        return;
      }
      if (e.code === 'Tab') this.trapFocus(e);
    };
    this._focus = (e) => {
      if (!this.destroyed && !this.el.contains(e.target)) this.closeButton.focus();
    };
    // Stop bubbling only after target controls have handled their own keys.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('keyup', (e) => e.stopPropagation());
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation());
    window.addEventListener('keydown', this._key, true);
    document.addEventListener('focusin', this._focus);
    this.setTab('quick');
    this._focusFrame = requestAnimationFrame(() => { if (!this.destroyed) this.closeButton.focus(); });
  }

  setTab(id, focus = false) {
    if (!this.tabs.has(id)) return;
    this.tab = id;
    for (const [key, el] of this.tabs) {
      el.setAttribute('aria-selected', String(key === id));
      el.tabIndex = key === id ? 0 : -1;
    }
    this.content.setAttribute('aria-labelledby', this.tabs.get(id).id);
    this.searchBar.hidden = id === 'quick';
    this.render();
    this.content.scrollTop = 0;
    if (focus) this.tabs.get(id).focus();
  }

  tabKey(e, id) {
    const index = TABS.findIndex((tab) => tab.id === id);
    let next = index;
    if (e.code === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.code === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (e.code === 'Home') next = 0;
    else if (e.code === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    this.setTab(TABS[next].id, true);
  }

  render() {
    clear(this.content);
    if (this.tab === 'quick') return this.renderQuick();
    if (this.tab === 'commands') return this.renderCommands();
    const entries = GLOSSARY.filter((entry) => matches(this.query, entry.term, entry.group, entry.description));
    this.resultStatus.textContent = `${entries.length} ${entries.length === 1 ? 'voce' : 'voci'}`;
    this.content.appendChild(h('p.help-section-intro', 'Le sigle del cockpit, spiegate con esempi utili durante il volo. Velocità in nodi (kt), quote in piedi (ft), distanze in miglia nautiche (NM).'));
    const grid = h('dl.help-glossary');
    for (const entry of entries) grid.appendChild(h('div.help-term', h('dt', entry.term, h('span.help-category', entry.group)), h('dd', entry.description)));
    this.content.appendChild(entries.length ? grid : this.emptyState());
  }

  renderQuick() {
    this.content.appendChild(h('div.help-start-note', h('b', 'Un buon primo volo'),
      h('p', 'Scegli Volo libero → Falco T-172 → In pista → Sereno. Parti con i motori già accesi. Usa correzioni piccole e lascia al velivolo il tempo di reagire.'),
      h('p', 'Consulta questa guida con F12 quando vuoi. La pausa di prima dell’apertura viene ripristinata quando chiudi l’aiuto.')));
    const cards = h('div.help-quick-grid');
    for (const guide of QUICK_GUIDE) cards.appendChild(h('section.help-guide-card', h('h2', guide.title), h('ol', guide.steps.map((step) => h('li', step)))));
    this.content.appendChild(cards);
    this.content.appendChild(h('div.help-next-links',
      button('Trova un comando', () => { this.setTab('commands'); this.search.focus(); }),
      button('Capisci una sigla', () => { this.setTab('glossary'); this.search.focus(); })));
  }

  renderCommands() {
    const entries = this.commands.filter((entry) => matches(this.query, entry.group, entry.label, entry.description, ...(entry.keys || [])));
    const controls = this.cockpit.filter((entry) => matches(this.query, entry.group, entry.label, entry.description));
    const count = entries.length + controls.length;
    this.resultStatus.textContent = `${count} ${count === 1 ? 'comando' : 'comandi'}`;
    this.content.appendChild(h('p.help-section-intro', 'I tasti indicati sono quelli attivi nel simulatore. Tieni premuti i comandi di volo; premi una volta per interruttori e funzioni. Le combinazioni con + si premono insieme.'));
    const groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
    const grid = h('div.help-command-grid');
    for (const [name, rows] of groups) {
      const list = h('dl.help-command-list');
      for (const entry of rows) list.appendChild(h('div.help-command-row',
        h('dt', entry.label, entry.description ? h('p.help-command-description', entry.description) : null),
        h('dd', (entry.keys || []).map((key) => h('kbd', key)))));
      grid.appendChild(h('section.help-command-group', h('h2', name), list));
    }
    if (entries.length) this.content.appendChild(grid);
    if (controls.length) {
      this.content.appendChild(h('h2.help-cockpit-heading', 'Comandi nel cockpit'));
      this.content.appendChild(h('p.help-section-intro', 'Puoi azionare direttamente il pannello. Queste spiegazioni descrivono la funzione di ogni controllo, anche quando non ha una scorciatoia da tastiera.'));
      const list = h('div.help-cockpit-grid');
      for (const entry of controls) list.appendChild(h('section.help-cockpit-item', h('span.help-category', entry.group), h('h3', entry.label), h('p', entry.description)));
      this.content.appendChild(list);
    }
    if (!count) this.content.appendChild(this.emptyState());
  }

  emptyState() {
    return h('div.help-empty', h('h2', 'Nessun risultato'), h('p', 'Prova una parola più breve, una sigla come “ILS”, oppure un tasto come “F4”. La ricerca resta la stessa quando cambi sezione.'),
      button('Cancella ricerca', () => { this.search.value = ''; this.query = ''; this.render(); this.search.focus(); }));
  }

  trapFocus(e) {
    const controls = [...this.el.querySelectorAll('button, input, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1), current = document.activeElement;
    if (e.shiftKey && (current === first || !this.el.contains(current))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (current === last || !this.el.contains(current))) { e.preventDefault(); first.focus(); }
  }

  requestClose() {
    if (this.destroyed || this._closing) return;
    this._closing = true;
    this.onClose?.();
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this._focusFrame);
    window.removeEventListener('keydown', this._key, true);
    document.removeEventListener('focusin', this._focus);
    this.el.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
