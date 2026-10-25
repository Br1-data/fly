import test from 'node:test';
import assert from 'node:assert/strict';
import { isTouchDevice, defaultQuality } from '../src/core/device.js';
import { loadSettings } from '../src/ui/settings-store.js';

test('coarse-pointer defaults are lightweight while explicit quality choices survive', (t) => {
  let coarse = true;
  let stored = null;
  const previous = Object.fromEntries(['matchMedia', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: coarse }) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => stored } } });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  assert.equal(isTouchDevice(), true);
  assert.equal(defaultQuality(), 'low');
  assert.equal(loadSettings().quality, 'low');
  stored = JSON.stringify({ quality: 'high' });
  assert.equal(loadSettings().quality, 'high');
  stored = JSON.stringify({ quality: 'invalid' });
  assert.equal(loadSettings().quality, 'low');
  stored = null;
  coarse = false;
  assert.equal(defaultQuality(), 'medium');
  assert.equal(loadSettings().quality, 'medium');
});
