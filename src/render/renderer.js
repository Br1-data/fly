// Scene renderer: floating origin (the camera always sits at the origin and every object is
// placed relative to it, computed in double precision), logarithmic depth for metres to
// millions of kilometres, planets with streamed level of detail, atmosphere, clouds, stars,
// vessels, objects, surface sites, mission markers, orbit lines and the camera views.
import * as THREE from 'three';
import { V3, clamp, smoothstep } from '../core/math.js';
import { BODIES, SITES, bodyOrientation, childrenOf, relativeState } from '../sim/system.js';
import { elements, conicPoints, propagate } from '../sim/orbit.js';
import { ChunkBuilder } from './planet.js';
import { createBodies } from './bodies.js';
import { SpaceBackground } from './space.js';
import { createVessel, updateVessel } from './vessels.js';
import { buildStation, buildOrbiter, buildSatellite, buildSwarm, updateSwarm, buildSpaceport, buildLucerna, updateLights } from './objects.js';
import { Effects } from './effects.js';
import { deviceClass } from '../core/device.js';

export const VIEWS = ['cockpit', 'chase', 'orbit', 'target', 'map'];
const RESOLUTION_LEVELS = [1, 0.85, 0.72, 0.6];
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
// Sim world → three world: −90° about x, i.e. (x, y, z) → (x, z, −y).
const Q_C = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

/** Sim (x, y, z) → three (x, z, −y). */
export function toThree(v, out = new THREE.Vector3()) {
  return out.set(v.x, v.z, -v.y);
}

/** three quaternion for a body→sim-world quaternion (model built in body sim axes). */
export function quatToThree(q, out = new THREE.Quaternion()) {
  out.set(q.x, q.y, q.z, q.w);
  return out.premultiply(Q_C);
}

const Q_CI = Q_C.clone().invert();
/** Same rotation for content already expressed in three axes (planet chunks, sites). */
export function quatToThreeAxes(q, out = new THREE.Quaternion()) {
  out.set(q.x, q.y, q.z, q.w);
  return out.premultiply(Q_C).multiply(Q_CI);
}

/**
 * Device budgets. `device`: 'desktop' | 'phone' | 'iphone' | 'tablet'.
 */
export function getRenderProfile(quality = 'medium', device = 'desktop') {
  const level = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  const kind = ['phone', 'iphone', 'tablet'].includes(device) ? device : 'desktop';
  const rich = level !== 'low';
  const common = {
    quality: level,
    device: kind,
    lodRes: level === 'low' ? 16 : level === 'high' ? 32 : 24,
    split: level === 'low' ? 1.45 : level === 'high' ? 2.1 : 1.75,
    shadowMapSize: level === 'high' ? 2048 : 1024,
    workers: level === 'low' ? 1 : 2,
  };
  if (kind === 'tablet') {
    return { ...common, antialias: rich, pixelRatioMax: level === 'low' ? 1 : level === 'high' ? 2 : 1.5, maxBufferPixels: level === 'low' ? 1_500_000 : level === 'high' ? 5_000_000 : 3_200_000, shadows: rich, maxFps: rich ? 60 : 30, dynamicResolution: true };
  }
  if (kind === 'iphone') {
    return { ...common, antialias: rich, pixelRatioMax: level === 'low' ? 1 : level === 'high' ? 3 : 2, maxBufferPixels: level === 'low' ? 1_000_000 : level === 'high' ? 3_100_000 : 1_800_000, shadows: rich, maxFps: rich ? 60 : 30, dynamicResolution: true };
  }
  const touch = kind === 'phone';
  return {
    ...common,
    antialias: !touch && rich,
    pixelRatioMax: touch || level === 'low' ? 1 : level === 'high' ? 2 : 1.5,
    maxBufferPixels: touch ? (level === 'low' ? 1_000_000 : level === 'high' ? 2_000_000 : 1_500_000) : level === 'low' ? 1_500_000 : Infinity,
    shadows: !touch && rich,
    maxFps: touch ? 30 : Infinity,
    dynamicResolution: touch,
  };
}

export function getRenderPixelRatio(profile, width, height, devicePixelRatio = 1) {
  const area = Math.max(1, width) * Math.max(1, height);
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, profile.pixelRatioMax, Math.sqrt(profile.maxBufferPixels / area));
}

/** JS twin of the shader's sun transmittance (3 samples), for light colours on the CPU. */
function sunTransmittance(p, sunDir, body) {
  const a = body.atmosphere;
  if (!a) return [1, 1, 1];
  const R = body.radius, Ra = R + a.height;
  const b = p.dot(sunDir), c = p.lenSq() - R * R * 0.9995 * 0.9995;
  const disc = b * b - c;
  if (disc > 0 && -b - Math.sqrt(disc) > 0) return [0, 0, 0];
  const c2 = p.lenSq() - Ra * Ra;
  const d2 = b * b - c2;
  if (d2 < 0) return [1, 1, 1];
  const lt = -b + Math.sqrt(d2);
  if (lt <= 0) return [1, 1, 1];
  const ds = lt / 3;
  let odR = 0, odM = 0;
  for (let j = 0; j < 3; j++) {
    const t = ds * (j + 0.5);
    const h = Math.max(0, Math.hypot(p.x + sunDir.x * t, p.y + sunDir.y * t, p.z + sunDir.z * t) - R);
    odR += Math.exp(-h / a.scaleHeight) * ds;
    odM += Math.exp(-h / 1300) * ds;
  }
  const beta = [5.8e-6, 13.5e-6, 33.1e-6];
  return beta.map((br) => Math.exp(-(br * odR + 8e-6 * 1.1 * odM)));
}

export class SceneRenderer {
  constructor(canvas, { quality = 'medium' } = {}) {
    this.canvas = canvas;
    this.device = deviceClass();
    this.touch = this.device !== 'desktop';
    this.quality = quality;
    this.profile = getRenderProfile(quality, this.device);
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: this.profile.antialias, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.webgl.shadowMap.enabled = this.profile.shadows;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1e14);
    this.width = 1280;
    this.height = 720;
    this.view = 'chase';
    this.yaw = 0;
    this.tilt = 0.18;
    this.zoomFactor = 1;
    this.headYaw = 0;
    this.headPitch = 0;
    this.mapYaw = 0.6;
    this.mapPitch = 0.9;
    this.mapZoom = 4;
    this.panelFraction = 0;
    this.resolutionScale = 1;
    this.dynamicResolution = true;
    this._frames = { last: 0, ema: 0, changed: 0, good: 0 };
    this.elapsed = 0;
    this.camAbs = new V3();
    this.camLook = new V3(1, 0, 0);
    this.camUp = new V3(0, 0, 1);
    this.markers = [];
    this.objectViews = new Map();
    this.debrisViews = new Map();
    this.showOrbits = false;
    this._chaseQ = null;
  }

  async init(onProgress = () => {}) {
    const p = this.profile;
    onProgress(0.05, 'Preparazione delle stelle…');
    this.space = new SpaceBackground(this.scene, this.webgl, p.quality);
    await nextFrame();
    onProgress(0.2, 'Costruzione dei pianeti…');
    this.builder = new ChunkBuilder(p.workers);
    const bodies = createBodies(this.scene, this.webgl, p, this.builder);
    this.bodies = bodies.views;
    this.bodyDots = bodies.dots;
    this.bodyDotIds = bodies.dotIds;
    this.cloudRT = bodies.cloudRT;
    await nextFrame();
    onProgress(0.6, 'Luci e ombre…');
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = p.shadows;
    this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    this.sun.shadow.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 1, 4000);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x101420, 0x334466, 0.6);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.02);
    this.scene.add(this.ambient);
    this.pmrem = new THREE.PMREMGenerator(this.webgl);
    this.envScene = this.createEnvScene();
    // Surface sites, attached to their (rotating) bodies in body-fixed coordinates.
    this.sites = [];
    for (const site of Object.values(SITES)) {
      const view = site.body === 'earth' ? buildSpaceport(site) : buildLucerna(site);
      const bv = this.bodies[site.body];
      const b = BODIES[site.body];
      const lon = (site.lon * Math.PI) / 180;
      const up = new V3(...site.dir);
      const east = new V3(-Math.sin(lon), Math.cos(lon), 0);
      const north = new V3().crossVectors(up, east);
      const h = b.terrain.height(up.x, up.y, up.z);
      const pos = up.clone().scale(b.radius + (b.ocean ? Math.max(h, 0) : h));
      view.root.position.copy(toThree(pos));
      view.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toThree(east), toThree(up), toThree(north.clone().scale(-1))));
      bv.group.add(view.root);
      this.sites.push({ site, view });
    }
    this.effects = new Effects(this.scene, p.quality);
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.orbitGroup = new THREE.Group();
    this.scene.add(this.orbitGroup);
    this.mapIcons = this.createMapIcons();
    await nextFrame();
    onProgress(1, 'Sistema pronto');
  }

  createEnvScene() {
    const scene = new THREE.Scene();
    this.envUniforms = { uBody: { value: new THREE.Vector3(0, -1, 0) }, uBodySize: { value: 0.5 }, uBodyColor: { value: new THREE.Color(0.2, 0.3, 0.45) }, uSun: { value: new THREE.Vector3(1, 0, 0) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.envUniforms,
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uBody; uniform float uBodySize; uniform vec3 uBodyColor; uniform vec3 uSun;
        varying vec3 vD;
        void main(){
          vec3 d = normalize(vD);
          float b = smoothstep(uBodySize - 0.05, uBodySize + 0.05, dot(d, uBody));
          vec3 c = vec3(0.004, 0.005, 0.008) + uBodyColor * b;
          c += vec3(18.0, 16.0, 13.0) * pow(max(dot(d, uSun), 0.0), 900.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
    return scene;
  }

  createMapIcons() {
    const make = (color) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
      s.scale.setScalar(0.018);
      s.renderOrder = 90;
      s.visible = false;
      this.scene.add(s);
      return s;
    };
    return { ship: make(0x7dffe0), target: make(0xff7dd8), ap: make(0x7fb8ff), pe: make(0xffd27f), node: make(0xffa040) };
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    // Changing chunk resolution and shaders needs a rebuild: simplest is a reload on next start.
    this.profile = { ...getRenderProfile(q, this.device), lodRes: this.profile.lodRes };
    this.webgl.shadowMap.enabled = this.profile.shadows;
    this.sun.castShadow = this.profile.shadows;
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.baseRatio = getRenderPixelRatio(this.profile, this.width, this.height, globalThis.devicePixelRatio || 1);
    this.webgl.setPixelRatio(this.baseRatio * this.resolutionScale);
    this.webgl.setSize(this.width, this.height, false);
    this.updateProjection();
  }

  updateProjection() {
    this.camera.aspect = this.width / this.height;
    // The cockpit panel covers the lower part: shift the view centre up.
    const visible = 1 - this.panelFraction;
    this.camera.setViewOffset(this.width, this.height / visible, 0, 0, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  setPanelFraction(f) {
    const v = clamp(f || 0, 0, 0.6);
    if (Math.abs(v - this.panelFraction) < 0.002) return;
    this.panelFraction = v;
    this.updateProjection();
  }

  // ------------------------------------------------------------------ scenario
  /** (Re)build the vessel and object models for a simulation. */
  setScenario(sim) {
    if (this.vessel) {
      this.vessel.root.removeFromParent();
      disposeTree(this.vessel.root);
    }
    this.vessel = createVessel(sim.def);
    this.scene.add(this.vessel.root);
    this.vesselDef = sim.def;
    for (const v of this.objectViews.values()) v.view.root.removeFromParent();
    this.objectViews.clear();
    for (const o of sim.objects) this.addObjectView(o);
    for (const d of this.debrisViews.values()) d.removeFromParent();
    this.debrisViews.clear();
    this.effects.reset();
    this._chaseQ = null;
    this.resetView();
  }

  addObjectView(o) {
    let view;
    const k = o.def.model || o.kind;
    if (k === 'station') view = buildStation(o.def);
    else if (k === 'orbiter') view = buildOrbiter(o.def);
    else if (k === 'swarm') view = buildSwarm(o, this.profile.quality);
    else view = buildSatellite(o.def);
    this.scene.add(view.root);
    this.objectViews.set(o.id, { o, view });
  }

  /** Build terrain around the vessel before the first frame. */
  async warmup(sim, onProgress = () => {}) {
    this.updateCamera(sim, 0);
    for (let i = 0; i < 40; i++) {
      this.updateBodies(sim);
      this.builder.flushSync(this.touch ? 900 : 1600);
      onProgress(Math.min(1, (i + 1) / 12));
      if (!this.builder.pending) break;
      await nextFrame();
    }
    this.updateBodies(sim);
  }

  // ------------------------------------------------------------------ views
  setView(view) {
    if (!VIEWS.includes(view)) view = 'chase';
    this.view = view;
    this.headYaw = 0;
    this.headPitch = 0;
    this._chaseQ = null;
  }

  nextView(dir = 1) {
    const order = ['cockpit', 'chase', 'orbit', 'target'];
    const i = Math.max(0, order.indexOf(this.view));
    this.setView(order[(i + dir + order.length) % order.length]);
    return this.view;
  }

  look(dx, dy) {
    if (this.view === 'cockpit') {
      this.headYaw = clamp(this.headYaw - dx * 0.004, -2.6, 2.6);
      this.headPitch = clamp(this.headPitch - dy * 0.004, -1.3, 1.3);
    } else if (this.view === 'map') {
      this.mapYaw -= dx * 0.006;
      this.mapPitch = clamp(this.mapPitch - dy * 0.006, -1.5, 1.5);
    } else {
      this.yaw -= dx * 0.006;
      this.tilt = clamp(this.tilt + dy * 0.005, -1.45, 1.45);
    }
  }

  zoom(delta) {
    const k = Math.exp(delta * 0.0015);
    if (this.view === 'map') this.mapZoom = clamp(this.mapZoom * k, 1.4, 60000);
    else if (this.view === 'cockpit') this.camera.fov = clamp(this.camera.fov * k, 25, 95);
    else this.zoomFactor = clamp(this.zoomFactor * k, 0.25, 40);
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    this.yaw = 0;
    this.tilt = 0.18;
    this.zoomFactor = 1;
    this.headYaw = 0;
    this.headPitch = 0;
    this.camera.fov = this.vesselDef?.camera?.fov || 70;
    this.camera.updateProjectionMatrix();
  }

  /** Camera look / up in the vehicle frame for its pilot (forward window or belly window). */
  pilotAxes(def) {
    return def.camera.look === 'belly' ? { look: new V3(0, 0, 1), up: new V3(1, 0, 0) } : { look: new V3(1, 0, 0), up: new V3(0, 0, -1) };
  }

  updateCamera(sim, dt) {
    const s = sim.ship;
    const def = s.def;
    const shipAbs = sim.absolute(s.ref, s.pos);
    const axes = this.pilotAxes(def);
    const lookW = s.q.rotate(axes.look, new V3());
    const upW = s.q.rotate(axes.up, new V3());
    const radial = s.pos.clone().normalize();
    let pos, look, up;
    const view = this.view;
    if (view === 'cockpit') {
      const eye = s.q.rotate(s.local(def.camera.eye, new V3()), new V3());
      pos = shipAbs.clone().add(eye);
      // Head movement: yaw about the cockpit up axis, pitch about the right axis.
      const right = new V3().crossVectors(lookW, upW).normalize();
      look = rotateAround(lookW, upW, this.headYaw);
      const right2 = rotateAround(right, upW, this.headYaw);
      look = rotateAround(look, right2, this.headPitch);
      up = rotateAround(upW, right2, this.headPitch);
    } else if (view === 'map') {
      const focusId = sim.ship.ref;
      const body = BODIES[focusId];
      const focus = sim.bodyPos(focusId);
      const d = body.radius * this.mapZoom;
      const cy = Math.cos(this.mapPitch);
      const off = new V3(Math.cos(this.mapYaw) * cy, Math.sin(this.mapYaw) * cy, Math.sin(this.mapPitch)).scale(d);
      pos = focus.clone().add(off);
      look = off.clone().scale(-1).normalize();
      up = new V3(0, 0, 1);
    } else {
      const size = (def.camera.chaseDist || 20) * this.zoomFactor;
      if (view === 'chase') {
        // Smoothly follow the vehicle attitude.
        const q = s.q;
        if (!this._chaseQ) this._chaseQ = q.clone();
        const k = 1 - Math.exp(-Math.max(dt, 0) * 4);
        slerpQuat(this._chaseQ, q, k);
        const l = this._chaseQ.rotate(axes.look, new V3());
        const u = this._chaseQ.rotate(axes.up, new V3());
        const yawed = rotateAround(l, u, this.yaw);
        const right = new V3().crossVectors(yawed, u).normalize();
        const tilted = rotateAround(yawed, right, -this.tilt * 0.6);
        pos = shipAbs.clone().addScaled(tilted, -size).addScaled(u, (def.camera.chaseHeight || 3) * this.zoomFactor * 0.6);
        look = shipAbs.clone().addScaled(u, (def.camera.chaseHeight || 3) * 0.25).sub(pos).normalize();
        up = u;
      } else if (view === 'target' && sim.targetState()) {
        const ts = sim.targetState();
        const tAbs = sim.absolute(s.ref, ts.pos);
        const dir = tAbs.clone().sub(shipAbs).normalize();
        const u = radial.clone().addScaled(dir, -radial.dot(dir)).normalize();
        pos = shipAbs.clone().addScaled(dir, -size).addScaled(u, size * 0.25);
        look = tAbs.clone().sub(pos).normalize();
        up = u;
      } else {
        // Orbit camera in the local horizon frame (up = away from the body).
        const north = new V3(0, 0, 1);
        let east = new V3().crossVectors(north, radial);
        if (east.len() < 1e-6) east = new V3(1, 0, 0);
        east.normalize();
        const n2 = new V3().crossVectors(radial, east);
        const cy = Math.cos(this.tilt);
        const off = east.clone().scale(Math.cos(this.yaw) * cy).addScaled(n2, Math.sin(this.yaw) * cy).addScaled(radial, Math.sin(this.tilt)).scale(size * 1.2);
        pos = shipAbs.clone().add(off);
        look = off.clone().scale(-1).normalize();
        up = radial;
      }
    }
    // Keep the camera above the ground.
    const body = BODIES[s.ref];
    const bp = sim.bodyPos(s.ref);
    const rel = pos.clone().sub(bp);
    const rr = rel.len();
    if (rr > 1) {
      const dirn = rel.clone().scale(1 / rr);
      const gh = sim.heightAt(s.ref, rel);
      const floor = body.radius + (body.ocean ? Math.max(gh, 0) : gh) + 1.2;
      if (rr < floor) pos = bp.clone().addScaled(dirn, floor);
    }
    this.camAbs.copy(pos);
    this.camLook.copy(look);
    this.camUp.copy(up);
    const L = toThree(look), U = toThree(up);
    const R = new THREE.Vector3().crossVectors(L, U).normalize();
    const U2 = new THREE.Vector3().crossVectors(R, L).normalize();
    const m = new THREE.Matrix4().makeBasis(R, U2, L.clone().negate());
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.updateMatrixWorld();
  }

  /** Three-space position of an absolute sim position (relative to the camera). */
  rel(abs, out = new THREE.Vector3()) {
    return out.set(abs.x - this.camAbs.x, abs.z - this.camAbs.z, -(abs.y - this.camAbs.y));
  }

  /** Screen position (CSS px) of an absolute sim position, or null if behind the camera. */
  project(abs) {
    const p = this.rel(abs);
    p.project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (-p.y * 0.5 + 0.5) * this.height, depth: p.z };
  }

  // ------------------------------------------------------------------ per frame
  updateBodies(sim) {
    const t = sim.t;
    const pxPerRad = this.height / ((this.camera.fov * Math.PI) / 180);
    for (const v of Object.values(this.bodies)) {
      const bp = sim.bodyPos(v.id);
      this.rel(bp, v.group.position);
      const q = bodyOrientation(v.id, t);
      quatToThreeAxes(q, v.group.quaternion);
      const camRel = this.camAbs.clone().sub(bp);
      const d = camRel.len();
      const px = (Math.asin(Math.min(1, v.body.radius / Math.max(d, v.body.radius))) * pxPerRad);
      v.px = px;
      v.group.visible = px > 0.6;
      if (v.lod) {
        const fixed = q.rotateInv(camRel, new V3());
        if (v.group.visible) {
          v.lod.update(fixed);
          v.clouds?.update(fixed);
        }
      }
    }
  }

  update(sim, dt) {
    this.elapsed += dt;
    const s = sim.ship;
    if (!s) return;
    this.updateCamera(sim, dt);
    const sunDir = toThree(sim.sunDir);
    // Bodies, atmosphere, clouds.
    this.updateBodies(sim);
    this.builder.pump(this.touch ? 3 : 5);
    // Per-body uniforms: centre relative to the camera, direction of the Sun from the body.
    const shipRef = s.ref;
    for (const v of Object.values(this.bodies)) {
      const bp = sim.bodyPos(v.id);
      const toSun = bp.clone().scale(-1).normalize();
      const sd = toThree(toSun);
      const mats = [v.material, v.cloudMat, v.atmosphere?.material, v.ring?.material].filter(Boolean);
      for (const mat of mats) {
        const u = mat.uniforms;
        if (u.uPlanet) u.uPlanet.value.copy(v.group.position);
        if (u.uSunDir) u.uSunDir.value.copy(sd);
        if (u.uTime) u.uTime.value = this.elapsed;
      }
      if (v.atmosphere) {
        v.atmosphere.position.copy(v.group.position);
        v.atmosphere.visible = v.group.visible && v.px > 2;
      }
      if (v.cloudMat) {
        const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(sim.t * 2.0e-6));
        v.cloudMat.uniforms.uCloudRot.value.copy(rot);
        v.material.uniforms.uCloudRot.value.copy(rot);
        const camR = this.camAbs.clone().sub(bp).len();
        v.cloudMat.uniforms.uBelow.value = camR < v.body.radius + v.cloudAlt ? 1 : 0;
      }
      // Planetshine on airless moons (Earthshine on the Moon).
      if (v.material.uniforms.uShine && v.body.parent && v.body.parent !== 'sun') {
        const pp = sim.bodyPos(v.body.parent);
        const toP = pp.clone().sub(bp).normalize();
        const phase = 0.5 * (1 - toP.dot(toSun));
        v.material.uniforms.uShine.value.set(0.05, 0.07, 0.11).multiplyScalar(phase * 0.8);
      }
    }
    // Light: eclipses and atmospheric reddening at the camera.
    let eclipse = 1;
    const sunAbs = new V3(0, 0, 0);
    const camToSun = sunAbs.clone().sub(this.camAbs).normalize();
    for (const b of Object.values(BODIES)) {
      if (b.id === 'sun') continue;
      const rel = this.camAbs.clone().sub(sim.bodyPos(b.id));
      const along = rel.dot(camToSun);
      if (along > 0) continue;
      const perp = rel.clone().addScaled(camToSun, -along).len();
      if (perp > b.radius * 1.05) continue;
      eclipse *= smoothstep(b.radius * 0.992, b.radius * 1.012, perp);
    }
    const nb = BODIES[shipRef];
    const camRelN = this.camAbs.clone().sub(sim.bodyPos(shipRef));
    const tr = nb.atmosphere && (shipRef === 'earth' || shipRef === 'mars') ? sunTransmittance(camRelN, camToSun, nb) : [1, 1, 1];
    const sunColor = new THREE.Color(tr[0], tr[1], tr[2]);
    if (eclipse < 1 && camRelN.len() > nb.radius + 100e3) sunColor.setRGB(1, 1, 1);
    // Sunlight falls with the square of the distance (1 at 1 AU).
    const au = this.camAbs.len() / 1.495978707e11;
    const solar = Math.min(3, 1 / Math.max(0.1, au * au));
    this.sun.color.copy(sunColor);
    this.sun.intensity = 3.2 * eclipse * Math.pow(solar, 0.5);
    const toB = this.rel(sim.bodyPos(shipRef));
    const dist = toB.length();
    toB.normalize();
    const cover = 1 - Math.sqrt(Math.max(0, 1 - (nb.radius / Math.max(dist, nb.radius * 1.0001)) ** 2));
    const phaseB = 0.5 * (1 - toB.dot(sunDir));
    const alt = camRelN.len() - nb.radius;
    const daylight = smoothstep(-0.08, 0.15, camRelN.clone().normalize().dot(camToSun));
    const airTop = shipRef === 'earth' ? 60e3 : shipRef === 'mars' ? 40e3 : 0;
    const inAir = airTop ? 1 - smoothstep(airTop * 0.25, airTop, alt) : 0;
    this.hemi.position.copy(toB).negate();
    const groundCol = { earth: [0.22, 0.3, 0.42], mars: [0.45, 0.28, 0.16], moon: [0.3, 0.3, 0.3], sun: [0, 0, 0] }[shipRef] || [0.3, 0.28, 0.25];
    this.hemi.groundColor.setRGB(...groundCol).multiplyScalar(0.25 + 2.4 * cover * phaseB);
    const skyCol = shipRef === 'mars' ? new THREE.Color(0.6, 0.45, 0.32) : new THREE.Color(0.35, 0.5, 0.75);
    this.hemi.color.setRGB(0.012, 0.016, 0.026).lerp(skyCol, inAir * daylight);
    this.hemi.intensity = 1.0 + inAir * daylight * 0.8;
    this.scene.background.setRGB(0, 0, 0);
    // Stars fade in daylight air.
    const starFade = 1 - inAir * daylight * 0.97;
    const sunScreen = this.camera.position.clone().add(toThree(camToSun)).project(this.camera);
    const flare = this.profile.quality === 'low' ? 0 : eclipse * (1 - inAir * 0.4) * (sunScreen.z < 1 ? 1 : 0) * 0.9 * Math.min(1, solar);
    const sunAng = Math.atan(BODIES.sun.radius / Math.max(1, this.camAbs.len()));
    this.space.update(toThree(camToSun), starFade, sunColor, this.webgl.getPixelRatio(), flare, sunAng);
    this.updateDots(sim);
    // Environment for reflections.
    this.updateEnvironment(toB, nb, cover * phaseB, toThree(camToSun));
    // Vessel
    const v = this.vessel;
    const shipAbs = sim.absolute(s.ref, s.pos);
    this.rel(shipAbs, v.root.position);
    quatToThree(s.q, v.root.quaternion);
    const atmo = nb.atmosphere && s.dynPressure > 0 ? Math.min(1, Math.exp(-Math.max(0, s.altitude) / (nb.atmosphere.scaleHeight || 8000))) : 0;
    updateVessel(v, s, this.elapsed, atmo);
    v.root.visible = !s.destroyed && this.view !== 'map';
    // In the cockpit, hide the cabin shell around the eye (the panel and windows are 2D).
    if (this.view === 'cockpit') this.hideNearEye(v, s);
    else this.showAll(v);
    // Shadow frustum around the vessel (wider near large objects).
    let near = 30;
    for (const { o } of this.objectViews.values()) {
      const d = sim.absolute(o.ref, o.pos).sub(shipAbs).len();
      if (d < o.radius + 150) near = Math.max(near, Math.min(140, o.radius * 1.1));
    }
    const sc = this.sun.shadow.camera;
    if (sc.right !== near) {
      sc.left = sc.bottom = -near;
      sc.right = sc.top = near;
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.copy(v.root.position);
    this.sun.position.copy(v.root.position).addScaledVector(sunDir, 1500);
    // Objects
    for (const { o, view } of this.objectViews.values()) {
      const abs = sim.absolute(o.ref, o.pos);
      this.rel(abs, view.root.position);
      quatToThree(o.q, view.root.quaternion);
      const far = abs.clone().sub(this.camAbs).len();
      view.root.visible = far < 600e3 && !o.hidden;
      if (!view.root.visible) continue;
      updateLights(view.lights, this.elapsed);
      if (view.ring) view.ring.rotation.x = sim.t * view.spin;
      if (view.wings) {
        const sb = o.q.rotateInv(sim.sunDir, new V3());
        for (const w of view.wings) w.rotation.y = Math.atan2(sb.x, -sb.z);
      }
      if (view.meshes) updateSwarm(view, o, sim.t);
    }
    // Surface sites (blinking lights only when close).
    for (const { view } of this.sites) {
      const wp = view.root.getWorldPosition(new THREE.Vector3());
      view.root.visible = wp.length() < 150e3;
      if (view.root.visible) updateLights(view.lights, this.elapsed);
    }
    // Debris
    this.updateDebris(sim);
    // Effects (RCS puffs, plasma, explosions).
    this.effects.update(sim, this, dt);
    // Markers and orbit lines.
    this.updateMarkers(sim);
    this.updateOrbits(sim);
    // Exposure: a touch brighter in the dark side so the cockpit lights read.
    this.webgl.toneMappingExposure = 1.0;
  }

  updateDots(sim) {
    const pos = this.bodyDots.geometry.attributes.position;
    const col = this.bodyDots.geometry.attributes.color;
    this.bodyDotIds.forEach((id, i) => {
      const v = this.bodies[id];
      const p = this.rel(sim.bodyPos(id));
      // Keep the dot inside the depth range: same direction, closer.
      const d = p.length();
      if (d > 5e12) p.multiplyScalar(5e12 / d);
      pos.setXYZ(i, p.x, p.y, p.z);
      const k = id === 'sun' ? 0 : clamp(1.6 - v.px, 0, 1) * (id === 'venus' || id === 'jupiter' ? 1 : 0.75);
      const c = { mars: [1, 0.6, 0.45], venus: [1, 0.97, 0.85], jupiter: [1, 0.92, 0.8], saturn: [1, 0.9, 0.7], neptune: [0.6, 0.7, 1], uranus: [0.7, 0.95, 1], moon: [0.9, 0.9, 0.9], earth: [0.6, 0.75, 1], mercury: [0.85, 0.8, 0.75] }[id] || [1, 1, 1];
      col.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  hideNearEye(v, s) {
    if (!this._hidden) this._hidden = new Set();
    const eye = new THREE.Vector3(...s.def.camera.eye);
    v.inner.traverse((o) => {
      if (!o.isMesh || o.material?.uniforms) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrix);
      const r = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z);
      if (c.distanceTo(eye) < r + 0.25) {
        o.visible = false;
        this._hidden.add(o);
      }
    });
  }

  showAll() {
    if (!this._hidden?.size) return;
    for (const o of this._hidden) o.visible = true;
    this._hidden.clear();
  }

  updateEnvironment(toB, body, lit, sunDir) {
    const now = performance.now();
    const key = `${toB.x.toFixed(2)},${toB.y.toFixed(2)},${toB.z.toFixed(2)},${lit.toFixed(2)}`;
    if (key === this._envKey || now - (this._envT || 0) < 2500) return;
    this._envKey = key;
    this._envT = now;
    const u = this.envUniforms;
    u.uBody.value.copy(toB);
    u.uSun.value.copy(sunDir);
    u.uBodySize.value = 0.2;
    u.uBodyColor.value.set(body.id === 'earth' ? 0x3a5a86 : body.id === 'mars' ? 0x8a5a3a : 0x777777).multiplyScalar(0.25 + lit * 1.5);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 64 });
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.8;
  }

  updateDebris(sim) {
    const seen = new Set();
    for (const d of sim.debris) {
      seen.add(d.id);
      let g = this.debrisViews.get(d.id);
      if (!g) {
        const idx = this.vessel.def.stages.findIndex((st) => st.id === d.stage.id);
        if (idx < 0) continue;
        g = new THREE.Group();
        const clone = this.vessel.stages[idx].clone();
        clone.visible = true;
        clone.traverse((o) => {
          if (o.material?.uniforms || o.isSprite) o.visible = false;
        });
        clone.position.x = -d.stage.x;
        g.add(clone);
        this.scene.add(g);
        this.debrisViews.set(d.id, g);
      }
      this.rel(sim.absolute(d.ref, d.pos), g.position);
      quatToThree(d.q, g.quaternion);
    }
    for (const [id, g] of this.debrisViews) {
      if (!seen.has(id)) {
        g.removeFromParent();
        this.debrisViews.delete(id);
      }
    }
  }

  setMarkers(markers = []) {
    this.markers = markers;
  }

  updateMarkers(sim) {
    const list = this.markers || [];
    const g = this.markerGroup;
    while (g.children.length < list.length) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64), new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.renderOrder = 30;
      g.add(ring);
    }
    g.children.forEach((m, i) => {
      const mk = list[i];
      m.visible = !!mk && this.view !== 'map';
      if (!mk) return;
      const abs = sim.absolute(mk.ref, mk.pos);
      this.rel(abs, m.position);
      const r = mk.radius || 20;
      m.scale.setScalar(r);
      if (mk.normal) {
        const n = toThree(mk.normal).normalize();
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      }
      const color = mk.done ? 0x3cff8a : mk.active ? 0xffd34a : 0x46e0ff;
      m.material.color.setHex(color);
      m.material.opacity = mk.active ? 0.95 : mk.done ? 0.35 : 0.6;
    });
  }

  /** Orbit lines: always in the map view, optionally in flight. */
  updateOrbits(sim) {
    const show = this.view === 'map' || this.showOrbits;
    this.orbitGroup.visible = show;
    for (const k of Object.keys(this.mapIcons)) this.mapIcons[k].visible = false;
    if (!show) return;
    const key = `${sim.prediction?.[0]?.t0}|${sim.nodePrediction?.[0]?.t0}|${sim.node?.pro}|${sim.target?.id}`;
    if (key !== this._orbitKey || this.elapsed - (this._orbitT || 0) > 1) {
      this._orbitKey = key;
      this._orbitT = this.elapsed;
      this.rebuildOrbits(sim);
    }
    for (const line of this.orbitGroup.children) this.rel(sim.bodyPos(line.userData.ref), line.position);
    if (this.view === 'map') {
      const s = sim.ship;
      const icons = this.mapIcons;
      icons.ship.visible = true;
      this.rel(sim.absolute(s.ref, s.pos), icons.ship.position);
      const ts = sim.targetState();
      if (ts) {
        icons.target.visible = true;
        this.rel(sim.absolute(s.ref, ts.pos), icons.target.position);
      }
      const el = sim.info.el;
      const bp = sim.bodyPos(s.ref);
      if (el.e < 1) {
        const pts = this._apsides;
        if (pts) {
          icons.ap.visible = true;
          icons.pe.visible = true;
          this.rel(bp.clone().add(pts.ap), icons.ap.position);
          this.rel(bp.clone().add(pts.pe), icons.pe.position);
        }
      }
    }
  }

  rebuildOrbits(sim) {
    for (const l of this.orbitGroup.children) l.geometry.dispose();
    this.orbitGroup.clear();
    const add = (pts, ref, color, dashed = false) => {
      if (pts.length < 2) return;
      const arr = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => arr.set([p.x, p.z, -p.y], i * 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: BODIES[ref].radius * 0.03, gapSize: BODIES[ref].radius * 0.02, transparent: true, opacity: 0.9, depthWrite: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
      const line = new THREE.Line(g, mat);
      if (dashed) line.computeLineDistances();
      line.userData.ref = ref;
      line.frustumCulled = false;
      line.renderOrder = 40;
      this.orbitGroup.add(line);
    };
    const segPoints = (seg) => {
      const body = BODIES[seg.ref];
      if (seg.tEnd === Infinity && seg.el.e < 1) return conicPoints(seg.el, 256);
      const span = Number.isFinite(seg.tEnd) ? seg.tEnd - seg.t0 : Math.min(seg.el.e < 1 ? seg.el.period : 3e5, 3e5);
      const pts = [];
      const r = new V3(), v = new V3();
      for (let i = 0; i <= 200; i++) {
        propagate(seg.pos, seg.vel, (span * i) / 200, body.mu, r, v);
        if (r.len() < body.radius) break;
        pts.push(r.clone());
      }
      return pts;
    };
    const colors = [0x52f2ff, 0x9fe8ff, 0xbcd6ff];
    (sim.prediction || []).forEach((seg, i) => add(segPoints(seg), seg.ref, colors[i] || 0x9fe8ff));
    (sim.nodePrediction || []).forEach((seg) => add(segPoints(seg), seg.ref, 0xffa040, true));
    // Target orbit
    const t = sim.target?.kind === 'object' ? sim.target.object : null;
    if (t) {
      const el = elements(t.pos, t.vel, BODIES[t.ref].mu);
      add(conicPoints(el, 200), t.ref, 0xff7dd8);
    }
    // Orbits of the bodies around the current reference (or its parent).
    const ref = sim.ship.ref;
    const around = BODIES[ref].parent && BODIES[ref].parent !== 'sun' ? BODIES[ref].parent : ref;
    for (const c of childrenOf(around)) {
      const el2 = elementsOfBody(c.id, around, sim.t);
      if (el2) add(conicPoints(el2, 256), around, c.id === 'moon' ? 0x9aa2ad : 0x6f7884);
    }
    if (around !== 'sun' && ref !== 'sun') {
      const el3 = elementsOfBody(around, BODIES[around].parent, sim.t);
      if (el3 && this.mapZoom > 400) add(conicPoints(el3, 256), BODIES[around].parent, 0x6f7884);
    }
    const el = sim.info.el;
    if (el.e < 1) {
      const P = new V3().copy(el.ecc).normalize();
      if (P.len() < 0.5) P.copy(sim.ship.pos).normalize();
      this._apsides = { pe: P.clone().scale(el.rp), ap: P.clone().scale(-el.ra) };
    } else this._apsides = null;
  }

  // ------------------------------------------------------------------ drawing
  render() {
    this.applyResolution();
    this.webgl.render(this.scene, this.camera);
    this.adaptResolution(performance.now());
  }

  adaptResolution(now) {
    const f = this._frames;
    const interval = now - f.last;
    f.last = now;
    if (!this.profile.dynamicResolution || !this.dynamicResolution || !(interval > 0) || interval > 250) return;
    f.ema = f.ema ? f.ema + (interval - f.ema) * 0.1 : interval;
    const target = 1000 / Math.min(this.profile.maxFps, 60);
    if (now - f.changed < 1500) return;
    let level = RESOLUTION_LEVELS.findIndex((v) => v <= this.resolutionScale + 1e-6);
    if (level < 0) level = RESOLUTION_LEVELS.length - 1;
    if (f.ema > target * 1.22 && level < RESOLUTION_LEVELS.length - 1) {
      level++;
      f.good = 0;
      if (now - (f.grown || -Infinity) < 8000) {
        f.holdFor = Math.min((f.holdFor || 90000) * 2, 600000);
        f.hold = now + f.holdFor;
      }
    } else if (f.ema < target * 1.04 && level > 0 && now > (f.hold || 0)) {
      f.good += interval;
      if (f.good < 6000) return;
      level--;
      f.good = 0;
      f.grown = now;
    } else {
      if (f.ema >= target * 1.04) f.good = 0;
      return;
    }
    this.resolutionScale = RESOLUTION_LEVELS[level];
    f.changed = now;
    this._resizePending = true;
  }

  applyResolution() {
    if (!this._resizePending) return;
    this._resizePending = false;
    this.webgl.setPixelRatio(this.baseRatio * this.resolutionScale);
    this.webgl.setSize(this.width, this.height, false);
  }

  getStats() {
    let chunks = 0;
    for (const v of Object.values(this.bodies)) chunks += (v.lod?.drawn || 0) + (v.clouds?.drawn || 0);
    return { triangles: this.webgl.info.render.triangles, calls: this.webgl.info.render.calls, chunks };
  }

  dispose() {
    this.builder?.dispose();
    this.webgl.dispose();
  }
}

/** Osculating elements of a body around its parent (from the ephemeris). */
function elementsOfBody(id, around, t) {
  const b = BODIES[id];
  if (!b || !around) return null;
  const r = relativeState(id, around, t);
  const mu = around === 'sun' ? BODIES.sun.mu : BODIES[around].mu + b.mu;
  return elements(r.pos, r.vel, mu);
}

function rotateAround(v, axis, angle) {
  if (!angle) return v.clone();
  const a = axis.clone().normalize();
  const c = Math.cos(angle), s = Math.sin(angle);
  const cross = new V3().crossVectors(a, v);
  const dot = a.dot(v);
  return new V3(v.x * c + cross.x * s + a.x * dot * (1 - c), v.y * c + cross.y * s + a.y * dot * (1 - c), v.z * c + cross.z * s + a.z * dot * (1 - c));
}

function slerpQuat(a, b, t) {
  let cos = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bw = b.w, bx = b.x, by = b.y, bz = b.z;
  if (cos < 0) {
    cos = -cos;
    bw = -bw; bx = -bx; by = -by; bz = -bz;
  }
  if (cos > 0.9995) {
    a.w += (bw - a.w) * t; a.x += (bx - a.x) * t; a.y += (by - a.y) * t; a.z += (bz - a.z) * t;
    return a.normalize();
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  a.w = a.w * ka + bw * kb; a.x = a.x * ka + bx * kb; a.y = a.y * ka + by * kb; a.z = a.z * ka + bz * kb;
  return a.normalize();
}

export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
  });
}
