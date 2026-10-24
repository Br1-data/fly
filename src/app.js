// Application shell: state machine (loading -> menu -> flight), main loop and wiring between
// simulation, renderer, cockpit, input, audio, missions and the user interface.
import { Simulation } from './sim/simulation.js';
import { WEATHER_PRESETS } from './sim/atmosphere.js';
import { getAircraft } from './sim/aircraft/index.js';
import { airportLayouts, findAirport } from './world/world-data.js';
import { clamp } from './core/math.js';
import { h, clear } from './ui/dom.js';
import { loadSettings, saveSettings } from './ui/settings-store.js';
import { LoadingScreen } from './ui/loading.js';
import { MainMenu } from './ui/menu.js';
import { FreeFlightScreen } from './ui/freeflight.js';
import { MissionsScreen } from './ui/missions-screen.js';
import { SettingsScreen } from './ui/settings.js';
import { ControlsScreen } from './ui/controls.js';
import { CreditsScreen } from './ui/credits.js';
import { FlightHud } from './ui/hud.js';
import { PauseMenu, CrashScreen, DebriefScreen, LandingReport } from './ui/overlays.js';
import { MapOverlay } from './ui/map.js';
import { ChecklistOverlay } from './ui/checklist.js';

const VIEW_NAMES = { cockpit: 'Cockpit', chase: 'Esterna', orbit: 'Orbitale', tower: 'Torre di controllo', flyby: 'Passaggio' };
const SIM_RATES = [1, 2, 4, 8];

export class App {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas 3D canvas
   * @param {object} o.roots {cockpit, hud, screens, overlay}
   * @param {object} o.deps {SceneRenderer, Cockpit, InputManager, AudioEngine, MISSIONS, MissionRunner, loadResults, saveResult, getChecklists}
   */
  constructor({ canvas, roots, deps }) {
    this.canvas = canvas;
    this.roots = roots;
    this.deps = deps;
    this.settings = loadSettings();
    this.state = 'boot';
    this.flightSim = new Simulation();
    this.menuSim = new Simulation();
    this.mission = null;
    this.runner = null;
    this.flightOpts = null;
    this.overlay = null; // active blocking overlay
    this.lastTime = 0;
    this.simRateIdx = 0;
    this.showHud = this.settings.showHud;
    this.lastAtisText = null;
    this.debriefShown = false;
    this.crashShown = false;
    this.landingReported = false;
    this.screen = null;
    this._menuAngle = 0;
    this._frame = this._frame.bind(this);
  }

  // ------------------------------------------------------------------ startup
  async start() {
    const { deps } = this;
    this.loading = new LoadingScreen(this.roots.overlay);
    this.loading.show('Preparazione del simulatore…');
    this.renderer = new deps.SceneRenderer(this.canvas, { quality: this.settings.quality });
    this._resize();
    window.addEventListener('resize', () => this._resize());
    await this.renderer.init((f, label) => this.loading.progress(f * 0.6, label || 'Costruzione del mondo…'));

    this.cockpit = new deps.Cockpit(this.roots.cockpit, this.flightSim);
    this.audio = new deps.AudioEngine();
    this.audio.setVolume(this.settings.volume);
    this.audio.setMuted(true);
    const resumeAudio = () => {
      this.audio.resume?.();
    };
    window.addEventListener('pointerdown', resumeAudio);
    window.addEventListener('keydown', resumeAudio);

    this.input = new deps.InputManager(this.flightSim, { onAction: (a, d) => this.onAction(a, d) });
    this.input.attach(window, this.canvas);
    this.input.setEnabled(false);

    this.hud = new FlightHud(this.roots.hud, this);
    this.map = new MapOverlay(this.roots.overlay, this);
    this.checklist = new ChecklistOverlay(this.roots.overlay, this);
    this.landingReport = new LandingReport(this.roots.hud);

    // live background scene for the menus
    this.loading.progress(0.65, 'Decollo del volo dimostrativo…');
    this._setupMenuScene();
    await this.renderer.warmup(this.menuSim, (f) => this.loading.progress(0.65 + f * 0.35, 'Generazione del terreno…'));
    this.loading.hide();
    this.showMainMenu();
    requestAnimationFrame(this._frame);
  }

  _setupMenuScene() {
    const sim = this.menuSim;
    sim.setup({
      aircraft: 'airliner',
      start: { type: 'air', airport: 'XCST', n: 20000, e: -36500, altitudeFt: 2500, speedKt: 230, heading: 170 },
      weather: { ...WEATHER_PRESETS.poche_nubi, turbulence: 0.05 },
      time: 17.6,
    });
    sim.update(0.05);
    sim.command('ap');
    sim.command('apHdg');
    sim.command('apAlt');
    sim.ap.spdSel = 230;
    sim.command('apAthr');
    sim.messages.length = 0;
    this.renderer.setAircraft(sim.def);
    this.renderer.setPanelFraction(0);
    this.renderer.setMarkers([]);
    this.renderer.setView('orbit');
  }

  _resize() {
    const w = window.innerWidth,
      hgt = window.innerHeight;
    this.renderer?.resize(w, hgt);
    this.cockpit?.resize(w, hgt);
  }

  // ------------------------------------------------------------------ screens
  _showScreen(screen) {
    this.screen?.destroy?.();
    clear(this.roots.screens);
    this.screen = screen;
    if (screen) {
      this.roots.screens.appendChild(screen.el);
      this.roots.screens.classList.add('visible');
    } else this.roots.screens.classList.remove('visible');
  }

  showMainMenu() {
    if (this.state === 'flight') this._endFlight();
    this.state = 'menu';
    document.body.dataset.state = 'menu';
    this.input.setEnabled(false);
    this.audio.setMuted(true);
    if (this.renderer.view !== 'orbit') this.renderer.setView('orbit');
    this._showScreen(
      new MainMenu(this, {
        freeflight: () => this.showFreeFlight(),
        missions: () => this.showMissions(),
        controls: () => this.showControls(() => this.showMainMenu()),
        settings: () => this.showSettings(() => this.showMainMenu()),
        credits: () => this._showScreen(new CreditsScreen(() => this.showMainMenu())),
        quit: window.desktop?.quit ? () => window.desktop.quit() : null,
      }),
    );
  }

  showFreeFlight() {
    this._showScreen(new FreeFlightScreen(this, { back: () => this.showMainMenu(), start: (opts) => this.startFlight(opts, null) }));
  }

  showMissions() {
    this._showScreen(
      new MissionsScreen(this, {
        back: () => this.showMainMenu(),
        start: (mission) => this.startFlight(mission.setup, mission),
      }),
    );
  }

  showSettings(back) {
    this._showScreen(new SettingsScreen(this, { back }));
  }

  showControls(back) {
    this._showScreen(new ControlsScreen(this, { back }));
  }

  applySettings() {
    saveSettings(this.settings);
    this.renderer.setQuality(this.settings.quality);
    this.audio.setVolume(this.settings.volume);
    Object.assign(this.flightSim.settings, this.settings.realism);
    if (this.flightSim.fm) {
      this.flightSim.fm.systems.infiniteFuel = this.settings.realism.unlimitedFuel;
      if (this.flightSim.fm.fcs) this.flightSim.fm.fcs.mode = this.settings.realism.fbwNormalLaw ? 'normal' : 'direct';
    }
  }

  // ------------------------------------------------------------------ flight lifecycle
  async startFlight(opts, mission) {
    const { deps } = this;
    this._closeOverlay();
    this._showScreen(null);
    this.state = 'loading';
    document.body.dataset.state = 'loading';
    this.input.setEnabled(false);
    this.audio.setMuted(true);
    const def = getAircraft(opts.aircraft);
    this.loading.show(mission ? mission.title : `${def.name}`);
    this.loading.progress(0.02, 'Preparazione del velivolo…');
    await new Promise((r) => setTimeout(r, 30));

    const sim = this.flightSim;
    sim.settings = { ...sim.settings, ...this.settings.realism };
    sim.paused = false;
    sim.simRate = 1;
    this.simRateIdx = 0;
    sim.setup(opts);
    this.flightOpts = opts;
    this.mission = mission;
    this.runner = null;
    if (mission) {
      this.runner = new deps.MissionRunner(mission, sim);
      this.runner.start();
    }
    this.renderer.setAircraft(def);
    this.cockpit.setAircraft(def);
    this.audio.setAircraft(def);
    this.input.setSim?.(sim);
    this.renderer.setMarkers(this.runner?.getMarkers() || []);
    await this.renderer.warmup(sim, (f) => this.loading.progress(0.05 + f * 0.95, 'Generazione del paesaggio…'));

    const view = this.settings.defaultView || 'cockpit';
    this._setView(view, true);
    this.hud.reset();
    this.hud.setMission(mission ? this.runner : null);
    this.debriefShown = false;
    this.crashShown = false;
    this.landingReported = false;
    this.landingReport.hide();
    this.lastAtisText = null;
    this.state = 'flight';
    document.body.dataset.state = 'flight';
    this.loading.hide();
    this.input.setEnabled(true);
    this.audio.setMuted(this.settings.muted);
    this.lastTime = performance.now();
    if (!mission) {
      const ap = findAirport(opts.start?.airport);
      const where = opts.start?.type === 'air' ? 'in volo' : opts.start?.type === 'final' ? `in finale pista ${opts.start.runway}` : ap ? `${ap.name}` : '';
      sim.message(`${def.name} — ${where}`, 'info', 5);
      if (opts.coldDark) sim.message('Cockpit spento: segui la checklist (K) oppure premi Ctrl+E per l\'avviamento automatico', 'info', 9);
    }
    this.settings.lastFlight = mission ? this.settings.lastFlight : opts;
    saveSettings(this.settings);
  }

  restartFlight() {
    if (this.flightOpts) this.startFlight(this.flightOpts, this.mission);
  }

  _endFlight() {
    this._closeOverlay();
    this.flightSim.paused = false;
    this.cockpit.setView('orbit');
    this.hud.hide();
    this.landingReport.hide();
    this.runner = null;
    this.mission = null;
    this._setupMenuScene();
    this.renderer.warmup(this.menuSim);
  }

  // ------------------------------------------------------------------ views
  _setView(view, silent) {
    this.renderer.setView(view);
    this.cockpit.setView(this.renderer.view);
    if (!silent) this.hud.flash(VIEW_NAMES[this.renderer.view] || this.renderer.view);
  }

  get view() {
    return this.renderer?.view || 'cockpit';
  }

  // ------------------------------------------------------------------ overlays
  _openOverlay(ov) {
    this._closeOverlay();
    this.overlay = ov;
    this.input.setEnabled(false);
  }

  _closeOverlay() {
    if (this.overlay) {
      this.overlay.destroy?.();
      this.overlay = null;
    }
    if (this.state === 'flight') this.input.setEnabled(true);
  }

  togglePause(force) {
    const sim = this.flightSim;
    sim.paused = force !== undefined ? force : !sim.paused;
    this.audio.setMuted(sim.paused || this.settings.muted);
  }

  openPauseMenu() {
    if (this.state !== 'flight' || this.overlay) return;
    this.togglePause(true);
    this._openOverlay(
      new PauseMenu(this.roots.overlay, this, {
        resume: () => {
          this._closeOverlay();
          this.togglePause(false);
        },
        restart: () => this.restartFlight(),
        settings: () => {
          this._closeOverlay();
          this.state = 'flight-settings';
          this.showSettings(() => this._returnToFlightFromScreen());
        },
        controls: () => {
          this._closeOverlay();
          this.state = 'flight-settings';
          this.showControls(() => this._returnToFlightFromScreen());
        },
        menu: () => this.showMainMenu(),
      }),
    );
  }

  _returnToFlightFromScreen() {
    this._showScreen(null);
    this.state = 'flight';
    this.openPauseMenu();
  }

  // ------------------------------------------------------------------ input actions
  onAction(action, data) {
    if (this.state !== 'flight') return;
    const sim = this.flightSim;
    switch (action) {
      case 'pause':
        if (!this.overlay) {
          this.togglePause();
          this.hud.flash(sim.paused ? 'PAUSA' : 'Ripresa');
        }
        break;
      case 'menu':
        if (this.map.visible) this.map.hide();
        else if (this.checklist.visible) this.checklist.hide();
        else this.openPauseMenu();
        break;
      case 'view-next':
        this._setView(this._nextView(1));
        break;
      case 'view-prev':
        this._setView(this._nextView(-1));
        break;
      case 'view-cockpit':
        this._setView('cockpit');
        break;
      case 'view-chase':
        this._setView('chase');
        break;
      case 'panel-cycle':
        if (this.view !== 'cockpit') this._setView('cockpit');
        else this.cockpit.cycleMode();
        break;
      case 'hud-toggle':
        if (this.view === 'cockpit' && sim.def.panel === 'jet') {
          this._jetHud = !(this._jetHud ?? true);
          this.cockpit.setHudVisible(this._jetHud);
        } else {
          this.showHud = !this.showHud;
          this.settings.showHud = this.showHud;
          saveSettings(this.settings);
        }
        break;
      case 'map':
        this.map.toggle();
        break;
      case 'checklist':
        this.checklist.toggle();
        break;
      case 'sim-rate':
        this.simRateIdx = (this.simRateIdx + 1) % SIM_RATES.length;
        sim.simRate = SIM_RATES[this.simRateIdx];
        this.hud.flash(`Velocità simulazione ×${sim.simRate}`);
        break;
      case 'restart':
        this.restartFlight();
        break;
      case 'reset-view':
        this.renderer.resetView();
        break;
      case 'look':
        this.renderer.look(data?.dx || 0, data?.dy || 0);
        break;
      case 'zoom':
        this.renderer.zoom(data?.delta || 0);
        break;
      case 'mouse-yoke':
        this.hud.flash(data?.enabled ? 'Cloche col mouse: ATTIVA' : 'Cloche col mouse: disattivata');
        break;
      case 'atis-repeat':
        if (this.lastAtisText) {
          this.hud.showAtis(this.lastAtisText);
          this.audio.speak?.(this.lastAtisText);
        }
        break;
      default:
        break;
    }
  }

  _nextView(dir) {
    const order = ['cockpit', 'chase', 'orbit', 'tower', 'flyby'];
    const i = order.indexOf(this.view);
    return order[(i + dir + order.length) % order.length];
  }

  // ------------------------------------------------------------------ events
  _dispatchEvents() {
    const sim = this.flightSim;
    for (const ev of sim.events) {
      try {
        this.audio.handleEvent(ev);
      } catch (e) {
        console.error(e);
      }
      this.runner?.handleEvent(ev);
      switch (ev.type) {
        case 'crash':
          if (!this.crashShown) {
            this.crashShown = true;
            setTimeout(() => this._showCrash(ev.reason), 2600);
          }
          break;
        case 'atis':
          this.lastAtisText = ev.text;
          this.hud.showAtis(ev.text);
          this.audio.speak?.(ev.text, 'it-IT');
          break;
        case 'touchdown':
          this.landingReported = false;
          break;
        default:
          break;
      }
    }
    sim.events.length = 0;
  }

  _showCrash(reason) {
    if (this.state !== 'flight') return;
    if (this.runner && this.runner.status === 'running') this.runner.handleEvent({ type: 'crash', reason });
    if (this.runner && this.runner.debrief) {
      this._showDebrief();
      return;
    }
    this._openOverlay(
      new CrashScreen(this.roots.overlay, {
        reason,
        retry: () => this.restartFlight(),
        menu: () => this.showMainMenu(),
      }),
    );
  }

  _showDebrief() {
    if (this.debriefShown || !this.runner?.debrief) return;
    this.debriefShown = true;
    const d = this.runner.debrief;
    try {
      this.deps.saveResult(this.mission.id, d);
    } catch (e) {
      console.warn(e);
    }
    this._openOverlay(
      new DebriefScreen(this.roots.overlay, {
        mission: this.mission,
        debrief: d,
        retry: () => this.restartFlight(),
        missions: () => {
          this.showMainMenu();
          this.showMissions();
        },
        cont: d.success
          ? () => {
              this._closeOverlay();
            }
          : null,
      }),
    );
  }

  // ------------------------------------------------------------------ main loop
  _frame(now) {
    requestAnimationFrame(this._frame);
    const dt = clamp((now - (this.lastTime || now)) / 1000, 0, 0.1);
    this.lastTime = now;
    try {
      if (this.state === 'flight' || this.state === 'flight-settings') this._flightFrame(dt);
      else if (this.state === 'menu') this._menuFrame(dt);
    } catch (e) {
      console.error(e);
      if (!this._errShown) {
        this._errShown = true;
        window.dispatchEvent(new CustomEvent('cieli:error', { detail: e }));
      }
    }
  }

  _menuFrame(dt) {
    const sim = this.menuSim;
    sim.update(dt);
    // keep the demo flight inside the coastline: gentle racetrack
    if (sim.fm && Math.floor(sim.timeSinceStart) % 90 === 0 && !this._turnDone) {
      sim.ap.hdgBug = (sim.ap.hdgBug + 180) % 360;
      this._turnDone = true;
    } else if (Math.floor(sim.timeSinceStart) % 90 !== 0) this._turnDone = false;
    sim.events.length = 0;
    sim.messages.length = 0;
    this.renderer.look(dt * 14, 0);
    this.renderer.setPanelFraction(0);
    this.renderer.update(sim, dt);
    this.renderer.render();
  }

  _flightFrame(dt) {
    const sim = this.flightSim;
    const active = this.state === 'flight' && !this.overlay;
    if (active) this.input.update(dt);
    if (!sim.crashed && !(this.overlay && !this.overlay.live)) sim.update(dt);
    if (this.runner && !sim.paused) {
      this.runner.update(dt * sim.simRate);
      if (this.runner.status !== 'running' && !this.debriefShown && !this._debriefTimer) {
        this._debriefTimer = setTimeout(() => {
          this._debriefTimer = null;
          this._showDebrief();
        }, sim.crashed ? 2600 : 1800);
      }
    }
    this._dispatchEvents();
    this.cockpit.setNight(nightFactor(sim.timeOfDay));
    this.renderer.setPanelFraction(this.view === 'cockpit' ? this.cockpit.panelFraction : 0);
    this.renderer.setMarkers(this.runner?.getMarkers() || []);
    this.renderer.update(sim, dt);
    this.renderer.render();
    this.cockpit.update(dt);
    this.audio.update(sim, dt, { view: this.view === 'cockpit' ? 'cockpit' : 'external', cameraDistance: this._cameraDistance() });
    this.hud.update(dt);
    this.map.update(dt);
    this.checklist.update(dt);
    // free flight landing report after a full stop
    const fm = sim.fm;
    if (!this.runner && sim.landed && !this.landingReported && fm.onGround && fm.gsKt < 3) {
      this.landingReported = true;
      this.landingReport.show(sim);
    }
  }

  _cameraDistance() {
    const fm = this.flightSim.fm;
    const def = this.flightSim.def;
    switch (this.view) {
      case 'cockpit':
        return 0;
      case 'chase':
      case 'orbit':
        return def.camera.chaseDist || 15;
      case 'tower': {
        let best = Infinity;
        for (const L of airportLayouts()) best = Math.min(best, Math.hypot(L.tower.n - fm.pos.x, L.tower.e - fm.pos.y, fm.alt - L.airport.elev - L.tower.height));
        return best;
      }
      default:
        return 120;
    }
  }
}

/** 0 = full daylight, 1 = night (for panel backlighting). */
export function nightFactor(hour) {
  const hh = ((hour % 24) + 24) % 24;
  if (hh >= 7.5 && hh <= 17.5) return 0;
  if (hh >= 20 || hh <= 5) return 1;
  if (hh < 7.5) return clamp((7.5 - hh) / 2.5, 0, 1);
  return clamp((hh - 17.5) / 2.5, 0, 1);
}

export { h };
