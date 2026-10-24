// All sounds are synthesised locally; no external assets or network access required.
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  constructor() {
    this.volume = 0.7;
    this.muted = true;
    this.def = null;
    this.context = null;
    this.voices = [];
    this._movementNext = new Map();
    this._onClick = (event) => this.click(event.detail?.kind || 'button');
    globalThis.window?.addEventListener('cieli:click', this._onClick);
  }

  _init() {
    if (this.context) return;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = this.context = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // An air stream gives jet engines and airspeed a broadband component.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 1500;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    source.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    source.start();
    this.noise = source;
    // Persistent voices avoid creating WebAudio nodes every animation frame.
    for (let i = 0; i < 2; i++) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      oscillator.connect(filter).connect(gain).connect(this.master);
      oscillator.start();
      this.voices.push({ oscillator, filter, gain });
    }
    this.warning = ctx.createOscillator();
    this.warning.type = 'sine';
    this.warning.frequency.value = 950;
    this.warningGain = ctx.createGain();
    this.warningGain.gain.value = 0;
    this.warning.connect(this.warningGain).connect(this.master);
    this.warning.start();
  }

  async resume() {
    this._init();
    if (this.context?.state === 'suspended') await this.context.resume();
  }
  setAircraft(def) { this.def = def; this._movementNext.clear(); }
  setVolume(value) {
    this.volume = clamp(Number(value) || 0);
    this._updateMaster();
    if (this.volume === 0) globalThis.speechSynthesis?.cancel();
  }
  setMuted(value) {
    this.muted = !!value;
    this._updateMaster();
    if (this.muted) globalThis.speechSynthesis?.cancel();
  }
  _updateMaster() {
    if (this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.04);
  }

  update(sim, dt, { view = 'cockpit', cameraDistance = 0 } = {}) {
    if (!this.context || !sim.fm) return;
    const ctx = this.context;
    const time = ctx.currentTime;
    const fm = sim.fm;
    const interior = view === 'cockpit' ? 0.55 : 1;
    const attenuation = view === 'cockpit' ? 1 : 1 / (1 + Math.max(0, cameraDistance - 8) / 80);
    const active = !sim.paused && !sim.crashed;
    let jetPower = 0;
    this.voices.forEach((voice, i) => {
      const engine = fm.engines[i];
      let frequency = 30;
      let level = 0;
      if (engine && active) {
        if (engine.type === 'piston') {
          const rpm = Math.max(0, engine.rpm || 0);
          frequency = Math.max(12, rpm / 60 * 2);
          level = clamp(rpm / 2600) * (0.025 + clamp(engine.throttle || 0) * 0.045);
          voice.filter.frequency.setTargetAtTime(300 + rpm * 0.3, time, 0.1);
        } else {
          const n1 = clamp((engine.n1 || 0) / 100);
          frequency = 70 + n1 * 450;
          level = n1 * 0.035;
          jetPower += n1;
          voice.filter.frequency.setTargetAtTime(300 + n1 * 1800, time, 0.1);
        }
      }
      voice.oscillator.frequency.setTargetAtTime(frequency, time, 0.08);
      voice.gain.gain.setTargetAtTime(level * interior * attenuation, time, 0.08);
    });
    const wind = clamp((fm.iasKt || 0) / 300);
    const rain = sim.atm?.precip || 0;
    this.noiseGain.gain.setTargetAtTime(active ? (wind * wind * 0.025 + jetPower * 0.05 + rain * 0.012) * interior * attenuation : 0, time, 0.1);
    this.noiseFilter.frequency.setTargetAtTime(800 + wind * 2200 + jetPower * 800, time, 0.1);
    const stall = active && fm.stallWarning;
    const overspeed = active && fm.overspeed;
    this.warning.frequency.setTargetAtTime(stall ? 950 : 650, time, 0.03);
    const pulse = Math.floor(time * 4) % 2 === 0;
    this.warningGain.gain.setTargetAtTime(stall || (overspeed && pulse) ? 0.09 : 0, time, 0.02);
  }

  _tone(frequency, duration = 0.1, volume = 0.07, delay = 0, type = 'sine') {
    if (this.muted || this.volume === 0 || !this.context) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  click(kind = 'button') {
    this._tone(kind === 'switch' ? 1500 : kind === 'knob' ? 2200 : kind === 'lever' ? 500 : 1000, 0.045, 0.025, 0, 'triangle');
  }
  _movementSound(type, frequency, duration, volume) {
    if (!this.context || this.muted || this.volume === 0) return;
    const now = this.context.currentTime;
    if (now < (this._movementNext.get(type) ?? -Infinity)) return;
    this._movementNext.set(type, now + duration);
    this._tone(frequency, duration, volume, 0, 'triangle');
  }
  handleEvent(event) {
    if (!event) return;
    switch (event.type) {
      case 'callout': this.speak(String(event.value)); break;
      case 'atis': this.speak(event.text); break;
      case 'touchdown': this._tone(65, 0.25, 0.15, 0, 'triangle'); break;
      case 'crash': this._tone(45, 0.6, 0.2, 0, 'sawtooth'); break;
      case 'gearMoving': this._movementSound(event.type, 140, 0.8, 0.035); break;
      case 'flapsMoving': this._movementSound(event.type, 220, 0.4, 0.025); break;
      case 'marker': this._tone(event.which === 'OM' ? 400 : 1300, 0.2, 0.08); break;
      case 'failure': this._tone(550, 0.3, 0.1); this._tone(440, 0.3, 0.1, 0.3); break;
      case 'ap':
        if (event.what?.startsWith('disengage')) {
          this._tone(880, 0.15); this._tone(660, 0.15, 0.07, 0.16); this._tone(880, 0.15, 0.07, 0.32);
        } else this._tone(900, 0.08, 0.025);
        break;
      default: break;
    }
  }
  speak(text) {
    if (this.muted || this.volume === 0 || !text || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = 'it-IT';
    utterance.volume = this.volume;
    utterance.rate = 1.05;
    // A new callout or ATIS replaces stale queued speech.
    globalThis.speechSynthesis.cancel();
    globalThis.speechSynthesis.speak(utterance);
  }
  destroy() {
    globalThis.window?.removeEventListener('cieli:click', this._onClick);
    globalThis.speechSynthesis?.cancel();
    this.voices.forEach((voice) => voice.oscillator.stop());
    this.warning?.stop();
    this.noise?.stop();
    this.context?.close();
    this.context = null;
    this.voices = [];
  }
}
