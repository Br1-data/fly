import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { deviceClass, isIPad, defaultQuality } from '../src/core/device.js';
import { getRenderProfile, getRenderPixelRatio } from '../src/render/renderer.js';
import { buildTileData, TILE } from '../src/render/terrain-build.js';
import { TerrainTiles } from '../src/render/terrain.js';

function withGlobals(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

test('iPads are tablets even with the desktop-class (Macintosh) user agent and a trackpad', (t) => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.equal(isIPad({ userAgent: mac, maxTouchPoints: 5 }), true);
  assert.equal(isIPad({ userAgent: mac, maxTouchPoints: 0 }), false, 'a real Mac is not an iPad');
  assert.equal(isIPad({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', maxTouchPoints: 5 }), true);
  withGlobals(t, {
    navigator: { userAgent: mac, maxTouchPoints: 5 },
    matchMedia: () => ({ matches: false }),
    screen: { width: 1180, height: 820 },
  });
  assert.equal(deviceClass(), 'tablet');
  assert.equal(defaultQuality(), 'medium');
});

test('touch screens split into phones and tablets by their short side', (t) => {
  let screen = { width: 390, height: 844 };
  withGlobals(t, {
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 },
    matchMedia: () => ({ matches: true }),
  });
  Object.defineProperty(globalThis, 'screen', { configurable: true, get: () => screen });
  t.after(() => { delete globalThis.screen; });
  assert.equal(deviceClass(), 'phone');
  assert.equal(defaultQuality(), 'low');
  screen = { width: 800, height: 1280 };
  assert.equal(deviceClass(), 'tablet');
  assert.equal(defaultQuality(), 'medium');
});

test('tablet profiles are sharper and smoother than phones but stay within a buffer budget', () => {
  const phone = getRenderProfile('medium', 'phone');
  const tablet = getRenderProfile('medium', 'tablet');
  assert.equal(getRenderProfile('medium', true).device, 'phone', 'the old boolean still means phone');
  assert.equal(tablet.antialias, true);
  assert.equal(tablet.maxFps, 60);
  assert.equal(phone.maxFps, 30);
  assert.equal(getRenderProfile('low', 'tablet').maxFps, 30, 'low quality saves battery');
  assert.equal(getRenderProfile('medium').maxFps, Infinity, 'desktop is not capped');
  assert.ok(tablet.dynamicResolution && phone.dynamicResolution && !getRenderProfile('high').dynamicResolution);
  // iPad Air 11" (1180×820 @2x): 1.5× of CSS pixels; iPad Pro 13" (1366×1024 @2x) too.
  assert.equal(getRenderPixelRatio(tablet, 1180, 820, 2), 1.5);
  assert.equal(getRenderPixelRatio(tablet, 1366, 1024, 2), 1.5);
  for (const quality of ['low', 'medium', 'high']) {
    const profile = getRenderProfile(quality, 'tablet');
    const ratio = getRenderPixelRatio(profile, 1366, 1024, 2);
    assert.ok(1366 * 1024 * ratio ** 2 <= profile.maxBufferPixels + 1);
    assert.ok(ratio >= 1, `${quality}: never below the screen's own CSS resolution`);
  }
});

test('terrain tiles built off the main thread share seams with their neighbours', () => {
  const a = buildTileData({ nn: 1, ee: 2, segments: 16 });
  const b = buildTileData({ nn: 1, ee: 3, segments: 16 });
  const side = 17;
  for (let row = 0; row < side; row++) {
    const ia = row * side + 16, ib = row * side;
    for (let k = 0; k < 3; k++) {
      assert.equal(a.positions[ia * 3 + k], b.positions[ib * 3 + k], 'shared edge vertex');
      assert.ok(Math.abs(a.normals[ia * 3 + k] - b.normals[ib * 3 + k]) < 1e-6, 'shared edge normal');
    }
  }
  assert.equal(a.positions[0], 2 * TILE - TILE / 2, 'world coordinates (east)');
  assert.equal(a.index.length, 16 * 16 * 6 + 4 * 16 * 6);
  for (const v of a.index) assert.ok(v < a.positions.length / 3);
  const forest = buildTileData({ nn: 2, ee: 4, segments: 32, treeSamples: 260 });
  const trees = forest.trees.conifer.matrices.length / 16 + forest.trees.broadleaf.matrices.length / 16;
  assert.ok(trees > 0, 'trees are generated');
  assert.equal(forest.trees.conifer.colors.length / 3, forest.trees.conifer.matrices.length / 16);
});

test('worker results for tiles that are no longer wanted are discarded', () => {
  const streamer = new TerrainTiles(new THREE.Scene(), 'low');
  streamer.plan(0, 0);
  const job = streamer.queue.shift();
  job.id = 99;
  streamer.inFlight.set(99, job);
  streamer.inFlightKeys.add(streamer._signature(job));
  streamer.plan(60000, 60000); // far away: the old tile is not needed any more
  streamer._receive({ id: 99, data: buildTileData(streamer._jobData(job)) });
  assert.equal(streamer.tiles.has(job.key), false);
  assert.equal(streamer.inFlight.size, 0);
  // Without a Worker (Node) streaming falls back to one synchronous tile per call.
  const before = streamer.queue.length;
  streamer.stream();
  assert.equal(streamer.queue.length, before - 1);
  assert.equal(streamer.tiles.size, 1);
  streamer.dispose();
});

test('dynamic resolution trades sharpness for frame rate and recovers', async () => {
  const { SceneRenderer } = await import('../src/render/renderer.js');
  const ratios = [];
  const fake = {
    profile: getRenderProfile('medium', 'tablet'), dynamicResolution: true, resolutionScale: 1, baseRatio: 1.5,
    width: 1180, height: 820, _frames: { last: 0, ema: 0, changed: 0, good: 0 },
    webgl: { setPixelRatio: (r) => ratios.push(r), setSize() {} },
  };
  const run = (interval, seconds, start) => {
    let now = start;
    for (let t = 0; t < seconds * 1000; t += interval) { now += interval; SceneRenderer.prototype.adaptResolution.call(fake, now); }
    return now;
  };
  let now = run(16.7, 2, 1000);
  assert.equal(fake.resolutionScale, 1, 'smooth frames keep full resolution');
  now = run(45, 8, now);
  assert.ok(fake.resolutionScale < 0.75 && fake.resolutionScale >= 0.6, `slow frames lower the resolution (${fake.resolutionScale})`);
  assert.ok(Math.min(...ratios) >= 1.5 * 0.6 - 1e-9);
  run(16.7, 35, now + 500);
  assert.equal(fake.resolutionScale, 1, 'fluid frames bring it back');
  const paused = fake.resolutionScale;
  SceneRenderer.prototype.adaptResolution.call(fake, now + 100000);
  assert.equal(fake.resolutionScale, paused, 'a long pause is ignored');
});

test('iPhones get a sharp Apple-GPU profile, also in Safari desktop-website mode', (t) => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  let nav = { userAgent: iphone, maxTouchPoints: 5 };
  withGlobals(t, { matchMedia: () => ({ matches: true }), screen: { width: 393, height: 852 } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => nav });
  t.after(() => { delete globalThis.navigator; });
  assert.equal(deviceClass(), 'iphone');
  assert.equal(defaultQuality(), 'medium');
  nav = { userAgent: mac, maxTouchPoints: 5 };
  assert.equal(deviceClass(), 'iphone', 'Mac user agent on a phone-sized touch screen');
  const profile = getRenderProfile('medium', 'iphone');
  assert.equal(profile.antialias, true);
  assert.equal(profile.maxFps, 60);
  assert.equal(getRenderPixelRatio(profile, 393, 852, 3), 2, 'iPhone 16: 2× instead of a soft 1×');
  assert.ok(440 * 956 * getRenderPixelRatio(getRenderProfile('high', 'iphone'), 440, 956, 3) ** 2 <= 3_100_000 + 1);
  assert.equal(getRenderProfile('low', 'iphone').maxFps, 30);
  assert.equal(getRenderPixelRatio(getRenderProfile('low', 'iphone'), 393, 852, 3), 1);
  // Other phones keep the light defaults.
  nav = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', maxTouchPoints: 5 };
  assert.equal(deviceClass(), 'phone');
  assert.equal(defaultQuality(), 'low');
});
