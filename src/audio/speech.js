// Spoken ATIS and cockpit callouts with the browser's speech synthesis.
// - picks the most natural Italian voice available (neural/online voices first) and
//   lets the player choose another one or switch speech off;
// - reads radio phraseology the way controllers do: runways, headings, QNH and
//   frequencies digit by digit ("pista due cinque", "QNH uno zero uno otto");
// - speaks sentence by sentence (long utterances are cut off by Chrome and stall on
//   iOS), so a callout can interrupt the ATIS and the broadcast resumes afterwards.

const DIGITS = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove'];

/** "250" → "due cinque zero". */
export function digits(value) {
  return String(value).replace(/\D/g, '').split('').map((d) => DIGITS[+d]).join(' ');
}

/** Italian radiotelephony for an ATIS or ATC text. */
export function radioPhrase(text) {
  return String(text)
    // Frequencies: 118.70 → uno uno otto decimale sette zero
    .replace(/\b(\d{3})[.,](\d{1,3})\b/g, (_, a, b) => `${digits(a)} decimale ${digits(b.replace(/0+$/, '') || '0')}`)
    .replace(/\bQNH\s+(\d{3,4})\b/gi, (_, v) => `cu enne acca ${digits(v)}`)
    .replace(/\b(pista(?: in uso)?)\s+(\d{2})([LRC]?)\b/gi, (_, w, n, side) => `${w} ${digits(n)}${side ? { L: ' sinistra', R: ' destra', C: ' centrale' }[side.toUpperCase()] : ''}`)
    .replace(/\b(\d{3})\s+gradi\b/g, (_, v) => `${digits(v)} gradi`)
    // Natural pauses between wind direction, speed and gusts.
    .replace(/gradi (\d+) nodi(?= raffiche)/g, 'gradi, $1 nodi,')
    .replace(/gradi (\d+) nodi/g, 'gradi, $1 nodi')
    .replace(/\brotta\s+(\d{3})\b/gi, (_, v) => `rotta ${digits(v)}`)
    .replace(/\bQNH\b/g, 'cu enne acca')
    .replace(/\bATIS\b/g, 'atis')
    .replace(/\bILS\b/g, 'i elle esse')
    .replace(/\bVOR\b/g, 'vor')
    .replace(/\bft\b/g, 'piedi')
    .replace(/\bkt\b/g, 'nodi')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Altitude callouts in words that every Italian voice pronounces well. */
export function calloutPhrase(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const words = { 2500: 'duemilacinquecento', 1000: 'mille', 500: 'cinquecento', 400: 'quattrocento', 300: 'trecento', 200: 'duecento',
    100: 'cento', 50: 'cinquanta', 40: 'quaranta', 30: 'trenta', 20: 'venti', 10: 'dieci' };
  return words[n] || String(n);
}

/** Splits a broadcast into sentences short enough to be spoken reliably. */
export function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Higher is better: natural/neural voices, then Google/Apple premium ones, local before remote. */
export function voiceScore(voice) {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-');
  if (!lang.startsWith('it')) return -1;
  const name = voice.name || '';
  let score = lang === 'it-it' ? 10 : 5;
  if (/natural|neural|online/i.test(name)) score += 40;
  if (/google/i.test(name)) score += 30;
  if (/premium|enhanced|siri/i.test(name)) score += 25;
  if (/alice|federica|elsa|isabella|diego|cosimo|luca|paola|emma/i.test(name)) score += 8;
  if (/compact|espeak/i.test(name)) score -= 20;
  if (voice.localService) score += 2;
  return score;
}

export function pickVoice(voices, preferred = '') {
  if (preferred) {
    const chosen = voices.find((v) => v.name === preferred);
    if (chosen) return chosen;
  }
  let best = null, bestScore = -1;
  for (const v of voices) {
    const s = voiceScore(v);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

export class Speech {
  constructor(synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
    this.synth = synth || null;
    this.Utterance = Utterance || null;
    this.voiceName = '';
    this.enabled = true;
    this.rate = 1;
    this.volume = 0.8;
    this.voice = null;
    this.queue = [];
    this.current = null;
    this.onRadio = null; // (phase: 'start' | 'end') → squelch clicks
    this._loadVoices();
    this.synth?.addEventListener?.('voiceschanged', () => this._loadVoices());
  }

  get available() { return !!(this.synth && this.Utterance); }

  /** Italian voices for the settings list, best first. */
  italianVoices() {
    return (this.synth?.getVoices?.() || []).filter((v) => voiceScore(v) >= 0).sort((a, b) => voiceScore(b) - voiceScore(a));
  }

  configure({ voice = this.voiceName, rate = this.rate, volume = this.volume } = {}) {
    this.voiceName = voice === 'off' ? '' : voice || '';
    this.enabled = voice !== 'off';
    this.rate = Math.min(1.4, Math.max(0.7, Number(rate) || 1));
    this.volume = volume;
    this._loadVoices();
    if (!this.enabled) this.stop();
  }

  _loadVoices() {
    const voices = this.synth?.getVoices?.() || [];
    this.voice = pickVoice(voices, this.voiceName);
  }

  /** iOS only speaks after a gesture has spoken once: prime it with a silent utterance. */
  unlock() {
    if (this._unlocked || !this.available) return;
    this._unlocked = true;
    const u = new this.Utterance(' ');
    u.volume = 0;
    try { this.synth.speak(u); } catch { /* ignore */ }
  }

  /** Radio broadcast (ATIS): queued sentence by sentence, low priority. */
  radio(text) {
    if (!this.enabled || !this.available || !text) return;
    this.queue = this.queue.filter((item) => item.kind !== 'radio');
    const parts = sentences(radioPhrase(text));
    parts.forEach((part, i) => this.queue.push({ kind: 'radio', text: part, rate: this.rate * 0.97, first: i === 0, last: i === parts.length - 1 }));
    if (this.current?.kind === 'radio') this._cancelCurrent();
    this._next();
  }

  /** Cockpit callout: interrupts the radio, replaces any older pending callout. */
  callout(value) {
    if (!this.enabled || !this.available) return;
    this.queue = this.queue.filter((item) => item.kind !== 'callout');
    this.queue.unshift({ kind: 'callout', text: calloutPhrase(value), rate: this.rate * 1.12, at: Date.now() });
    if (this.current?.kind === 'radio') {
      // Resume the interrupted sentence after the callout.
      this.queue.splice(1, 0, { ...this.current.item, first: false });
      this._cancelCurrent();
    }
    if (!this.current) this._next();
  }

  /** Plain text (messages, help): spoken as is, after anything already queued. */
  say(text) {
    if (!this.enabled || !this.available || !text) return;
    for (const part of sentences(text)) this.queue.push({ kind: 'text', text: part, rate: this.rate });
    this._next();
  }

  stop() {
    this.queue = [];
    this._cancelCurrent();
  }

  _cancelCurrent() {
    const cur = this.current;
    this.current = null;
    if (cur) {
      cur.cancelled = true;
      clearTimeout(cur.timer);
    }
    try { this.synth?.cancel(); } catch { /* ignore */ }
  }

  _next() {
    if (this.current || !this.queue.length || !this.available) return;
    const item = this.queue.shift();
    // A callout that waited too long is no longer true: drop it.
    if (item.kind === 'callout' && Date.now() - item.at > 2500) return this._next();
    const u = new this.Utterance(item.text);
    u.lang = this.voice?.lang || 'it-IT';
    if (this.voice) u.voice = this.voice;
    u.rate = item.rate;
    u.pitch = item.kind === 'callout' ? 0.9 : 1;
    u.volume = this.volume;
    const cur = { item, kind: item.kind, cancelled: false };
    this.current = cur;
    if (item.kind === 'radio' && item.first) this.onRadio?.('start');
    const done = () => {
      clearTimeout(cur.timer);
      if (cur.cancelled || this.current !== cur) return;
      this.current = null;
      if (item.kind === 'radio' && item.last) this.onRadio?.('end');
      this._next();
    };
    u.onend = done;
    u.onerror = done;
    // Safety net: some engines never fire onend (backgrounded tabs, iOS).
    cur.timer = setTimeout(done, 1500 + item.text.length * 110 / item.rate);
    cur.timer?.unref?.();
    u.onstart = () => {
      clearTimeout(cur.timer);
      cur.timer = setTimeout(done, 1000 + item.text.length * 140 / item.rate);
      cur.timer?.unref?.();
    };
    try { this.synth.speak(u); } catch { done(); }
  }
}
