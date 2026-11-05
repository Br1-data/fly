// Synthesised sound. In vacuum there is no sound outside the vehicle: engines and thrusters
// are heard only through the structure in the cockpit view; in an atmosphere they are heard
// outside too, together with the wind and the re-entry plasma. Italian voice callouts.
import { Speech } from './speech.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const WORDS = { 1000: 'mille metri', 500: 'cinquecento', 200: 'duecento', 100: 'cento', 50: 'cinquanta', 20: 'venti', 10: 'dieci', 5: 'cinque' };

export class AudioEngine {
  constructor() {
    this.volume = 0.7;
    this.muted = true;
    this.context = null;
    this.speech = new Speech();
    this._onClick = (e) => this.click(e.detail?.kind || 'button');
    globalThis.window?.addEventListener('cieli:click', this._onClick);
    this._alarmNext = 0;
  }

  _noise(seconds = 2) {
    const ctx = this.context;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = b * 0.97 + (Math.random() * 2 - 1) * 0.3;
      d[i] = b;
    }
    return buf;
  }

  _init() {
    if (this.context) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.context = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    const loop = (filterType, freq) => {
      const src = ctx.createBufferSource();
      src.buffer = this._noise(3);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { src, f, g };
    };
    this.engine = loop('lowpass', 180);
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'sawtooth';
    this.rumble.frequency.value = 38;
    this.rumbleF = ctx.createBiquadFilter();
    this.rumbleF.type = 'lowpass';
    this.rumbleF.frequency.value = 120;
    this.rumbleG = ctx.createGain();
    this.rumbleG.gain.value = 0;
    this.rumble.connect(this.rumbleF).connect(this.rumbleG).connect(this.master);
    this.rumble.start();
    this.rcs = loop('highpass', 2600);
    this.wind = loop('bandpass', 700);
    this.wheel = ctx.createOscillator();
    this.wheel.type = 'sine';
    this.wheel.frequency.value = 420;
    this.wheelG = ctx.createGain();
    this.wheelG.gain.value = 0;
    this.wheel.connect(this.wheelG).connect(this.master);
    this.wheel.start();
    this.alarm = ctx.createOscillator();
    this.alarm.type = 'square';
    this.alarm.frequency.value = 880;
    this.alarmG = ctx.createGain();
    this.alarmG.gain.value = 0;
    const af = ctx.createBiquadFilter();
    af.type = 'lowpass';
    af.frequency.value = 1800;
    this.alarm.connect(af).connect(this.alarmG).connect(this.master);
    this.alarm.start();
  }

  async resume() {
    this._init();
    this.speech.unlock();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  setAircraft() {}
  setShip() {}

  setVolume(v) {
    this.volume = clamp(Number(v) || 0);
    this._master();
    this.speech.configure({ volume: Math.min(1, this.volume * 1.15) });
  }

  setMuted(v) {
    this.muted = !!v;
    this._master();
    if (this.muted) this.speech.stop();
  }

  setSpeech({ voice = '', rate = 1 } = {}) {
    this.speech.configure({ voice, rate });
  }

  _master() {
    if (this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.04);
  }

  update(sim, dt, { view = 'cockpit', cameraDistance = 0 } = {}) {
    if (!this.context || !sim.ship) return;
    const ctx = this.context, now = ctx.currentTime;
    const s = sim.ship;
    const active = !sim.paused && !s.destroyed;
    const body = sim.body;
    const rho = s.dynPressure > 0 && s.airspeed > 0 ? (2 * s.dynPressure) / (s.airspeed * s.airspeed) : 0;
    const air = clamp(rho / 0.2);
    const inside = view === 'cockpit';
    // Outside the vehicle sound needs air; inside it travels through the structure.
    const carry = inside ? 0.75 : air * (1 / (1 + Math.max(0, cameraDistance - 10) / 60));
    const st = s.engineStage;
    const power = active && st && s.thrust > 0 ? clamp(s.thrust / st.engine.thrustVac) : 0;
    const big = st ? clamp(Math.log10(st.engine.thrustVac / 1000) / 4) : 0; // 0 small, 1 huge
    const target = (g, v) => g.gain.setTargetAtTime(v, now, 0.08);
    target(this.engine.g, power * carry * (0.08 + big * 0.22));
    this.engine.f.frequency.setTargetAtTime(140 + power * (300 - big * 150) + air * 500, now, 0.1);
    target(this.rumbleG, power * carry * (0.05 + big * 0.12));
    this.rumble.frequency.setTargetAtTime(28 + power * 18 - big * 8, now, 0.1);
    const a = s.rcsActivity;
    const rcs = active && s.rcsEnabled ? clamp(Math.abs(a.trans.x) + Math.abs(a.trans.y) + Math.abs(a.trans.z) + Math.abs(a.rot.x) + Math.abs(a.rot.y) + Math.abs(a.rot.z)) : 0;
    target(this.rcs.g, rcs * carry * 0.05);
    const spin = active ? clamp(Math.abs(s.cmd.rot.x) + Math.abs(s.cmd.rot.y) + Math.abs(s.cmd.rot.z)) : 0;
    target(this.wheelG, inside ? spin * 0.006 : 0);
    // Wind and plasma roar in the atmosphere.
    const q = clamp(s.dynPressure / 30000);
    const plasma = clamp((s.heatFlux || 0) / 400000);
    target(this.wind.g, active ? (q * 0.08 + plasma * 0.12) * (inside ? 0.6 : 1) * (body.atmosphere ? 1 : 0) : 0);
    this.wind.f.frequency.setTargetAtTime(400 + q * 900 + plasma * 600, now, 0.15);
    // Master alarm: overheating, overload, low propellant during a burn, terrain closure.
    const heat = s.tempLimit ? s.temperature / s.tempLimit : 0;
    const descent = s.vel.dot(s.pos.clone().normalize());
    const terrain = s.agl < 300 && descent < -25 && !s.landed;
    const fuelLow = st && st.fuel > 0 && st.fuelLeft / st.fuel < 0.05 && s.engineOn;
    const alarm = active && (heat > 0.85 || s.gForce > (s.def.gLimit || 12) * 0.85 || terrain || fuelLow);
    const pulse = Math.floor(now * 3) % 2 === 0;
    this.alarmG.gain.setTargetAtTime(alarm && pulse ? 0.035 : 0, now, 0.01);
  }

  _tone(freq, dur = 0.1, vol = 0.07, delay = 0, type = 'sine') {
    if (this.muted || !this.context || this.volume === 0) return;
    const ctx = this.context;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  _thump(freq = 60, dur = 0.5, vol = 0.3, noise = 0.2) {
    if (this.muted || !this.context) return;
    const ctx = this.context, t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.8, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    if (noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this._noise(Math.max(0.2, dur));
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(noise, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      src.connect(lp).connect(ng).connect(this.master);
      src.start(t0);
    }
  }

  click(kind = 'button') {
    this._tone(kind === 'switch' ? 1500 : 1000, 0.04, 0.02, 0, 'triangle');
  }

  say(text) {
    if (!this.muted && this.volume > 0) this.speech.say(text);
  }

  handleEvent(ev) {
    switch (ev.type) {
      case 'callout':
        if (!this.muted && this.volume > 0) this.speech.say(WORDS[ev.value] || String(ev.value));
        break;
      case 'dock':
        this._thump(90, 0.35, 0.25, 0.3);
        this._tone(660, 0.15, 0.05, 0.4);
        this._tone(990, 0.2, 0.05, 0.6);
        this.say('Aggancio confermato.');
        break;
      case 'undock':
        this._thump(120, 0.25, 0.15, 0.1);
        break;
      case 'dock-fail':
      case 'collision':
        this._thump(70, 0.4, 0.3, 0.4);
        break;
      case 'stage':
        this._thump(50, 0.8, 0.45, 0.5);
        this.say('Separazione.');
        break;
      case 'parachute':
        this._thump(140, 0.3, 0.2, 0.4);
        break;
      case 'chute-torn':
        this._thump(200, 0.2, 0.3, 0.5);
        break;
      case 'splashdown':
        this._thump(45, 1.2, 0.4, 0.8);
        this.say('Ammaraggio.');
        break;
      case 'touchdown':
        this._thump(55, 0.4, Math.min(0.4, 0.05 + ev.speed * 0.06), 0.2);
        break;
      case 'landed':
        this.say(ev.water ? 'Capsula in acqua, stabile.' : 'Contatto. Motore spento.');
        break;
      case 'ignition':
        this._thump(40, 0.6, 0.12, 0.3);
        break;
      case 'sas':
      case 'rcs':
        this._tone(ev.on ? 880 : 520, 0.07, 0.025);
        break;
      case 'warp':
        this._tone(ev.level > 1 ? 1200 : 700, 0.06, 0.02);
        break;
      case 'node':
        this._tone(1100, 0.08, 0.03);
        this._tone(1400, 0.08, 0.03, 0.1);
        break;
      case 'burn-complete':
        this.say('Manovra completata.');
        break;
      case 'orbit':
        this.say('Orbita raggiunta.');
        break;
      case 'soi':
        this._tone(500, 0.2, 0.03);
        this._tone(750, 0.3, 0.03, 0.2);
        break;
      case 'crash':
        this._explosion();
        break;
      default:
        break;
    }
  }

  _explosion() {
    if (!this.context || this.muted) return;
    this._thump(40, 3, 0.5, 0.6);
  }

  speak(text) {
    this.say(text);
  }

  destroy() {
    globalThis.window?.removeEventListener('cieli:click', this._onClick);
    this.speech.stop();
    this.context?.close();
    this.context = null;
  }
}
