// Procedural spacecraft models, built in the vehicle "stack" frame (x forward, y right,
// z down) so they share coordinates with the simulation. One group per stage, so a stage
// can be detached as debris. Engine plumes, RCS puffs, lights and the parachute.
import * as THREE from 'three';
import { canvasTexture, getGlowTexture } from './textures.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- materials (shared)
let M = null;
function mats() {
  if (M) return M;
  const quilt = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ecebe6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,120,120,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(0, (i * h) / 8); g.lineTo(w, (i * h) / 8); g.stroke();
      g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke();
    }
    for (let k = 0; k < 400; k++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`;
      g.fillRect(Math.random() * w, Math.random() * h, 6, 6);
    }
  }, { repeat: true });
  const foil = canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#d8b45a');
    grd.addColorStop(0.5, '#a97f2c');
    grd.addColorStop(1, '#e6c878');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 260; k++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,240,190' : '90,60,10'},${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
      g.stroke();
    }
  }, { repeat: true });
  const cells = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#0d1f3f';
    g.fillRect(0, 0, w, h);
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = `rgb(${18 + Math.random() * 8},${40 + Math.random() * 12},${86 + Math.random() * 20})`;
      g.fillRect((i * w) / n + 2, (j * h) / n + 2, w / n - 4, h / n - 4);
    }
    g.strokeStyle = '#8a8f99';
    g.lineWidth = 3;
    g.strokeRect(1, 1, w - 2, h - 2);
  }, { repeat: true });
  const hull = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4b5059';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,22,26,0.6)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo((i * w) / 6, 0); g.lineTo((i * w) / 6, h); g.stroke(); }
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, (i * h) / 4 + 10); g.lineTo(w, (i * h) / 4 + 10); g.stroke(); }
    g.fillStyle = '#e06a1f';
    g.fillRect(0, h * 0.42, w, h * 0.08);
  }, { repeat: true });
  M = {
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, map: quilt, roughness: 0.62, metalness: 0.05 }),
    whiteSmooth: new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.4, metalness: 0.1 }),
    foil: new THREE.MeshStandardMaterial({ color: 0xffffff, map: foil, roughness: 0.32, metalness: 0.85 }),
    shield: new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.95, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.35, metalness: 0.9 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.8 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x5b4b3f, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide }),
    cells: new THREE.MeshStandardMaterial({ color: 0xffffff, map: cells, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c1520, roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.72 }),
    hull: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hull, roughness: 0.45, metalness: 0.55 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd8641c, roughness: 0.5, metalness: 0.2 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7, metalness: 0.2 }),
    rocketWhite: new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.5, metalness: 0.1 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0xf06a2a, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }),
    canopyWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }),
  };
  return M;
}

// ---------------------------------------------------------------- geometry helpers (axis = body x)

function alongX(g) {
  g.rotateZ(-Math.PI / 2);
  return g;
}

function cyl(parent, r0, r1, len, x, mat, seg = 32, open = false) {
  const g = alongX(new THREE.CylinderGeometry(r1, r0, len, seg, 1, open));
  const m = new THREE.Mesh(g, mat);
  m.position.x = x;
  parent.add(m);
  return m;
}

/** Lathe profile [[x, r], ...] along body x. */
function lathe(parent, profile, mat, seg = 40) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(r, x));
  const g = alongX(new THREE.LatheGeometry(pts, seg));
  const m = new THREE.Mesh(g, mat);
  parent.add(m);
  return m;
}

function box(parent, sx, sy, sz, pos, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(...pos);
  parent.add(m);
  return m;
}

function rod(parent, a, b, r, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  parent.add(m);
  return m;
}

function nozzle(parent, x, rThroat, rExit, len, mats) {
  // Bell from the throat (x) towards -x.
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push([x - len * t, rThroat + (rExit - rThroat) * Math.pow(t, 0.7)]);
  }
  const g = alongX(new THREE.LatheGeometry(prof.map(([px, r]) => new THREE.Vector2(r, px)), 28));
  const m = new THREE.Mesh(g, mats.nozzle);
  parent.add(m);
  return { x: x - len, radius: rExit };
}

function solarWing(parent, y0, length, width, x, z = 0, panels = 3) {
  const m = mats();
  const sgn = Math.sign(y0) || 1;
  const wing = new THREE.Group();
  const w = length / panels;
  for (let i = 0; i < panels; i++) {
    const p = box(wing, width, w * 0.94, 0.05, [0, sgn * (w * (i + 0.5)), 0], m.cells);
    p.material = m.cells;
  }
  rod(wing, [0, 0, 0], [0, sgn * 0.3, 0], 0.06, m.metal);
  wing.position.set(x, y0, z);
  parent.add(wing);
  return wing;
}

function window(parent, pos, size, normal) {
  const g = new THREE.PlaneGeometry(size[0], size[1]);
  const mm = new THREE.Mesh(g, mats().glass);
  mm.position.set(...pos);
  mm.lookAt(new THREE.Vector3(...pos).add(new THREE.Vector3(...normal)));
  parent.add(mm);
  return mm;
}

function dockingRing(parent, x, r = 0.65) {
  const m = mats();
  cyl(parent, r, r, 0.35, x - 0.17, m.metal, 24);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.06, 8, 24), m.darkMetal);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = x;
  parent.add(ring);
  // Guide petals.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const p = box(parent, 0.3, 0.05, 0.25, [x + 0.08, Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8], m.metal);
    p.rotation.x = a;
  }
}

function rcsQuad(parent, x, y, z) {
  const m = mats();
  const b = box(parent, 0.28, 0.28, 0.28, [x, y, z], m.whiteSmooth);
  for (const [dx, dy, dz] of [[0.2, 0, 0], [-0.2, 0, 0], [0, 0, 0.2], [0, 0, -0.2]]) {
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 8, 1, true), m.nozzle);
    n.position.set(x + dx, y + dy, z + dz);
    n.lookAt(new THREE.Vector3(x + dx * 3, y + dy * 3, z + dz * 3));
    n.rotateX(Math.PI / 2);
    parent.add(n);
  }
  return b;
}

// ---------------------------------------------------------------- vehicles

function buildPod(stages, parts) {
  const m = mats();
  const g = stages[0];
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 20), m.white);
  cabin.position.x = 0.15;
  g.add(cabin);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.92, 32, 16, 0, TAU, 0, Math.PI / 2), m.glass);
  bubble.rotation.z = -Math.PI / 2;
  bubble.position.x = 0.75;
  g.add(bubble);
  cyl(g, 0.9, 0.75, 1.1, -0.9, m.foil, 24);
  nozzle(g, -1.4, 0.16, 0.36, 0.42, m);
  parts.engines.push({ stage: 0, x: -1.82, radius: 0.36, color: 'storable' });
  dockingRing(g, 1.85, 0.5);
  cyl(g, 0.45, 0.45, 0.5, 1.5, m.metal, 20);
  // Frame and skids
  for (const sy of [-1, 1]) {
    rod(g, [-0.8, sy * 0.95, 1.0], [1.2, sy * 0.95, 1.0], 0.05, m.metal);
    rod(g, [-0.3, sy * 0.95, 1.0], [-0.3, sy * 0.6, 0.6], 0.04, m.metal);
    rod(g, [0.8, sy * 0.95, 1.0], [0.8, sy * 0.6, 0.6], 0.04, m.metal);
    // Side thruster pods
    box(g, 0.9, 0.35, 0.5, [0, sy * 1.3, 0], m.whiteSmooth);
    rod(g, [0, sy * 1.1, 0], [0, sy * 0.9, 0], 0.08, m.metal);
  }
  for (const sz of [-1, 1]) rcsQuad(g, -0.4, 0, sz * 1.15);
  // Manipulator arm
  rod(g, [0.9, 0.6, 0.6], [1.7, 0.75, 0.9], 0.05, m.whiteSmooth);
  rod(g, [1.7, 0.75, 0.9], [2.1, 0.5, 0.95], 0.04, m.whiteSmooth);
  parts.thrusters = [[0, 1.3, 0], [0, -1.3, 0], [-0.4, 0, 1.15], [-0.4, 0, -1.15], [1.2, 0, 0], [-1.3, 0, 0]];
}

function buildCapsuleSM(g, parts, stage) {
  const m = mats();
  cyl(g, 2.0, 2.0, 3.6, -2.6, m.white, 40);
  cyl(g, 2.02, 2.02, 0.35, -0.95, m.foil, 40);
  cyl(g, 1.7, 2.0, 0.5, -4.65, m.foil, 40);
  nozzle(g, -4.85, 0.32, 0.95, 1.25, m);
  parts.engines.push({ stage, x: -6.1, radius: 0.95, color: 'storable' });
  parts.wings = parts.wings || [];
  for (const sy of [-1, 1]) parts.wings.push(solarWing(g, sy * 2.1, 7.2, 1.9, -2.7, 0, 3));
  for (const [y, z] of [[0, 2.05], [0, -2.05]]) rcsQuad(g, -1.3, y, z);
  box(g, 1.6, 0.06, 1.1, [-2.9, 0, -2.05], m.whiteSmooth);
}

function buildCapsuleCM(g, parts) {
  const m = mats();
  // Cone with a curved shoulder; heat shield at the back.
  lathe(g, [[-0.75, 0], [-0.75, 2.25], [-0.55, 2.32], [-0.35, 2.26], [1.9, 1.05], [2.25, 0.9], [2.3, 0]], m.white, 48);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.2, 40, 8, 0, TAU, 0, 0.6), m.shield);
  shield.rotation.z = Math.PI / 2;
  shield.position.x = -0.75 + 4.2 * Math.cos(0.6) - 0.06;
  shield.scale.set(1, 0.98, 1);
  g.add(shield);
  cyl(g, 0.85, 0.65, 0.45, 2.45, m.whiteSmooth, 32);
  dockingRing(g, 2.75, 0.6);
  // Windows facing forward-up.
  for (const a of [-0.55, 0.55]) {
    const y = Math.sin(a) * 1.5, z = -Math.cos(a) * 1.5;
    window(g, [1.2, y, z], [0.55, 0.4], [0.45, Math.sin(a), -Math.cos(a)]);
  }
  window(g, [1.75, 0.0, -1.1], [0.42, 0.32], [0.5, 0, -1]);
  parts.chuteX = 2.4;
  parts.thrusters = [[1.5, 1.3, 0], [1.5, -1.3, 0], [1.5, 0, 1.3], [1.5, 0, -1.3], [-1.3, 0, 2.05], [-1.3, 0, -2.05]];
}

function buildCapsule(stages, parts) {
  buildCapsuleSM(stages[0], parts, 0);
  buildCapsuleCM(stages[1], parts);
}

function buildLander(stages, parts) {
  const m = mats();
  const d = stages[0];
  // Octagonal descent stage in gold foil.
  const oct = alongX(new THREE.CylinderGeometry(2.0, 2.0, 1.9, 8));
  const om = new THREE.Mesh(oct, m.foil);
  om.position.x = -1.3;
  om.rotation.x = Math.PI / 8;
  d.add(om);
  cyl(d, 1.4, 1.95, 0.25, -2.35, m.darkMetal, 8);
  nozzle(d, -2.2, 0.28, 0.75, 0.65, m);
  parts.engines.push({ stage: 0, x: -2.85, radius: 0.75, color: 'storable' });
  for (const [sy, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const foot = [-3.0, sy * 2.33, sz * 2.33];
    rod(d, [-0.6, sy * 1.35, sz * 1.35], foot, 0.07, m.metal);
    rod(d, [-2.1, sy * 1.45, sz * 1.45], foot, 0.05, m.metal);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.12, 16), m.metal);
    pad.geometry.rotateZ(-Math.PI / 2);
    pad.position.set(...foot);
    pad.position.x -= 0.02;
    d.add(pad);
  }
  // Ascent stage: faceted cabin.
  const a = stages[1];
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.7, 2.1, 6), m.metal);
  cab.geometry.rotateZ(-Math.PI / 2);
  cab.position.x = 0.85;
  a.add(cab);
  box(a, 1.3, 2.6, 1.5, [0.7, 0, 0.45], m.foil);
  box(a, 0.9, 1.6, 0.8, [1.0, 0, 1.25], m.whiteSmooth);
  window(a, [1.2, -0.45, 1.66], [0.55, 0.5], [0.2, 0, 1]);
  window(a, [1.2, 0.45, 1.66], [0.55, 0.5], [0.2, 0, 1]);
  dockingRing(a, 2.45, 0.55);
  cyl(a, 0.6, 0.6, 0.5, 2.1, m.metal, 16);
  nozzle(a, -0.2, 0.16, 0.4, 0.35, m);
  parts.engines.push({ stage: 1, x: -0.55, radius: 0.4, color: 'storable' });
  for (const [sy, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) rcsQuad(a, 1.2, sy * 1.35, sz * 1.0);
  // Antennas
  rod(a, [1.9, 0.9, -0.6], [2.6, 1.1, -0.8], 0.02, m.metal);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 6, 0, TAU, 0, 0.8), m.whiteSmooth);
  dish.position.set(2.6, 1.1, -0.8);
  a.add(dish);
  parts.thrusters = [[1.2, 1.35, 1.0], [1.2, -1.35, 1.0], [1.2, 1.35, -1.0], [1.2, -1.35, -1.0], [2.3, 0, 0], [-0.3, 0, 0]];
}

function buildSpaceplane(stages, parts) {
  const m = mats();
  const g = stages[0];
  // Lifting body: white upper half, black tiles on the belly (z+ is down).
  const prof = [[-4.5, 1.25], [-3.9, 1.6], [-1.2, 1.72], [1.4, 1.45], [3.2, 0.95], [4.2, 0.45], [4.55, 0]];
  const pts = prof.map(([x, r]) => new THREE.Vector2(r, x));
  for (const [start, mat] of [[Math.PI / 2, m.rocketWhite], [-Math.PI / 2, m.black]]) {
    const half = new THREE.Mesh(alongX(new THREE.LatheGeometry(pts, 20, start, Math.PI)), mat);
    half.scale.set(1, 1.12, 0.74);
    g.add(half);
  }
  // Base plate with the two orbital engines.
  const base = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), m.darkMetal);
  base.rotation.y = -Math.PI / 2;
  base.scale.set(0.74, 1.12, 1);
  base.position.x = -4.5;
  g.add(base);
  for (const sy of [-1, 1]) {
    const n = nozzle(g, -4.5, 0.12, 0.3, 0.4, m);
    g.children[g.children.length - 1].position.y = sy * 0.45;
    parts.engines.push({ stage: 0, x: n.x, y: sy * 0.45, radius: 0.3, color: 'storable' });
  }
  // Small delta wings with upturned tip fins.
  const ws = new THREE.Shape();
  ws.moveTo(0.4, 0);
  ws.lineTo(-3.7, 2.1);
  ws.lineTo(-4.4, 2.1);
  ws.lineTo(-4.4, 0);
  const wg = new THREE.ExtrudeGeometry(ws, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  const fs = new THREE.Shape();
  fs.moveTo(-2.9, 0);
  fs.lineTo(-4.2, 1.6);
  fs.lineTo(-4.6, 1.6);
  fs.lineTo(-4.4, 0);
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.12, bevelEnabled: false });
  for (const sy of [1, -1]) {
    const w = new THREE.Mesh(wg, m.rocketWhite);
    w.scale.y = sy;
    w.position.set(0, sy * 1.45, 0.55);
    w.rotation.x = -sy * 0.12;
    g.add(w);
    const fin = new THREE.Mesh(fg, m.rocketWhite);
    fin.rotation.x = -Math.PI / 2 + sy * 0.35;
    fin.position.set(0, sy * 3.5, 0.35);
    g.add(fin);
  }
  // Cockpit windows and the upper docking port.
  for (const sy of [-1, 1]) window(g, [3.05, sy * 0.38, -0.66], [0.62, 0.36], [0.55, sy * 0.35, -1]);
  window(g, [2.55, 0, -0.95], [0.5, 0.3], [0.3, 0, -1]);
  const port = new THREE.Group();
  cyl(port, 0.5, 0.5, 0.6, -0.5, m.metal, 20);
  dockingRing(port, 0, 0.5);
  port.rotation.y = Math.PI / 2;
  port.position.set(2.0, 0, -1.6);
  g.add(port);
  parts.thrusters = [[4.0, 0.5, 0], [4.0, -0.5, 0], [3.6, 0, -0.6], [3.6, 0, 0.6], [-4.2, 1.2, -0.4], [-4.2, -1.2, -0.4]];
  // Landing gear (shown when deployed): wheels at the simulation's contact points.
  parts.gear = [];
  for (const [x, y, z, r] of [[3.0, 0, 1.55, 0.22], [-1.6, 2.0, 1.6, 0.25], [-1.6, -2.0, 1.6, 0.25]]) {
    const leg = new THREE.Group();
    rod(leg, [x, y * 0.8, 0.85], [x, y, z], 0.07, m.metal);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 16), m.black);
    wheel.position.set(x, y, z);
    leg.add(wheel);
    g.add(leg);
    parts.gear.push(leg);
  }
}

/** Liquid-hydrogen stage for the trans-lunar injection, with an open adapter around the SM engine. */
function buildTranslunar(stages, parts) {
  const m = mats();
  const t = stages[0];
  cyl(t, 2.0, 2.0, 9.1, -10.85, m.white, 40);
  cyl(t, 2.02, 2.02, 0.4, -8.0, m.foil, 40);
  cyl(t, 2.02, 2.02, 1.5, -5.55, m.rocketWhite, 40, true);
  cyl(t, 1.4, 2.0, 0.6, -15.7, m.darkMetal, 32);
  const n = nozzle(t, -15.95, 0.3, 0.9, 0.85, m);
  parts.engines.push({ stage: 0, x: n.x, radius: 0.9, color: 'hydrolox' });
  for (const [y, z] of [[2.05, 0], [-2.05, 0], [0, 2.05], [0, -2.05]]) rcsQuad(t, -15.0, y, z);
  buildCapsuleSM(stages[1], parts, 1);
  buildCapsuleCM(stages[2], parts);
}

/** Nuclear thermal interplanetary ship: habitat, hydrogen tank, truss with radiators, three reactors. */
function buildNtr(stages, parts) {
  const m = mats();
  const s = stages[0];
  cyl(s, 2.05, 2.05, 1.7, -5.65, m.rocketWhite, 32, true); // adapter around the SM engine
  cyl(s, 2.5, 2.5, 5.4, -9.2, m.white, 32); // habitat
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    window(s, [-8.2, Math.cos(a) * 2.52, Math.sin(a) * 2.52], [0.5, 0.35], [0, Math.cos(a), Math.sin(a)]);
  }
  for (const sy of [-1, 1]) solarWing(s, sy * 2.6, 9, 2.4, -9.5, 0, 4);
  cyl(s, 2.5, 4.2, 1.2, -12.5, m.rocketWhite, 40);
  cyl(s, 4.2, 4.2, 12.6, -19.4, m.foil, 48); // liquid hydrogen tank
  cyl(s, 4.2, 3.0, 1.2, -26.3, m.rocketWhite, 48);
  // Truss and radiator panels.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    rod(s, [-26.8, Math.cos(a) * 1.6, Math.sin(a) * 1.6], [-33, Math.cos(a) * 1.6, Math.sin(a) * 1.6], 0.12, m.metal);
  }
  for (const sz of [-1, 1]) {
    const r = box(s, 5.5, 0.06, 4.2, [-30, 0, sz * 3.8], m.hull);
    r.rotation.x = 0;
  }
  cyl(s, 2.6, 2.6, 0.5, -33.3, m.darkMetal, 32); // shadow shield
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    const y = Math.cos(a) * 1.35, z = Math.sin(a) * 1.35;
    const core = cyl(s, 0.6, 0.6, 3.3, -35.2, m.metal, 20);
    core.position.set(-35.2, y, z);
    const n = nozzle(s, -36.85, 0.22, 0.75, 1.65, m);
    s.children[s.children.length - 1].position.set(0, y, z);
    parts.engines.push({ stage: 0, x: n.x, y, z, radius: 0.75, color: 'nuclear' });
  }
  for (const [y, z] of [[2.55, 0], [-2.55, 0], [0, 2.55], [0, -2.55]]) rcsQuad(s, -10.5, y, z);
  buildCapsuleSM(stages[1], parts, 1);
  buildCapsuleCM(stages[2], parts);
}

/** Two-stage launcher with the Rondine under a fairing and an escape tower. */
function buildRocket(stages, parts) {
  const m = mats();
  const b = stages[0];
  // First stage: tank −59.6…−21, black interstage −21…−18.6 around the upper-stage nozzle.
  cyl(b, 1.83, 1.83, 38.6, -40.3, m.rocketWhite, 40);
  cyl(b, 1.84, 1.84, 2.4, -19.8, m.black, 40, true);
  cyl(b, 1.84, 1.84, 0.5, -33.0, m.black, 40);
  cyl(b, 1.83, 1.6, 0.4, -59.8, m.darkMetal, 32);
  const ring = [[0, 0]];
  for (let k = 0; k < 8; k++) ring.push([Math.cos((k / 8) * TAU) * 1.22, Math.sin((k / 8) * TAU) * 1.22]);
  let exit = -60.7;
  for (const [y, z] of ring) {
    exit = nozzle(b, -59.9, 0.16, 0.42, 0.8, m).x;
    b.children[b.children.length - 1].position.set(0, y, z);
  }
  parts.engines.push({ stage: 0, x: exit, radius: 1.75, color: 'kerolox' });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const y = Math.cos(a), z = Math.sin(a);
    // Folded landing legs and grid fins.
    const leg = box(b, 9, 0.5, 0.18, [-55, y * 1.88, z * 1.88], m.black);
    leg.rotation.x = a + Math.PI / 2;
    const fin = box(b, 0.25, 1.1, 1.0, [-22, y * 2.2, z * 2.2], m.darkMetal);
    fin.rotation.x = a;
  }
  // Second stage.
  const u = stages[1];
  cyl(u, 1.83, 1.83, 12.8, -12.0, m.rocketWhite, 40);
  const n2 = nozzle(u, -18.4, 0.28, 1.2, 2.4, m);
  parts.engines.push({ stage: 1, x: n2.x, radius: 1.2, color: 'kerolox' });
  // Fairing around the service module and capsule, with the escape tower: jettisoned with
  // the second stage (hidden on the falling debris).
  const fair = [];
  fair.push(cyl(u, 1.83, 2.45, 0.8, -5.2, m.rocketWhite, 40));
  fair.push(cyl(u, 2.45, 2.45, 4.0, -2.8, m.rocketWhite, 40));
  fair.push(lathe(u, [[-0.8, 2.45], [0.6, 2.4], [1.9, 1.5], [2.9, 0.75], [3.3, 0]], m.rocketWhite, 40));
  fair.push(rod(u, [3.2, 0, 0], [6.8, 0, 0], 0.16, m.orange));
  fair.push(cyl(u, 0.38, 0.2, 1.5, 7.4, m.orange, 16));
  for (const f of fair) f.userData.jettison = true;
  buildCapsuleSM(stages[2], parts, 2);
  buildCapsuleCM(stages[3], parts);
  // Solar wings stay folded under the fairing until the capsule flies alone.
  parts.wingStage = 2;
}

const BUILDERS = { pod: buildPod, capsule: buildCapsule, translunar: buildTranslunar, lander: buildLander, spaceplane: buildSpaceplane, rocket: buildRocket, ntr: buildNtr };

/** Exhaust colours by propellant. */
const PLUME = {
  storable: [new THREE.Color(1.0, 0.72, 0.45), new THREE.Color(0.55, 0.35, 0.9)],
  kerolox: [new THREE.Color(1.0, 0.85, 0.55), new THREE.Color(1.0, 0.45, 0.12)],
  hydrolox: [new THREE.Color(0.85, 0.9, 1.0), new THREE.Color(0.35, 0.5, 1.0)],
  nuclear: [new THREE.Color(0.7, 0.8, 1.0), new THREE.Color(0.25, 0.35, 0.9)],
};

function plumeMaterial(kind) {
  const [core, edge] = PLUME[kind] || PLUME.storable;
  return new THREE.ShaderMaterial({
    uniforms: { uCore: { value: core }, uEdge: { value: edge }, uPower: { value: 0 }, uTime: { value: 0 }, uAir: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uPower;
      uniform float uTime;
      uniform float uAir;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float along = vUv.y; // 0 at the nozzle
        float rim = abs(dot(normalize(vN), normalize(vV)));
        float fall = pow(1.0 - along, 1.6);
        float flick = 0.85 + 0.15 * sin(uTime * 61.0 + along * 30.0) * sin(uTime * 37.0);
        // Shock diamonds in the lower atmosphere.
        float diamonds = uAir * 0.5 * pow(0.5 + 0.5 * cos(along * 38.0), 6.0) * (1.0 - along);
        vec3 col = mix(uEdge, uCore, pow(rim, 2.0) * (1.0 - along * 0.6)) * (fall * pow(rim, 1.2) + diamonds);
        gl_FragColor = vec4(col * uPower * flick * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Build the model of a vehicle definition.
 * Returns { root, inner, stages: [Group], engines: [{stage, x, radius, mesh, light}], ... }.
 */
export function createVessel(def) {
  const root = new THREE.Group();
  const inner = new THREE.Group(); // stack frame (offset by -com every frame)
  root.add(inner);
  const stages = def.stages.map((s) => {
    const g = new THREE.Group();
    g.name = s.id;
    inner.add(g);
    return g;
  });
  const parts = { engines: [], thrusters: [] };
  (BUILDERS[def.model] || buildCapsule)(stages, parts);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Plumes (unit cone along -x, scaled per frame).
  for (const e of parts.engines) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    g.translate(0, 0.5, 0);
    g.rotateZ(Math.PI / 2); // +y → −x: the plume starts at the nozzle and extends backwards
    // Cylinder → cone-ish: widen the far end in the vertex positions.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); // 0 .. -1
      const k = 1 + -x * 1.6;
      pos.setY(i, pos.getY(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, plumeMaterial(e.color));
    mesh.position.set(e.x, e.y || 0, e.z || 0);
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
    mesh.visible = false;
    stages[e.stage].add(mesh);
    e.mesh = mesh;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: PLUME[e.color]?.[0] || 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.set(e.x - e.radius * 0.6, e.y || 0, e.z || 0);
    glow.renderOrder = 21;
    glow.visible = false;
    stages[e.stage].add(glow);
    e.glow = glow;
  }
  // Navigation lights and strobes.
  const lights = [];
  const addLight = (p, color, blink) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(...p);
    s.scale.setScalar(0.5);
    s.renderOrder = 22;
    inner.add(s);
    lights.push({ sprite: s, blink });
  };
  const L = def.lights || {};
  if (L.nav) {
    addLight(L.nav[0], 0x2bff66, 0);
    addLight(L.nav[1], 0xff2a2a, 0);
  }
  for (const p of L.strobe || []) addLight(p, 0xffffff, 1);
  // Parachute (capsules)
  let chute = null;
  if (parts.chuteX !== undefined) {
    chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI / 2.4), mats().canopy);
    canopy.geometry.rotateZ(-Math.PI / 2);
    canopy.position.x = 1;
    const stripes = new THREE.Mesh(new THREE.SphereGeometry(1.002, 24, 10, 0, TAU, Math.PI / 5, Math.PI / 12), mats().canopyWhite);
    stripes.geometry.rotateZ(-Math.PI / 2);
    stripes.position.x = 1;
    chute.add(canopy, stripes);
    const lineGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      pts.push(0, 0, 0, 1 + Math.cos(Math.PI / 2.4) * 0, Math.cos(a) * Math.sin(Math.PI / 2.4), Math.sin(a) * Math.sin(Math.PI / 2.4));
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 }));
    chute.add(lines);
    chute.visible = false;
    stages[stages.length - 1].add(chute);
  }
  // Docking spotlight and engine light (always present: toggling lights never recompiles shaders).
  const spot = new THREE.SpotLight(0xfff2dd, 0, 220, 0.42, 0.5, 1.2);
  if (L.spot) spot.position.set(...L.spot);
  spot.target.position.set((L.spot?.[0] || 0) + 10, L.spot?.[1] || 0, L.spot?.[2] || 0);
  inner.add(spot, spot.target);
  const engineLight = new THREE.PointLight(0xffb070, 0, 80, 1.6);
  inner.add(engineLight);
  return { root, inner, stages, engines: parts.engines, thrusters: parts.thrusters, lights, chute, gear: parts.gear || null, wings: parts.wings || [], wingStage: parts.wingStage || 0, spot, engineLight, def };
}

/** Per-frame visual state of a vessel model from the spacecraft. */
export function updateVessel(v, ship, time, atmosphere = 0) {
  v.inner.position.set(-ship.com, 0, 0);
  for (let i = 0; i < v.stages.length; i++) v.stages[i].visible = i >= ship.stageIndex;
  let flame = 0;
  for (const e of v.engines) {
    const active = e.stage === ship.stageIndex && ship.thrust > 0;
    const st = ship.stages[e.stage];
    const power = active ? ship.thrust / (st.engine.thrustVac || 1) : 0;
    e.mesh.visible = power > 0.01;
    e.glow.visible = power > 0.01;
    if (power > 0.01) {
      flame = Math.max(flame, power);
      const len = e.radius * (6 + 14 * power) * (1 - atmosphere * 0.35);
      const width = e.radius * (0.9 + (1 - atmosphere) * 0.35 * power);
      e.mesh.scale.set(len, width, width);
      e.mesh.material.uniforms.uPower.value = 0.55 + power * 0.8;
      e.mesh.material.uniforms.uTime.value = time;
      e.mesh.material.uniforms.uAir.value = atmosphere;
      e.glow.scale.setScalar(e.radius * (3 + 3 * power));
      e.glow.material.opacity = 0.6 + power * 0.4;
    }
  }
  v.engineLight.intensity = flame * 600;
  const eng = v.engines.find((e) => e.stage === ship.stageIndex);
  if (eng) v.engineLight.position.set(eng.x - eng.radius * 2, 0, 0);
  for (const l of v.lights) {
    const on = ship.lights || l.blink === 0;
    const vis = l.blink ? ship.lights && (time % 1.4) < 0.08 : on;
    l.sprite.visible = vis;
    l.sprite.scale.setScalar(l.blink ? 1.2 : 0.45);
  }
  v.spot.intensity = ship.lights ? 400 : 0;
  if (v.gear) for (const g of v.gear) g.visible = ship.legsDeployed;
  for (const w of v.wings) w.visible = ship.stageIndex >= v.wingStage;
  if (v.chute) {
    const open = ship.parachute > 0 ? ship.parachute : 0;
    v.chute.visible = open > 0 && ship.stageIndex === ship.stages.length - 1;
    if (v.chute.visible) {
      // Trail the canopy opposite to the motion, in body coordinates.
      const vb = ship.q.rotateInv(ship.vel, { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
      const len = Math.hypot(vb.x, vb.y, vb.z) || 1;
      const dir = new THREE.Vector3(-vb.x / len, -vb.y / len, -vb.z / len);
      const size = 3 + 13 * open;
      v.chute.position.set(2.4 + ship.com * 0, 0, 0);
      v.chute.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      v.chute.scale.set(size * 1.7, size, size);
    }
  }
}

/** A detached stage as a standalone object (debris). */
export function detachStage(v, index) {
  const g = v.stages[index];
  const clone = g.clone();
  clone.visible = true;
  for (const e of v.engines) if (e.stage === index) {
    e.mesh.visible = false;
    e.glow.visible = false;
  }
  clone.traverse((o) => {
    if (o.material?.uniforms) o.visible = false; // no plume on debris
  });
  return clone;
}
