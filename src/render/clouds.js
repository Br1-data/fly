// Billboard cloud system: every cloud is a cluster of soft, camera-facing puffs lit by the sun
// (bright tops, shaded bases, silver lining against the light). Clouds are anchored to a world
// grid so they never jump when the aircraft moves; an overcast layer adds a continuous deck.
import * as THREE from 'three';
import { FOG_FRAGMENT, FOG_PARS_FRAGMENT, FOG_PARS_VERTEX, FOG_VERTEX, fogUniforms } from './atmosphere.js';
import { getCloudTexture, getDetailTexture } from './textures.js';
import { clamp, hash2 } from '../core/math.js';

const CELL = 5000;
const RANGE = 6; // cells around the camera (±30 km)

const PUFF_VERTEX = /* glsl */`
attribute vec3 aCenter;
attribute vec4 aParams; // size, height in cloud (0..1), atlas tile, rotation
attribute vec3 aOffset; // direction from the cluster centre
uniform vec3 uLightDir;
varying vec2 vUv;
varying float vShade;
varying float vAlpha;
varying float vSunFacing;
varying vec2 vRot;
varying vec3 vLightView;
${FOG_PARS_VERTEX}
void main() {
  vec4 world = modelMatrix * vec4(aCenter, 1.0);
  vec4 mvCenter = viewMatrix * world;
  float size = aParams.x;
  float cr = cos(aParams.w), sr = sin(aParams.w);
  vec2 corner = vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y);
  vec4 mvPosition = mvCenter + vec4(corner * size, 0.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  float tile = aParams.z;
  vUv = (uv + vec2(mod(tile, 2.0), floor(tile / 2.0))) * 0.5;
  float sunSide = dot(aOffset, uLightDir) * 0.5 + 0.5;
  vShade = clamp(aParams.y * 0.62 + sunSide * 0.5, 0.0, 1.0);
  float dist = length(mvCenter.xyz);
  vAlpha = smoothstep(size * 0.2, size * 1.2, dist);
  vSunFacing = pow(max(dot(normalize(world.xyz - cameraPosition), uLightDir), 0.0), 5.0);
  vRot = vec2(cr, sr);
  vLightView = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  ${FOG_VERTEX}
}
`;

const PUFF_FRAGMENT = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform vec3 uSilver;
uniform float uOpacity;
varying vec2 vUv;
varying float vShade;
varying float vAlpha;
varying float vSunFacing;
varying vec2 vRot;
varying vec3 vLightView;
${FOG_PARS_FRAGMENT}
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha * uOpacity;
  if (a < 0.004) discard;
  float shade = vShade;
  #ifdef CLOUD_HQ
    // Treat the puff density as a height field: its gradient gives a per-pixel normal, so
    // every puff is lit from the sun's side and shaded on the far side like a solid volume.
    const float o = 2.0 / 256.0;
    float ax = texture2D(uMap, vUv + vec2(o, 0.0)).a - texture2D(uMap, vUv - vec2(o, 0.0)).a;
    float ay = texture2D(uMap, vUv + vec2(0.0, o)).a - texture2D(uMap, vUv - vec2(0.0, o)).a;
    vec2 g = vec2(vRot.x * ax - vRot.y * ay, vRot.y * ax + vRot.x * ay);
    vec3 n = normalize(vec3(-g * 2.2, 0.35 + t.a));
    float lambert = clamp(dot(n, vLightView) * 0.5 + 0.5, 0.0, 1.0);
    shade = clamp(vShade * 0.6 + lambert * 0.5, 0.0, 1.0);
  #endif
  vec3 col = mix(uShadow, uLit, shade * t.g);
  col += uSilver * vSunFacing * 0.18;
  col += uSilver * vSunFacing * (1.0 - t.a) * 1.6;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  ${FOG_FRAGMENT}
}
`;

const DECK_VERTEX = /* glsl */`
varying vec3 vWorld;
${FOG_PARS_VERTEX}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_VERTEX}
}
`;

const DECK_FRAGMENT = /* glsl */`
uniform sampler2D uNoise;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform float uCoverage;
uniform float uBelow;
varying vec3 vWorld;
${FOG_PARS_FRAGMENT}
void main() {
  vec2 p = vWorld.xz;
  float n = texture2D(uNoise, p / 9000.0).a * 0.55 + texture2D(uNoise, p / 2300.0).g * 0.3 + texture2D(uNoise, p / 600.0).r * 0.15;
  float threshold = 1.0 - uCoverage;
  float a = smoothstep(threshold - 0.08, threshold + 0.22, n);
  if (a < 0.01) discard;
  float shade = uBelow > 0.5 ? 0.55 + 0.45 * (1.0 - n) : 0.75 + 0.25 * n;
  vec3 col = mix(uShadow, uLit, shade * (uBelow > 0.5 ? 0.55 : 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  ${FOG_FRAGMENT}
}
`;

export class CloudLayer {
  constructor(scene, maxClusters = 180) {
    this.scene = scene;
    this.maxClusters = maxClusters;
    this.maxPuffs = 16 * 260;
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    this.center = new Float32Array(this.maxPuffs * 3);
    this.params = new Float32Array(this.maxPuffs * 4);
    this.offset = new Float32Array(this.maxPuffs * 3);
    this.centerAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.offsetAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCenter', this.centerAttr);
    geometry.setAttribute('aParams', this.paramsAttr);
    geometry.setAttribute('aOffset', this.offsetAttr);
    geometry.instanceCount = 0;
    this.uniforms = {
      ...fogUniforms(),
      uMap: { value: getCloudTexture() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uShadow: { value: new THREE.Color(0.5, 0.55, 0.6) },
      uSilver: { value: new THREE.Color(1, 0.9, 0.8) },
      uOpacity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'cloud-puffs', vertexShader: PUFF_VERTEX, fragmentShader: PUFF_FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.deckUniforms = {
      ...fogUniforms(),
      uNoise: { value: getDetailTexture() },
      uLit: this.uniforms.uLit,
      uShadow: this.uniforms.uShadow,
      uCoverage: { value: 1 },
      uBelow: { value: 1 },
    };
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.ShaderMaterial({
      name: 'cloud-deck', vertexShader: DECK_VERTEX, fragmentShader: DECK_FRAGMENT, uniforms: this.deckUniforms,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    }));
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.frustumCulled = false;
    this.deck.renderOrder = 9;
    this.deck.visible = false;
    scene.add(this.deck);
    this.key = '';
    this.count = 0;
    this.sortTimer = 0;
    this.sortedFrom = new THREE.Vector3(Infinity, 0, 0);
    this.order = new Uint32Array(this.maxPuffs);
    this.dist = new Float32Array(this.maxPuffs);
    this.layer = null;
  }

  setBudget(maxClusters) {
    this.maxClusters = maxClusters;
    this.key = '';
  }

  /** Per-pixel puff lighting (four extra texture reads) on medium/high quality. */
  setDetail(high) {
    const defines = high ? { CLOUD_HQ: '' } : {};
    if (('CLOUD_HQ' in this.material.defines) === high) return;
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  /** Lay out the puffs of the first visible layer around the camera (world-anchored cells). */
  layout(layer, camera) {
    const cx = Math.floor(camera.position.x / CELL), cz = Math.floor(camera.position.z / CELL);
    const key = layer ? `${cx}:${cz}:${layer.baseFt}:${layer.thickFt}:${layer.coverage}:${layer.type}:${this.maxClusters}` : 'none';
    if (key === this.key) return;
    this.key = key;
    this.layer = layer;
    let count = 0;
    if (layer) {
      const base = layer.baseFt * 0.3048;
      const thick = clamp((layer.thickFt || 2000) * 0.3048, 150, 1600);
      const stratus = layer.type === 'stratus';
      const coverage = clamp(layer.coverage, 0, 1);
      // Expected clusters per cell scales with coverage and the quality budget.
      const perCell = coverage * this.maxClusters / 60;
      const cells = [];
      for (let dz = -RANGE; dz <= RANGE; dz++) for (let dx = -RANGE; dx <= RANGE; dx++) cells.push([dx * dx + dz * dz, cx + dx, cz + dz]);
      cells.sort((a, b) => a[0] - b[0]);
      let clusters = 0;
      for (const [, ix, iz] of cells) {
        const n = Math.floor(perCell + hash2(ix, iz, 91));
        for (let k = 0; k < n && clusters < this.maxClusters; k++) {
          const seed = ix * 7919 + iz * 104729 + k * 31;
          const px = (ix + hash2(seed, 1)) * CELL, pz = (iz + hash2(seed, 2)) * CELL;
          const radius = stratus ? 1400 + hash2(seed, 3) * 1300 : 320 + hash2(seed, 3) * 820;
          const height = stratus ? 90 + hash2(seed, 4) * 160 : thick * (0.35 + hash2(seed, 4) * 0.6) * Math.min(1, radius / 700);
          const puffs = stratus ? 9 : Math.round(7 + radius / 110);
          clusters++;
          for (let j = 0; j < puffs && count < this.maxPuffs; j++) {
            const a = hash2(seed, 10 + j) * Math.PI * 2;
            const r = Math.sqrt(hash2(seed, 40 + j));
            const ux = Math.cos(a) * r, uz = Math.sin(a) * r;
            const dome = Math.sqrt(Math.max(0, 1 - r * r));
            const y = Math.pow(hash2(seed, 70 + j), 0.8) * height * dome;
            const size = stratus ? radius * (0.75 + hash2(seed, 100 + j) * 0.5) : radius * (0.62 + hash2(seed, 100 + j) * 0.4) * (1 - 0.3 * r) + height * 0.4;
            const i3 = count * 3, i4 = count * 4;
            this.center[i3] = px + ux * radius;
            // Puff centres sit high enough that the lower edges line up into a flat base.
            this.center[i3 + 1] = base + y + size * (stratus ? 0.05 : 0.3);
            this.center[i3 + 2] = pz + uz * radius * (stratus ? 1 : 0.8);
            this.params[i4] = size;
            this.params[i4 + 1] = stratus ? 0.45 + 0.3 * (y / Math.max(1, height)) : y / Math.max(1, height);
            this.params[i4 + 2] = Math.floor(hash2(seed, 130 + j) * 4);
            this.params[i4 + 3] = hash2(seed, 160 + j) * Math.PI * 2;
            const ox = ux, oy = y / Math.max(1, height) - 0.35, oz = uz;
            const ol = Math.hypot(ox, oy, oz) || 1;
            this.offset[i3] = ox / ol;
            this.offset[i3 + 1] = oy / ol;
            this.offset[i3 + 2] = oz / ol;
            count++;
          }
        }
      }
      const deck = coverage >= 0.6;
      this.deck.visible = deck;
      this.deckUniforms.uCoverage.value = deck ? clamp((coverage - 0.5) * 2, 0, 1) * 0.85 + 0.15 : 0;
      this.deckBase = base;
      this.deckTop = base + thick;
    } else {
      this.deck.visible = false;
    }
    this.count = count;
    this.mesh.geometry.instanceCount = count;
    this.sortedFrom.set(Infinity, 0, 0);
  }

  /** Back-to-front ordering of the puffs so the soft edges blend correctly. */
  sort(camera) {
    const n = this.count;
    if (!n) return;
    const { x, y, z } = camera.position;
    for (let i = 0; i < n; i++) {
      const dx = this.center[i * 3] - x, dy = this.center[i * 3 + 1] - y, dz = this.center[i * 3 + 2] - z;
      this.dist[i] = dx * dx + dy * dy + dz * dz;
      this.order[i] = i;
    }
    const order = this.order.subarray(0, n);
    order.sort((a, b) => this.dist[b] - this.dist[a]);
    const c = this.centerAttr.array, p = this.paramsAttr.array, o = this.offsetAttr.array;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      c[k * 3] = this.center[i * 3]; c[k * 3 + 1] = this.center[i * 3 + 1]; c[k * 3 + 2] = this.center[i * 3 + 2];
      p[k * 4] = this.params[i * 4]; p[k * 4 + 1] = this.params[i * 4 + 1]; p[k * 4 + 2] = this.params[i * 4 + 2]; p[k * 4 + 3] = this.params[i * 4 + 3];
      o[k * 3] = this.offset[i * 3]; o[k * 3 + 1] = this.offset[i * 3 + 1]; o[k * 3 + 2] = this.offset[i * 3 + 2];
    }
    for (const attr of [this.centerAttr, this.paramsAttr, this.offsetAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.sortedFrom.copy(camera.position);
  }

  /**
   * @param {object} layer weather cloud layer (or null)
   * @param {THREE.Camera} camera
   * @param {object} light { dir, color (linear), intensity 0..1, ambient (linear Color), daylight }
   */
  update(layer, camera, dt, light) {
    this.layout(layer, camera);
    this.sortTimer -= dt;
    if (this.count && (this.sortTimer <= 0 || this.sortedFrom.distanceToSquared(camera.position) > 250 * 250)) {
      this.sort(camera);
      this.sortTimer = 0.4;
    }
    const u = this.uniforms;
    u.uLightDir.value.copy(light.dir);
    // Lit side: direct light plus sky light; shadowed side: tinted sky light only.
    u.uLit.value.copy(light.color).multiplyScalar(0.9 * light.intensity).add(light.ambient).multiplyScalar(0.85);
    u.uShadow.value.copy(light.ambient).multiplyScalar(0.62).add(light.color.clone().multiplyScalar(0.12 * light.intensity));
    u.uSilver.value.copy(light.color).multiplyScalar(light.intensity * 0.9);
    if (this.deck.visible) {
      const below = camera.position.y < (this.deckBase + this.deckTop) / 2;
      this.deck.position.set(Math.round(camera.position.x / 1000) * 1000, below ? this.deckBase : this.deckTop, Math.round(camera.position.z / 1000) * 1000);
      this.deckUniforms.uBelow.value = below ? 1 : 0;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.deck.geometry.dispose();
    this.deck.material.dispose();
  }
}
