// Main menu and credits.
import { h, button } from './dom.js';

export class MainMenu {
  constructor(app, actions) {
    const item = (icon, label, sub, fn, cls = '') =>
      fn ? h('button.menu-item' + (cls ? '.' + cls : ''), { type: 'button', onclick: fn }, h('span.menu-icon', icon), h('span.menu-text', h('b', label), h('small', sub))) : null;
    const n = app.deps.MISSIONS?.length || 0;
    this.el = h(
      'div.screen.main-menu',
      h(
        'div.menu-panel',
        h('div.brand.big', h('span.brand-mark', '🚀'), h('span.brand-name', 'CIELI APERTI'), h('span.brand-sub', 'Space Edition')),
        h(
          'nav.menu-list',
          item('🛰', 'Volo libero', 'Veicolo, punto di partenza e data: Terra, Luna, Marte', actions.freeflight, 'primary'),
          item('🎯', 'Missioni', `${n} missioni: attracco, lancio, rientro, Luna e Marte`, actions.missions),
          item('🕹', 'Comandi', 'Tastiera, gamepad, joystick e touch', actions.controls),
          item('?', 'Aiuto e glossario', 'Guida al volo spaziale e termini · F12', actions.help),
          item('⚙', 'Impostazioni', 'Grafica, audio e realismo', actions.settings),
          item('ℹ', 'Riconoscimenti', 'Dati planetari e informazioni', actions.credits),
          item('⏻', 'Esci', 'Chiudi il simulatore', actions.quit),
        ),
        h('div.menu-footer', 'v2.0 Space Edition · Sistema Solare reale · fisica newtoniana a coniche raccordate'),
      ),
    );
  }
}

export class CreditsScreen {
  constructor(back) {
    this.el = h(
      'div.screen.credits',
      h(
        'div.panel.wide',
        h('header.panel-head', button('← Indietro', back, 'ghost'), h('h1', 'Riconoscimenti')),
        h(
          'div.panel-body.prose',
          h('p', h('b', 'Cieli Aperti – Space Edition'), ' è un simulatore di volo spaziale con le leggi della fisica reali: dinamica newtoniana del corpo rigido a sei gradi di libertà, gravità dei corpi del Sistema Solare a coniche raccordate, equazione del razzo, atmosfere standard, riscaldamento di Sutton-Graves al rientro.'),
          h('h3', 'Sistema Solare'),
          h('ul',
            h('li', 'Posizioni dei pianeti dagli elementi orbitali medi J2000 del JPL (“Keplerian Elements for Approximate Positions of the Major Planets”), orientamenti dai modelli di rotazione IAU.'),
            h('li', 'Terra: immagine NASA Blue Marble Next Generation e rilievi ricavati dalla carta NOAA ETOPO1 (dominio pubblico), distribuite con il pacchetto basemap-data.'),
            h('li', 'Luna, Marte, Venere, Giove, Saturno, Nettuno: mappe NASA dalla raccolta NASA-3D-Resources (“free and without copyright”). Il lato nascosto della Luna e i rilievi di Luna e Marte sono ricostruiti dai bacini e dai crateri reali.'),
            h('li', 'Atmosfera terrestre: US Standard Atmosphere 1976.')),
          h('h3', 'Luoghi reali'),
          h('p', 'Centro Spaziale Luigi Broglio (Malindi, Kenya), spazioporto di Taranto-Grottaglie, Mare della Tranquillità (Apollo 11), cratere Jezero su Marte. La Stazione Aurora, la navetta Selene, i veicoli e il campo di detriti sono immaginari; le loro prestazioni seguono veicoli reali della stessa classe.'),
          h('h3', 'Tecnologia'),
          h('p', 'JavaScript, WebGL 2 (three.js), Web Audio, sintesi vocale del browser, Electron. Suoni, modelli 3D e texture dei veicoli sono generati dal programma.'),
          h('p.muted', 'Licenza MIT per il codice. Le mappe planetarie NASA e NOAA sono di dominio pubblico.'),
        ),
      ),
    );
  }
}
