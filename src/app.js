// Application shell: state machine (loading → menu → flight), main loop and wiring between
// simulation, renderer, flight interface, input, touch controls, audio and missions.
import { Simulation } from './sim/simulation.js';
import { getShip } from './sim/ships.js';
import { clamp } from './core/math.js';
import { clear } from './ui/dom.js';
import { loadSettings, saveSettings } from './ui/settings-store.js';
import { LoadingScreen } from './ui/loading.js';
import { MainMenu, CreditsScreen } from './ui/menu.js';
import { FreeFlightScreen } from './ui/freeflight.js';
import { MissionsScreen } from './ui/missions-screen.js';
import { SettingsScreen } from './ui/settings.js';
import { ControlsScreen } from './ui/controls.js';
import { FlightUI } from './ui/flight-ui.js';
import { PauseMenu, CrashScreen, DebriefScreen } from './ui/overlays.js';
import { HelpOverlay } from './ui/help.js';
import { TouchControls } from './input/touch-controls.js';
import { deviceClass, isIPad, isIPhone, isTouchDevice } from './core/device.js';

const VIEW_NAMES = { cockpit: 'Cockpit', chase: 'Esterna', orbit: 'Orbitale', target: 'Verso il bersaglio', map: 'Mappa orbitale' };

export class App {
  constructor({ canvas, roots, deps }) {
    this.canvas = canvas;
    this.roots = roots;
    this.deps = deps;
    this.touchMode = isTouchDevice();
    this._needsRender = true;
    const root = document.documentElement;
    root.classList.toggle('touch-device', this.touchMode);
    root.classList.toggle('tablet-device', deviceClass() === 'tablet');
    root.classList.toggle('ios-device', isIPad() || isIPhone());
    root.classList.toggle('phone-device', ['phone', 'iphone'].includes(deviceClass()));
    this.settings = loadSettings();
    this.state = 'boot';
    this.flightSim = new Simulation();
    this.menuSim = new Simulation();
    this.mission = null;
    this.runner = null;
    this.flightOpts = null;
    this.overlay = null;
    this.lastTime = 0;
    this.screen = null;
    this._frame = this._frame.bind(this);
  }

  // ------------------------------------------------------------------ startup
  async start() {
    const { deps } = this;
    this.loading = new LoadingScreen(this.roots.overlay);
    this.loading.show('Preparazione del Sistema Solare…');
    this.loading.progress(0.02, 'Caricamento delle mappe di Terra, Luna e Marte…');
    await deps.loadPlanetData();
    this.renderer = new deps.SceneRenderer(this.canvas, { quality: this.settings.quality });
    this._resize();
    window.addEventListener('resize', () => this._resize());
    await this.renderer.init((f, label) => this.loading.progress(0.1 + f * 0.5, label || 'Costruzione dei pianeti…'));
    this.audio = new deps.AudioEngine();
    this.audio.setVolume(this.settings.volume);
    this.audio.setSpeech?.({ voice: this.settings.voice, rate: this.settings.voiceRate });
    this.audio.setMuted(true);
    const resume = () => this.audio.resume?.();
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(type, resume, { passive: true });
    this.input = new deps.InputManager(this.flightSim, { onAction: (a, d) => this.onAction(a, d) });
    this.input.attach(window, this.canvas);
    this.input.setEnabled(false);
    this.ui = new FlightUI(this.roots.hud, this);
    this.ui.showHud = this.settings.showHud !== false;
    this.touchControls = new TouchControls(this.roots.hud, this);
    window.addEventListener('orientationchange', () => this.touchControls.reset());
    document.addEventListener('visibilitychange', () => {
      if (this.touchMode && document.hidden && this.state === 'flight' && !this.flightSim.paused && !this.overlay) this.openPauseMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F12' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (this.overlay instanceof HelpOverlay) this._helpClose?.();
      else this.openHelp();
    }, true);
    this.loading.progress(0.65, 'Messa in orbita della Stazione Aurora…');
    this._setupMenuScene();
    await this.renderer.warmup(this.menuSim, (f) => this.loading.progress(0.65 + f * 0.35, 'Generazione delle superfici…'));
    this.loading.hide();
    this.showMainMenu();
    requestAnimationFrame(this._frame);
  }

  _setupMenuScene() {
    const sim = this.menuSim;
    sim.setup({ ship: 'capsule', date: '2031-05-20T07:40:00Z', start: { type: 'near', object: 'aurora', port: 'prua', distance: 70, lateral: [6, -3] }, target: 'aurora', objects: ['aurora'] });
    sim.messages.length = 0;
    this.renderer.setScenario(sim);
    this.renderer.setView('orbit');
    this.renderer.zoomFactor = 5.5;
    this.renderer.tilt = 0.25;
    this.renderer.yaw = 2.2;
  }

  _resize() {
    this._needsRender = true;
    this.renderer?.resize(window.innerWidth, window.innerHeight);
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
    if (this.state === 'flight' || this.state === 'flight-settings') this._endFlight();
    this.state = 'menu';
    document.body.dataset.state = 'menu';
    this.input.setEnabled(false);
    this.audio.setMuted(true);
    this.ui.hide();
    this._showScreen(new MainMenu(this, {
      freeflight: () => this.showFreeFlight(),
      missions: () => this.showMissions(),
      controls: () => this.showControls(() => this.showMainMenu()),
      help: () => this.openHelp(),
      settings: () => this.showSettings(() => this.showMainMenu()),
      credits: () => this._showScreen(new CreditsScreen(() => this.showMainMenu())),
      quit: window.desktop?.quit ? () => window.desktop.quit() : null,
    }));
  }

  showFreeFlight() {
    this._showScreen(new FreeFlightScreen(this, { back: () => this.showMainMenu(), start: (opts) => this.startFlight(opts, null) }));
  }

  showMissions() {
    this._showScreen(new MissionsScreen(this, { back: () => this.showMainMenu(), start: (m) => this.startFlight(m.setup, m) }));
  }

  showSettings(back) {
    this._showScreen(new SettingsScreen(this, { back }));
  }

  showControls(back) {
    this._showScreen(new ControlsScreen(this, { back }));
  }

  applySettings() {
    this._needsRender = true;
    saveSettings(this.settings);
    this.renderer.setQuality(this.settings.quality);
    this.audio.setVolume(this.settings.volume);
    this.audio.setSpeech?.({ voice: this.settings.voice, rate: this.settings.voiceRate });
    Object.assign(this.flightSim.settings, this.settings.realism);
    if (this.ui) this.ui.showHud = this.settings.showHud !== false;
  }

  // ------------------------------------------------------------------ flight lifecycle
  async startFlight(opts, mission) {
    const { deps } = this;
    this._clearTimers();
    this.touchControls.reset();
    this._closeOverlay();
    this._showScreen(null);
    this.state = 'loading';
    document.body.dataset.state = 'loading';
    this.input.setEnabled(false);
    this.audio.setMuted(true);
    const def = getShip(opts.ship);
    this.loading.show(mission ? mission.title : def.name);
    this.loading.progress(0.03, 'Preparazione del veicolo…');
    await new Promise((r) => setTimeout(r, 30));
    const sim = this.flightSim;
    sim.settings = { ...sim.settings, ...this.settings.realism };
    sim.paused = false;
    sim.setup(opts);
    this.flightOpts = opts;
    this.mission = mission;
    this.runner = null;
    if (mission) {
      this.runner = new deps.MissionRunner(mission, sim);
      this.runner.start();
    }
    this.input.setSim(sim);
    this.renderer.setScenario(sim);
    this.renderer.setMarkers(this.runner?.getMarkers() || []);
    this._setView(this.settings.defaultView || 'chase', true);
    await this.renderer.warmup(sim, (f) => this.loading.progress(0.05 + f * 0.95, 'Generazione della superficie…'));
    this.ui.reset();
    this.ui.setMission(this.runner);
    this.debriefShown = false;
    this.crashShown = false;
    this.state = 'flight';
    document.body.dataset.state = 'flight';
    this.loading.hide();
    this.input.setEnabled(true);
    this.audio.setMuted(this.settings.muted);
    this.lastTime = performance.now();
    if (!mission) sim.message(`${def.name} · ${sim.body.name}`, 'info', 4);
    saveSettings(this.settings);
  }

  restartFlight() {
    if (this.flightOpts) return this.startFlight(this.flightOpts, this.mission);
  }

  _endFlight() {
    this.touchControls.reset();
    this.touchControls.setEnabled(false);
    this._clearTimers();
    this._closeOverlay();
    this.flightSim.paused = false;
    this.ui.hide();
    this.ui.toggleNav(false);
    this.ui.toggleKeys(false);
    this.runner = null;
    this.mission = null;
    this._setupMenuScene();
    this.renderer.warmup(this.menuSim);
  }

  _clearTimers() {
    clearTimeout(this._crashTimer);
    clearTimeout(this._debriefTimer);
    this._crashTimer = null;
    this._debriefTimer = null;
  }

  // ------------------------------------------------------------------ views
  _setView(view, silent) {
    this._needsRender = true;
    if (view !== 'map') this._lastFlightView = view;
    this.renderer.setView(view);
    document.body.classList.toggle('cockpit-view', this.renderer.view === 'cockpit');
    if (!silent) this.ui.flash(VIEW_NAMES[this.renderer.view] || this.renderer.view);
  }

  get view() {
    return this.renderer?.view || 'chase';
  }

  // ------------------------------------------------------------------ overlays
  _openOverlay(ov) {
    this._closeOverlay();
    this.overlay = ov;
    this.input.setEnabled(false);
    this.touchControls?.setEnabled(false);
    if (!ov.live) this.audio.setMuted(true);
  }

  _closeOverlay() {
    if (this.overlay) {
      if (this.overlay instanceof HelpOverlay) this._helpClose = null;
      this.overlay.destroy?.();
      this.overlay = null;
    }
    if (this.state === 'flight') {
      this.input.setEnabled(true);
      this.audio.setMuted(this.flightSim.paused || this.settings.muted);
    }
  }

  togglePause(force) {
    this._needsRender = true;
    const sim = this.flightSim;
    sim.paused = force !== undefined ? force : !sim.paused;
    this.audio.setMuted(sim.paused || this.settings.muted);
  }

  openHelp() {
    if (!this.input || ['boot', 'loading'].includes(this.state)) return;
    if (this.overlay instanceof HelpOverlay) return this._helpClose?.();
    const returnToPause = this.overlay instanceof PauseMenu;
    if (this.overlay && !returnToPause) return;
    const state = this.state;
    const wasPaused = this.flightSim.paused;
    const wasEnabled = this.input.enabled;
    if (state === 'flight') this.togglePause(true);
    const close = () => {
      this._closeOverlay();
      if (this.state !== state) return;
      if (state === 'flight') this.togglePause(wasPaused);
      if (returnToPause) this.openPauseMenu();
      else this.input.setEnabled(wasEnabled);
    };
    this._openOverlay(new HelpOverlay(this.roots.overlay, this, { close }));
    this._helpClose = close;
  }

  openPauseMenu() {
    if (this.state !== 'flight' || this.overlay) return;
    this.togglePause(true);
    this._openOverlay(new PauseMenu(this.roots.overlay, this, {
      resume: () => {
        this._closeOverlay();
        this.togglePause(false);
      },
      restart: () => this.restartFlight(),
      settings: () => {
        this.state = 'flight-settings';
        this._closeOverlay();
        this.showSettings(() => this._returnToFlight());
      },
      controls: () => {
        this.state = 'flight-settings';
        this._closeOverlay();
        this.showControls(() => this._returnToFlight());
      },
      help: () => this.openHelp(),
      menu: () => this.showMainMenu(),
    }));
  }

  _returnToFlight() {
    this._showScreen(null);
    this.state = 'flight';
    this.openPauseMenu();
  }

  // ------------------------------------------------------------------ input actions
  onAction(action, data) {
    if (action === 'help') return this.openHelp();
    if (this.state !== 'flight') return;
    const sim = this.flightSim;
    switch (action) {
      case 'pause':
        if (!this.overlay) {
          this.togglePause();
          this.ui.flash(sim.paused ? 'PAUSA' : 'Ripresa');
        }
        break;
      case 'menu':
        if (this.ui.navOpen) this.ui.toggleNav(false);
        else if (this.ui.keysOpen) this.ui.toggleKeys(false);
        else if (this.view === 'map') this._setView(this._lastFlightView || 'chase');
        else this.openPauseMenu();
        break;
      case 'view-next':
        this._setView(this.view === 'map' ? this._lastFlightView || 'chase' : this.renderer.nextView(1));
        break;
      case 'view-prev':
        this._setView(this.view === 'map' ? this._lastFlightView || 'chase' : this.renderer.nextView(-1));
        break;
      case 'view-cockpit':
        this._setView('cockpit');
        break;
      case 'view-chase':
        this._setView('chase');
        break;
      case 'map':
        this._setView(this.view === 'map' ? this._lastFlightView || 'chase' : 'map');
        break;
      case 'nav':
        this.ui.toggleNav();
        break;
      case 'keys':
        this.ui.toggleKeys();
        break;
      case 'panel-cycle':
        this.ui.cycleMode();
        break;
      case 'hud-toggle':
        this.ui.showHud = !this.ui.showHud;
        this.settings.showHud = this.ui.showHud;
        saveSettings(this.settings);
        this.ui.flash(this.ui.showHud ? 'Simboli HUD attivi' : 'Simboli HUD nascosti');
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
      default:
        break;
    }
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
      if (ev.type === 'crash' && !this.crashShown) {
        this.crashShown = true;
        this.renderer.effects.explode(sim.absolute(sim.ship.ref, sim.ship.pos), sim.absoluteVel(sim.ship.ref, sim.ship.vel));
        this._setView('orbit', true);
        this.renderer.zoomFactor = 2.5;
        this._crashTimer = setTimeout(() => this._showCrash(ev.reason), 4500);
      }
      if (ev.type === 'warp') this.ui.flash(ev.level > 1 ? `Tempo ×${ev.level}` : 'Tempo reale');
    }
    sim.events.length = 0;
  }

  _showCrash(reason) {
    if (this.state !== 'flight') return;
    if (this.runner?.debrief) return this._showDebrief();
    this._openOverlay(new CrashScreen(this.roots.overlay, { reason, retry: () => this.restartFlight(), menu: () => this.showMainMenu() }));
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
    this.togglePause(true);
    this._openOverlay(new DebriefScreen(this.roots.overlay, {
      mission: this.mission,
      debrief: d,
      retry: () => this.restartFlight(),
      missions: () => {
        this.showMainMenu();
        this.showMissions();
      },
      cont: d.success ? () => {
        this._closeOverlay();
        this.togglePause(false);
      } : null,
    }));
  }

  // ------------------------------------------------------------------ main loop
  _frame(now) {
    requestAnimationFrame(this._frame);
    const maxFps = this.renderer?.profile?.maxFps ?? Infinity;
    if (maxFps < 200 && this.lastTime && now - this.lastTime < 1000 / maxFps - 1) return;
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
    sim.events.length = 0;
    sim.messages.length = 0;
    this.renderer.look(dt * 10, 0);
    this.renderer.update(sim, dt);
    this.renderer.render();
  }

  _flightFrame(dt) {
    const sim = this.flightSim;
    const active = this.state === 'flight' && !this.overlay;
    this.touchControls.setEnabled(active && !sim.paused && this.view !== 'map');
    if (active) {
      this.input.update(dt);
      this.touchControls.update();
    }
    if (!(this.overlay && !this.overlay.live)) sim.update(dt);
    if (this.runner && !sim.paused) {
      this.runner.update(dt * sim.timeWarp);
      this.renderer.setMarkers(this.runner.getMarkers());
      if (this.runner.status !== 'running' && !this.debriefShown && !this._debriefTimer) {
        this._debriefTimer = setTimeout(() => {
          this._debriefTimer = null;
          this._showDebrief();
        }, sim.crashed ? 4500 : 1800);
      }
    }
    this._dispatchEvents();
    if (sim.crashed && this.view === 'orbit') this.renderer.yaw += dt * 0.1;
    if (!this.touchMode || !sim.paused || this._needsRender) {
      this.renderer.update(sim, dt);
      this.renderer.render();
      this._needsRender = false;
    }
    this.audio.update(sim, dt, { view: this.view === 'cockpit' ? 'cockpit' : 'external', cameraDistance: this.view === 'cockpit' ? 0 : (sim.def.camera.chaseDist || 20) * this.renderer.zoomFactor });
    this.ui.update(dt);
  }
}
