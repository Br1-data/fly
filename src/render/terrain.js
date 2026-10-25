// Streaming terrain meshes sample the exact height model used by ground physics.
import * as THREE from 'three';
import { getTerrain } from '../world/terrain-height.js';
import { hash2 } from '../core/math.js';

const TILE = 6000;
const COLORS = {
  sand: new THREE.Color(0xc5b583), grass: new THREE.Color(0x78884e),
  forest: new THREE.Color(0x375b3e), rock: new THREE.Color(0x89867c),
  snow: new THREE.Color(0xdce2df), water: new THREE.Color(0x437f8a),
};

export function getTerrainProfile(quality = 'medium') {
  const level = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  return {
    quality: level,
    radius: level === 'low' ? 3 : level === 'high' ? 6 : 5,
    segments: level === 'low' ? [24, 16, 8] : [64, 32, 8],
    treeSamples: level === 'low' ? 30 : level === 'high' ? 180 : 100,
  };
}

export class TerrainTiles {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.terrain = getTerrain();
    this.tiles = new Map();
    this.queue = [];
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.treeMaterial = new THREE.MeshLambertMaterial({ color: 0x35533b });
    this.treeGeometry = new THREE.ConeGeometry(1, 1, 5);
    this.setQuality(quality);
  }

  setQuality(quality) {
    const profile = getTerrainProfile(quality);
    if (profile.quality === this.quality) return;
    this.profile = profile;
    this.quality = profile.quality;
    this.radius = profile.radius;
    this.center = '';
  }

  plan(n, e) {
    const ni = Math.floor(n / TILE), ei = Math.floor(e / TILE);
    const center = `${ni}:${ei}:${this.quality}`;
    if (this.center === center) return;
    this.center = center;
    const wanted = new Set();
    const queue = [];
    for (let dn = -this.radius; dn <= this.radius; dn++) {
      for (let de = -this.radius; de <= this.radius; de++) {
        const distance = Math.max(Math.abs(dn), Math.abs(de));
        const segments = this.profile.segments[distance <= 1 ? 0 : distance <= 2 ? 1 : 2];
        const nn = ni + dn, ee = ei + de, key = `${nn}:${ee}`;
        wanted.add(key);
        const old = this.tiles.get(key);
        if (!old || old.segments !== segments || old.quality !== this.quality) queue.push({ nn, ee, key, segments, priority: dn * dn + de * de });
      }
    }
    for (const [key, tile] of this.tiles) {
      if (!wanted.has(key)) this.remove(key, tile);
    }
    this.queue = queue.sort((a, b) => a.priority - b.priority);
  }

  remove(key, tile) {
    this.scene.remove(tile.group);
    tile.mesh.geometry.dispose();
    // Per-tile instance attributes have their own GPU buffers. Shared geometry and
    // materials stay alive until the entire terrain streamer is disposed.
    tile.group.traverse((object) => { if (object.isInstancedMesh) object.dispose(); });
    this.tiles.delete(key);
  }

  buildOne() {
    const job = this.queue.shift();
    if (!job) return false;
    const { nn, ee, key, segments } = job;
    const n0 = nn * TILE, e0 = ee * TILE;
    // Local vertices avoid float32 jitter over the large world.
    let geometry = new THREE.PlaneGeometry(TILE, TILE, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const p = geometry.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const n = n0 - p.getZ(i), e = e0 + p.getX(i);
      const h = this.terrain.height(n, e);
      p.setY(i, h);
      const surface = h < 1 ? 'sand' : h > 2100 ? 'snow' : h > 1250 ? 'rock' : 'grass';
      c.copy(COLORS[surface]);
      if (surface === 'grass') {
        const forest = this.terrain.forestFactor(n, e, h, 0);
        c.lerp(COLORS.forest, Math.min(0.7, forest));
        const field = this.terrain.fieldCell(n, e);
        c.multiplyScalar(0.85 + field * 0.3);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry = this.addSkirt(geometry, segments);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    const group = new THREE.Group();
    group.position.set(e0, 0, -n0);
    group.add(mesh);
    if (segments >= (this.quality === 'low' ? 24 : 32)) this.addTrees(group, n0, e0, nn, ee);
    const old = this.tiles.get(key);
    if (old) this.remove(key, old);
    this.scene.add(group);
    this.tiles.set(key, { group, mesh, segments, quality: this.quality });
    return true;
  }

  addSkirt(surface, segments) {
    const positions = Array.from(surface.attributes.position.array);
    const colors = Array.from(surface.attributes.color.array);
    const indices = Array.from(surface.index.array);
    const p = surface.attributes.position, c = surface.attributes.color;
    const edges = [[], [], [], []];
    for (let i = 0; i <= segments; i++) {
      edges[0].push(i);
      edges[1].push(i * (segments + 1) + segments);
      edges[2].push((segments + 1) * segments + segments - i);
      edges[3].push((segments - i) * (segments + 1));
    }
    for (const edge of edges) {
      const start = positions.length / 3;
      for (const i of edge) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i), p.getX(i), p.getY(i) - 250, p.getZ(i));
        colors.push(c.getX(i), c.getY(i), c.getZ(i), c.getX(i), c.getY(i), c.getZ(i));
      }
      for (let j = 0; j < edge.length - 1; j++) {
        const a = start + j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    surface.dispose();
    return geometry;
  }

  addTrees(group, n0, e0, nn, ee) {
    const samples = this.profile.treeSamples;
    const trees = new THREE.InstancedMesh(this.treeGeometry, this.treeMaterial, samples);
    const dummy = new THREE.Object3D();
    let count = 0;
    for (let j = 0; j < samples; j++) {
      const n = n0 + (hash2(nn * 281 + j, ee * 17) - 0.5) * TILE;
      const e = e0 + (hash2(nn * 53, ee * 109 + j) - 0.5) * TILE;
      const h = this.terrain.height(n, e);
      if (h < 6 || this.terrain.airportSurface(n, e) || this.terrain.forestFactor(n, e, h, 0) < 0.32) continue;
      const height = 8 + hash2(nn + j * 7, ee) * 14;
      dummy.position.set(e - e0, h + height / 2, -(n - n0));
      dummy.scale.set(height * 0.3, height, height * 0.3);
      dummy.updateMatrix();
      trees.setMatrixAt(count++, dummy.matrix);
    }
    trees.count = count;
    trees.computeBoundingSphere();
    group.add(trees);
  }

  dispose() {
    for (const [key, tile] of this.tiles) this.remove(key, tile);
    this.material.dispose();
    this.treeGeometry.dispose();
    this.treeMaterial.dispose();
  }
}
