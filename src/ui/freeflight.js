// Free flight setup: aircraft, departure, time of day, weather, fuel.
import { h, button, segmented, slider, checkbox, select, hourStr, clear } from './dom.js';
import { AIRCRAFT_LIST, getAircraft } from '../sim/aircraft/index.js';
import { WEATHER_PRESETS, cloneWeather } from '../sim/atmosphere.js';
import { AIRPORTS, airportLayouts, runwayGeometry, findAirport } from '../world/world-data.js';
import { DEG } from '../core/math.js';

const START_TYPES = [
  { value: 'runway', label: 'In pista' },
  { value: 'parking', label: 'Parcheggio' },
  { value: 'air', label: 'In volo' },
  { value: 'final', label: 'Finale' },
];

const AIRCRAFT_ICON = { trainer: '🛩', airliner: '✈', jet: '🛦' };

export class FreeFlightScreen {
  constructor(app, { back, start }) {
    this.app = app;
    const last = app.settings.lastFlight;
    this.state = {
      aircraft: last?.aircraft || 'trainer',
      airport: last?.start?.airport || 'XAQU',
      startType: last?.start?.type || 'runway',
      runway: last?.start?.runway || null,
      parking: last?.start?.parking || 0,
      time: last?.time ?? 10,
      weatherKey: last?._weatherKey || 'sereno',
      weather: last?.weather ? cloneWeather(last.weather) : cloneWeather(WEATHER_PRESETS.sereno),
      fuel: last?.fuel ?? 0.8,
      coldDark: !!last?.coldDark,
      destination: last?._destination || '',
    };
    if (!WEATHER_PRESETS[this.state.weatherKey] && this.state.weatherKey !== 'custom') this.state.weatherKey = 'sereno';

    this.acCol = h('div.ff-col');
    this.depCol = h('div.ff-col');
    this.condCol = h('div.ff-col');
    this.summary = h('div.ff-summary');
    this.el = h(
      'div.screen.freeflight',
      h(
        'div.panel.full',
        h('header.panel-head', button('← Menu', back, 'ghost'), h('h1', 'Volo libero'), h('div.spacer'), button('Vola! ✈', () => start(this.buildOptions()), 'primary big')),
        h('div.ff-grid', this.acCol, this.depCol, this.condCol),
        this.summary,
      ),
    );
    this.renderAircraft();
    this.renderDeparture();
    this.renderConditions();
    this.updateSummary();
  }

  renderAircraft() {
    const col = clear(this.acCol);
    col.appendChild(h('h2', 'Velivolo'));
    for (const def of AIRCRAFT_LIST) {
      const card = h(
        'button.ac-card' + (def.id === this.state.aircraft ? '.active' : ''),
        { type: 'button', onclick: () => {
          this.state.aircraft = def.id;
          this.renderAircraft();
          this.renderDeparture();
          this.updateSummary();
        } },
        h('div.ac-icon', AIRCRAFT_ICON[def.id] || '✈'),
        h('div.ac-info', h('b', def.name), h('small', def.category), def.id === this.state.aircraft ? h('p', def.description) : null, def.id === this.state.aircraft ? h('ul.specs', def.specs.map((s) => h('li', s))) : null),
      );
      col.appendChild(card);
    }
  }

  renderDeparture() {
    const st = this.state;
    const col = clear(this.depCol);
    col.appendChild(h('h2', 'Partenza'));
    const def = getAircraft(st.aircraft);
    col.appendChild(
      select({
        label: 'Aeroporto',
        options: AIRPORTS.map((a) => ({ value: a.icao, label: `${a.icao} — ${a.name} (${Math.round(a.elev / 0.3048)} ft)` })),
        value: st.airport,
        onChange: (v) => {
          st.airport = v;
          st.runway = null;
          st.parking = 0;
          this.renderDeparture();
          this.updateSummary();
        },
      }),
    );
    const ap = findAirport(st.airport);
    const rw = ap.runways[0];
    const shortField = rw.length < 1500 && def.id === 'airliner';
    if (shortField) col.appendChild(h('div.warn-note', `⚠ Pista di ${rw.length} m: troppo corta per l'${def.name}.`));
    col.appendChild(h('div.field', h('span.field-label', 'Posizione iniziale'), segmented(START_TYPES, st.startType, (v) => {
      st.startType = v;
      this.renderDeparture();
      this.updateSummary();
    })));
    const ends = runwayGeometry(ap, rw).ends;
    if (!st.runway || !ends.some((e) => e.ident === st.runway)) st.runway = this.windRunway(ap);
    if (st.startType === 'runway' || st.startType === 'final') {
      col.appendChild(
        h('div.field', h('span.field-label', 'Pista'), segmented(ends.map((e) => ({ value: e.ident, label: `${e.ident}${e.ils ? ' ILS' : ''}` })), st.runway, (v) => {
          st.runway = v;
          this.updateSummary();
        })),
      );
    }
    if (st.startType === 'parking') {
      const L = airportLayouts().find((l) => l.airport.icao === ap.icao);
      col.appendChild(select({ label: 'Piazzola', options: L.parking.map((p, i) => ({ value: String(i), label: p.name })), value: String(st.parking), onChange: (v) => (st.parking = Number(v)) }));
    }
    const rwInfo = h(
      'div.airport-info',
      h('div', h('b', ap.name), ` · ${ap.city}`),
      h('div', `Pista ${rw.id} · ${rw.length} × ${rw.width} m · ${rw.surface === 'grass' ? 'erba' : 'asfalto'}`),
      h('div', `Elevazione ${Math.round(ap.elev / 0.3048)} ft · TWR ${ap.tower.toFixed(2)}${ap.atis ? ` · ATIS ${ap.atis.toFixed(2)}` : ''}`),
      h('div', rw.ends.filter((e) => e.ils).map((e) => `ILS ${e.ident} ${e.ils.freq.toFixed(2)} (${e.ils.ident})`).join(' · ') || 'Nessun ILS: avvicinamento a vista'),
    );
    col.appendChild(rwInfo);
    col.appendChild(
      select({
        label: 'Destinazione GPS (facoltativa)',
        options: [{ value: '', label: '— nessuna —' }, ...AIRPORTS.filter((a) => a.icao !== st.airport).map((a) => ({ value: a.icao, label: `${a.icao} — ${a.name}` }))],
        value: st.destination,
        onChange: (v) => {
          st.destination = v;
          this.updateSummary();
        },
      }),
    );
    col.appendChild(
      checkbox({
        label: 'Cockpit spento (avviamento a freddo)',
        hint: 'Motori e impianti spenti: segui la checklist (K) o usa Ctrl+E',
        checked: st.coldDark,
        onChange: (v) => {
          st.coldDark = v;
          this.updateSummary();
        },
      }),
    );
  }

  windRunway(ap) {
    const w = this.state.weather;
    const rw = ap.runways[0];
    let best = rw.ends[0].ident,
      bestHead = -2;
    rw.ends.forEach((e, i) => {
      const hdg = i === 0 ? rw.heading : (rw.heading + 180) % 360;
      const head = Math.cos(((w.windDir || 0) - hdg) * DEG) * (w.windSpeedKt || 0);
      if (head > bestHead) {
        bestHead = head;
        best = e.ident;
      }
    });
    return best;
  }

  renderConditions() {
    const st = this.state;
    const col = clear(this.condCol);
    col.appendChild(h('h2', 'Condizioni'));
    col.appendChild(slider({ label: 'Ora del giorno', min: 0, max: 23.75, step: 0.25, value: st.time, format: (v) => `${hourStr(v)} ${v < 6 || v > 20.5 ? '🌙' : v < 8 || v > 18.5 ? '🌅' : '☀'}`, onInput: (v) => {
      st.time = v;
      this.updateSummary();
    } }));
    const presets = h('div.weather-presets');
    const icons = { sereno: '☀', poche_nubi: '🌤', nuvoloso: '☁', coperto_pioggia: '🌧', temporale: '⛈', nebbia: '🌫', invernale: '❄' };
    for (const [key, p] of Object.entries(WEATHER_PRESETS)) {
      presets.appendChild(
        h('button.wx' + (st.weatherKey === key ? '.active' : ''), { type: 'button', onclick: () => {
          st.weatherKey = key;
          st.weather = cloneWeather(p);
          this.renderConditions();
          this.renderDeparture();
          this.updateSummary();
        } }, h('span.wx-icon', icons[key] || '☁'), h('span', p.name)),
      );
    }
    presets.appendChild(h('button.wx' + (st.weatherKey === 'custom' ? '.active' : ''), { type: 'button', onclick: () => {
      st.weatherKey = 'custom';
      this.renderConditions();
    } }, h('span.wx-icon', '🛠'), h('span', 'Personalizzato')));
    col.appendChild(h('div.field', h('span.field-label', 'Meteo'), presets));

    const w = st.weather;
    const custom = h('div.custom-weather' + (st.weatherKey === 'custom' ? '.open' : ''));
    const mk = (o) => {
      const s = slider({ ...o, onInput: (v) => {
        o.set(v);
        st.weatherKey = 'custom';
        for (const b of presets.querySelectorAll('.wx')) b.classList.toggle('active', b === presets.lastChild);
        custom.classList.add('open');
        this.updateSummary();
      } });
      custom.appendChild(s);
    };
    w.clouds = w.clouds || [];
    if (!w.clouds.length) w.clouds.push({ baseFt: 4000, thickFt: 2500, coverage: 0, type: 'cumulus' });
    const c0 = w.clouds[0];
    mk({ label: 'Direzione del vento', min: 0, max: 355, step: 5, value: w.windDir, format: (v) => `${String(v).padStart(3, '0')}°`, set: (v) => (w.windDir = v) });
    mk({ label: 'Intensità del vento', min: 0, max: 45, step: 1, value: w.windSpeedKt, format: (v) => `${v} kt`, set: (v) => (w.windSpeedKt = v) });
    mk({ label: 'Raffiche', min: 0, max: 25, step: 1, value: w.gustKt || 0, format: (v) => (v ? `+${v} kt` : 'nessuna'), set: (v) => (w.gustKt = v) });
    mk({ label: 'Turbolenza', min: 0, max: 1, step: 0.05, value: w.turbulence || 0, format: (v) => (v < 0.1 ? 'assente' : v < 0.3 ? 'leggera' : v < 0.6 ? 'moderata' : 'forte'), set: (v) => (w.turbulence = v) });
    mk({ label: 'Visibilità', min: 0.3, max: 60, step: 0.1, value: w.visibilityKm, format: (v) => (v < 5 ? `${Math.round(v * 1000)} m` : `${Math.round(v)} km`), set: (v) => (w.visibilityKm = v) });
    mk({ label: 'Base delle nubi', min: 200, max: 12000, step: 100, value: c0.baseFt, format: (v) => `${v} ft`, set: (v) => (c0.baseFt = v) });
    mk({ label: 'Copertura nuvolosa', min: 0, max: 1, step: 0.05, value: c0.coverage, format: (v) => (v < 0.05 ? 'sereno' : v < 0.3 ? 'poche (FEW)' : v < 0.55 ? 'sparse (SCT)' : v < 0.9 ? 'molto nuvoloso (BKN)' : 'coperto (OVC)'), set: (v) => (c0.coverage = v) });
    custom.appendChild(
      h('div.field', h('span.field-label', 'Tipo di nubi'), segmented([
        { value: 'cumulus', label: 'Cumuli' },
        { value: 'stratus', label: 'Strati' },
      ], c0.type, (v) => {
        c0.type = v;
        st.weatherKey = 'custom';
      })),
    );
    mk({ label: 'Temperatura al livello del mare', min: -20, max: 40, step: 1, value: w.tempC, format: (v) => `${v} °C`, set: (v) => (w.tempC = v) });
    mk({ label: 'QNH', min: 960, max: 1050, step: 1, value: w.qnhHpa, format: (v) => `${v} hPa`, set: (v) => (w.qnhHpa = v) });
    mk({ label: 'Precipitazioni', min: 0, max: 1, step: 0.1, value: w.precipitation || 0, format: (v) => (v < 0.1 ? 'nessuna' : v < 0.5 ? 'deboli' : 'intense'), set: (v) => (w.precipitation = v) });
    col.appendChild(custom);
    col.appendChild(slider({ label: 'Carburante', min: 0.1, max: 1, step: 0.05, value: st.fuel, format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => {
      st.fuel = v;
      this.updateSummary();
    } }));
  }

  updateSummary() {
    const o = this.buildOptions();
    const def = getAircraft(o.aircraft);
    const ap = findAirport(o.start.airport);
    const w = o.weather;
    const fuelKg = def.fuel.capacity * o.fuel;
    const where = { runway: `pista ${o.start.runway}`, parking: 'parcheggio', air: `in volo a ${o.start.altitudeFt} ft`, final: `finale ${o.start.runway} a ${o.start.distanceNm} NM` }[o.start.type];
    clear(this.summary).appendChild(
      h('div.summary-line',
        h('span', `${def.name}`), h('span', `${ap.icao} ${where}`), h('span', `${hourStr(o.time)}`),
        h('span', `Vento ${String(Math.round(w.windDir)).padStart(3, '0')}° / ${Math.round(w.windSpeedKt)} kt`),
        h('span', `QNH ${Math.round(w.qnhHpa)}`), h('span', `Carburante ${Math.round(fuelKg)} kg`),
        o.coldDark ? h('span.tag', 'Cockpit spento') : null,
        o.route.length ? h('span.tag', `GPS → ${o.route[o.route.length - 1].id}`) : null),
    );
  }

  buildOptions() {
    const st = this.state;
    const def = getAircraft(st.aircraft);
    const ap = findAirport(st.airport);
    const rw = ap.runways[0];
    const g = runwayGeometry(ap, rw);
    const end = g.ends.find((e) => e.ident === st.runway) || g.ends[0];
    const start = { type: st.startType, airport: ap.icao, runway: end.ident, parking: st.parking };
    if (st.startType === 'air') {
      const alt = Math.round((ap.elev / 0.3048 + (def.id === 'airliner' ? 5000 : 3000)) / 100) * 100;
      const d = def.id === 'airliner' ? 22000 : 12000;
      start.n = end.thrN - end.dirN * d;
      start.e = end.thrE - end.dirE * d;
      start.heading = end.heading;
      start.altitudeFt = alt;
      start.speedKt = def.id === 'airliner' ? 250 : def.speeds.cruise;
      start.apAltFt = alt;
    } else if (st.startType === 'final') {
      start.distanceNm = def.id === 'airliner' ? 8 : 5;
    }
    const route = [];
    if (st.destination) {
      const dst = findAirport(st.destination);
      route.push({ id: ap.icao, n: ap.n, e: ap.e }, { id: dst.icao, n: dst.n, e: dst.e });
    }
    return {
      aircraft: st.aircraft,
      start,
      weather: cloneWeather(st.weather),
      time: st.time,
      fuel: st.fuel,
      coldDark: st.coldDark && st.startType !== 'air' && st.startType !== 'final',
      route,
      _weatherKey: st.weatherKey,
      _destination: st.destination,
    };
  }
}
