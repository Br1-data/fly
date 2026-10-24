// Main menu and credits.
import { h, button } from './dom.js';

export class MainMenu {
  constructor(app, actions) {
    const item = (icon, label, sub, fn, cls = '') =>
      fn
        ? h('button.menu-item' + (cls ? '.' + cls : ''), { type: 'button', onclick: fn }, h('span.menu-icon', icon), h('span.menu-text', h('b', label), h('small', sub)))
        : null;
    this.el = h(
      'div.screen.main-menu',
      h(
        'div.menu-panel',
        h('div.brand.big', h('span.brand-mark', '✈'), h('span.brand-name', 'CIELI APERTI'), h('span.brand-sub', 'Flight Simulator')),
        h(
          'nav.menu-list',
          item('🛫', 'Volo libero', 'Scegli aereo, aeroporto, orario e meteo', actions.freeflight, 'primary'),
          item('🎯', 'Missioni', '13 missioni con briefing e punteggio', actions.missions),
          item('🕹', 'Comandi', 'Tastiera, joystick e gamepad', actions.controls),
          item('⚙', 'Impostazioni', 'Grafica, audio e realismo', actions.settings),
          item('ℹ', 'Riconoscimenti', 'Informazioni sul simulatore', actions.credits),
          item('⏻', 'Esci', 'Chiudi il simulatore', actions.quit),
        ),
        h('div.menu-footer', 'v1.0 · Regione Aquilana · 6 aeroporti · 3 velivoli'),
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
          h('p', h('b', 'Cieli Aperti Flight Simulator'), ' è un simulatore di volo realistico per Windows.'),
          h('h3', 'Simulazione'),
          h(
            'ul',
            h('li', 'Modello di volo a 6 gradi di libertà con aerodinamica a componenti (pannelli alari, piani di coda, fusoliera).'),
            h('li', 'Atmosfera standard ICAO con QNH e temperatura variabili, vento, raffiche, turbolenza e ghiaccio.'),
            h('li', 'Motori a pistoni con elica a passo fisso, turbofan e turbogetto con avviamento realistico.'),
            h('li', 'Impianti di bordo, autopilota con autoland, radionavigazione VOR/DME/ILS/NDB/GPS.'),
          ),
          h('h3', 'Mondo'),
          h('p', 'La Regione Aquilana, i suoi aeroporti e le sue città sono immaginari e generati proceduralmente. I velivoli sono di fantasia: le loro prestazioni si ispirano ad aeromobili reali della stessa categoria.'),
          h('h3', 'Tecnologia'),
          h('p', 'JavaScript, WebGL (three.js), Web Audio, Electron. Tutti i suoni e le texture sono generati dal programma.'),
          h('p.muted', 'Licenza MIT.'),
        ),
      ),
    );
  }
}
