// Loading screen with progress bar.
import { h } from './dom.js';

const TIPS = [
  'Nello spazio non c’è attrito: ogni impulso dura finché non lo annulli con un impulso opposto.',
  'Per raggiungere un oggetto davanti a te in orbita, frena: un’orbita più bassa è più veloce.',
  'Accendi prograde all’apoasse per alzare il periasse, e viceversa.',
  'Il tasto F annulla la velocità relativa al bersaglio con i propulsori RCS.',
  'Il computer di navigazione (O) calcola trasferimenti, rendezvous e rientri.',
  'Lancia verso est: la rotazione terrestre regala fino a 465 m/s all’equatore.',
  'Prima del rientro sgancia il modulo di servizio e tieni lo scudo termico in avanti (retrograde).',
  'Sulla Luna non c’è aria: niente paracadute, solo il motore e le gambe ammortizzate.',
  'Il warp temporale si ferma da solo prima di una manovra, di un incontro o dell’atmosfera.',
  'Un trasferimento verso Marte conviene solo ogni 26 mesi: è la finestra di lancio.',
  'Con V il modulo lunare mantiene la velocità verticale: manetta al centro = volo stazionario.',
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
      h('div.loading-inner', h('div.brand', h('span.brand-mark', '🚀'), h('span.brand-name', 'CIELI APERTI'), h('span.brand-sub', 'Space Edition')), this.title, h('div.loading-bar', this.bar), this.label, this.tip),
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
