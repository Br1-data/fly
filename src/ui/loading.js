// Loading screen with progress bar.
import { h } from './dom.js';

const TIPS = [
  'Regola sempre l\'altimetro sul QNH (tasto B): con la pressione sbagliata l\'altimetro mente.',
  'Prima del decollo controlla flap, trim e freno di parcheggio: Ctrl + . lo rilascia.',
  'In avvicinamento mantieni la velocità di riferimento: troppo lenti si stalla, troppo veloci si "galleggia".',
  'Le luci PAPI: due bianche e due rosse significano sentiero di discesa corretto.',
  'In salita con molta potenza serve pedale destro per contrastare la coppia dell\'elica.',
  'Sopra gli 8.000 ft smagrisci la miscela (Ctrl+Shift+F2) per recuperare potenza.',
  'Con temperature tra -10 e +25 °C e aria umida usa il riscaldamento carburatore (Shift+H).',
  'Sintonizza la frequenza ATIS sulla COM1 per ascoltare vento, visibilità e QNH dell\'aeroporto.',
  'Con l\'autopilota in modo APR l\'aereo intercetta da solo localizzatore e sentiero di discesa.',
  'Premi K per la checklist del velivolo: gli elementi si spuntano da soli quando li esegui.',
  'Premi M per la mappa: clicca un aeroporto per impostare il GPS "diretto a".',
];

export class LoadingScreen {
  constructor(root) {
    this.root = root;
    this.bar = h('div.loading-bar-fill');
    this.label = h('div.loading-label', '');
    this.title = h('div.loading-title', '');
    this.tip = h('div.loading-tip', '');
    this.el = h(
      'div.loading-screen',
      h('div.loading-inner', h('div.brand', h('span.brand-mark', '✈'), h('span.brand-name', 'CIELI APERTI'), h('span.brand-sub', 'Flight Simulator')), this.title, h('div.loading-bar', this.bar), this.label, this.tip),
    );
  }
  show(title) {
    this.title.textContent = title || '';
    this.tip.textContent = 'Suggerimento: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
    this.progress(0, '');
    if (!this.el.parentNode) this.root.appendChild(this.el);
    this.el.classList.add('visible');
  }
  progress(f, label) {
    this.bar.style.width = `${Math.round(Math.min(Math.max(f, 0), 1) * 100)}%`;
    if (label !== undefined) this.label.textContent = label;
  }
  hide() {
    this.el.classList.remove('visible');
    setTimeout(() => {
      if (!this.el.classList.contains('visible')) this.el.remove();
    }, 400);
  }
}
