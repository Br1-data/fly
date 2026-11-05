// Planets: cube-sphere quadtree level of detail, chunk streaming (module workers with a
// main-thread fallback), terrain / cloud / atmosphere shaders and the cloud cube map bake.
import * as THREE from 'three';
import { buildChunk, chunkIndices, faceDir } from './planet-build.js';
import { NOISE_GLSL } from './shaders.js';
import { planetMaps } from '../sim/planet-data.js';

// ---------------------------------------------------------------- chunk builder pool

export class ChunkBuilder {
  constructor(workers = 2) {
    this.queue = [];
    this.inflight = new Map();
    this.nextId = 1;
    this.workers = [];
    const maps = planetMaps();
    if (typeof Worker !== 'undefined' && workers > 0) {
      try {
        for (let i = 0; i < workers; i++) {
          const w = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
          if (maps) w.postMessage({ type: 'maps', maps });
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


/** Sim (x, y, z) → three (x, z, −y). */
export function simToThree(x, y, z, out = new THREE.Vector3()) {
  return out.set(x, z, -y);
}

export class PlanetLOD {
  /**
   * @param opts { kind: body id | 'flat', radius, material, res, maxLevel, split, builder, terrain, ocean }
   * The group is rotated with the body: chunks live in body-fixed coordinates.
   */
  constructor(parent, opts) {
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = `planet-${opts.kind}`;
    parent.add(this.group);
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
    if (this.terrain) h = this.opts.ocean ? Math.max(0, this.terrain.height(d[0], d[1], d[2])) : this.terrain.height(d[0], d[1], d[2]);
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
   * centre in body-fixed sim axes (metres). The caller places and rotates `group`.
   */
  update(camRel) {
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
      // Chunk centre in body-fixed coordinates (three axes).
      simToThree(n.center[0], n.center[1], n.center[2], m.position);
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
