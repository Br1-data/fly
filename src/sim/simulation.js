// Simulation orchestrator: aircraft physics, atmosphere, radios, autopilot, instruments,
// cockpit commands and events. Runs at a fixed 240 Hz internal step.
import { clamp, DEG, RAD, wrap360, moveTowards } from '../core/math.js';
import { KT, FT, NM, FPM } from '../core/units.js';
import { FlightModel } from './flightmodel.js';
import { Atmosphere, WEATHER_PRESETS } from './atmosphere.js';
import { Autopilot } from './autopilot.js';
import { NavRadio, AdfRadio, Gps, markerAt, atisText, airportByAtis } from './navigation.js';
import { Instruments } from './instruments.js';
import { getAircraft } from './aircraft/index.js';
import { getTerrain } from '../world/terrain-height.js';
import { findAirport, findRunwayEnd, airportLayouts, runwayGeometry } from '../world/world-data.js';

export const STEP = 1 / 240;

export const DEFAULT_SETTINGS = {
  crashes: true,
  gyroDrift: true,
  autoRudder: false,
  unlimitedFuel: false,
  fbwNormalLaw: true,
  icing: true,
  carbIce: true,
};

export class Simulation {
  constructor() {
    this.terrain = getTerrain();
    this.atm = new Atmosphere(WEATHER_PRESETS.sereno);
    this.settings = { ...DEFAULT_SETTINGS };
    this.pilot = { pitch: 0, roll: 0, yaw: 0, throttle: 0, mixture: 1, brakeL: 0, brakeR: 0, reverse: false, trimRate: 0, rudTrimRate: 0, ailTrimRate: 0, throttleAxis: false };
    this.events = [];
    this.messages = [];
    this.acc = 0;
    this.paused = false;
    this.simRate = 1;
    this.timeOfDay = 10; // hours
    this.nav1 = new NavRadio(113.5, 110.3);
    this.nav2 = new NavRadio(115.2, 112.4);
    this.adf = new AdfRadio(385);
    this.gps = new Gps();
    this.com1 = { active: 127.25, standby: 118.7, atisAirport: null };
    this.xpdr = { code: 7000, mode: 'ALT' };
    this.instruments = new Instruments();
    this.athrThrottle = null;
    this._sequence = null;
    this.callouts = { last: 10000 };
  }

  // ---------------------------------------------------------------- setup
  /**
   * opts: { aircraft, start: {type, airport, runway, parking, distanceNm, altitudeFt, speedKt, heading, n, e},
   *         weather, time, fuel, coldDark, payload }
   */
  setup(opts) {
    this.opts = opts;
    const def = getAircraft(opts.aircraft);
    this.def = def;
    this.atm.setWeather(opts.weather || WEATHER_PRESETS.sereno);
    this.timeOfDay = opts.time ?? 10;
    this.fm = new FlightModel(def, this.terrain, this.atm);
    this.ap = new Autopilot(def);
    this.instruments = new Instruments();
    this.events.length = 0;
    this.messages.length = 0;
    this.callouts = { last: 10000 };
    const fm = this.fm;
    const s = opts.start || { type: 'runway', airport: 'XAQU', runway: '25' };
    const inAir = s.type === 'air' || s.type === 'final';
    const night = this.timeOfDay < 6.5 || this.timeOfDay > 19.5;
    const running = !opts.coldDark;
    const fuel = opts.fuel ?? def.fuel.defaultFraction ?? 0.8;
    const startFlaps = s.flaps ?? (s.type === 'final' ? def.controls.flapDetents.length - 1 : 0);
    fm.systems.reset(running, { inAir, night, fuel, flaps: startFlaps, gearDown: s.type === 'final' || s.gearDown });
    fm.systems.infiniteFuel = this.settings.unlimitedFuel;
    if (opts.payload !== undefined) def.mass.payload = opts.payload;
    fm.updateMass();
    for (const e of fm.engines) e.reset(running, this.atm.sample(0).T);
    if (fm.fcs) fm.fcs.mode = this.settings.fbwNormalLaw ? 'normal' : 'direct';
    this.engineMaster = fm.engines.map(() => running);
    fm.systems.engMaster = this.engineMaster;
    this.pilot.throttle = 0;
    this.pilot.mixture = running ? 1 : 0;
    if (def.engines[0].type === 'piston' && !running) {
      fm.engines[0].mixture = 0;
    }

    // ---- position ----
    let n = 0,
      e = 0,
      hdg = 0,
      alt = 0,
      speed = 0;
    const ap = findAirport(s.airport || 'XAQU');
    this.departure = ap;
    fm.kollsman = this.atm.qnh;
    if (s.type === 'runway' || s.type === 'final') {
      const end = findRunwayEnd(ap.icao, s.runway) || runwayGeometry(ap, ap.runways[0]).ends[0];
      this.runwayEnd = end;
      hdg = end.heading;
      if (s.type === 'runway') {
        const off = def.id === 'airliner' ? 70 : 35;
        n = end.thrN + end.dirN * off;
        e = end.thrE + end.dirE * off;
      } else {
        const d = (s.distanceNm ?? 5) * NM;
        n = end.thrN - end.dirN * d;
        e = end.thrE - end.dirE * d;
        alt = end.elev + d * Math.tan(3 * DEG) + 15 + (s.altitudeOffsetFt || 0) * FT;
        speed = (s.speedKt ?? def.speeds.vapp) * KT;
      }
    } else if (s.type === 'parking') {
      const L = airportLayouts().find((l) => l.airport.icao === ap.icao);
      const spot = L.parking[s.parking ?? 0] || L.parking[0];
      n = spot.n;
      e = spot.e;
      hdg = spot.heading;
    } else if (s.type === 'air') {
      n = s.n ?? ap.n;
      e = s.e ?? ap.e;
      hdg = s.heading ?? 0;
      alt = (s.altitudeFt ?? 3000) * FT;
      speed = (s.speedKt ?? def.speeds.cruise) * KT;
    }
    if (inAir) {
      fm.place({ n, e, alt, heading: hdg, speed });
      const gamma = s.type === 'final' ? -3 : 0;
      // air speed -> true airspeed (approx.)
      const tas = speed / Math.sqrt(this.atm.sample(alt).sigma);
      const r = fm.trimLevel(tas, gamma);
      this.pilot.throttle = r.throttle;
      for (const en of fm.engines) en.throttle = r.throttle;
      fm.place({ n, e, alt, heading: hdg, speed: tas });
      // keep the trimmed attitude
      fm.q.setFromEuler(0, (r.alpha + gamma) * DEG, hdg * DEG);
      fm.vel.set(Math.cos(hdg * DEG) * Math.cos(gamma * DEG) * tas, Math.sin(hdg * DEG) * Math.cos(gamma * DEG) * tas, -Math.sin(gamma * DEG) * tas);
      fm.input.elevTrim = r.trim;
      if (fm.fcs && def.controls.trimType === 'stab') fm.defl.stab = r.trim >= 0 ? r.trim * def.controls.stabUp * DEG : r.trim * def.controls.stabDown * DEG;
      fm.systems.parkingBrake = false;
      // add wind so the aircraft keeps its airspeed
      this.atm.windAt(1000, alt, fm.wind);
      fm.vel.add(fm.wind);
    } else {
      fm.input.elevTrim = def.id === 'trainer' ? 0.15 : def.id === 'jet' ? 0.25 : 0.35;
      fm.placeOnGround({ n, e, heading: hdg });
      fm.systems.parkingBrake = s.type === 'parking' || !running || s.parkingBrake === true;
    }
    this.instruments.reset(fm.heading);
    this.instruments.alt = fm.indicatedAlt / FT;
    this.instruments.asi = fm.iasKt;
    // ---- radios / autopilot defaults ----
    const ils = this.runwayEnd?.ils;
    if (ils) {
      this.nav1.active = ils.freq;
      this.nav1.obs = this.runwayEnd.heading;
    }
    this.ap.hdgBug = Math.round(fm.heading);
    this.ap.altSel = Math.round(((s.apAltFt ?? (inAir ? fm.altFt : ap.elev / FT + 3000)) / 100)) * 100;
    this.ap.spdSel = def.id === 'airliner' ? (inAir ? Math.round(speed / KT) : 250) : def.speeds.cruise;
    if (ap.atis) this.com1.active = ap.atis;
    this.gps.setPlan(opts.route || []);
    this.messages.length = 0;
    this.acc = 0;
    this.crashed = false;
    this.flightTime = 0;
    this.distanceFlown = 0;
    this.fuelStart = fm.systems.fuelTotal;
    this.landed = null;
    this.failures = (opts.failures || []).map((f) => ({ ...f, done: false }));
    this.timeSinceStart = 0;
    this.lastAtis = null;
    this.prevGearPos = fm.systems.gearPos;
    this.prevFlaps = fm.systems.flaps;
    this.updateRadios();
    return this;
  }

  message(text, kind = 'info', duration = 5) {
    this.messages.push({ text, kind, duration, t: performance.now() });
  }

  // ---------------------------------------------------------------- commands
  /** Execute a cockpit command (from keyboard, joystick buttons or clickable panel). */
  command(name, arg) {
    const fm = this.fm;
    if (!fm) return;
    const sys = fm.systems;
    const def = this.def;
    const ap = this.ap;
    const toggle = (v) => (arg === undefined ? !v : !!arg);
    switch (name) {
      case 'battery':
        sys.battery = toggle(sys.battery);
        break;
      case 'alternator':
        sys.alternator = toggle(sys.alternator);
        break;
      case 'master':
        sys.battery = toggle(sys.battery);
        sys.alternator = sys.battery;
        break;
      case 'avionics':
        sys.avionics = toggle(sys.avionics);
        break;
      case 'fuelPump':
        sys.fuelPump = toggle(sys.fuelPump);
        break;
      case 'light':
        sys.lights[arg.which] = arg.value === undefined ? !sys.lights[arg.which] : !!arg.value;
        break;
      case 'allLights': {
        const on = !(sys.lights.nav || sys.lights.beacon);
        for (const k of ['nav', 'beacon', 'strobe', 'landing', 'taxi', 'panel', 'logo']) sys.lights[k] = on;
        break;
      }
      case 'pitotHeat':
        sys.pitotHeat = toggle(sys.pitotHeat);
        break;
      case 'antiIce':
        sys.antiIce = toggle(sys.antiIce);
        break;
      case 'carbHeat':
        for (const e of fm.engines) if (e.type === 'piston') e.carbHeat = toggle(e.carbHeat);
        break;
      case 'magnetos': {
        const e = fm.engines[0];
        if (e.type !== 'piston') break;
        if (arg === 'inc') e.magnetos = Math.min(4, e.magnetos + 1);
        else if (arg === 'dec') e.magnetos = Math.max(0, e.magnetos - 1);
        else e.magnetos = clamp(arg | 0, 0, 4);
        break;
      }
      case 'magnetoRelease': {
        const e = fm.engines[0];
        if (e.type === 'piston' && e.magnetos === 4) e.magnetos = 3;
        break;
      }
      case 'mixture':
        this.pilot.mixture = clamp(arg, 0, 1);
        break;
      case 'mixtureStep':
        this.pilot.mixture = clamp(this.pilot.mixture + arg, 0, 1);
        break;
      case 'fuelSelector': {
        const opts = ['off', 'left', 'both', 'right'];
        if (arg === 'next') sys.fuelSelector = opts[(opts.indexOf(sys.fuelSelector) + 1) % opts.length];
        else sys.fuelSelector = arg;
        break;
      }
      case 'parkingBrake':
        sys.parkingBrake = toggle(sys.parkingBrake);
        this.message(sys.parkingBrake ? 'Freno di parcheggio inserito' : 'Freno di parcheggio rilasciato', 'info', 2);
        break;
      case 'flaps': {
        const n = def.controls.flapDetents.length - 1;
        if (arg === 'inc') sys.flapsLever = Math.min(n, sys.flapsLever + 1);
        else if (arg === 'dec') sys.flapsLever = Math.max(0, sys.flapsLever - 1);
        else if (arg === 'full') sys.flapsLever = n;
        else if (arg === 'up') sys.flapsLever = 0;
        else sys.flapsLever = clamp(arg | 0, 0, n);
        this.message(`Flap: ${def.controls.flapDetents[sys.flapsLever].name}`, 'info', 1.5);
        break;
      }
      case 'gear':
        if (!def.controls.retractableGear) {
          this.message('Carrello fisso', 'info', 1.5);
          break;
        }
        if (arg === 'up') sys.gearLever = 0;
        else if (arg === 'down') sys.gearLever = 1;
        else sys.gearLever = sys.gearLever ? 0 : 1;
        if (fm.onGround && sys.gearLever === 0) {
          sys.gearLever = 1;
          this.message('Carrello: retrazione inibita a terra', 'warn', 2);
        } else this.message(sys.gearLever ? 'Carrello: GIÙ' : 'Carrello: SU', 'info', 1.5);
        break;
      case 'spoilers':
        if (!def.controls.spoilers) break;
        if (arg === 'arm') {
          sys.spoilersArmed = !sys.spoilersArmed;
          sys.spoilerLever = 0;
          this.message(sys.spoilersArmed ? 'Spoiler armati' : 'Spoiler disarmati', 'info', 1.5);
        } else if (typeof arg === 'number') sys.spoilerLever = clamp(arg, 0, 1);
        else {
          sys.spoilerLever = sys.spoilerLever > 0.1 ? 0 : def.id === 'airliner' ? 0.5 : 1;
          sys.spoilersArmed = false;
          this.message(sys.spoilerLever > 0 ? 'Aerofreni estesi' : 'Aerofreni retratti', 'info', 1.5);
        }
        break;
      case 'autobrake':
        if (!def.controls.autobrake) break;
        sys.autobrake = arg === 'next' ? (sys.autobrake + 1) % 4 : clamp(arg | 0, 0, 3);
        this.message(`Autobrake: ${['OFF', 'LO', 'MED', 'MAX'][sys.autobrake]}`, 'info', 1.5);
        break;
      case 'apuMaster':
        sys.apuMaster = toggle(sys.apuMaster);
        break;
      case 'apuBleed':
        sys.apuBleed = toggle(sys.apuBleed);
        break;
      case 'engineMaster': {
        const i = arg.index ?? 0;
        this.engineMaster[i] = arg.value === undefined ? !this.engineMaster[i] : !!arg.value;
        break;
      }
      case 'engineStartSel':
        sys.engineStartSel = arg === undefined ? (sys.engineStartSel === 'ign' ? 'norm' : 'ign') : arg;
        break;
      case 'starter':
        this._starterTimer = 25;
        break;
      case 'smoke':
        if (def.controls.smoke) {
          sys.smoke = toggle(sys.smoke);
          this.message(sys.smoke ? 'Fumogeni ON' : 'Fumogeni OFF', 'info', 1.5);
        }
        break;
      case 'autostart':
        this.autostart();
        break;
      case 'shutdown':
        this.shutdown();
        break;
      case 'kollsman':
        if (arg === 'std') fm.kollsman = 101325;
        else if (arg === 'local') fm.kollsman = this.atm.qnh;
        else fm.kollsman = clamp(fm.kollsman + arg * 100, 94000, 105000);
        break;
      case 'dgSync':
        this.instruments.syncDG(this.instruments.compass);
        break;
      case 'dgAdjust':
        this.instruments.dg = wrap360(this.instruments.dg + arg);
        break;
      // ---- autopilot ----
      case 'ap':
        ap.toggle(this);
        break;
      case 'apDisconnect':
        ap.disengage('manual');
        break;
      case 'apHdg':
        ap.setLateral('HDG', this);
        break;
      case 'apNav':
        ap.setLateral('NAV', this);
        break;
      case 'apApr':
        ap.setLateral('APR', this);
        break;
      case 'apAlt':
        ap.setVertical('ALT', this);
        break;
      case 'apVs':
        ap.setVertical('VS', this);
        break;
      case 'apFlc':
        ap.setVertical('FLC', this);
        break;
      case 'apAthr':
        if (def.autopilot.autothrottle) {
          ap.athr = !ap.athr;
          if (ap.athr) ap.spdSel = ap.spdSel || Math.round(fm.iasKt);
          this.message(ap.athr ? 'Autothrottle inserito' : 'Autothrottle disinserito', 'info', 1.5);
        }
        break;
      case 'apNavSource':
        ap.navSource = ap.navSource === 'GPS' ? 'NAV1' : 'GPS';
        this.message(`Sorgente navigazione: ${ap.navSource}`, 'info', 1.5);
        break;
      case 'hdgBug':
        ap.hdgBug = arg === 'sync' ? Math.round(fm.heading) : wrap360(ap.hdgBug + arg);
        break;
      case 'altSel':
        ap.altSel = clamp(ap.altSel + arg, 0, 45000);
        break;
      case 'vsSel':
        ap.vsSel = clamp(ap.vsSel + arg, -6000, 6000);
        if (ap.vertical !== 'VS' && ap.engaged && ap.cfg.type === 'ga') ap.setVertical('VS', this);
        break;
      case 'spdSel':
        ap.spdSel = clamp(ap.spdSel + arg, 60, 400);
        break;
      case 'obs':
        this.nav1.obs = wrap360(this.nav1.obs + arg);
        break;
      case 'obs2':
        this.nav2.obs = wrap360(this.nav2.obs + arg);
        break;
      case 'nav1Swap':
        this.nav1.swap();
        break;
      case 'nav2Swap':
        this.nav2.swap();
        break;
      case 'nav1Tune':
        this.nav1.standby = tuneNav(this.nav1.standby, arg);
        break;
      case 'nav2Tune':
        this.nav2.standby = tuneNav(this.nav2.standby, arg);
        break;
      case 'com1Swap': {
        const t = this.com1.active;
        this.com1.active = this.com1.standby;
        this.com1.standby = t;
        break;
      }
      case 'com1Tune':
        this.com1.standby = tuneCom(this.com1.standby, arg);
        break;
      case 'adfSwap':
        this.adf.swap();
        break;
      case 'adfTune':
        this.adf.standby = clamp(Math.round(this.adf.standby + arg), 190, 1750);
        break;
      case 'xpdr':
        if (arg === 'mode') this.xpdr.mode = { OFF: 'STBY', STBY: 'ALT', ALT: 'OFF' }[this.xpdr.mode];
        else if (typeof arg === 'number') this.xpdr.code = arg;
        break;
      case 'timer':
        this.instruments.timerRun = !this.instruments.timerRun;
        if (arg === 'reset') {
          this.instruments.timer = 0;
          this.instruments.timerRun = false;
        }
        break;
      case 'gpsDirect':
        this.gps.direct(arg);
        this.message(`GPS: diretto a ${arg.id}`, 'info', 2);
        break;
      default:
        break;
    }
  }

  /** Animated engine start sequence (Ctrl+E). */
  autostart() {
    const fm = this.fm;
    const def = this.def;
    const steps = [];
    const S = (t, fn, msg) => steps.push({ t, fn, msg });
    if (def.engines[0].type === 'piston') {
      S(0, () => this.command('master', true), 'Master ON');
      S(0.6, () => this.command('light', { which: 'beacon', value: true }), 'Beacon ON');
      S(1.2, () => this.command('fuelSelector', 'both'), 'Selettore carburante BOTH');
      S(1.8, () => (this.pilot.mixture = 1), 'Miscela RICCA');
      S(2.4, () => (this.pilot.throttle = 0.1), 'Manetta 10%');
      S(3.0, () => this.command('magnetos', 4), 'Avviamento...');
      S(3.0, () => fm.engines[0].running, null, true);
      S(0.4, () => this.command('magnetos', 3), 'Magneti BOTH');
      S(1.0, () => this.command('avionics', true), 'Avionica ON');
      S(1.6, () => this.command('light', { which: 'nav', value: true }), 'Luci di navigazione ON');
      S(2.0, () => (this.pilot.throttle = 0.05), 'Motore avviato');
    } else if (def.systems.apu) {
      S(0, () => this.command('battery', true), 'Batterie ON');
      S(0.5, () => this.command('light', { which: 'beacon', value: true }), 'Beacon ON');
      S(1.0, () => this.command('apuMaster', true), 'APU master ON — avvio APU');
      S(1.5, () => fm.systems.apuN > 95, null, true);
      S(0.5, () => this.command('apuBleed', true), 'APU BLEED ON');
      S(1.0, () => this.command('alternator', true), 'Generatori ON');
      S(1.5, () => this.command('engineStartSel', 'ign'), 'ENG MODE: IGN/START');
      S(1.5, () => this.command('engineMaster', { index: 1, value: true }), 'ENG 2 MASTER ON');
      S(1.0, () => fm.engines[1].running, null, true);
      S(1.0, () => this.command('engineMaster', { index: 0, value: true }), 'ENG 1 MASTER ON');
      S(1.0, () => fm.engines[0].running, null, true);
      S(1.0, () => this.command('engineStartSel', 'norm'), 'ENG MODE: NORM');
      S(1.0, () => this.command('apuBleed', false), 'APU BLEED OFF');
      S(0.5, () => this.command('avionics', true), 'Avionica ON');
      S(0.5, () => this.command('light', { which: 'nav', value: true }), 'Motori avviati');
    } else {
      S(0, () => this.command('battery', true), 'Batteria ON');
      S(0.5, () => this.command('light', { which: 'beacon', value: true }), 'Anticollisione ON');
      S(1.0, () => this.command('engineMaster', { index: 0, value: true }), 'Leva carburante APERTA');
      S(1.0, () => this.command('starter'), 'Avviamento motore...');
      S(1.0, () => fm.engines[0].running, null, true);
      S(1.0, () => this.command('alternator', true), 'Generatore ON');
      S(0.5, () => this.command('avionics', true), 'Avionica ON');
      S(0.5, () => this.command('light', { which: 'nav', value: true }), 'Motore avviato');
    }
    this._sequence = { steps: steps.map((s, i) => ({ ...s, wait: steps[i].fn.length === 0 && arguments.length === -1 })), idx: 0, timer: 0 };
    // mark wait-steps (condition functions) explicitly
    this._sequence.steps = steps;
    this.message('Avviamento automatico in corso…', 'info', 3);
  }

  shutdown() {
    const fm = this.fm;
    this.pilot.throttle = 0;
    if (fm.engines[0].type === 'piston') {
      this.pilot.mixture = 0;
      setTimeout(() => this.command('magnetos', 0), 2500);
    } else {
      this.engineMaster.fill(false);
    }
    this.message('Spegnimento motori', 'info', 2);
  }

  _runSequence(dt) {
    const q = this._sequence;
    if (!q) return;
    const st = q.steps[q.idx];
    if (!st) {
      this._sequence = null;
      return;
    }
    q.timer += dt;
    if (q.timer < st.t) return;
    if (st.msg === null && steps_isWait(st)) {
      if (st.fn()) {
        q.idx++;
        q.timer = 0;
      } else if (q.timer > 60) {
        this._sequence = null;
        this.message('Avviamento automatico fallito', 'warn', 4);
      }
      return;
    }
    st.fn();
    if (st.msg) this.message(st.msg, 'info', 1.6);
    q.idx++;
    q.timer = 0;
  }

  // ---------------------------------------------------------------- main loop
  /** Advance the simulation by real time dt (seconds). */
  update(dtReal) {
    if (!this.fm || this.paused) return;
    const dt = Math.min(dtReal, 0.1) * this.simRate;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      this.stepOnce(STEP);
      this.acc -= STEP;
      steps++;
      if (this.crashed) {
        this.acc = 0;
        break;
      }
    }
    this.timeOfDay = (this.timeOfDay + dt / 3600 + 24) % 24;
    this.updateRadios();
  }

  stepOnce(dt) {
    const fm = this.fm;
    const def = this.def;
    const sys = fm.systems;
    const p = this.pilot;
    const ap = this.ap;
    this._runSequence(dt);
    this.timeSinceStart += dt;

    // ---- failures ----
    for (const f of this.failures) {
      if (f.done) continue;
      const trig = (f.atTime !== undefined && this.timeSinceStart >= f.atTime) || (f.atAltitudeFt !== undefined && fm.altFt >= f.atAltitudeFt && !fm.onGround);
      if (trig) {
        f.done = true;
        if (f.system === 'engine') {
          for (const e of fm.engines) e.failed = true;
          this.events.push({ type: 'failure', what: 'engine' });
          this.message('AVARIA MOTORE!', 'alert', 6);
        } else if (f.system === 'vacuum') {
          sys.s.vacuum = false;
          this.message('Avaria impianto a depressione', 'alert', 5);
        } else if (f.system === 'electrical') {
          sys.alternator = false;
          this.message('Avaria alternatore', 'alert', 5);
        }
      }
    }

    // ---- autopilot ----
    let apOut = null;
    if (ap.engaged || ap.fd) apOut = ap.update(dt, this);
    if (ap.engaged && (Math.abs(p.pitch) > 0.55 || Math.abs(p.roll) > 0.55)) {
      ap.disengage('override');
    }
    // ---- controls to flight model ----
    const inp = fm.input;
    fm.apEngaged = ap.engaged;
    let yaw = p.yaw;
    if (this.settings.autoRudder) {
      if (fm.onGround) yaw = clamp(yaw + p.roll * 0.8, -1, 1);
      else yaw = clamp(yaw + fm.beta * 6, -1, 1);
    }
    if (ap.engaged && apOut) {
      inp.pitch = apOut.pitch;
      inp.roll = apOut.roll;
      inp.yaw = clamp(yaw + apOut.yaw, -1, 1);
      if (def.autopilot.autoTrim && Math.abs(apOut.pitch) > 0.02) {
        inp.elevTrim = clamp(inp.elevTrim + Math.sign(apOut.pitch) * Math.min(Math.abs(apOut.pitch), 0.25) * 0.12 * dt, -1, 1);
      }
    } else {
      inp.pitch = p.pitch;
      inp.roll = p.roll;
      inp.yaw = yaw;
    }
    if (def.controls.trimType !== 'stab' || !fm.fcs || fm.fcs.mode !== 'normal' || fm.onGround) {
      if (p.trimRate) inp.elevTrim = clamp(inp.elevTrim + p.trimRate * 0.18 * dt, -1, 1);
    }
    if (p.rudTrimRate) inp.rudTrim = clamp(inp.rudTrim + p.rudTrimRate * 0.2 * dt, -1, 1);
    if (p.ailTrimRate) inp.ailTrim = clamp(inp.ailTrim + p.ailTrimRate * 0.2 * dt, -1, 1);
    inp.brakeL = p.brakeL;
    inp.brakeR = p.brakeR;

    // ---- engines ----
    const athr = ap.athr && apOut && apOut.throttle !== null;
    if (athr) p.throttle = apOut.throttle;
    if (this._starterTimer > 0) this._starterTimer -= dt;
    fm.engines.forEach((e, i) => {
      const thr = i === 1 && p.throttle2 !== undefined ? p.throttle2 : p.throttle;
      e.throttle = clamp(thr, 0, 1);
      if (e.type === 'piston') {
        e.mixture = p.mixture;
      } else {
        e.reverseCmd = p.reverse && def.controls.reversers;
        e.master = this.engineMaster[i];
        if (def.systems.apu) e.starter = sys.engineStartSel === 'ign' && e.master && !e.running;
        else e.starter = this._starterTimer > 0 && sys.battery;
      }
    });

    fm.step(dt);
    this.instruments.update(dt, this);

    // ---- bookkeeping / events ----
    this.flightTime += fm.onGround ? 0 : dt;
    this.distanceFlown += fm.gs * dt;
    this._detectEvents(dt);
    if (fm.damage.crashed && this.settings.crashes) {
      this.crashed = true;
      this.events.push({ type: 'crash', reason: fm.damage.reason });
    } else if (fm.damage.crashed) {
      // crashes disabled: bounce back
      fm.damage.crashed = false;
    }
  }

  _detectEvents(dt) {
    const fm = this.fm;
    const sys = fm.systems;
    // touchdown
    if (fm.touchdown && !fm.touchdown.reported) {
      fm.touchdown.reported = true;
      this.landed = fm.touchdown;
      this.events.push({ type: 'touchdown', data: fm.touchdown });
      const fpm = Math.round(fm.touchdown.vsFpm);
      const grade = fpm < 150 ? 'eccellente' : fpm < 300 ? 'buono' : fpm < 500 ? 'duro' : 'molto duro';
      this.message(`Contatto: ${fpm} ft/min — atterraggio ${grade}`, fpm < 500 ? 'info' : 'warn', 5);
    }
    // gear / flaps motion (for sounds)
    if (sys.gearPos !== this.prevGearPos) this.events.push({ type: 'gearMoving' });
    if (sys.flaps !== this.prevFlaps) this.events.push({ type: 'flapsMoving' });
    this.prevGearPos = sys.gearPos;
    this.prevFlaps = sys.flaps;
    // autopilot events
    for (const e of this.ap.events) this.events.push({ type: 'ap', what: e });
    this.ap.events.length = 0;
    // altitude callouts (radio altimeter, airliner/jet)
    if (this.def.panel !== 'ga' && !fm.onGround && fm.vs < -0.5 && sys.avionicsPowered) {
      const ra = fm.aglFt;
      const marks = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
      for (const m of marks) {
        if (ra <= m && this.callouts.last > m) {
          this.events.push({ type: 'callout', value: m });
          this.callouts.last = m;
          break;
        }
      }
    }
    if (fm.aglFt > 2600 || fm.vs > 2) this.callouts.last = Math.max(this.callouts.last, fm.aglFt + 50);
    // marker beacons
    const mk = sys.avionicsPowered ? markerAt(fm) : null;
    if (mk !== this.marker) {
      this.marker = mk;
      if (mk) this.events.push({ type: 'marker', which: mk });
    }
  }

  updateRadios() {
    const fm = this.fm;
    if (!fm) return;
    const pw = fm.systems.avionicsPowered;
    this.nav1.update(fm, pw);
    this.nav2.update(fm, pw);
    this.adf.update(fm, pw);
    this.gps.update(fm);
    // ATIS on COM1
    const ap = pw ? airportByAtis(this.com1.active) : null;
    if (ap) {
      const d = Math.hypot(ap.n - fm.pos.x, ap.e - fm.pos.y);
      if (d < 60 * NM && (!this.lastAtis || this.lastAtis.icao !== ap.icao)) {
        this.lastAtis = ap;
        this.events.push({ type: 'atis', airport: ap, text: atisText(ap, this.atm, Math.floor(this.timeOfDay) % 8) });
      }
    } else this.lastAtis = null;
  }
}

function steps_isWait(st) {
  return st.msg === null;
}

function tuneNav(f, d) {
  let v = Math.round((f + d) * 100) / 100;
  if (v > 117.95) v = 108;
  if (v < 108) v = 117.95;
  return v;
}
function tuneCom(f, d) {
  let v = Math.round((f + d) * 1000) / 1000;
  if (v > 136.975) v = 118;
  if (v < 118) v = 136.975;
  return v;
}
