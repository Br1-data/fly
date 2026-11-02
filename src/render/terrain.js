// Streaming terrain meshes sample the exact height model used by ground physics.
// Vertex colours give the broad land cover (beaches, meadows, forests, rock, snow, towns and
// the sea bed seen through the water); a shader adds field patchworks, hedgerows, forest canopy
// and multi-scale detail that stays sharp from the cockpit up to cruise altitude.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrain, rectDist } from '../world/terrain-height.js';
import { clamp, hash2, smoothstep } from '../core/math.js';
import { applyAtmosphere } from './atmosphere.js';
import { getDetailTexture } from './textures.js';
import { sceneryUniforms } from './materials.js';

const TILE = 6000;
const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  beach: C(0xd8c99c), meadow: C(0x6c8a42), dry: C(0x9b9858), scrub: C(0x5a6b3a),
  alpine: C(0x7b8452), forest: C(0x2e4a28), pine: C(0x263f2c), town: C(0xa39a89),
  rock: C(0x8e877c), darkRock: C(0x655f58), snow: C(0xf0f3f6),
  seabedShallow: C(0xd9cfa3), seabedMid: C(0x6aa197), seabedDeep: C(0x0c3a4a),
};

export function getTerrainProfile(quality = 'medium') {
  const level = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  return {
    quality: level,
    radius: level === 'low' ? 3 : level === 'high' ? 6 : 5,
    segments: level === 'low' ? [24, 16, 8] : [64, 32, 8],
    treeSamples: level === 'low' ? 40 : level === 'high' ? 520 : 260,
  };
}

const TERRAIN_VERTEX_PARS = /* glsl */`
attribute vec4 aTerrain;
varying vec4 vTerrain;
varying vec3 vTerrainPos;
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */`
uniform sampler2D uDetail;
uniform float uNight;
varying vec4 vTerrain;
varying vec3 vTerrainPos;
vec3 terrainLinear(vec3 c) { return pow(c, vec3(2.2)); }
float terrainHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 fieldColor(float h) {
  if (h < 0.17) return vec3(0.80, 0.70, 0.41);  // ripe wheat
  if (h < 0.33) return vec3(0.49, 0.60, 0.29);  // young crop
  if (h < 0.46) return vec3(0.37, 0.48, 0.24);  // lucerne
  if (h < 0.60) return vec3(0.55, 0.43, 0.31);  // ploughed soil
  if (h < 0.71) return vec3(0.67, 0.62, 0.44);  // stubble
  if (h < 0.85) return vec3(0.47, 0.53, 0.35);  // olive grove
  if (h < 0.94) return vec3(0.60, 0.64, 0.38);  // meadow
  return vec3(0.82, 0.71, 0.25);                // sunflowers
}
`;

const TERRAIN_FRAGMENT = /* glsl */`
{
  vec2 wp = vec2(vTerrainPos.x, -vTerrainPos.z);
  vec4 d1 = texture2D(uDetail, wp * (1.0 / 53.0));
  vec4 d2 = texture2D(uDetail, wp * (1.0 / 397.0));
  vec4 d3 = texture2D(uDetail, wp * (1.0 / 2900.0));
  vec3 base = diffuseColor.rgb;
  base *= 0.84 + 0.32 * d3.a;
  base *= 0.9 + 0.2 * d2.g;
  float forest = vTerrain.y;
  base *= mix(1.0, 0.55 + 0.85 * d2.b, forest);
  float fw = vTerrain.x;
  if (fw > 0.01) {
    float ca = cos(vTerrain.z), sa = sin(vTerrain.z);
    vec2 q = vec2(ca * wp.x - sa * wp.y, sa * wp.x + ca * wp.y) + (d3.rg - 0.5) * 140.0;
    vec2 cs = vec2(380.0, 260.0);
    vec2 c = q / cs;
    vec2 id = floor(c);
    vec2 f = fract(c);
    float h = terrainHash(id);
    if (h > 0.55) {
      float k = floor(f.x * 3.0);
      id += vec2(k * 0.31 + 7.0, 3.0);
      f.x = fract(f.x * 3.0);
      cs.x /= 3.0;
      h = terrainHash(id);
    }
    vec3 fc = terrainLinear(fieldColor(h));
    float rows = texture2D(uDetail, vec2(q.x * 0.45, q.y * 0.015)).r;
    fc *= 0.86 + 0.28 * rows;
    vec2 edge = min(f, 1.0 - f) * cs;
    float e = min(edge.x, edge.y);
    float px = max(length(fwidth(q)), 0.001);
    float hedge = 1.0 - smoothstep(1.8, 1.8 + px * 1.5, e);
    fc = mix(fc, terrainLinear(vec3(0.25, 0.31, 0.17)), hedge * (h > 0.3 ? 0.8 : 0.35));
    float detail = 1.0 - smoothstep(30.0, 140.0, px);
    fc = mix(terrainLinear(vec3(0.58, 0.58, 0.37)), fc, detail);
    base = mix(base, fc * (0.9 + 0.2 * d2.g), fw);
  }
  base *= 0.88 + 0.24 * d1.r;
  diffuseColor.rgb = base;
  // Towns glow orange at night: street lighting scattered on the ground.
  terrainCityGlow = vec3(1.0, 0.55, 0.22) * vTerrain.w * uNight * (0.25 + 0.75 * smoothstep(0.35, 0.8, d1.b + d2.g * 0.5)) * 0.16;
}
`;

function createTerrainMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const detail = getDetailTexture();
  return applyAtmosphere(material, 'terrain', (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uNight = sceneryUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrain = aTerrain;\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nvec3 terrainCityGlow = vec3(0.0);\n${TERRAIN_FRAGMENT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += terrainCityGlow;');
  });
}

/** Unit-height tree with its base at the origin; vertex colours: trunk brown, crown green. */
function treeGeometry(kind) {
  const parts = [];
  const paint = (geometry, color, shadeBottom = 0.72) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      // Darker towards the bottom of each crown: cheap ambient occlusion.
      const k = shadeBottom + (1 - shadeBottom) * (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
      colors.set([color.r * k, color.g * k, color.b * k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  };
  const trunk = new THREE.Color(0x5a4632);
  const leaves = new THREE.Color(0xffffff);
  if (kind === 'conifer') {
    paint(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 4, 1, true).translate(0, 0.11, 0), trunk, 1);
    paint(new THREE.ConeGeometry(0.36, 0.55, 6, 1, true).translate(0, 0.42, 0), leaves, 0.55);
    paint(new THREE.ConeGeometry(0.26, 0.45, 6, 1, true).translate(0, 0.76, 0), leaves, 0.65);
  } else {
    paint(new THREE.CylinderGeometry(0.04, 0.06, 0.42, 4, 1, true).translate(0, 0.21, 0), trunk, 1);
    paint(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.82, 1).translate(0, 0.66, 0), leaves, 0.5);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

export class TerrainTiles {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.terrain = getTerrain();
    this.tiles = new Map();
    this.queue = [];
    this.material = createTerrainMaterial();
    this.treeMaterial = applyAtmosphere(new THREE.MeshLambertMaterial({ vertexColors: true }), 'trees');
    this.treeGeometry = treeGeometry('conifer');
    this.broadleafGeometry = treeGeometry('broadleaf');
    this.receiveShadow = false;
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

  /** Distance (m) at which streamed terrain ends in every direction. */
  get visibleRange() {
    return this.radius * TILE;
  }

  setShadows(enabled) {
    this.receiveShadow = enabled;
    for (const tile of this.tiles.values()) tile.mesh.receiveShadow = enabled;
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

  /** Land-cover colour and shader weights (field, forest, field-grid angle) at a vertex. */
  shade(n, e, h, slope, color, extra) {
    const t = this.terrain;
    const lake = t.lakeLevel(n, e);
    const depth = h < 0 ? -h : lake !== null && h < lake ? lake - h : -1;
    if (depth >= 0) {
      color.copy(PALETTE.seabedShallow).lerp(PALETTE.seabedMid, smoothstep(0.4, 7, depth)).lerp(PALETTE.seabedDeep, smoothstep(7, 32, depth));
      extra[0] = extra[1] = extra[2] = extra[3] = 0;
      return;
    }
    const forest = t.forestFactor(n, e, h, slope);
    const city = t.cityFactor(n, e);
    const variation = t.noiseDetail(n, e, 4200);
    color.copy(PALETTE.meadow).lerp(PALETTE.dry, clamp(0.45 + variation * 0.55, 0, 1));
    color.lerp(PALETTE.scrub, smoothstep(350, 900, h) * 0.6);
    color.lerp(PALETTE.alpine, smoothstep(1150, 1650, h) * 0.7);
    color.lerp(h > 800 ? PALETTE.pine : PALETTE.forest, forest * 0.92);
    color.lerp(PALETTE.beach, 1 - smoothstep(1.2, 4.5, h));
    color.lerp(PALETTE.town, clamp(city * 1.3, 0, 0.8));
    const rock = clamp(smoothstep(0.42, 0.85, slope) + smoothstep(1650, 2000, h + variation * 140), 0, 1);
    if (rock > 0) color.lerp(variation > 0 ? PALETTE.rock : PALETTE.darkRock, rock * 0.92);
    const snow = smoothstep(1950, 2150, h + variation * 160) * (1 - smoothstep(0.75, 1.1, slope));
    if (snow > 0) color.lerp(PALETTE.snow, snow);
    let airport = 1;
    for (const flat of t.flats) {
      const r = flat.rect;
      if (Math.abs(n - r.n) + Math.abs(e - r.e) > r.length + r.width + 600) continue;
      airport *= smoothstep(150, 500, rectDist(n, e, r));
    }
    const farmland = smoothstep(-0.3, 0.1, t.noiseDetail(n, e, 11000));
    extra[0] = farmland * (1 - forest) * (1 - smoothstep(380, 650, h)) * (1 - smoothstep(0.12, 0.3, slope))
      * smoothstep(2.5, 6, h) * (1 - clamp(city * 2.5, 0, 1)) * (1 - rock) * airport;
    extra[1] = forest * (1 - rock) * (1 - snow);
    extra[2] = t.fieldAngle(n, e);
    extra[3] = clamp(city * 1.6, 0, 1);
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
    const side = segments + 1;
    const heights = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const h = this.terrain.height(n0 - p.getZ(i), e0 + p.getX(i));
      heights[i] = h;
      p.setY(i, h);
    }
    const colors = new Float32Array(p.count * 3);
    const extras = new Float32Array(p.count * 4);
    const c = new THREE.Color();
    const extra = [0, 0, 0, 0];
    const step = TILE / segments;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const i = row * side + col;
        const c0 = Math.max(col - 1, 0), c1 = Math.min(col + 1, segments);
        const r0 = Math.max(row - 1, 0), r1 = Math.min(row + 1, segments);
        const gx = (heights[row * side + c1] - heights[row * side + c0]) / ((c1 - c0) * step);
        const gz = (heights[r1 * side + col] - heights[r0 * side + col]) / ((r1 - r0) * step);
        this.shade(n0 - p.getZ(i), e0 + p.getX(i), heights[i], Math.hypot(gx, gz), c, extra);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        extras.set(extra, i * 4);
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aTerrain', new THREE.BufferAttribute(extras, 4));
    geometry = this.addSkirt(geometry, segments);
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal;
    // Edge vertices only see triangles on their own side; use central differences that
    // reach into the neighbouring tile so both sides of a seam get the same normal.
    const heightAt = (r, col) => (r >= 0 && r <= segments && col >= 0 && col <= segments
      ? heights[r * side + col]
      : this.terrain.height(n0 + TILE / 2 - r * step, e0 - TILE / 2 + col * step));
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        if (row !== 0 && row !== segments && col !== 0 && col !== segments) continue;
        const dx = (heightAt(row, col + 1) - heightAt(row, col - 1)) / (2 * step);
        const dn = (heightAt(row - 1, col) - heightAt(row + 1, col)) / (2 * step);
        const l = Math.hypot(dx, 1, dn);
        normals.setXYZ(row * side + col, -dx / l, 1 / l, dn / l);
      }
    }
    // Skirts take the normal of the edge they hang from, so cracks between tiles of
    // different detail are shaded like the surface and do not show as lines.
    const { first, sources } = geometry.userData.skirt;
    sources.forEach((src, k) => {
      for (const v of [first + k * 2, first + k * 2 + 1]) normals.setXYZ(v, normals.getX(src), normals.getY(src), normals.getZ(src));
    });
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = this.receiveShadow;
    const group = new THREE.Group();
    group.position.set(e0, 0, -n0);
    group.add(mesh);
    if (segments >= (this.quality === 'low' ? 24 : 32)) this.addTrees(group, n0, e0, nn, ee, segments >= 64 ? 3 : 1);
    const old = this.tiles.get(key);
    if (old) this.remove(key, old);
    this.scene.add(group);
    this.tiles.set(key, { group, mesh, segments, quality: this.quality });
    return true;
  }

  addSkirt(surface, segments) {
    const positions = Array.from(surface.attributes.position.array);
    const names = ['color', 'aTerrain'];
    const data = names.map((name) => Array.from(surface.attributes[name].array));
    const indices = Array.from(surface.index.array);
    const p = surface.attributes.position;
    const edges = [[], [], [], []];
    for (let i = 0; i <= segments; i++) {
      edges[0].push(i);
      edges[1].push(i * (segments + 1) + segments);
      edges[2].push((segments + 1) * segments + segments - i);
      edges[3].push((segments - i) * (segments + 1));
    }
    const first = p.count;
    const sources = [];
    // The skirt slopes slightly under its own tile, so it also covers sub-pixel cracks
    // at the seams when the camera looks straight down (a vertical skirt is seen edge-on).
    const inward = [[0, 8], [-8, 0], [0, -8], [8, 0]];
    edges.forEach((edge, side) => {
      const start = positions.length / 3;
      const [ix, iz] = inward[side];
      for (const i of edge) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i), p.getX(i) + ix, p.getY(i) - 250, p.getZ(i) + iz);
        sources.push(i);
        names.forEach((name, k) => {
          const a = surface.attributes[name];
          for (let copy = 0; copy < 2; copy++) for (let c = 0; c < a.itemSize; c++) data[k].push(a.array[i * a.itemSize + c]);
        });
      }
      for (let j = 0; j < edge.length - 1; j++) {
        const a = start + j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    names.forEach((name, k) => geometry.setAttribute(name, new THREE.Float32BufferAttribute(data[k], surface.attributes[name].itemSize)));
    geometry.setIndex(indices);
    geometry.userData.skirt = { first, sources };
    surface.dispose();
    return geometry;
  }

  addTrees(group, n0, e0, nn, ee, density = 1) {
    const samples = this.profile.treeSamples * density;
    const conifers = new THREE.InstancedMesh(this.treeGeometry, this.treeMaterial, samples);
    const broadleaf = new THREE.InstancedMesh(this.broadleafGeometry, this.treeMaterial, samples);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let nc = 0, nb = 0;
    for (let j = 0; j < samples; j++) {
      const n = n0 + (hash2(nn * 281 + j, ee * 17) - 0.5) * TILE;
      const e = e0 + (hash2(nn * 53, ee * 109 + j) - 0.5) * TILE;
      const h = this.terrain.height(n, e);
      if (h < 6 || h > 1900 || this.terrain.airportSurface(n, e)) continue;
      const r1 = hash2(nn + j * 7, ee), r2 = hash2(j, nn * 31 + ee), r3 = hash2(ee * 13 + j, nn);
      const forest = this.terrain.forestFactor(n, e, h, 0);
      let conifer;
      let height, width;
      if (forest >= 0.3) {
        conifer = h > 650 || r2 < 0.22;
        height = conifer ? 11 + r1 * 13 : 8 + r1 * 8;
        width = height * (conifer ? 0.42 : 0.75);
      } else if (r3 < 0.07 && h < 650 && this.terrain.cityFactor(n, e) < 0.15) {
        // Scattered Mediterranean trees in the open country: slender cypresses and olives.
        conifer = r2 < 0.45;
        height = conifer ? 10 + r1 * 8 : 5 + r1 * 3;
        width = conifer ? height * 0.2 : height * 1.1;
      } else continue;
      dummy.position.set(e - e0, h - 0.4, -(n - n0));
      dummy.rotation.y = r3 * 6.28;
      dummy.scale.set(width, height, width * (0.85 + r2 * 0.3));
      dummy.updateMatrix();
      const shade = 0.75 + r1 * 0.35;
      if (conifer) color.setRGB(0.2 * shade, 0.3 * shade, 0.2 * shade, THREE.SRGBColorSpace);
      else color.setRGB((0.29 + r2 * 0.1) * shade, (0.38 + r3 * 0.07) * shade, 0.19 * shade, THREE.SRGBColorSpace);
      const target = conifer ? conifers : broadleaf;
      const index = conifer ? nc++ : nb++;
      target.setMatrixAt(index, dummy.matrix);
      target.setColorAt(index, color);
    }
    for (const [mesh, count] of [[conifers, nc], [broadleaf, nb]]) {
      mesh.count = count;
      if (count) {
        mesh.computeBoundingSphere();
        group.add(mesh);
      } else mesh.dispose();
    }
  }

  dispose() {
    for (const [key, tile] of this.tiles) this.remove(key, tile);
    this.material.dispose();
    this.treeGeometry.dispose();
    this.broadleafGeometry.dispose();
    this.treeMaterial.dispose();
  }
}
