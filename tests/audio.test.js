import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/audio.js';

test('physics-step movement events create bounded, independent sound effects', () => {
  const audio = new AudioEngine();
  audio.context = { currentTime: 5 };
  audio.muted = false;
  const tones = [];
  audio._tone = (...args) => tones.push(args);
  for (let i = 0; i < 240; i++) {
    audio.handleEvent({ type: 'gearMoving' });
    audio.handleEvent({ type: 'flapsMoving' });
  }
  assert.deepEqual(tones.map(([frequency]) => frequency), [140, 220]);
  audio.context.currentTime = 5.41;
  audio.handleEvent({ type: 'gearMoving' });
  audio.handleEvent({ type: 'flapsMoving' });
  assert.equal(tones.length, 3);
  assert.equal(tones[2][0], 220);
  audio.context.currentTime = 5.81;
  audio.handleEvent({ type: 'gearMoving' });
  assert.equal(tones.length, 4);
  assert.equal(tones[3][0], 140);
});

test('muted movement events consume no voice or cooldown', () => {
  const audio = new AudioEngine();
  audio.context = { currentTime: 5 };
  const tones = [];
  audio._tone = (...args) => tones.push(args);
  audio.handleEvent({ type: 'flapsMoving' });
  assert.equal(tones.length, 0);
  audio.muted = false;
  audio.handleEvent({ type: 'flapsMoving' });
  assert.equal(tones.length, 1);
  audio.setAircraft({ id: 'trainer' });
  audio.handleEvent({ type: 'flapsMoving' });
  assert.equal(tones.length, 2, 'new flight resets the movement cooldown');
});

test('speech: radio phraseology reads runways, QNH, headings and frequencies digit by digit', async () => {
  const { radioPhrase, calloutPhrase, sentences } = await import('../src/audio/speech.js');
  const t = radioPhrase('Pista in uso 25. Vento 250 gradi 8 nodi. QNH 1018. TWR 118.70.');
  assert.match(t, /pista in uso due cinque/i);
  assert.match(t, /due cinque zero gradi/);
  assert.match(t, /cu enne acca uno zero uno otto/);
  assert.match(t, /uno uno otto decimale sette/);
  assert.equal(calloutPhrase(2500), 'duemilacinquecento');
  assert.deepEqual(sentences('Uno. Due! Tre?'), ['Uno.', 'Due!', 'Tre?']);
});

test('speech: best Italian voice, callouts interrupt the ATIS and it resumes', async () => {
  const { Speech, pickVoice } = await import('../src/audio/speech.js');
  const voices = [{ name: 'eSpeak Italian', lang: 'it' }, { name: 'Microsoft Elsa Online (Natural) - Italian (Italy)', lang: 'it-IT' },
    { name: 'Google italiano', lang: 'it-IT' }, { name: 'Google US English', lang: 'en-US' }];
  assert.equal(pickVoice(voices).name, 'Microsoft Elsa Online (Natural) - Italian (Italy)');
  assert.equal(pickVoice(voices, 'Google italiano').name, 'Google italiano');
  const spoken = [];
  let cancels = 0;
  const synth = { getVoices: () => voices, speak: (u) => spoken.push(u), cancel: () => cancels++ };
  class Utterance { constructor(text) { this.text = text; } }
  const speech = new Speech(synth, Utterance);
  speech.radio('Aquila informazioni Alfa. Pista in uso 07. QNH 1013.');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].voice.name, voices[1].name);
  assert.equal(spoken[0].lang, 'it-IT');
  speech.callout(500);
  assert.equal(cancels, 1);
  assert.equal(spoken.at(-1).text, 'cinquecento');
  spoken.at(-1).onend();
  assert.equal(spoken.at(-1).text, spoken[0].text, 'the interrupted sentence is spoken again');
  spoken.at(-1).onend();
  assert.match(spoken.at(-1).text, /pista in uso zero sette/i);
  speech.configure({ voice: 'off' });
  const before = spoken.length;
  speech.callout(100);
  assert.equal(spoken.length, before, 'speech switched off');
});
