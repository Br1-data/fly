import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getRenderProfile, getRenderPixelRatio } from '../src/render/renderer.js';
import { getTerrainProfile, TerrainTiles } from '../src/render/terrain.js';

test('touch rendering caps device-pixel ratio and total framebuffer size', () => {
  for (const quality of ['low', 'medium', 'high']) {
    const profile = getRenderProfile(quality, true);
    const ratio = getRenderPixelRatio(profile, 2560, 1440, 3);
    assert.equal(profile.antialias, false);
    assert.ok(ratio <= 1);
    assert.ok(2560 * 1440 * ratio ** 2 <= profile.maxBufferPixels + 0.001);
  }
  assert.equal(getRenderPixelRatio(getRenderProfile('low', true), 844, 390, 3), 1);
});

test('desktop medium/high retain their existing resolution and detail budgets', () => {
  assert.equal(getRenderPixelRatio(getRenderProfile('medium'), 1920, 1080, 2), 1.5);
  assert.equal(getRenderPixelRatio(getRenderProfile('high'), 1920, 1080, 3), 2);
  assert.equal(getRenderProfile('high').antialias, true);
  assert.deepEqual(getTerrainProfile('medium').segments, [64, 32, 8]);
  assert.equal(getTerrainProfile('medium').radius, 5);
  assert.equal(getTerrainProfile('high').radius, 6);
});

test('low quality materially reduces terrain, vegetation and weather workloads', () => {
  const low = getTerrainProfile('low');
  assert.equal(low.radius, 3);
  assert.deepEqual(low.segments, [24, 16, 8]);
  assert.ok(low.treeSamples < getTerrainProfile('medium').treeSamples);
  const streamer = new TerrainTiles(new THREE.Scene(), 'low');
  streamer.plan(0, 0);
  assert.equal(streamer.queue.length, 49);
  assert.equal(streamer.queue.filter((job) => job.segments === 24).length, 9);
  assert.equal(streamer.queue.filter((job) => job.segments === 16).length, 16);
  assert.equal(streamer.queue.filter((job) => job.segments === 8).length, 24);
  assert.ok(getRenderProfile('low').cloudCount < getRenderProfile('medium').cloudCount);
  assert.ok(getRenderProfile('low').rainCount < getRenderProfile('medium').rainCount);
  streamer.dispose();
});

test('streaming removal disposes per-tile instance buffers and preserves shared resources', () => {
  const scene = new THREE.Scene();
  const streamer = new TerrainTiles(scene, 'low');
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), streamer.material);
  const trees = new THREE.InstancedMesh(streamer.treeGeometry, streamer.treeMaterial, 2);
  group.add(mesh, trees);
  scene.add(group);
  const tile = { group, mesh, segments: 24, quality: 'low' };
  streamer.tiles.set('test', tile);
  let instancesDisposed = 0, geometryDisposed = 0, sharedDisposed = 0;
  trees.addEventListener('dispose', () => instancesDisposed++);
  mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
  streamer.treeGeometry.addEventListener('dispose', () => sharedDisposed++);
  streamer.treeMaterial.addEventListener('dispose', () => sharedDisposed++);
  streamer.material.addEventListener('dispose', () => sharedDisposed++);
  streamer.remove('test', tile);
  assert.equal(instancesDisposed, 1);
  assert.equal(geometryDisposed, 1);
  assert.equal(sharedDisposed, 0);
  assert.equal(group.parent, null);
  assert.equal(streamer.tiles.size, 0);
  streamer.dispose();
  assert.equal(sharedDisposed, 3);
});
