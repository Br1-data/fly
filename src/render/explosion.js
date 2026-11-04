// Impact explosion: flash, fireball, flying debris with smoke trails, sparks, ground
// shock ring, scorch mark, a burning wreck and a rising smoke column (or a spray of
// water for crashes at sea). Particles are camera-facing quads drawn by one shader,
// so no lights or programs are added at impact time (no stall on the crash frame).
import * as THREE from 'three';

const VERT = `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute float aSize;
attribute float aRot;
attribute vec4 aColor;
attribute float aSeed;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float c = cos(aRot), s = sin(aRot);
  mv.xy += vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y) * aSize;
  vUv = aCorner * 0.5 + 0.5;
  vColor = aColor;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform float uAdditive;
uniform float uLight;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // Billowing edge: two octaves of noise eat into the disc.
  float n = noise(p * 2.6 + vSeed * 17.0) * 0.65 + noise(p * 5.3 - vSeed * 9.0) * 0.35;
  float a = vColor.a * smoothstep(1.0, 0.25, r + (n - 0.5) * 0.55);
  if (a < 0.003) discard;
  // Smoke is lit by the day (darker at night) and shaded towards its lower edge.
  vec3 col = uAdditive > 0.5 ? vColor.rgb : vColor.rgb * uLight * (0.8 + 0.35 * (p.y * 0.5 + 0.5)) * (0.85 + 0.3 * n);
  gl_FragColor = uAdditive > 0.5 ? vec4(col * a, a) : vec4(col, a);
}`;

/** Pool of billboard particles with CPU-side simulation. */
class Particles {
  constructor(capacity, additive) {
    this.capacity = capacity;
    this.list = [];
    const g = new THREE.BufferGeometry();
    const n = capacity * 4;
    this.center = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.color = new Float32Array(n * 4);
    this.seed = new Float32Array(n);
    const corner = new Float32Array(n * 2);
    const index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    g.setAttribute('aCenter', new THREE.BufferAttribute(this.center, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.uniforms = { uAdditive: { value: additive ? 1 : 0 }, uLight: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 14 : 13;
  }

  /** p: { pos, vel, life, size, grow, rot, spin, drag, lift, colorAt(t) → [r,g,b,a] } */
  add(p) {
    if (this.list.length >= this.capacity) return;
    p.age = 0;
    p.seed = Math.random();
    p.rot ??= Math.random() * Math.PI * 2;
    this.list.push(p);
  }

  update(dt, wind) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
      const drag = Math.exp(-(p.drag ?? 1) * dt);
      p.vel.multiplyScalar(drag);
      p.vel.y += (p.lift ?? 0) * dt;
      if (wind) p.vel.addScaledVector(wind, (1 - drag) * (p.windy ?? 1));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += (p.spin ?? 0) * dt;
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i], t = p.age / p.life;
      const size = p.size * (1 + (p.grow ?? 0) * Math.sqrt(t));
      const [r, g, b, a] = p.colorAt(t, p);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        this.center[v * 3] = p.pos.x; this.center[v * 3 + 1] = p.pos.y; this.center[v * 3 + 2] = p.pos.z;
        this.size[v] = size;
        this.rot[v] = p.rot;
        this.color[v * 4] = r; this.color[v * 4 + 1] = g; this.color[v * 4 + 2] = b; this.color[v * 4 + 3] = a;
        this.seed[v] = p.seed;
      }
    }
    const g = this.mesh.geometry;
    for (const name of ['aCenter', 'aSize', 'aRot', 'aColor', 'aSeed']) g.attributes[name].needsUpdate = true;
    g.setDrawRange(0, list.length * 6);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Fire colour ramp: white-hot core → yellow → orange → deep red, then sooty smoke. */
function fireColour(t, heat = 1) {
  const k = 1 - t;
  const r = 1.6 * heat * Math.min(1, k * 2.2) + 0.15;
  const g = 0.85 * heat * Math.pow(k, 1.8) + 0.03;
  const b = 0.3 * heat * Math.pow(k, 5);
  return [r, g, b, 0.4 * Math.min(1, k * 1.8) * smooth(0, 0.05, t)];
}

function scorchTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  const grad = c.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(8,6,5,0.95)');
  grad.addColorStop(0.55, 'rgba(18,14,11,0.75)');
  grad.addColorStop(1, 'rgba(30,24,18,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(${10 + Math.random() * 30},${8 + Math.random() * 20},6,${Math.random() * 0.5})`;
    const a = Math.random() * Math.PI * 2, d = Math.random() * 58;
    c.fillRect(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Explosion {
  /**
   * @param scene three.js scene
   * @param o { position: Vector3 (world), velocity: Vector3 (world m/s), groundY(x, z) → height,
   *            scale (≈ wingspan / 11), fuel (0..1), water (bool), paint (THREE.Color) }
   */
  constructor(scene, { position, velocity, groundY, scale = 1, fuel = 0.5, water = false, paint = new THREE.Color(0x9aa3aa) }) {
    this.scene = scene;
    this.origin = position.clone();
    this.groundY = groundY;
    this.scale = scale;
    this.water = water;
    this.time = 0;
    this.energy = Math.min(1.6, 0.55 + fuel * 0.6 + velocity.length() / 220);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fire = new Particles(380, true);
    this.smoke = new Particles(480, false);
    this.group.add(this.smoke.mesh, this.fire.mesh);
    this.wind = new THREE.Vector3(rnd(-2, 2), 0, rnd(-2, 2));
    const k = scale * this.energy;
    const ground = groundY(position.x, position.z);
    this.origin.y = Math.max(position.y, ground + 0.5);
    // Break-up in the air: no wreck fire, ring or scorch at the break-up point.
    this.airborne = this.origin.y - ground > 15;
    const impactDir = velocity.clone().setY(Math.max(velocity.y, 0)).multiplyScalar(0.12);

    // Flash: one short white-hot burst (the renderer also brightens the exposure).
    this.fire.add({ pos: this.origin.clone(), vel: new THREE.Vector3(), life: 0.35, size: 14 * k, grow: 1.5, drag: 0,
      colorAt: (t) => [2.2, 1.7, 1.0, 0.8 * (1 - t) * (1 - t)] });
    if (water) this._splash(k, impactDir); else this._fireball(k, impactDir);
    this._debris(k, velocity, paint);
    if (!this.airborne) this._shockRing(k, ground);
    if (!water && !this.airborne) this._scorch(k, ground);
  }

  _fireball(k, impactDir) {
    for (let i = 0; i < 48; i++) {
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.15, 1), rnd(-1, 1)).normalize();
      const speed = rnd(5, 24) * k;
      this.fire.add({
        pos: this.origin.clone().addScaledVector(dir, rnd(0, 2) * k), vel: dir.multiplyScalar(speed).add(impactDir),
        life: rnd(0.9, 2.4), size: rnd(2.2, 5.5) * k, grow: rnd(1.2, 2.6), drag: 2.2, lift: rnd(4, 9) * Math.sqrt(k), spin: rnd(-1, 1),
        heat: rnd(0.7, 1.15), colorAt: (t, p) => fireColour(t, p.heat),
      });
    }
    // Sparks and burning fragments arcing out.
    for (let i = 0; i < 60; i++) {
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(0.2, 1.4), rnd(-1, 1)).normalize();
      this.fire.add({
        pos: this.origin.clone(), vel: dir.multiplyScalar(rnd(18, 55) * Math.sqrt(k)).add(impactDir), life: rnd(0.8, 2.2), size: rnd(0.25, 0.6),
        drag: 0.4, lift: -9.8, colorAt: (t) => [3.5, 2.2 - t, 0.6 * (1 - t), 1 - t * t],
      });
    }
    // Initial dark cloud pushed out by the blast.
    for (let i = 0; i < 34; i++) {
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize();
      this._smokePuff(this.origin.clone().addScaledVector(dir, rnd(2, 6) * k), dir.multiplyScalar(rnd(4, 14) * k), k * rnd(5, 10), rnd(6, 12), 0.13, 0.08);
    }
  }

  _splash(k, impactDir) {
    for (let i = 0; i < 90; i++) {
      const dir = new THREE.Vector3(rnd(-0.6, 0.6), rnd(0.6, 1.6), rnd(-0.6, 0.6)).normalize();
      this.smoke.add({
        pos: this.origin.clone(), vel: dir.multiplyScalar(rnd(10, 32) * Math.sqrt(k)).add(impactDir), life: rnd(1.5, 3.5), size: rnd(1.5, 4) * k, grow: 2.5,
        drag: 0.6, lift: -9.8, windy: 0.3, colorAt: (t) => [0.95, 0.97, 1, 0.75 * (1 - t)],
      });
    }
    for (let i = 0; i < 30; i++) {
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(0, 0.4), rnd(-1, 1)).normalize();
      this.smoke.add({ pos: this.origin.clone(), vel: dir.multiplyScalar(rnd(6, 14) * k), life: rnd(4, 8), size: rnd(4, 8) * k, grow: 2,
        drag: 0.8, lift: 0.4, colorAt: (t) => [0.9, 0.93, 0.96, 0.35 * (1 - t)] });
    }
  }

  _smokePuff(pos, vel, size, life, alpha = 0.06, shade = 0.16) {
    this.smoke.add({
      pos, vel, life, size, grow: 2.6, drag: 0.9, lift: 2.2, spin: rnd(-0.3, 0.3),
      colorAt: (t) => { const c = shade + 0.32 * t; return [c, c * 0.96, c * 0.92, alpha * 8 * smooth(0, 0.08, t) * (1 - t) * (1 - t)]; },
    });
  }

  _debris(k, velocity, paint) {
    this.debris = [];
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.7, metalness: 0.5 });
    const painted = new THREE.MeshStandardMaterial({ color: paint.clone().multiplyScalar(0.55), roughness: 0.6, metalness: 0.3 });
    this.debrisMaterials = [metal, painted];
    const count = Math.round(18 + 14 * Math.min(2, k));
    for (let i = 0; i < count; i++) {
      const s = rnd(0.25, 1.1) * Math.sqrt(this.scale);
      const geo = new THREE.BoxGeometry(s * rnd(0.6, 2.4), s * rnd(0.08, 0.5), s * rnd(0.5, 1.6));
      const m = new THREE.Mesh(geo, i % 3 ? metal : painted);
      m.position.copy(this.origin);
      m.castShadow = false;
      this.group.add(m);
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(0.3, 1.5), rnd(-1, 1)).normalize();
      this.debris.push({
        mesh: m, vel: dir.multiplyScalar(rnd(8, 34) * Math.sqrt(k)).addScaledVector(velocity, rnd(0.15, 0.45)),
        spin: new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)), smoking: !this.water && Math.random() < (this.airborne ? 0.8 : 0.55), rest: false, trail: 0,
      });
    }
  }

  _shockRing(k, ground) {
    const geo = new THREE.RingGeometry(0.85, 1, 64);
    const mat = new THREE.MeshBasicMaterial({ color: this.water ? 0xffffff : 0xffe2b0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(this.origin.x, ground + 0.6, this.origin.z);
    this.ring.renderOrder = 12;
    this.ringSize = 60 * k;
    this.group.add(this.ring);
  }

  _scorch(k, ground) {
    const map = scorchTexture();
    if (!map) return;
    this.scorch = new THREE.Mesh(new THREE.CircleGeometry(9 * k, 32), new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0,
    }));
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorch.position.set(this.origin.x, ground + 0.15, this.origin.z);
    this.group.add(this.scorch);
  }

  /** Camera shake amplitude (m) for a camera at `distance` metres. */
  shake(distance) {
    const t = this.time;
    return 2.2 * this.scale * this.energy * Math.exp(-t * 2.8) * Math.min(1, 120 / Math.max(distance, 20));
  }

  /** Extra exposure for the flash (multiplier ≥ 1). */
  flash() {
    return 1 + 0.7 * Math.exp(-this.time * 8) * Math.min(1, this.energy);
  }

  update(dt, night = 0) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const t = this.time, k = this.scale * this.energy;
    this.smoke.uniforms.uLight.value = 1 - 0.82 * night;
    // Debris: ballistic, tumbling, bouncing and coming to rest on the ground.
    for (const d of this.debris) {
      if (d.rest) continue;
      d.vel.y -= 9.81 * dt;
      d.vel.multiplyScalar(Math.exp(-0.08 * dt));
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const g = this.groundY(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < g + 0.15) {
        d.mesh.position.y = g + 0.15;
        if (this.water) { d.rest = true; d.mesh.visible = false; continue; }
        d.vel.y = Math.abs(d.vel.y) * 0.28;
        d.vel.x *= 0.5; d.vel.z *= 0.5;
        d.spin.multiplyScalar(0.5);
        if (d.vel.length() < 1.2) d.rest = true;
      }
      if (d.smoking && t < (this.airborne ? 12 : 3.5) && (d.trail -= dt) <= 0) {
        d.trail = 0.05;
        this._smokePuff(d.mesh.position.clone(), new THREE.Vector3(), rnd(0.8, 1.6) * Math.sqrt(this.scale), rnd(2.5, 4), 0.07, 0.12);
        if (t < 1.5) this.fire.add({ pos: d.mesh.position.clone(), vel: new THREE.Vector3(), life: 0.35, size: rnd(0.5, 1.1), drag: 0, colorAt: (u) => fireColour(u, 0.9) });
      }
    }
    // Shock ring.
    if (this.ring) {
      const r = Math.min(1, t / 0.9);
      this.ring.scale.setScalar(1 + this.ringSize * (1 - (1 - r) ** 3));
      this.ring.material.opacity = 0.55 * (1 - r);
      if (r >= 1) { this.group.remove(this.ring); this.ring.geometry.dispose(); this.ring.material.dispose(); this.ring = null; }
    }
    if (this.scorch) this.scorch.material.opacity = Math.min(0.9, t * 2);
    // Burning wreck and smoke column: strong at first, then a long-lasting fire.
    if (!this.water && !this.airborne) {
      const intensity = t < 1 ? 1 : Math.max(0.35, Math.exp(-(t - 1) / 40));
      this._fireAcc = (this._fireAcc || 0) + dt * 26 * intensity * Math.min(2, k);
      while (this._fireAcc > 1) {
        this._fireAcc -= 1;
        const p = this.origin.clone().add(new THREE.Vector3(rnd(-3, 3) * k, rnd(-0.5, 1), rnd(-3, 3) * k));
        this.fire.add({ pos: p, vel: new THREE.Vector3(rnd(-1, 1), rnd(3, 7), rnd(-1, 1)), life: rnd(0.5, 1.1), size: rnd(1.2, 2.8) * Math.sqrt(k),
          grow: 0.6, drag: 1.5, lift: 3, colorAt: (u) => fireColour(u, 0.85) });
      }
      this._smokeAcc = (this._smokeAcc || 0) + dt * 9 * intensity * Math.min(2, k);
      while (this._smokeAcc > 1) {
        this._smokeAcc -= 1;
        const p = this.origin.clone().add(new THREE.Vector3(rnd(-2, 2) * k, rnd(1, 3), rnd(-2, 2) * k));
        this._smokePuff(p, new THREE.Vector3(rnd(-1, 1), rnd(4, 8), rnd(-1, 1)), rnd(3, 6) * Math.sqrt(k), rnd(9, 15), 0.075, 0.1);
      }
    }
    this.wind.y = 0;
    this.fire.update(dt, null);
    this.smoke.update(dt, this.wind);
  }

  dispose() {
    this.scene.remove(this.group);
    this.fire.dispose();
    this.smoke.dispose();
    for (const d of this.debris) d.mesh.geometry.dispose();
    for (const m of this.debrisMaterials) m.dispose();
    if (this.ring) { this.ring.geometry.dispose(); this.ring.material.dispose(); }
    if (this.scorch) { this.scorch.geometry.dispose(); this.scorch.material.map?.dispose(); this.scorch.material.dispose(); }
  }
}
