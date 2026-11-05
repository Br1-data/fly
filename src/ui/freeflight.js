// Free flight setup: vehicle, starting point (orbit, station, surface sites, Moon, Mars) and date.
import { h, button, segmented, select, slider, clear, checkbox } from './dom.js';
import { SHIPS, getShip } from '../sim/ships.js';

const ICON = { pod: '🛰', capsule: '🚀', translunar: '🌙', lander: '🕷', spaceplane: '🛩', rocket: '🚀', ntr: '☢' };

/** Starting points: [id, label, description, applicable ships, start options]. */
export const STARTS = [
  { id: 'station', label: 'Vicino alla Stazione Aurora', desc: 'A 150 m dalla porta di prua, a 410 km di quota', ships: ['pod', 'capsule', 'translunar', 'spaceplane', 'ntr', 'lander'], start: { type: 'near', object: 'aurora', port: 'prua', distance: 150 }, target: { id: 'aurora', port: 'prua' } },
  { id: 'leo', label: 'Orbita terrestre bassa', desc: 'Orbita circolare di 400 km, inclinazione 6°', ships: ['pod', 'capsule', 'translunar', 'spaceplane', 'ntr', 'lander'], start: { type: 'orbit', body: 'earth', altitude: 400e3, inclination: 6 } },
  { id: 'malindi', label: 'Rampa di Malindi', desc: 'Centro Spaziale Luigi Broglio, Kenya', ships: ['rocket'], start: { type: 'surface', site: 'malindi' } },
  { id: 'grottaglie', label: 'Avvicinamento a Grottaglie', desc: '9 km di quota, 30 km dalla pista 17', ships: ['spaceplane'], start: { type: 'approach', site: 'grottaglie', altitude: 9000, north: 30000, east: -4000, heading: 172, pitch: -6, vel: [10, -205, -12] }, legs: false },
  { id: 'runway', label: 'Pista di Grottaglie', desc: 'Fermo in testata pista 17', ships: ['spaceplane'], start: { type: 'surface', site: 'grottaglie', runway: true } },
  { id: 'debris', label: 'Campo di detriti', desc: 'Kessler-7, 780 km di quota', ships: ['pod', 'capsule'], start: { type: 'offset', object: 'detriti', lvlh: [-900, 0, 0] }, target: 'detriti' },
  { id: 'moon-orbit', label: 'Orbita lunare', desc: '100 km sopra la Luna, vicino alla navetta Selene', ships: ['lander', 'capsule', 'pod', 'ntr'], start: { type: 'orbit', body: 'moon', altitude: 100e3, inclination: 2, argLat: -0.02 }, target: 'selene' },
  { id: 'moon-hover', label: 'Sopra la Base Tranquillitatis', desc: '500 m sopra il Mare della Tranquillità', ships: ['lander'], start: { type: 'hover', site: 'tranquillitatis', altitude: 500 } },
  { id: 'moon-base', label: 'Base Tranquillitatis', desc: 'Posato sulla piazzola, a 1,9 km dall’Apollo 11', ships: ['lander'], start: { type: 'surface', site: 'tranquillitatis', pad: 0 } },
  { id: 'translunar', label: 'Parcheggio per la Luna', desc: 'Orbita di 300 km con la Luna come bersaglio', ships: ['translunar', 'ntr', 'capsule'], start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 28 }, target: 'moon' },
  { id: 'mars-departure', label: 'Partenza per Marte', desc: 'Finestra del 2033, orbita orientata verso Marte', ships: ['ntr'], start: { type: 'orbit', body: 'earth', altitude: 400e3, departureTo: 'mars' }, target: 'mars', date: '2033-02-01T00:00:00Z' },
  { id: 'mars-orbit', label: 'Orbita marziana', desc: '500 km sopra Marte, Phobos come bersaglio', ships: ['ntr', 'capsule', 'pod', 'lander'], start: { type: 'orbit', body: 'mars', altitude: 500e3, inclination: 3 }, target: 'phobos', date: '2033-11-01T00:00:00Z' },
];

export class FreeFlightScreen {
  constructor(app, { back, start }) {
    this.app = app;
    const last = app.settings.lastFree || {};
    this.state = { ship: last.ship || 'capsule', startId: last.startId || 'station', date: last.date || '2031-05-20', hour: last.hour ?? 8, fuel: last.fuel ?? 1 };
    this.shipCol = h('div.ff-col');
    this.startCol = h('div.ff-col');
    this.summary = h('div.ff-summary');
    this.el = h('div.screen.freeflight', h('div.panel.full',
      h('header.panel-head', button('← Menu', back, 'ghost'), h('h1', 'Volo libero'), h('div.spacer'), button('Parti! 🚀', () => start(this.buildOptions()), 'primary big')),
      h('div.ff-grid.two', this.shipCol, this.startCol), this.summary));
    this.render();
  }

  starts() {
    return STARTS.filter((s) => s.ships.includes(this.state.ship));
  }

  render() {
    const st = this.state;
    const col = clear(this.shipCol);
    col.appendChild(h('h2', `Veicolo · ${SHIPS.length}`));
    for (const def of SHIPS) {
      col.appendChild(h('button.ac-card' + (def.id === st.ship ? '.active' : ''), { type: 'button', onclick: () => {
        st.ship = def.id;
        if (!this.starts().some((s) => s.id === st.startId)) st.startId = this.starts()[0].id;
        this.render();
      } }, h('div.ac-icon', ICON[def.id] || '🚀'), h('div.ac-info', h('b', def.name), h('small', def.category),
        def.id === st.ship ? h('p', def.description) : null, def.id === st.ship ? h('ul.specs', def.specs.map((s) => h('li', s))) : null)));
    }
    const sc = clear(this.startCol);
    sc.appendChild(h('h2', 'Partenza'));
    for (const s of this.starts()) {
      sc.appendChild(h('button.ac-card.small' + (s.id === st.startId ? '.active' : ''), { type: 'button', onclick: () => {
        st.startId = s.id;
        this.render();
      } }, h('div.ac-info', h('b', s.label), h('small', s.desc))));
    }
    const chosen = STARTS.find((s) => s.id === st.startId);
    if (!chosen?.date) {
      const date = h('input', { type: 'date', value: st.date, min: '2000-01-01', max: '2050-12-31' });
      date.addEventListener('change', () => { st.date = date.value || st.date; this.updateSummary(); });
      sc.appendChild(h('label.field', h('span.field-label', 'Data (UTC)'), date));
      sc.appendChild(slider({ label: 'Ora (UTC)', min: 0, max: 23.75, step: 0.25, value: st.hour, format: (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, onInput: (v) => { st.hour = v; this.updateSummary(); } }));
    } else sc.appendChild(h('p.muted', `Data della finestra: ${chosen.date.slice(0, 10)}`));
    sc.appendChild(slider({ label: 'Propellente', min: 0.1, max: 1, step: 0.05, value: st.fuel, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => { st.fuel = v; this.updateSummary(); } }));
    this.updateSummary();
  }

  updateSummary() {
    const st = this.state;
    const s = STARTS.find((x) => x.id === st.startId);
    clear(this.summary).appendChild(h('div.summary-line', h('span.tag', getShip(st.ship).name), h('span.tag', s?.label || ''), h('span.tag', s?.date ? s.date.slice(0, 10) : `${st.date} ${String(Math.floor(st.hour)).padStart(2, '0')}:${String(Math.round((st.hour % 1) * 60)).padStart(2, '0')} UTC`)));
  }

  buildOptions() {
    const st = this.state;
    const s = STARTS.find((x) => x.id === st.startId) || STARTS[0];
    this.app.settings.lastFree = { ...st };
    const hh = Math.floor(st.hour), mm = Math.round((st.hour % 1) * 60);
    const date = s.date || `${st.date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`;
    return { ship: st.ship, start: { ...s.start }, target: s.target, date, fuel: st.fuel, legs: s.legs };
  }
}
