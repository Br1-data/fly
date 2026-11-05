// Planets: cube-sphere quadtree level of detail, chunk streaming (module workers with a
// main-thread fallback), terrain / cloud / atmosphere shaders and the cloud cube map bake.
import * as THREE from 'three';
import { buildChunk, chunkIndices, faceDir } from './planet-build.js';
import { NOISE_GLSL, ATMOSPHERE_GLSL, NO_ATMOSPHERE_GLSL } from './shaders.js';
import { BODIES } from '../sim/system.js';
import { getMaterialTexture } from './textures.js';

// ---------------------------------------------------------------- chunk builder pool

export class ChunkBuilder {
  constructor(workers = 2) {
    this.queue = [];
    this.inflight = new Map();
    this.nextId = 1;
    this.workers = [];
    if (typeof Worker !== 'undefined' && workers > 0) {
      try {
        for (let i = 0; i < workers; i++) {
          const w = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
          w.busy = 0;
          w.onmessage = (e) => this._done(w, e.data);
          w.onerror = () => {
            w.failed = true;
          };
          this.workers.push(w);
        }
      } catch {
        this.workers = [];
      }
    }
  }

  /**
   * Queue a job; resolve(data) is called with the chunk arrays. Lower priority first.
   * `alive()` tells whether the chunk is still wanted: stale requests are dropped.
   */
  request(job, priority, resolve, alive = () => true, cancel = () => {}) {
    this.queue.push({ job, priority, resolve, alive, cancel });
  }

  _prune() {
    const keep = [];
    for (const item of this.queue) {
      if (item.alive()) keep.push(item);
      else item.cancel();
    }
    this.queue = keep;
  }

  /** Dispatch queued work: to idle workers, or build on the main thread within budgetMs. */
  pump(budgetMs = 4) {
    if (!this.queue.length) return;
    this._prune();
    this.queue.sort((a, b) => a.priority - b.priority);
    const live = this.workers.filter((w) => !w.failed);
    for (const w of live) {
      while (w.busy < 2 && this.queue.length) {
        const item = this.queue.shift();
        const id = this.nextId++;
        this.inflight.set(id, item);
        w.busy++;
        w.postMessage({ ...item.job, id });
      }
    }
    if (live.length) return;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const item = this.queue.shift();
      item.resolve(buildChunk(item.job));
    }
  }

  /** Build everything queued right now on the main thread (warm-up). */
  flushSync(limitMs = 4000) {
    const t0 = performance.now();
    this._prune();
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.queue.length && performance.now() - t0 < limitMs) {
      const item = this.queue.shift();
      item.resolve(buildChunk(item.job));
    }
  }

  get pending() {
    return this.queue.length + this.inflight.size;
  }

  _done(w, msg) {
    w.busy = Math.max(0, w.busy - 1);
    const item = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (!item) return;
    if (msg.error) {
      console.warn('chunk', msg.error);
      item.resolve(buildChunk(item.job));
    } else item.resolve(msg.data);
  }

  clear() {
    this.queue.length = 0;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

// ---------------------------------------------------------------- level of detail

const tmpV = new THREE.Vector3();

/** Sim (x, y, z) → three (x, z, −y). */
export function simToThree(x, y, z, out = new THREE.Vector3()) {
  return out.set(x, z, -y);
}

export class PlanetLOD {
  /**
   * @param opts { kind: 'ausonia'|'lucina'|'flat', radius, material, res, maxLevel, split, builder, terrain }
   */
  constructor(scene, opts) {
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = `planet-${opts.kind}`;
    scene.add(this.group);
    this.material = opts.material;
    this.res = opts.res || 32;
    this.maxLevel = opts.maxLevel ?? 12;
    this.split = opts.split ?? 2.4;
    this.builder = opts.builder;
    this.radius = opts.radius;
    this.terrain = opts.terrain || null;
    this.maxHeight = this.terrain?.maxHeight || 0;
    this.frame = 0;
    this.cache = new Map();
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(this._node(f, 0, -1, -1, 2));
    const { indices } = chunkIndices(this.res);
    this.index = new THREE.BufferAttribute(indices, 1);
    this.drawn = 0;
    this.visible = true;
  }

  _node(face, level, x0, y0, size) {
    const d = faceDir(face, x0 + size / 2, y0 + size / 2);
    let h = 0;
    if (this.terrain) h = this.opts.kind === 'ausonia' ? Math.max(0, this.terrain.height(d[0], d[1], d[2])) : this.terrain.height(d[0], d[1], d[2]);
    const arc = (size * Math.PI * this.radius) / 4;
    return { face, level, x0, y0, size, dir: d, h, arc, children: null, mesh: null, state: 'none', used: 0, center: null };
  }

  _children(n) {
    if (!n.children) {
      const s = n.size / 2;
      n.children = [
        this._node(n.face, n.level + 1, n.x0, n.y0, s),
        this._node(n.face, n.level + 1, n.x0 + s, n.y0, s),
        this._node(n.face, n.level + 1, n.x0, n.y0 + s, s),
        this._node(n.face, n.level + 1, n.x0 + s, n.y0 + s, s),
      ];
    }
    return n.children;
  }

  _request(n, priority) {
    n.wanted = this.frame;
    if (n.state === 'pending' && n.item) {
      n.item.priority = priority;
      return;
    }
    if (n.state !== 'none') return;
    n.state = 'pending';
    const item = { job: { body: this.opts.kind, face: n.face, x0: n.x0, y0: n.y0, size: n.size, res: this.res, radius: this.radius, level: n.level } };
    n.item = item;
    this.builder.request(item.job, priority, (data) => this._ready(n, data), () => n.wanted >= this.frame - 1, () => {
      if (n.state === 'pending') n.state = 'none';
      n.item = null;
    });
    n.item = this.builder.queue[this.builder.queue.length - 1];
  }

  _ready(n, data) {
    n.item = null;
    if (n.state !== 'pending') return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(data.dir, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(data.info, 3));
    g.setAttribute('aTile', new THREE.BufferAttribute(data.tile, 3));
    g.setIndex(this.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), data.radius);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.visible = false;
    mesh.renderOrder = this.opts.renderOrder || 0;
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);
    n.mesh = mesh;
    n.center = data.center;
    n.state = 'ready';
    this.cache.set(n, true);
  }

  /** Distance from the camera to the node surface and its horizon visibility. */
  _measure(n, cx, cy, cz, camR) {
    const r = this.radius + n.h;
    const px = n.dir[0] * r, py = n.dir[1] * r, pz = n.dir[2] * r;
    const dist = Math.max(0, Math.hypot(px - cx, py - cy, pz - cz) - n.arc * 0.72);
    // Horizon: angle between camera and node directions vs. horizon angle + node size.
    const cosA = (n.dir[0] * cx + n.dir[1] * cy + n.dir[2] * cz) / camR;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const rMin = this.radius - 5000;
    const horizon = Math.acos(Math.min(1, rMin / Math.max(camR, rMin + 1))) + Math.acos(Math.min(1, this.radius / (this.radius + this.maxHeight + 3000)));
    const visible = ang - (n.arc / this.radius) * 0.9 < horizon;
    return { dist, visible };
  }

  /**
   * Choose and position chunks for the camera. camRel: camera position relative to the body
   * centre (sim axes, metres). offset: body centre relative to the camera in three axes.
   */
  update(camRel, offset) {
    this.frame++;
    const cx = camRel.x, cy = camRel.y, cz = camRel.z;
    const camR = Math.hypot(cx, cy, cz);
    const drawn = [];
    const visit = (n) => {
      const { dist, visible } = this._measure(n, cx, cy, cz, camR);
      if (!visible && n.level > 0) return true;
      const wantSplit = n.level < this.maxLevel && dist < this.split * n.arc;
      if (wantSplit) {
        const kids = this._children(n);
        let ready = true;
        for (const k of kids) {
          if (k.state !== 'ready') {
            const m = this._measure(k, cx, cy, cz, camR);
            if (m.visible || k.level === 0) {
              ready = false;
              this._request(k, m.dist / Math.max(1, k.arc) + k.level * 0.01);
            }
          }
        }
        if (ready) {
          for (const k of kids) visit(k);
          return true;
        }
      }
      if (n.state === 'ready') {
        drawn.push(n);
        return true;
      }
      this._request(n, dist / Math.max(1, n.arc) - 10);
      return false;
    };
    for (const r of this.roots) visit(r);
    for (const n of this.cache.keys()) if (n.mesh) n.mesh.visible = false;
    for (const n of drawn) {
      n.used = this.frame;
      const m = n.mesh;
      m.visible = this.visible;
      // Chunk centre relative to the camera, converted to three axes.
      simToThree(n.center[0], n.center[1], n.center[2], tmpV);
      m.position.set(tmpV.x + offset.x, tmpV.y + offset.y, tmpV.z + offset.z);
    }
    this.drawn = drawn.length;
    this._evict();
  }

  _evict() {
    if (this.cache.size < (this.opts.cacheSize || 700)) return;
    const old = [...this.cache.keys()].filter((n) => n.used < this.frame - 120 && n.level > 0).sort((a, b) => a.used - b.used);
    for (const n of old.slice(0, Math.max(0, this.cache.size - (this.opts.cacheSize || 700) * 0.8))) {
      n.mesh.geometry.dispose();
      this.group.remove(n.mesh);
      n.mesh = null;
      n.state = 'none';
      this.cache.delete(n);
      // Children of an evicted node are rebuilt on demand.
    }
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  dispose() {
    for (const n of this.cache.keys()) n.mesh?.geometry.dispose();
    this.group.removeFromParent();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------- materials

const LOGDEPTH_V = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGDEPTH_F = '#include <logdepthbuf_pars_fragment>';

export function atmosphereUniforms(body) {
  const a = body.atmosphere;
  return {
    uPlanet: { value: new THREE.Vector3() },
    uR: { value: body.radius },
    uAtmR: { value: body.radius + (a ? a.height : 0) },
    uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6) },
    uBetaM: { value: 4e-6 },
    uHR: { value: a ? a.scaleHeight : 7000 },
    uHM: { value: 1300 },
    uSunPower: { value: 10 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
}

/** Terrain material for Ausonia (oceans, biomes, night lights, aerial perspective). */
export function ausoniaMaterial(quality, cloudCube) {
  const detail = quality !== 'low';
  const uniforms = {
    ...atmosphereUniforms(BODIES.ausonia),
    uSunLight: { value: 2.5 },
    uTime: { value: 0 },
    uCloudRot: { value: new THREE.Matrix3() },
    uCloudCover: { value: 0.75 },
    tClouds: { value: cloudCube },
    tRock: getMaterialTexture('rock'),
    tGrass: getMaterialTexture('grass'),
    tSand: getMaterialTexture('sand'),
    tGround: getMaterialTexture('ground_normal'),
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { DETAIL: detail ? 1 : 0, STEPS: quality === 'high' ? 6 : quality === 'low' ? 3 : 4 },
    vertexShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      ${LOGDEPTH_V}
      attribute vec3 aDir;
      attribute vec3 aInfo;
      attribute vec3 aTile;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vDir;
      varying vec3 vInfo;
      varying vec3 vTile;
      varying vec3 vIn;
      varying vec3 vTr;
      varying vec3 vSun;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        vDir = aDir;
        vInfo = aInfo;
        vTile = aTile;
        vec3 r0 = -uPlanet;
        float dist = length(wp.xyz);
        vec3 rd = wp.xyz / max(dist, 1e-3);
        vec3 tr;
        vIn = scatter(r0, rd, dist, STEPS, tr);
        vTr = tr;
        vSun = sunlightAt(wp.xyz - uPlanet);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform float uTime;
      uniform mat3 uCloudRot;
      uniform float uCloudCover;
      uniform samplerCube tClouds;
      uniform sampler2D tRock;
      uniform sampler2D tGrass;
      uniform sampler2D tSand;
      uniform sampler2D tGround;
      ${LOGDEPTH_F}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vDir;
      varying vec3 vInfo;
      varying vec3 vTile;
      varying vec3 vIn;
      varying vec3 vTr;
      varying vec3 vSun;
      vec3 tri(sampler2D t, vec3 p, vec3 w) {
        return texture2D(t, p.yz).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDir);
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vWorld);
        float dist = length(vWorld);
        float h = vInfo.x;
        float moist = vInfo.y;
        float slope = 1.0 - dot(N, D);
        float lat = abs(D.y);
        float n1 = snoise(D * 700.0) * 0.5 + 0.5;
        float n2 = snoise(D * 5200.0) * 0.5 + 0.5;
        vec3 L = uSunDir;
        vec3 col;
        bool water = h <= 0.0;
        if (water) {
          float depth = -h;
          col = mix(vec3(0.02, 0.12, 0.16), vec3(0.003, 0.015, 0.045), smoothstep(0.0, 220.0, depth));
          col = mix(col, vec3(0.75, 0.82, 0.86), (1.0 - smoothstep(0.88, 0.95, 1.0 - lat)) * 0.0 + smoothstep(0.93, 0.97, lat));
        } else {
          vec3 sand = vec3(0.62, 0.53, 0.36);
          vec3 grass = vec3(0.13, 0.25, 0.06);
          vec3 dry = vec3(0.42, 0.33, 0.19);
          vec3 forest = vec3(0.045, 0.12, 0.035);
          vec3 rock = vec3(0.33, 0.30, 0.27);
          vec3 snow = vec3(0.92, 0.94, 0.97);
          float m = moist + (n1 - 0.5) * 0.25;
          vec3 land = mix(dry, grass, smoothstep(0.22, 0.52, m));
          land = mix(land, forest, smoothstep(0.58, 0.82, m) * (1.0 - smoothstep(1100.0, 2000.0, h)));
          land *= 0.82 + 0.36 * n2;
          land = mix(sand, land, smoothstep(3.0, 22.0, h + (n2 - 0.5) * 14.0));
          land = mix(land, rock, max(smoothstep(0.1, 0.26, slope), smoothstep(2000.0, 2900.0, h + n1 * 400.0)));
          float snowLine = 3000.0 - lat * 3200.0;
          float sn = smoothstep(snowLine - 250.0, snowLine + 250.0, h + n1 * 500.0) * (1.0 - smoothstep(0.32, 0.55, slope));
          sn = max(sn, smoothstep(0.9, 0.95, lat + n1 * 0.04));
          col = mix(land, snow, sn);
          #if DETAIL
          float near = 1.0 - smoothstep(600.0, 3500.0, dist);
          if (near > 0.001) {
            vec3 w = abs(N); w = pow(w, vec3(4.0)); w /= dot(w, vec3(1.0));
            vec3 p = vTile / 9.0;
            vec3 g = tri(tGrass, p, w);
            vec3 r = tri(tRock, p * 0.6, w);
            vec3 s = tri(tSand, p, w);
            vec3 tex = mix(g, r, max(smoothstep(0.1, 0.26, slope), sn));
            tex = mix(s, tex, smoothstep(3.0, 22.0, h));
            float lum = dot(tex, vec3(0.333));
            col *= mix(vec3(1.0), tex / max(0.18, lum) * 0.55 + 0.45, near * 0.85);
          }
          #endif
        }
        // Cloud shadows.
        float cs = textureCube(tClouds, uCloudRot * normalize(D + L * 0.009)).r;
        float shadow = 1.0 - 0.55 * smoothstep(0.5, 0.68, cs) * uCloudCover;
        float ndl = max(dot(N, L), 0.0);
        float dayside = dot(D, L);
        vec3 sun = vSun * uSunLight;
        vec3 sky = vec3(0.18, 0.28, 0.45) * 0.35 * smoothstep(-0.2, 0.3, dayside);
        vec3 c = col * (sun * ndl * shadow + sky);
        if (water) {
          // Waves: perturbed normal, sun glint and sky reflection.
          vec3 wn = normalize(D + 0.04 * vec3(snoise(vTile * 0.05 + uTime * 0.1), snoise(vTile.zxy * 0.05 - uTime * 0.08), snoise(vTile.yzx * 0.05)) * (1.0 - smoothstep(2000.0, 30000.0, dist)));
          vec3 R = reflect(-V, wn);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
          float glint = pow(max(dot(R, L), 0.0), mix(900.0, 60.0, smoothstep(0.0, 400000.0, dist)));
          c = mix(c, vec3(0.22, 0.38, 0.6) * 0.5 * smoothstep(-0.2, 0.3, dayside), fres * 0.6);
          c += sun * glint * shadow * mix(6.0, 1.2, smoothstep(0.0, 400000.0, dist));
        }
        // City lights on the night side.
        float night = smoothstep(0.08, -0.14, dayside);
        if (!water && night > 0.0 && h < 900.0) {
          float cities = smoothstep(0.62, 0.9, snoise(D * 260.0) * 0.5 + 0.5) * smoothstep(0.25, 0.5, moist) * (1.0 - smoothstep(0.8, 0.95, moist));
          float grain = smoothstep(0.35, 0.85, snoise(D * 9000.0) * 0.5 + 0.5);
          c += vec3(1.0, 0.72, 0.38) * cities * grain * night * 0.9;
        }
        c = c * vTr + vIn;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Terrain material for Lucina: regolith with maria, opposition-like lighting. */
export function lucinaMaterial(quality) {
  const detail = quality !== 'low';
  const uniforms = {
    uPlanet: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunLight: { value: 1.9 },
    uEarthshine: { value: new THREE.Vector3(0, 0, 0) },
    tRock: getMaterialTexture('rock'),
    tGround: getMaterialTexture('ground_normal'),
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { DETAIL: detail ? 1 : 0 },
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V}
      attribute vec3 aDir;
      attribute vec3 aInfo;
      attribute vec3 aTile;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vDir;
      varying vec3 vInfo;
      varying vec3 vTile;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        vDir = aDir;
        vInfo = aInfo;
        vTile = aTile;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform vec3 uEarthshine;
      uniform sampler2D tRock;
      uniform sampler2D tGround;
      ${LOGDEPTH_F}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vDir;
      varying vec3 vInfo;
      varying vec3 vTile;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDir);
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vWorld);
        float dist = length(vWorld);
        float mare = vInfo.z;
        float n1 = snoise(D * 420.0) * 0.5 + 0.5;
        float n2 = snoise(D * 3800.0) * 0.5 + 0.5;
        float slope = 1.0 - dot(N, D);
        float alb = mix(0.27, 0.12, mare) * (0.8 + 0.34 * n1) * (0.88 + 0.24 * n2);
        alb += smoothstep(0.06, 0.25, slope) * 0.05;
        vec3 col = vec3(alb) * vec3(1.0, 0.97, 0.93);
        #if DETAIL
        float near = 1.0 - smoothstep(300.0, 2500.0, dist);
        if (near > 0.001) {
          vec3 w = abs(N); w = pow(w, vec3(4.0)); w /= dot(w, vec3(1.0));
          vec3 p = vTile / 7.0;
          vec3 t = texture2D(tRock, p.yz).rgb * w.x + texture2D(tRock, p.xz).rgb * w.y + texture2D(tRock, p.xy).rgb * w.z;
          float l = dot(t, vec3(0.333));
          col *= mix(1.0, 0.35 + l * 1.5, near * 0.9);
        }
        #endif
        vec3 L = uSunDir;
        float ndl = max(dot(N, L), 0.0);
        float ndv = max(dot(N, V), 0.05);
        // Lommel-Seeliger mixed with Lambert: the flat look of airless regolith.
        float ls = 2.0 * ndl / (ndl + ndv);
        float lit = mix(ndl, ls * 0.5, 0.45);
        vec3 c = col * (uSunLight * lit + uEarthshine * max(dot(N, normalize(-vWorld)), 0.0) * 0.4 + vec3(0.004));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Cloud deck over Ausonia, from the baked coverage cube map. */
export function cloudMaterial(quality, cloudCube) {
  const uniforms = {
    ...atmosphereUniforms(BODIES.ausonia),
    uSunLight: { value: 2.4 },
    uCloudRot: { value: new THREE.Matrix3() },
    uCloudCover: { value: 0.75 },
    uTime: { value: 0 },
    uBelow: { value: 0 },
    tClouds: { value: cloudCube },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    defines: { STEPS: quality === 'low' ? 2 : 3 },
    vertexShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      ${LOGDEPTH_V}
      attribute vec3 aDir;
      varying vec3 vWorld;
      varying vec3 vDir;
      varying vec3 vIn;
      varying vec3 vTr;
      varying vec3 vSun;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vDir = aDir;
        float dist = length(wp.xyz);
        vec3 tr;
        vIn = scatter(-uPlanet, wp.xyz / max(dist, 1e-3), dist, STEPS, tr);
        vTr = tr;
        vSun = sunlightAt(wp.xyz - uPlanet);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform mat3 uCloudRot;
      uniform float uCloudCover;
      uniform float uTime;
      uniform float uBelow;
      uniform samplerCube tClouds;
      ${LOGDEPTH_F}
      varying vec3 vWorld;
      varying vec3 vDir;
      varying vec3 vIn;
      varying vec3 vTr;
      varying vec3 vSun;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDir);
        float dist = length(vWorld);
        float c = textureCube(tClouds, uCloudRot * D).r;
        float fine = snoise(D * 2600.0 + uTime * 0.002) * (1.0 - smoothstep(20000.0, 200000.0, dist));
        float a = smoothstep(0.47, 0.7, c + fine * 0.06) * uCloudCover;
        // Thin out the deck right around the camera so flying through it is not a wall.
        a *= smoothstep(150.0, 1800.0, dist);
        if (a < 0.003) discard;
        float dayside = dot(D, uSunDir);
        float thick = smoothstep(0.55, 0.85, c);
        float lit = mix(0.55, 1.0, smoothstep(-0.1, 0.4, dayside)) * mix(1.0, 0.62 - thick * 0.2, uBelow);
        vec3 col = vSun * uSunLight * 0.62 * lit * smoothstep(-0.12, 0.08, dayside) + vec3(0.03, 0.04, 0.06) * smoothstep(-0.3, 0.2, dayside);
        col = col * vTr + vIn * 0.6;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Sky / limb shell: rays that miss the ground (terrain draws its own aerial perspective). */
export function createAtmosphereShell(body, quality) {
  const uniforms = atmosphereUniforms(body);
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    defines: { STEPS: quality === 'high' ? 14 : quality === 'low' ? 6 : 10 },
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      ${LOGDEPTH_F}
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 rd = normalize(vWorld);
        vec3 r0 = -uPlanet;
        vec2 ground = rsi(r0, rd, uR);
        float tMax = ground.x > 0.0 && ground.x < ground.y ? ground.x : 1e12;
        vec3 tr;
        vec3 inS = scatter(r0, rd, tMax, STEPS, tr);
        float alpha = clamp(1.0 - (tr.r + tr.g + tr.b) / 3.0, 0.0, 1.0);
        gl_FragColor = vec4(inS, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, quality === 'low' ? 64 : 96, quality === 'low' ? 32 : 48), material);
  mesh.scale.setScalar(uniforms.uAtmR.value);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

/** Bake a procedural cube map on the GPU (clouds, milky way). */
export function bakeCube(renderer, size, fragmentBody) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      varying vec3 vP;
      vec4 bake(vec3 d);
      ${fragmentBody}
      void main() { gl_FragColor = bake(normalize(vP)); }`,
  });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat));
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  const prevLog = renderer.capabilities.logarithmicDepthBuffer;
  cam.update(renderer, scene);
  mat.dispose();
  scene.children[0].geometry.dispose();
  void prevLog;
  return rt;
}

export const CLOUD_BAKE = /* glsl */ `
vec4 bake(vec3 d) {
  // Large weather systems plus cells; bands of cloud near the equator and mid latitudes.
  vec3 w = d + 0.18 * vec3(snoise(d * 1.7 + 4.0), snoise(d * 1.7 - 2.0), snoise(d * 1.7 + 9.0));
  float base = fbm3(w * 2.6, 6) * 0.5 + 0.5;
  float cells = fbm3(d * 11.0 + 3.3, 5) * 0.5 + 0.5;
  float lat = abs(d.y);
  float bands = 0.12 * cos(lat * 9.0) + 0.06;
  float c = base * 0.75 + cells * 0.35 + bands - 0.12;
  return vec4(c, c, c, 1.0);
}`;
