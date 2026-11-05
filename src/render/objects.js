// Orbiting objects (station Aurora, orbiter Selene, satellites, the Ardesia swarm with its
// mining outpost) and surface sites (spaceport with pad and runway, Base Lucerna), built in
// the simulation body frames (x forward, y right, z down for objects).
import * as THREE from 'three';
import { canvasTexture, getGlowTexture, getMaterialTexture } from './textures.js';
import { Simplex3 } from '../core/noise.js';
import { rng } from '../core/math.js';

const TAU = Math.PI * 2;
let MT = null;
function mats() {
  if (MT) return MT;
  const panel = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#e3e2dc';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,90,96,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo((i * w) / 16, 0); g.lineTo((i * w) / 16, h); g.stroke(); }
    for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(0, (j * h) / 4); g.lineTo(w, (j * h) / 4); g.stroke(); }
    for (let k = 0; k < 90; k++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(60,60,70,0.35)' : 'rgba(255,255,255,0.4)';
      g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 20, 4 + Math.random() * 8);
    }
    g.fillStyle = '#c9312a';
    g.fillRect(w * 0.06, h * 0.38, 40, 18);
  }, { repeat: true });
  const cells = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#0a1836';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 14; j++) {
      g.fillStyle = `rgb(${14 + Math.random() * 10},${34 + Math.random() * 16},${80 + Math.random() * 26})`;
      g.fillRect((i * w) / 6 + 2, (j * h) / 14 + 2, w / 6 - 4, h / 14 - 4);
    }
  });
  const target = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w / 2, h - 14); g.moveTo(14, h / 2); g.lineTo(w - 14, h / 2); g.stroke();
  });
  const pad = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#6f6e69';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 3000; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,40,40' : '200,200,190'},${Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    g.strokeStyle = '#e8d34a';
    g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, TAU); g.stroke();
    g.fillStyle = '#ececec';
    g.font = 'bold 120px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', w / 2, h / 2);
  });
  MT = {
    module: new THREE.MeshStandardMaterial({ color: 0xffffff, map: panel, roughness: 0.55, metalness: 0.15 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9da2aa, roughness: 0.35, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.6, metalness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc69a3e, roughness: 0.3, metalness: 0.9 }),
    cells: new THREE.MeshStandardMaterial({ color: 0xffffff, map: cells, roughness: 0.28, metalness: 0.45, side: THREE.DoubleSide }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide }),
    target: new THREE.MeshStandardMaterial({ color: 0xffffff, map: target, roughness: 0.6, emissive: 0x222222, emissiveMap: target }),
    window: new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.1, metalness: 0.9, emissive: 0x664422, emissiveIntensity: 0.6 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pad, roughness: 0.92, metalness: 0 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.95, metalness: 0 }),
    marking: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8, metalness: 0 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb4352b, roughness: 0.6, metalness: 0.3 }),
    regolithDome: new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.85, metalness: 0.05 }),
  };
  return MT;
}

function alongX(g) {
  g.rotateZ(-Math.PI / 2);
  return g;
}
function cylX(parent, r, len, x, mat, seg = 32, y = 0, z = 0) {
  const m = new THREE.Mesh(alongX(new THREE.CylinderGeometry(r, r, len, seg)), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function box(parent, sx, sy, sz, pos, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(...pos);
  parent.add(m);
  return m;
}
function rod(parent, a, b, r, mat, seg = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  parent.add(m);
  return m;
}
function glow(parent, pos, color, size = 1.2) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.set(...pos);
  s.scale.setScalar(size);
  s.renderOrder = 22;
  parent.add(s);
  return s;
}

/** Docking port hardware with alignment target and approach lights. */
function portHardware(parent, port, lights) {
  const m = mats();
  const g = new THREE.Group();
  const d = new THREE.Vector3(...port.dir);
  g.position.set(...port.pos);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
  // Short tunnel ending at the port plane (x = 0 in port frame).
  cylX(g, 0.75, 1.6, -0.8, m.metal, 24);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.08, 8, 28), m.dark);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  // Alignment target: plate on a standoff above the port.
  const up = port.up || (Math.abs(port.dir[2]) > 0.5 ? [1, 0, 0] : [0, 0, -1]);
  const upL = new THREE.Vector3(...up).applyQuaternion(g.quaternion.clone().invert());
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), m.target);
  plate.position.copy(upL).multiplyScalar(1.6);
  plate.position.x = -0.25;
  plate.rotation.y = Math.PI / 2;
  g.add(plate);
  rod(g, [-0.6, upL.y * 0.8, upL.z * 0.8], [-0.25, upL.y * 1.6, upL.z * 1.6], 0.03, m.metal);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    lights.push({ sprite: glow(g, [0.05, Math.cos(a) * 1.15, Math.sin(a) * 1.15], k % 2 ? 0x37ff6a : 0xffd84a, 0.7), blink: 2, phase: k * 0.12 });
  }
  parent.add(g);
  return g;
}

export function buildStation(def) {
  const m = mats();
  const root = new THREE.Group();
  const lights = [];
  // Pressurised core: modules of different diameters along x.
  const segs = [[-40, -26, 3.0], [-26, -8, 3.3], [-8, 12, 3.4], [12, 30, 3.1], [30, 42, 2.9]];
  for (const [a, b, r] of segs) {
    cylX(root, r, b - a, (a + b) / 2, m.module, 40);
    const band = cylX(root, r + 0.08, 0.5, b - 0.25, m.dark, 40);
    band.castShadow = false;
  }
  // Zenith node
  const node = new THREE.Mesh(new THREE.SphereGeometry(3.8, 28, 18), m.module);
  node.position.set(8, 0, 0);
  root.add(node);
  const zen = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4.4, 28), m.module);
  zen.position.set(8, 0, -4.2);
  zen.rotation.x = Math.PI / 2;
  root.add(zen);
  // Cupola with windows
  const cup = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 10, 0, TAU, 0, Math.PI / 2), m.window);
  cup.position.set(-4, 0, 3.2);
  cup.rotation.x = Math.PI;
  root.add(cup);
  for (const p of def.ports) portHardware(root, p, lights);
  // Truss and solar wings (wings rotate about y to track the sun).
  box(root, 2.0, 80, 2.0, [-12, 0, 0], m.metal).material = m.metal;
  for (let k = -38; k <= 38; k += 4) {
    rod(root, [-13, k, -1], [-11, k + 4, 1], 0.08, m.dark);
    rod(root, [-11, k, -1], [-13, k + 4, 1], 0.08, m.dark);
  }
  const wings = [];
  for (const sy of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(-12, sy * 58, 0);
    for (const dx of [-8.2, 8.2]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 15), m.cells);
      panel.position.x = dx;
      w.add(panel);
    }
    rod(w, [0, -18, 0], [0, 18, 0], 0.25, m.metal);
    root.add(w);
    wings.push(w);
    glow(root, [-12, sy * 74, 0], sy > 0 ? 0x2bff66 : 0xff3030, 1.6);
  }
  // Radiators
  const rad = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), m.radiator);
  rad.position.set(-30, 0, 10);
  rad.rotation.x = Math.PI / 2;
  root.add(rad);
  rod(root, [-30, 0, 3], [-30, 0, 19], 0.2, m.metal);
  // Rotating habitation ring with spokes.
  const ring = new THREE.Group();
  ring.position.x = def.rings[0].x;
  const torus = new THREE.Mesh(new THREE.TorusGeometry(def.rings[0].radius, def.rings[0].tube, 18, 96), m.module);
  torus.rotation.y = Math.PI / 2;
  ring.add(torus);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    rod(ring, [0, Math.cos(a) * 3, Math.sin(a) * 3], [0, Math.cos(a) * 20, Math.sin(a) * 20], 0.9, m.white, 12);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    const wdw = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), m.window);
    wdw.position.set(def.rings[0].tube + 0.02, Math.cos(a) * def.rings[0].radius, Math.sin(a) * def.rings[0].radius);
    wdw.rotation.y = Math.PI / 2;
    ring.add(wdw);
  }
  root.add(ring);
  lights.push({ sprite: glow(root, [43, 0, -3.6], 0xffffff, 2.0), blink: 1, phase: 0 });
  lights.push({ sprite: glow(root, [-41, 0, 3.6], 0xffffff, 2.0), blink: 1, phase: 0.5 });
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, lights, wings, ring, spin: 0.05 };
}

export function buildOrbiter(def) {
  const m = mats();
  const root = new THREE.Group();
  const lights = [];
  cylX(root, 2.0, 6, 0.8, m.module, 32);
  cylX(root, 2.2, 4, -4.0, m.gold, 32);
  const nz = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.4, 0.9, 1.4, 20, 1, true)), m.metal);
  nz.position.x = -6.6;
  root.add(nz);
  for (const sy of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7.5), m.cells);
    p.position.set(0, sy * 6.5, 0);
    root.add(p);
    rod(root, [0, sy * 2, 0], [0, sy * 2.8, 0], 0.08, m.metal);
  }
  for (const p of def.ports) portHardware(root, p, lights);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, lights };
}

export function buildSatellite(def) {
  const m = mats();
  const root = new THREE.Group();
  const lights = [];
  const s = def.size || 1;
  box(root, 2.2 * s, 1.8 * s, 1.8 * s, [0, 0, 0], m.gold);
  box(root, 0.6 * s, 1.2 * s, 1.2 * s, [1.4 * s, 0, 0], m.white);
  for (const sy of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * s, 6 * s), m.cells);
    p.position.set(0, sy * 4.2 * s, 0);
    root.add(p);
    rod(root, [0, sy * 0.9 * s, 0], [0, sy * 1.3 * s, 0], 0.05 * s, m.metal);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1 * s, 20, 8, 0, TAU, 0, 0.9), m.white);
  dish.position.set(-0.4 * s, 0, 1.6 * s);
  dish.rotation.x = Math.PI;
  root.add(dish);
  if (def.ports) for (const p of def.ports) portHardware(root, p, lights);
  lights.push({ sprite: glow(root, [1.75 * s, 0, -0.9 * s], 0xff4040, 0.6), blink: 1, phase: 0.3 });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, lights };
}

// ---------------------------------------------------------------- asteroid swarm

function rockGeometry(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = new Simplex3(seed);
  const pos = g.attributes.position;
  const r = rng(seed);
  const stretch = [0.7 + r() * 0.6, 0.7 + r() * 0.5, 0.6 + r() * 0.5];
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let h = 1 + n.fbm(x * 1.4, y * 1.4, z * 1.4, 4) * 0.35;
    // Craters
    const c = n.noise(x * 3 + 5, y * 3, z * 3);
    if (c > 0.55) h -= (c - 0.55) * 0.5;
    pos.setXYZ(i, x * h * stretch[0], y * h * stretch[1], z * h * stretch[2]);
    const t = 0.55 + n.noise(x * 4, y * 4 + 2, z * 4) * 0.12;
    colors[i * 3] = t * 1.02;
    colors[i * 3 + 1] = t * 0.96;
    colors[i * 3 + 2] = t * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // Spherical UVs for the rock texture.
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    uv[i * 2] = (Math.atan2(z, x) / TAU + 0.5) * 3;
    uv[i * 2 + 1] = (Math.acos(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z)))) / Math.PI) * 2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function buildSwarm(obj, quality) {
  const root = new THREE.Group();
  const rock = getMaterialTexture('rock');
  const mat = new THREE.MeshStandardMaterial({ color: 0xa79f93, vertexColors: true, roughness: 0.95, metalness: 0.02 });
  mat.map = rock.value;
  // The ground texture loads asynchronously: refresh the map once it is there.
  mat.onBeforeRender = () => {
    if (mat.map !== rock.value) {
      mat.map = rock.value;
      mat.needsUpdate = true;
    }
  };
  const shapes = [0, 1, 2, 3].map((k) => rockGeometry(101 + k * 37, quality === 'low' ? 3 : 4));
  const byShape = [[], [], [], []];
  obj.asteroids.forEach((a, i) => byShape[a.shape].push(i));
  const meshes = byShape.map((list, k) => {
    const im = new THREE.InstancedMesh(shapes[k], mat, Math.max(1, list.length));
    im.count = list.length;
    im.castShadow = true;
    im.receiveShadow = true;
    im.userData.list = list;
    root.add(im);
    return im;
  });
  // Mining outpost at the centre.
  const m = mats();
  const outpost = new THREE.Group();
  const lights = [];
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 26, 28), m.module);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = -0.75;
  outpost.add(hub);
  box(outpost, 18, 18, 12, [0, 0, -22], m.red);
  box(outpost, 32, 2, 2, [0, 0, 0], m.metal);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(10, 22), m.cells);
    p.position.set(sx * 24, 0, 0);
    outpost.add(p);
  }
  portHardware(outpost, { pos: [0, 0, 18], dir: [0, 0, 1], up: [1, 0, 0] }, lights);
  for (let k = 0; k < 8; k++) lights.push({ sprite: glow(outpost, [Math.cos(k) * 14, Math.sin(k) * 14, -16], 0xffa040, 2.4), blink: 0, phase: 0 });
  outpost.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(outpost);
  return { root, lights, meshes };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3();
export function updateSwarm(view, obj, t) {
  for (const im of view.meshes) {
    const list = im.userData.list;
    for (let j = 0; j < list.length; j++) {
      const a = obj.asteroids[list[j]];
      _ax.set(a.axis[0], a.axis[1], a.axis[2]).normalize();
      _q.setFromAxisAngle(_ax, a.phase + a.spin * t);
      _p.set(a.x, a.y, a.z);
      _s.setScalar(a.radius);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(j, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- surface sites

/**
 * Spaceport: pad with service tower, flame trench, runway with markings and edge lights,
 * hangars. Built in local east (x) / up (y) / south (z) three coordinates.
 */
export function buildSpaceport(site) {
  const m = mats();
  const root = new THREE.Group();
  const lights = [];
  const padG = new THREE.Mesh(new THREE.CylinderGeometry(70, 74, 3, 48), m.concrete);
  padG.position.y = -1.3;
  root.add(padG);
  // Service tower and arm
  const tower = new THREE.Group();
  for (const [x, z] of [[-14, -4], [-8, -4], [-14, 2], [-8, 2]]) rod(tower, [x, 0, z], [x, 62, z], 0.35, m.red, 6);
  for (let y = 4; y < 62; y += 6) {
    rod(tower, [-14, y, -4], [-8, y + 6, -4], 0.15, m.red);
    rod(tower, [-14, y, 2], [-8, y + 6, 2], 0.15, m.red);
    rod(tower, [-14, y, -4], [-14, y, 2], 0.15, m.red);
    rod(tower, [-8, y, -4], [-8, y, 2], 0.15, m.red);
  }
  box(tower, 9, 2, 2, [-4.5, 34, -1], m.metal);
  lights.push({ sprite: glow(tower, [-11, 64, -1], 0xff3030, 3), blink: 1, phase: 0 });
  root.add(tower);
  // Lightning masts
  for (const [x, z] of [[55, 40], [-55, 40], [0, -60]]) {
    rod(root, [x, 0, z], [x, 80, z], 0.5, m.metal);
    lights.push({ sprite: glow(root, [x, 81, z], 0xff2020, 3), blink: 1, phase: x * 0.01 });
  }
  // Runway east-west, south of the pad.
  const rw = site.runway;
  const runway = new THREE.Group();
  runway.position.set(rw.east, 0, -rw.north);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(rw.length, rw.width), m.asphalt);
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.06;
  runway.add(strip);
  for (let x = -rw.length / 2 + 120; x < rw.length / 2 - 120; x += 60) {
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.2), m.marking);
    mk.rotation.x = -Math.PI / 2;
    mk.position.set(x, 0.08, 0);
    runway.add(mk);
  }
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      const mk = new THREE.Mesh(new THREE.PlaneGeometry(40, 2.5), m.marking);
      mk.rotation.x = -Math.PI / 2;
      mk.position.set(end * (rw.length / 2 - 40), 0.08, k * 6.5);
      runway.add(mk);
    }
  }
  const edge = [];
  for (let x = -rw.length / 2; x <= rw.length / 2; x += 60) for (const s of [-1, 1]) edge.push(x, 0.5, s * (rw.width / 2 + 1));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
  const edgeLights = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xfff1c0, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
  runway.add(edgeLights);
  root.add(runway);
  // Hangars and control centre
  for (const [x, z, w, d, hgt] of [[400, 260, 80, 60, 26], [520, 260, 60, 60, 22], [-300, 300, 50, 30, 14], [-380, 300, 40, 30, 40]]) {
    box(root, w, hgt, d, [x, hgt / 2, z], m.white);
    box(root, w * 1.02, 1, d * 1.02, [x, hgt, z], m.metal);
  }
  // Vehicle assembly building
  box(root, 120, 90, 100, [-700, 45, -200], m.white);
  box(root, 30, 70, 2, [-700, 35, -149], m.dark);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, lights, edgeLights };
}

export function buildLucerna(site) {
  const m = mats();
  const root = new THREE.Group();
  const lights = [];
  for (const p of site.pads) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(18, 19, 0.6, 40), m.concrete);
    pad.position.set(p.east, -0.25, -p.north);
    root.add(pad);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      lights.push({ sprite: glow(root, [p.east + Math.cos(a) * 19, 0.6, -p.north + Math.sin(a) * 19], 0x5cff7a, 1.6), blink: 2, phase: k * 0.1 });
    }
  }
  // Habitat domes, solar farm, antenna
  for (const [x, z, r] of [[90, -60, 14], [118, -40, 9], [70, -92, 8]]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, TAU, 0, Math.PI / 2), m.regolithDome);
    dome.position.set(x, -0.5, z);
    root.add(dome);
    lights.push({ sprite: glow(root, [x, r + 0.5, z], 0xffffff, 1.8), blink: 1, phase: x * 0.003 });
  }
  rod(root, [105, 0, -52], [118, 0, -40], 2.2, m.white, 12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), m.cells);
    p.position.set(-120 + i * 15, 3, -80 + j * 10);
    p.rotation.x = -Math.PI / 2.6;
    root.add(p);
  }
  rod(root, [40, 0, -130], [40, 30, -130], 0.4, m.metal);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 8, 0, TAU, 0, 0.9), m.white);
  dish.position.set(40, 30, -130);
  dish.rotation.x = 0.8;
  root.add(dish);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, lights };
}

/** Blink patterns: 0 steady, 1 strobe, 2 slow pulse. */
export function updateLights(lights, t, night = 1) {
  for (const l of lights) {
    const ph = t + (l.phase || 0);
    if (l.blink === 1) l.sprite.visible = ph % 1.6 < 0.09;
    else if (l.blink === 2) l.sprite.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ph * 4));
    else l.sprite.visible = night > 0.05 || true;
  }
}
