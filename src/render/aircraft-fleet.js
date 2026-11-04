// Procedural models of the extended fleet. Dimensions follow each aircraft's simulation
// data (span, chords, engine and gear positions); liveries are painted into textures.
// Model space: nose towards -Z, right wing +X, up +Y (see coords.js bodyToModel).
import * as THREE from 'three';
import { TAU, loftGeometry, surfaceGeometry, wingShape, addMirrored, mesh, ellipsoid, rod, nacelle, paintLivery, paintMaterial } from './aircraft-kit.js';

// ------------------------------------------------------------------ shared parts

function material(color, roughness = 0.45, metalness = 0.15) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** Propeller with spinner, `blades` blades of radius r, and the blur disc used at speed. */
function propeller(group, mats, { x = 0, y = 0, z, r, blades = 3, spinner = 0.2, width = 0.12, colour = mats.dark, tip = mats.yellow, spinnerMat = mats.accent, engine = 0, spin = 1 }) {
  const prop = new THREE.Group();
  prop.position.set(x, y, z);
  const set = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / blades) * TAU;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(width, r - spinner * 0.6, width * 0.3), colour);
    blade.position.y = spinner * 0.6 + (r - spinner * 0.6) / 2;
    blade.rotation.y = 0.3 * spin;
    arm.add(blade);
    if (tip) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(width * 1.01, r * 0.08, width * 0.31), tip);
      t.position.y = r * 0.96;
      t.rotation.y = 0.3 * spin;
      arm.add(t);
    }
    set.add(arm);
  }
  prop.add(set);
  prop.userData.blades = set;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(spinner, spinner * 2.1, 20), spinnerMat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -spinner * 0.55;
  prop.add(cone);
  group.add(prop);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), new THREE.MeshBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(x, y, z - 0.02);
  group.add(disc);
  return { propeller: prop, propDisc: disc, engine, spin };
}

/** Jet nozzle with a dark exhaust face and an afterburner flame (scaled by the renderer). */
function nozzle(group, mats, { x = 0, y = 0, z, r, length = 0.5, engine = 0, petals = mats.metal }) {
  const can = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, length, 20, 1, true), petals);
  can.rotation.x = Math.PI / 2;
  can.position.set(x, y, z - length / 2);
  group.add(can);
  const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 20), mats.dark);
  face.position.set(x, y, z - length * 0.6);
  group.add(face);
  const flameGeometry = new THREE.ConeGeometry(r * 0.8, r * 5, 18, 1, true);
  flameGeometry.translate(0, r * 2.5, 0);
  flameGeometry.rotateX(Math.PI / 2);
  // Shock-diamond orange fading to the tail: vertex colours along the cone, normal blending
  // so the flame stays visible against a bright sky.
  const colours = [];
  const pos = flameGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getZ(i) / (r * 5)));
    const c = new THREE.Color(0xfff1c0).lerp(new THREE.Color(0xff6a1a), Math.min(1, t * 1.6));
    colours.push(c.r, c.g, c.b);
  }
  flameGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const flame = new THREE.Mesh(flameGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  flame.position.set(x, y, z - length * 0.55);
  flame.visible = false;
  flame.renderOrder = 11;
  group.add(flame);
  return { mesh: flame, engine };
}

/** Vertical fin lofted between a root and a tip station. */
function finSurface(group, material, root, tip, x = 0, thick = 0.1) {
  return mesh(group, surfaceGeometry([
    { x, y: root.y, z: root.z, chord: root.chord, thick },
    { x, y: tip.y, z: tip.z, chord: tip.chord, thick: thick * 0.9 },
  ], true), material);
}

/** Circular canvas decal (national roundel) laid on a wing or fin. */
let roundelTexture = null;
function roundel(group, pos, size, rotation = [-Math.PI / 2, 0, 0]) {
  if (typeof document === 'undefined') return;
  if (!roundelTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d');
    for (const [r, col] of [[62, '#1f7a3a'], [44, '#f4f6f4'], [24, '#c8262e']]) {
      c.fillStyle = col;
      c.beginPath();
      c.arc(64, 64, r, 0, TAU);
      c.fill();
    }
    roundelTexture = new THREE.CanvasTexture(canvas);
    roundelTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(size, 28), new THREE.MeshStandardMaterial({
    map: roundelTexture, transparent: true, roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  m.position.set(...pos);
  m.rotation.set(...rotation);
  group.add(m);
}

/** Roundels on both fuselage sides (painter helper: fuselage z, height ratio, radius in m). */
function paintRoundel(p, z, h, r, width, height, z0, z1, radius) {
  const rx = (r * width) / (z1 - z0), ry = (r * height) / (TAU * radius);
  for (const a of [Math.asin(h), Math.PI - Math.asin(h)]) {
    const y = p.Y(a < 0 ? a + TAU : a);
    for (const [k, col] of [[1, '#1f7a3a'], [0.7, '#f4f6f4'], [0.38, '#c8262e']]) {
      p.c.fillStyle = col;
      p.c.beginPath();
      p.c.ellipse(p.X(z), y, rx * k, ry * k, 0, 0, TAU);
      p.c.fill();
    }
  }
}

/** Air-to-air missile on a wing-tip rail. */
function missile(group, mats, x, y, z0, length = 2.9) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, length, 10), mats.white);
  body.rotation.x = Math.PI / 2;
  body.position.set(x, y, z0 + length / 2);
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.064, 0.25, 10), mats.dark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(x, y, z0 - 0.12);
  group.add(nose);
  for (const k of [0, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(k ? 0.02 : 0.42, k ? 0.42 : 0.02, 0.28), mats.grey);
    fin.position.set(x, y, z0 + length - 0.2);
    group.add(fin);
  }
}

// ------------------------------------------------------------------ fighters

function buildFighter(group, mats) {
  const z0 = -8.0, z1 = 7.0;
  const livery = paintLivery({
    width: 1024, height: 128, z0, z1, radius: 0.7, base: '#8b959d',
    painter: (p) => {
      p.top(z0, z1, 0.35, '#737e87');
      p.c.fillStyle = '#5d666d';
      p.c.fillRect(p.X(z0), 0, p.X(-7.0) - p.X(z0), 128); // radome
      p.panels([-6.8, -5.9, -3.2, -1.6, 0.4, 2.2, 4.0, 5.6], [0.62, -0.45], 'rgba(30,35,40,0.25)');
      p.text('RS-16', -6.3, 0.05, 15, '#2b3238', '600');
      p.text('16-01', 4.6, 0.3, 22, '#3a4248');
      paintRoundel(p, 1.3, 0.25, 0.32, 1024, 128, z0, z1, 0.7);
    },
  });
  const paint = paintMaterial(livery, 0x8b959d);
  const grey = material(0x7f8a93, 0.5, 0.15);
  mesh(group, loftGeometry([
    [-8.0, 0.02, 0.02, -0.05], [-7.6, 0.16, 0.17, -0.05], [-7.0, 0.33, 0.35, -0.02], [-6.0, 0.48, 0.5, 0.03], [-5.0, 0.56, 0.6, 0.08],
    [-4.0, 0.62, 0.64, 0.08], [-3.0, 0.78, 0.6, 0.0], [-1.5, 0.86, 0.58, -0.05], [0, 0.86, 0.56, -0.05], [2.0, 0.8, 0.54, -0.02],
    [4.0, 0.68, 0.5, 0.0], [5.5, 0.56, 0.46, 0.0], [6.6, 0.48, 0.44, 0.02], [7.0, 0.45, 0.42, 0.02],
  ], 36), paint);
  // Bubble canopy and ventral intake.
  mesh(group, loftGeometry([[-6.4, 0.05, 0.03, 0.5], [-6.0, 0.3, 0.26, 0.58], [-5.2, 0.43, 0.42, 0.62], [-4.4, 0.41, 0.4, 0.62], [-3.8, 0.3, 0.28, 0.6], [-3.3, 0.08, 0.05, 0.55]], 24), mats.glass);
  mesh(group, loftGeometry([[-4.7, 0.5, 0.34, -0.62], [-4.3, 0.56, 0.4, -0.64], [-2.5, 0.54, 0.4, -0.58], [0.5, 0.4, 0.28, -0.42], [2.0, 0.1, 0.06, -0.3]], 20), grey);
  const inlet = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), mats.inlet);
  inlet.scale.y = 0.68;
  inlet.rotation.y = Math.PI;
  inlet.position.set(0, -0.64, -4.69);
  group.add(inlet);
  const wing = wingShape({ halfSpan: 4.98, rootChord: 4.55, tipChord: 1.05, centreZ: 0.08, sweep: 2.43, y: -0.08, thick: 0.05 });
  addMirrored(group, wing.geometry, grey);
  const stab = wingShape({ halfSpan: 2.8, rootChord: 2.2, tipChord: 0.8, centreZ: 5.8, sweep: 1.5, y: -0.06, rise: -0.15, thick: 0.05 });
  addMirrored(group, stab.geometry, grey);
  finSurface(group, grey, { y: 0.45, z: 3.8, chord: 3.4 }, { y: 3.15, z: 6.1, chord: 1.15 }, 0, 0.07);
  for (const side of [-1, 1]) {
    missile(group, mats, side * 5.06, -0.05, 0.9);
    roundel(group, [side * 3.3, -0.08 + 0.12, 1.75], 0.34);
  }
  const flames = [nozzle(group, mats, { z: 7.45, r: 0.46, length: 0.55, engine: 0 })];
  return { wing, stab, wingY: -0.08, flames, surfaces: { aileron: 0.55, flap: 0.55, elevator: 0.5, material: grey } };
}

function buildEurofighter(group, mats) {
  const z0 = -8.7, z1 = 7.3;
  const livery = paintLivery({
    width: 1024, height: 128, z0, z1, radius: 0.85, base: '#99a2a9',
    painter: (p) => {
      p.belly(z0, z1, -0.5, '#a7afb5');
      p.c.fillStyle = '#6e767c';
      p.c.fillRect(p.X(z0), 0, p.X(-7.8) - p.X(z0), 128);
      p.panels([-7.6, -6.5, -3.4, -1.0, 1.5, 3.6, 5.6], [0.6, -0.4], 'rgba(30,35,40,0.22)');
      p.text('36-02', -4.6, -0.1, 22, '#3a4248');
      paintRoundel(p, 2.6, 0.3, 0.36, 1024, 128, z0, z1, 0.85);
    },
  });
  const paint = paintMaterial(livery, 0x99a2a9);
  const grey = material(0x949da4, 0.5, 0.15);
  mesh(group, loftGeometry([
    [-8.7, 0.02, 0.02, 0], [-8.2, 0.17, 0.17, 0], [-7.4, 0.36, 0.36, 0.03], [-6.3, 0.52, 0.55, 0.08], [-5.0, 0.62, 0.66, 0.12],
    [-3.8, 0.74, 0.66, 0.08], [-2.5, 1.0, 0.62, -0.05], [-1.0, 1.1, 0.6, -0.05], [1.0, 1.1, 0.58, -0.05], [3.0, 1.05, 0.55, -0.02],
    [5.0, 0.95, 0.5, 0], [6.6, 0.85, 0.45, 0], [7.3, 0.8, 0.42, 0],
  ], 36), paint);
  mesh(group, loftGeometry([[-6.6, 0.05, 0.03, 0.55], [-6.1, 0.32, 0.26, 0.62], [-5.2, 0.44, 0.42, 0.66], [-4.3, 0.42, 0.4, 0.66], [-3.6, 0.3, 0.25, 0.62], [-3.1, 0.08, 0.05, 0.58]], 24), mats.glass);
  // Chin intake.
  mesh(group, loftGeometry([[-3.8, 0.66, 0.33, -0.66], [-3.3, 0.74, 0.38, -0.66], [-1.5, 0.74, 0.38, -0.6], [1.0, 0.55, 0.28, -0.5], [2.4, 0.1, 0.06, -0.35]], 20), grey);
  const inlet = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.55), mats.inlet);
  inlet.rotation.y = Math.PI;
  inlet.position.set(0, -0.66, -3.79);
  group.add(inlet);
  const wing = wingShape({ halfSpan: 5.47, rootChord: 7.2, tipChord: 0.86, centreZ: 0.4, sweep: 4.09, y: -0.25, rise: -0.12, thick: 0.045 });
  addMirrored(group, wing.geometry, grey);
  const canard = wingShape({ halfSpan: 2.05, rootChord: 1.7, tipChord: 0.5, centreZ: -4.6, sweep: 1.0, y: 0.12, thick: 0.04 });
  addMirrored(group, canard.geometry, grey);
  finSurface(group, grey, { y: 0.45, z: 2.5, chord: 4.2 }, { y: 3.1, z: 6.3, chord: 1.0 }, 0, 0.06);
  for (const side of [-1, 1]) {
    ellipsoid(group, [0.13, 0.15, 0.9], [side * 5.5, -0.37, 4.1], grey, 12);
    roundel(group, [side * 3.2, -0.25 + 0.03 - 0.12 * 0.58 + 0.1, 2.6], 0.36);
  }
  // Elevons share the wing trailing edge; a slim "stab" keeps the elevator animation.
  const stab = wingShape({ halfSpan: 2.6, rootChord: 1.0, tipChord: 0.8, centreZ: 3.9, sweep: 0.3, y: -0.26, thick: 0.03 });
  const flames = [-1, 1].map((side) => nozzle(group, mats, { x: side * 0.55, y: -0.08, z: 7.7, r: 0.44, length: 0.5, engine: side < 0 ? 0 : 1 }));
  return { wing, stab, wingY: -0.25, flames, surfaces: { aileron: 0.7, flap: 0.6, elevator: 0.6, material: grey } };
}

// ------------------------------------------------------------------ propeller military

function buildTurboprop(group, mats) {
  const z0 = -3.35, z1 = 6.8;
  const livery = paintLivery({
    width: 768, height: 128, z0, z1, radius: 0.6, base: '#3a4757',
    painter: (p) => {
      p.belly(z0, z1, -0.45, '#d8dde1');
      p.sides(-2.6, z1, -0.2, -0.12, '#f2b51d');
      p.top(-3.35, -1.7, 0.55, '#20262e');
      p.panels([-2.6, -1.6, 0.9, 2.2, 3.6, 5.0], [0.7, -0.6], 'rgba(10,15,20,0.25)');
      p.text('T-21', 3.6, 0.15, 26, '#f4f6f7');
      paintRoundel(p, 1.9, 0.2, 0.26, 768, 128, z0, z1, 0.6);
    },
  });
  const paint = paintMaterial(livery, 0x3a4757);
  const skin = material(0x3a4757, 0.42, 0.15);
  mesh(group, loftGeometry([
    [-3.35, 0.3, 0.3, 0.0], [-2.8, 0.44, 0.48, 0.0], [-1.8, 0.52, 0.6, 0.03], [-0.8, 0.55, 0.66, 0.08], [0.5, 0.55, 0.66, 0.1],
    [2.0, 0.5, 0.6, 0.15], [3.5, 0.38, 0.46, 0.25], [5.0, 0.25, 0.32, 0.35], [6.4, 0.14, 0.2, 0.4], [6.8, 0.05, 0.08, 0.42],
  ], 32), paint);
  mesh(group, loftGeometry([[-1.6, 0.05, 0.03, 0.55], [-1.2, 0.32, 0.26, 0.62], [-0.4, 0.42, 0.42, 0.68], [0.8, 0.42, 0.42, 0.7], [1.8, 0.34, 0.32, 0.66], [2.5, 0.1, 0.06, 0.6]], 24), mats.glass);
  const wing = wingShape({ halfSpan: 4.55, rootChord: 2.25, tipChord: 1.08, centreZ: 0.27, sweep: -0.1, y: -0.45, rise: 0.3, thick: 0.13 });
  addMirrored(group, wing.geometry, skin);
  const stab = wingShape({ halfSpan: 1.95, rootChord: 1.2, tipChord: 0.65, centreZ: 5.55, sweep: 0.25, y: 0.28, thick: 0.09 });
  addMirrored(group, stab.geometry, skin);
  finSurface(group, skin, { y: 0.35, z: 4.4, chord: 2.0 }, { y: 2.05, z: 5.85, chord: 0.95 });
  for (const side of [-1, 1]) {
    // Exhaust stubs on both sides of the cowling.
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.4, 12, 1, true), mats.metal);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(side * 0.5, 0.0, -2.4);
    group.add(pipe);
    roundel(group, [side * 3.4, -0.45 + 0.3 * 0.75 + 0.15, 0.2], 0.28);
  }
  const propellers = [propeller(group, mats, { z: -3.6, r: 1.2, blades: 5, spinner: 0.3, width: 0.16, spinnerMat: mats.dark, tip: mats.yellow })];
  return { wing, stab, wingY: -0.45, propellers, surfaces: { aileron: 0.36, flap: 0.4, elevator: 0.36, material: skin } };
}

function buildWarbird(group, mats) {
  const z0 = -3.2, z1 = 6.4;
  const livery = paintLivery({
    width: 768, height: 128, z0, z1, radius: 0.62, base: '#c4c9cd',
    painter: (p) => {
      p.top(-3.2, -0.9, 0.55, '#1c1f22'); // anti-glare panel
      p.sides(-3.2, -2.7, -1, 1, '#f2c31b'); // yellow nose band
      p.belly(-3.2, -2.7, -1, '#f2c31b');
      p.top(-3.2, -2.7, -1, '#f2c31b');
      for (let i = 0; i < 5; i++) {
        const z = 3.6 + i * 0.22;
        p.sides(z, z + 0.22, -1, 1, i % 2 ? '#15171a' : '#f4f6f7');
        p.belly(z, z + 0.22, -1, i % 2 ? '#15171a' : '#f4f6f7');
      }
      p.panels([-2.4, -1.5, 0.2, 1.6, 2.9, 4.8, 5.7], [0.7, -0.55], 'rgba(60,70,80,0.3)');
      p.text('VS-51', 2.3, 0.05, 26, '#1c1f22');
      paintRoundel(p, 1.0, -0.05, 0.24, 768, 128, z0, z1, 0.62);
    },
  });
  // Natural metal: polished aluminium rather than satin paint.
  const paint = paintMaterial(livery, 0xc4c9cd);
  paint.roughnessMap = paint.metalnessMap = null;
  paint.roughness = 0.34;
  paint.metalness = 0.72;
  const alu = material(0xc2c7cb, 0.34, 0.72);
  mesh(group, loftGeometry([
    [-3.2, 0.42, 0.48, 0.1], [-2.6, 0.52, 0.62, 0.1], [-1.5, 0.55, 0.72, 0.05], [-0.5, 0.55, 0.75, 0.05], [0.5, 0.52, 0.72, 0.03],
    [1.8, 0.45, 0.66, 0.05], [3.2, 0.34, 0.55, 0.1], [4.6, 0.22, 0.42, 0.15], [5.8, 0.13, 0.3, 0.2], [6.4, 0.05, 0.12, 0.25],
  ], 32), paint);
  mesh(group, loftGeometry([[-1.0, 0.05, 0.03, 0.6], [-0.7, 0.3, 0.25, 0.68], [0.0, 0.38, 0.38, 0.74], [0.8, 0.34, 0.33, 0.72], [1.4, 0.12, 0.08, 0.66]], 24), mats.glass);
  // Belly radiator scoop.
  mesh(group, loftGeometry([[-0.2, 0.05, 0.03, -0.55], [0.3, 0.32, 0.28, -0.62], [1.5, 0.34, 0.32, -0.64], [2.6, 0.2, 0.12, -0.56]], 18), alu);
  const scoop = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), mats.inlet);
  scoop.scale.y = 0.85;
  scoop.rotation.y = Math.PI;
  scoop.position.set(0, -0.62, 0.05);
  group.add(scoop);
  const wing = wingShape({ halfSpan: 5.64, rootChord: 2.68, tipChord: 1.2, centreZ: 0.42, sweep: -0.46, y: -0.55, rise: 0.5, thick: 0.14 });
  addMirrored(group, wing.geometry, alu);
  const stab = wingShape({ halfSpan: 2.4, rootChord: 1.4, tipChord: 0.7, centreZ: 5.6, sweep: 0.1, y: 0.1, thick: 0.1 });
  addMirrored(group, stab.geometry, alu);
  finSurface(group, alu, { y: 0.25, z: 4.5, chord: 1.9 }, { y: 1.75, z: 5.55, chord: 0.9 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), mats.dark);
      stack.position.set(side * 0.5, 0.32, -2.7 + i * 0.2);
      group.add(stack);
    }
    roundel(group, [side * 4.2, -0.55 + 0.5 * 0.75 + 0.18, 0.3], 0.3);
  }
  const propellers = [propeller(group, mats, { z: -3.45, r: 1.45, blades: 4, spinner: 0.34, width: 0.19, spinnerMat: mats.red, tip: mats.yellow })];
  return { wing, stab, wingY: -0.55, propellers, surfaces: { aileron: 0.38, flap: 0.45, elevator: 0.4, material: alu } };
}

// ------------------------------------------------------------------ civil

function buildAerobatic(group, mats) {
  const z0 = -2.0, z1 = 4.6;
  const livery = paintLivery({
    width: 512, height: 128, z0, z1, radius: 0.5, base: '#f4f5f6',
    painter: (p) => {
      p.top(-2.0, 0.8, 0.2, '#c8262e');
      p.sides(-2.0, 4.6, -0.55, -0.15, '#1d3f8c');
      p.sides(0.4, 4.6, -0.12, 0.05, '#c8262e');
      p.belly(-2.0, 4.6, -0.6, '#1d3f8c');
      p.text('I-ALLO', 2.6, 0.2, 26, '#1d3f8c');
    },
  });
  const paint = paintMaterial(livery, 0xf4f5f6);
  mesh(group, loftGeometry([
    [-2.0, 0.4, 0.42, 0.0], [-1.5, 0.48, 0.52, 0.0], [-0.8, 0.5, 0.58, 0.02], [0.2, 0.48, 0.6, 0.05], [1.2, 0.42, 0.52, 0.08],
    [2.4, 0.3, 0.4, 0.12], [3.6, 0.18, 0.28, 0.16], [4.6, 0.05, 0.1, 0.2],
  ], 28), paint);
  mesh(group, loftGeometry([[-0.9, 0.05, 0.03, 0.45], [-0.6, 0.3, 0.25, 0.52], [0.0, 0.36, 0.36, 0.58], [0.8, 0.33, 0.32, 0.56], [1.5, 0.1, 0.06, 0.5]], 24), mats.glass);
  const red = material(0xc8262e, 0.35, 0.1), blue = material(0x1d3f8c, 0.35, 0.1);
  const wing = wingShape({ halfSpan: 4.0, rootChord: 1.73, tipChord: 0.95, centreZ: 0.0, sweep: -0.15, y: -0.35, thick: 0.15 });
  addMirrored(group, wing.geometry, red);
  const stab = wingShape({ halfSpan: 1.6, rootChord: 1.0, tipChord: 0.6, centreZ: 4.05, sweep: 0.15, y: 0.25, thick: 0.1 });
  addMirrored(group, stab.geometry, red);
  finSurface(group, blue, { y: 0.25, z: 3.35, chord: 1.25 }, { y: 1.4, z: 4.05, chord: 0.7 });
  const propellers = [propeller(group, mats, { z: -2.25, r: 1.0, blades: 3, spinner: 0.2, width: 0.14, spinnerMat: red, tip: mats.yellow })];
  return { wing, stab, wingY: -0.35, propellers, surfaces: { aileron: 0.42, flap: 0.3, elevator: 0.36, material: mats.white } };
}

function buildTwin(group, mats) {
  const z0 = -3.1, z1 = 5.6;
  const livery = paintLivery({
    width: 768, height: 128, z0, z1, radius: 0.62, base: '#f3f5f6',
    painter: (p) => {
      p.sides(-3.1, 5.6, -0.3, -0.16, '#173f6b');
      p.sides(-2.4, 5.6, -0.14, -0.08, '#c8262e');
      p.belly(-3.1, 5.6, -0.55, '#d9dde0');
      p.top(-2.3, -1.7, 0.4, '#0d1a22', true);
      p.sides(-1.6, 1.4, 0.2, 0.72, '#0d1a22', true);
      p.panels([-2.6, -1.7, 1.5, 2.6, 3.8, 4.8], [0.85, -0.6]);
      p.text('I-GABB', 3.0, 0.2, 28, '#173f6b');
    },
  });
  const paint = paintMaterial(livery, 0xf3f5f6);
  mesh(group, loftGeometry([
    [-3.1, 0.05, 0.05, -0.05], [-2.9, 0.28, 0.26, -0.05], [-2.4, 0.48, 0.46, 0.0], [-1.6, 0.6, 0.6, 0.05], [-0.6, 0.62, 0.66, 0.08],
    [0.6, 0.62, 0.66, 0.08], [1.6, 0.55, 0.58, 0.1], [2.8, 0.4, 0.42, 0.18], [4.0, 0.26, 0.3, 0.28], [5.0, 0.15, 0.2, 0.36], [5.6, 0.05, 0.08, 0.4],
  ], 32), paint);
  const wing = wingShape({ halfSpan: 5.88, rootChord: 1.45, tipChord: 1.45, centreZ: 0.57, sweep: 0, y: -0.5, rise: 0.6, thick: 0.14 });
  addMirrored(group, wing.geometry, mats.white);
  const propellers = [];
  for (const side of [-1, 1]) {
    const x = side * 2.0, y = -0.5 + 0.6 * (2.0 / 5.88) + 0.02;
    mesh(group, loftGeometry([[-1.85, 0.2, 0.2, y], [-1.6, 0.34, 0.36, y], [-0.8, 0.38, 0.42, y - 0.02], [0.4, 0.34, 0.36, y - 0.05], [1.6, 0.08, 0.1, y - 0.02]], 20), mats.white, [x, 0, 0]);
    propellers.push(propeller(group, mats, { x, y, z: -1.95, r: 0.94, blades: 2, spinner: 0.18, width: 0.12, spinnerMat: mats.white, tip: mats.red, engine: side < 0 ? 0 : 1, spin: side < 0 ? 1 : -1 }));
  }
  // T-tail: fin with the stabilator on top.
  finSurface(group, mats.accent, { y: 0.38, z: 4.1, chord: 1.7 }, { y: 1.78, z: 5.0, chord: 1.0 });
  const stab = wingShape({ halfSpan: 1.95, rootChord: 1.0, tipChord: 0.75, centreZ: 5.5, sweep: 0.2, y: 1.72, thick: 0.09 });
  addMirrored(group, stab.geometry, mats.white);
  return { wing, stab, wingY: -0.5, propellers, surfaces: { aileron: 0.32, flap: 0.4, elevator: 0.35, material: mats.white } };
}

function buildBizjet(group, mats) {
  const z0 = -8.0, z1 = 8.3;
  const livery = paintLivery({
    width: 1536, height: 192, z0, z1, radius: 0.9, base: '#f4f6f7',
    painter: (p) => {
      p.belly(z0, z1, -0.45, '#cfd4d8');
      p.sides(-7.0, z1, -0.3, -0.2, '#14284b');
      p.sides(-6.4, z1, -0.18, -0.14, '#c9a24a');
      p.top(-6.95, -6.2, 0.45, '#0b141b', true);
      p.sides(-6.2, -5.6, 0.35, 0.62, '#0b141b', true);
      for (let z = -4.6; z < 1.9; z += 0.75) p.sides(z, z + 0.34, 0.2, 0.46, '#13202a', true);
      p.outline(-5.4, -4.75, -0.2, 0.62, '#9aa4ab');
      p.panels([-6.6, -5.0, -2.5, 0.5, 2.6, 4.4, 6.1], [0.8, -0.55], 'rgba(30,40,50,0.14)');
      p.text('CONDOR', -1.4, 0.62, 46, '#14284b');
      p.text('I-CNDR', 6.2, 0.1, 30, '#14284b', '600');
    },
  });
  const paint = paintMaterial(livery, 0xf4f6f7);
  mesh(group, loftGeometry([
    [-8.0, 0.05, 0.05, -0.15], [-7.6, 0.42, 0.36, -0.1], [-6.9, 0.7, 0.66, -0.02], [-6.0, 0.84, 0.84, 0.05], [-5.0, 0.88, 0.94, 0.08],
    [-3.0, 0.88, 0.95, 0.08], [2.0, 0.88, 0.95, 0.08], [3.5, 0.8, 0.88, 0.15], [5.0, 0.62, 0.7, 0.3], [6.5, 0.4, 0.48, 0.5],
    [7.6, 0.22, 0.3, 0.65], [8.3, 0.05, 0.1, 0.75],
  ], 36), paint);
  ellipsoid(group, [0.95, 0.45, 2.8], [0, -0.75, 0.2], mats.grey);
  const wing = wingShape({ halfSpan: 7.75, rootChord: 2.83, tipChord: 1.13, centreZ: 0.0, sweep: 1.1, y: -0.65, rise: 0.5, thick: 0.12 });
  addMirrored(group, wing.geometry, mats.grey);
  for (const side of [-1, 1]) {
    const tip = wing.at(7.75);
    mesh(group, surfaceGeometry([{ x: 0, y: 0, z: 0, chord: 1.1, thick: 0.08 }, { x: 0, y: 1.1, z: 0.6, chord: 0.5, thick: 0.08 }], true), mats.accent,
      [side * 7.7, tip.y, tip.le + 0.05]).rotation.z = -side * 0.25;
    // Rear-mounted engines on short pylons.
    const pod = new THREE.Group();
    nacelle(pod, 0, 0, mats);
    pod.scale.setScalar(0.52);
    pod.position.set(side * 1.55, 0.55, 6.3);
    group.add(pod);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 1.2), mats.grey);
    pylon.position.set(side * 1.0, 0.5, 5.0);
    group.add(pylon);
  }
  finSurface(group, mats.accent, { y: 0.85, z: 5.2, chord: 3.1 }, { y: 3.3, z: 7.5, chord: 1.6 });
  const stab = wingShape({ halfSpan: 3.05, rootChord: 1.6, tipChord: 0.9, centreZ: 8.0, sweep: 0.6, y: 3.22, thick: 0.09 });
  addMirrored(group, stab.geometry, mats.grey);
  return { wing, stab, wingY: -0.65, surfaces: { aileron: 0.45, flap: 0.6, elevator: 0.45, material: mats.grey } };
}

// ------------------------------------------------------------------ transport

function buildTransport(group, mats) {
  const z0 = -14.0, z1 = 15.8;
  const livery = paintLivery({
    width: 2048, height: 256, z0, z1, radius: 2.25, base: '#7c858b',
    painter: (p) => {
      p.belly(z0, z1, -0.5, '#868f95');
      p.top(-13.2, -12.2, 0.4, '#0b141b', true);
      p.c.fillStyle = '#7c858b';
      for (const a of [Math.PI / 2, Math.PI / 2 - 0.35, Math.PI / 2 + 0.35]) p.c.fillRect(p.X(-13.2), p.Y(a) - 1.5, p.X(-12.2) - p.X(-13.2), 3);
      p.sides(-12.2, -11.5, 0.25, 0.55, '#0b141b', true);
      for (const z of [-9.5, -2.0, 4.0]) p.sides(z, z + 0.35, 0.3, 0.42, '#13202a', true);
      p.outline(-10.6, -9.7, -0.6, 0.35, '#5b6368');
      p.outline(9.0, 14.5, -0.95, -0.55, '#5b6368');
      p.panels([-12.5, -10, -6, -2, 2, 6, 9, 12], [0.75, -0.55, 0.2], 'rgba(30,35,40,0.2)');
      p.text('46-30', 11.0, 0.35, 56, '#2f3539');
      paintRoundel(p, -6.0, 0.2, 0.9, 2048, 256, z0, z1, 2.25);
    },
  });
  const paint = paintMaterial(livery, 0x7c858b);
  const grey = material(0x737c82, 0.55, 0.15);
  mesh(group, loftGeometry([
    [-14.0, 0.1, 0.1, -0.5], [-13.5, 1.2, 1.1, -0.4], [-12.6, 1.9, 1.9, -0.15], [-11.5, 2.15, 2.2, 0.0], [-10, 2.2, 2.3, 0.0],
    [4, 2.2, 2.3, 0.0], [6, 2.1, 2.2, 0.3], [8.5, 1.7, 1.7, 0.9], [11, 1.25, 1.1, 1.5], [13.5, 0.8, 0.6, 2.0], [15.8, 0.3, 0.25, 2.4],
  ], 40), paint);
  for (const side of [-1, 1]) ellipsoid(group, [0.75, 0.95, 3.8], [side * 2.05, -1.85, 0.5], grey);
  const wing = wingShape({ halfSpan: 20.2, rootChord: 5.35, tipChord: 2.67, centreZ: 0.98, sweep: -0.63, y: 2.15, rise: 0.75, thick: 0.15 });
  addMirrored(group, wing.geometry, grey);
  const propellers = [];
  [-10.0, -5.3, 5.3, 10.0].forEach((x, index) => {
    const y = 2.15 + 0.75 * (Math.abs(x) / 20.2) - 0.45;
    mesh(group, loftGeometry([[-4.5, 0.3, 0.36, y], [-4.0, 0.55, 0.72, y], [-1.5, 0.62, 0.85, y - 0.05], [1.5, 0.55, 0.75, y], [3.6, 0.25, 0.35, y + 0.3]], 22), grey, [x, 0, 0]);
    propellers.push(propeller(group, mats, { x, y, z: -4.75, r: 2.05, blades: 6, spinner: 0.4, width: 0.26, spinnerMat: grey, tip: mats.yellow, engine: index }));
  });
  finSurface(group, grey, { y: 2.3, z: 10.4, chord: 6.0 }, { y: 9.0, z: 14.4, chord: 2.8 }, 0, 0.11);
  const stab = wingShape({ halfSpan: 7.0, rootChord: 4.0, tipChord: 2.0, centreZ: 14.0, sweep: 0.6, y: 2.35, thick: 0.11 });
  addMirrored(group, stab.geometry, grey);
  for (const side of [-1, 1]) roundel(group, [side * 14, 2.15 + 0.75 * 0.7 + 0.42, 1.2], 0.9);
  return { wing, stab, wingY: 2.15, propellers, twinWheels: true, surfaces: { aileron: 0.8, flap: 1.3, elevator: 1.1, material: grey } };
}

export const FLEET_BUILDERS = {
  fighter: buildFighter,
  eurofighter: buildEurofighter,
  turboprop: buildTurboprop,
  warbird: buildWarbird,
  aerobatic: buildAerobatic,
  twin: buildTwin,
  bizjet: buildBizjet,
  transport: buildTransport,
};
