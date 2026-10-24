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
