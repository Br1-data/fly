// Procedural models use the same dimensions and contact positions as the simulation.
// Fuselages are lofted from cross-sections, wings and tails use a real airfoil section,
// and the liveries (windows, cheatlines, registrations) are painted into a texture whose
// roughness/metalness companion makes the glass glossy and the paint satin.
import * as THREE from 'three';
import { bodyToModel } from './coords.js';
import { createGlowMaterial } from './glow.js';
import { loftGeometry, surfaceGeometry, wingShape, addMirrored, mesh, ellipsoid, rod, nacelle, paintLivery, paintMaterial } from './aircraft-kit.js';
import { FLEET_BUILDERS } from './aircraft-fleet.js';
import { isLarge } from '../sim/aircraft/index.js';

// Accent colour (fin, trim) per model.
const ACCENTS = { jet: 0x163e6d, airliner: 0x1b4f8c, trainer: 0x173f6b, twin: 0x173f6b, bizjet: 0x14284b, aerobatic: 0x1d3f8c };

// ------------------------------------------------------------------ aircraft

function commonMaterials(accent) {
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xeef1f2, roughness: 0.38, metalness: 0.08 }),
    grey: new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.45, metalness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b2127, roughness: 0.7, metalness: 0.2 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa7adb2, roughness: 0.28, metalness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x18303d, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.6 }),
    fan: new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: 0xc0272f, roughness: 0.4, metalness: 0.1 }),
    green: new THREE.MeshStandardMaterial({ color: 0x1f8a3d, roughness: 0.4, metalness: 0.1 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c31b, roughness: 0.4, metalness: 0.1 }),
  };
}

function buildTrainer(group, mats) {
  const stations = [
    [-2.1, 0.3, 0.3, 0], [-2.02, 0.44, 0.42, 0.01], [-1.85, 0.52, 0.5, 0.03], [-1.4, 0.57, 0.58, 0.06],
    [-1.0, 0.6, 0.7, 0.12], [-0.55, 0.62, 0.8, 0.22], [0.3, 0.62, 0.8, 0.22], [1.1, 0.58, 0.72, 0.2],
    [1.8, 0.46, 0.52, 0.22], [2.6, 0.34, 0.38, 0.28], [3.6, 0.22, 0.26, 0.34], [4.6, 0.13, 0.17, 0.4], [5.1, 0.03, 0.05, 0.42],
  ];
  const livery = paintLivery({
    width: 512, height: 128, z0: -2.1, z1: 5.1, radius: 0.62, base: '#f1f3f2',
    painter: (p) => {
      p.sides(-2.1, 5.1, -0.32, -0.12, '#173f6b');
      p.sides(-1.2, 5.1, -0.1, -0.03, '#2aa6a8');
      p.belly(-2.1, 5.1, -0.55, '#d9dde0');
      p.top(-1.1, -0.55, 0.38, '#0d1a22', true); // windscreen
      p.sides(-0.5, 0.95, 0.2, 0.86, '#0d1a22', true); // cabin side windows
      p.sides(1.0, 1.55, 0.28, 0.72, '#0d1a22', true);
      p.panels([-1.95, -1.4, -1.05, 1.62, 2.3, 3.3, 4.2], [-0.62, 0.9]);
      p.text('I-FALC', 2.9, 0.12, 30, '#173f6b');
    },
  });
  const paint = paintMaterial(livery, 0xeef1f2);
  mesh(group, loftGeometry(stations), paint);
  const wing = wingShape({ halfSpan: 5.5, rootChord: 1.5, tipChord: 1.3, centreZ: -0.1, sweep: 0.08, y: 1.16, thick: 0.13 });
  addMirrored(group, wing.geometry, mats.white);
  const stab = wingShape({ halfSpan: 1.9, rootChord: 1.15, tipChord: 0.72, centreZ: 4.63, sweep: 0.3, y: 0.3, thick: 0.09 });
  addMirrored(group, stab.geometry, mats.white);
  mesh(group, surfaceGeometry([
    { x: 0, y: 0.35, z: 3.95, chord: 1.3, thick: 0.1 },
    { x: 0, y: 1.0, z: 4.4, chord: 1.02, thick: 0.1 },
    { x: 0, y: 1.72, z: 4.9, chord: 0.72, thick: 0.09 },
  ], true), mats.accent);
  // Spinner and propeller (blades blur into a disc at high rpm).
  const propeller = new THREE.Group();
  propeller.position.z = -2.18;
  const blades = new THREE.Group();
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.9, 0.035), mats.dark);
    blade.position.y = s * 0.5;
    blade.rotation.y = s * 0.25;
    blades.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.111, 0.08, 0.036), mats.red);
    tip.position.y = s * 0.91;
    tip.rotation.y = s * 0.25;
    blades.add(tip);
  }
  propeller.add(blades);
  propeller.userData.blades = blades;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 18), mats.accent);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.12;
  propeller.add(spinner);
  group.add(propeller);
  const propDisc = new THREE.Mesh(new THREE.CircleGeometry(0.97, 40), new THREE.MeshBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  propDisc.position.z = -2.2;
  group.add(propDisc);
  // Wing struts, aligned between their actual endpoints.
  for (const side of [-1, 1]) {
    rod(group, new THREE.Vector3(side * 0.45, -0.32, 0.35), new THREE.Vector3(side * 3.4, 1.08, 0.12), 0.035, mats.white);
  }
  return { propeller, propDisc, wing, stab, wingY: 1.12 };
}

function buildAirliner(group, mats) {
  const stations = [
    [-18.15, 0.05, 0.05, -0.35], [-17.85, 0.55, 0.62, -0.3], [-17.3, 1.02, 1.12, -0.2], [-16.5, 1.42, 1.52, -0.1],
    [-15.5, 1.74, 1.84, -0.02], [-14.3, 1.92, 2.02, 0], [-12.5, 1.97, 2.06, 0], [9, 1.97, 2.06, 0],
    [11.5, 1.9, 1.96, 0.08], [13.5, 1.7, 1.72, 0.3], [15.5, 1.35, 1.32, 0.6], [17.5, 0.92, 0.86, 0.95],
    [19.2, 0.46, 0.42, 1.25], [20.2, 0.1, 0.12, 1.4],
  ];
  const livery = paintLivery({
    width: 2048, height: 256, z0: -18.15, z1: 20.2, radius: 2, base: '#f4f6f7',
    painter: (p) => {
      p.belly(-18.15, 20.2, -0.42, '#c9ced3');
      p.sides(-16, 20.2, -0.36, -0.22, '#1b4f8c');
      p.sides(-16, 20.2, -0.2, -0.15, '#d8a338');
      // Cockpit windscreen and side windows.
      p.top(-15.9, -15.15, 0.42, '#0b141b', true);
      p.c.fillStyle = '#f4f6f7';
      for (const a of [Math.PI / 2, Math.PI / 2 - 0.42, Math.PI / 2 + 0.42]) p.c.fillRect(p.X(-15.9), p.Y(a) - 1.5, p.X(-15.15) - p.X(-15.9), 3);
      p.sides(-15.1, -14.45, 0.38, 0.66, '#0b141b', true);
      // Passenger windows, skipping the doors.
      for (let z = -11.4; z < 12.2; z += 0.53) {
        if (Math.abs(z - 1.3) < 0.4 || Math.abs(z - 2.2) < 0.4) continue;
        p.sides(z, z + 0.25, 0.27, 0.41, '#13202a', true);
      }
      for (const [z, w] of [[-13.2, 0.85], [11.7, 0.8], [1.6, 0.6]]) p.outline(z, z + w, -0.12, 0.62, '#9aa4ab');
      const frames = [];
      for (let z = -16.6; z < 19.5; z += 1.55) frames.push(z);
      p.panels(frames, [0.8, -0.55, 0.12], 'rgba(30,40,50,0.14)');
      p.text('AQUILA', -3.5, 0.6, 72, '#1b4f8c');
      p.text('I-AQLA', 15.2, 0.15, 30, '#1b4f8c', '600');
    },
  });
  const paint = paintMaterial(livery, 0xf2f4f5);
  mesh(group, loftGeometry(stations, 40), paint);
  // Wing-body fairing.
  ellipsoid(group, [2.15, 0.95, 6], [0, -1.15, 0.4], mats.grey);
  const wing = wingShape({ halfSpan: 17.05, rootChord: 6, tipChord: 1.65, centreZ: -0.6, sweep: 6.6, y: -0.72, rise: 0.6, thick: 0.13 });
  addMirrored(group, wing.geometry, mats.grey);
  const stab = wingShape({ halfSpan: 6.2, rootChord: 3.4, tipChord: 1.3, centreZ: 15.9, sweep: 3.1, y: 1.15, rise: 0.25, thick: 0.1 });
  addMirrored(group, stab.geometry, mats.grey);
  mesh(group, surfaceGeometry([
    { x: 0, y: 1.5, z: 12.4, chord: 6.4, thick: 0.11 },
    { x: 0, y: 5, z: 15.2, chord: 4.1, thick: 0.1 },
    { x: 0, y: 8.1, z: 17.6, chord: 2.5, thick: 0.09 },
  ], true), mats.accent);
  for (const side of [-1, 1]) {
    nacelle(group, side * 5.75, -1.7, mats);
    // Pylon from the nacelle to the wing underside.
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 3.4), mats.grey);
    pylon.position.set(side * 5.75, -0.95, -2.2);
    pylon.rotation.x = -0.12;
    group.add(pylon);
    // Sharklet-style winglet.
    const tip = wing.at(17.05);
    mesh(group, surfaceGeometry([
      { x: 0, y: 0, z: 0, chord: 1.6, thick: 0.08 },
      { x: 0, y: 1.9, z: 1.0, chord: 0.6, thick: 0.08 },
    ], true), mats.accent, [side * 17.0, tip.y, tip.le + 0.05]).rotation.z = -side * 0.2;
  }
  return { wing, stab, wingY: -0.68, splitElevator: true };
}

function buildJet(group, mats) {
  const stations = [
    [-4.6, 0.02, 0.02, -0.05], [-4.3, 0.16, 0.15, -0.04], [-3.8, 0.33, 0.32, -0.02], [-3.0, 0.5, 0.5, 0.02],
    [-2.0, 0.62, 0.66, 0.05], [-0.8, 0.7, 0.74, 0.05], [0.8, 0.72, 0.72, 0.05], [2.4, 0.62, 0.62, 0.08],
    [3.8, 0.45, 0.48, 0.15], [5.0, 0.33, 0.36, 0.22], [6.1, 0.26, 0.28, 0.25], [6.45, 0.23, 0.25, 0.25],
  ];
  const livery = paintLivery({
    width: 512, height: 128, z0: -4.6, z1: 6.45, radius: 0.7, base: '#163e6d',
    painter: (p) => {
      p.belly(-4.6, 6.45, -0.35, '#e9edf0');
      p.sides(-3.6, 6.45, -0.3, -0.18, '#1f8a3d');
      p.sides(-3.6, 6.45, -0.18, -0.06, '#f4f6f7');
      p.sides(-3.6, 6.45, -0.06, 0.06, '#c0272f');
      p.c.fillStyle = '#0d1116';
      p.c.fillRect(p.X(-4.6), 0, p.X(-4.25) - p.X(-4.6), 128); // radome tip
      p.panels([-3.6, -2.9, -0.1, 0.9, 2.6, 4.1, 5.4], [0.55, -0.5], 'rgba(5,10,20,0.25)');
      p.text('10', 1.6, 0.42, 34, '#f4f6f7');
    },
  });
  const paint = paintMaterial(livery, 0x173d66);
  mesh(group, loftGeometry(stations), paint);
  // Tandem bubble canopy.
  mesh(group, loftGeometry([
    [-3.25, 0.05, 0.03, 0.42], [-3.0, 0.3, 0.2, 0.45], [-2.5, 0.44, 0.36, 0.5], [-1.6, 0.48, 0.42, 0.52],
    [-0.7, 0.46, 0.38, 0.52], [-0.2, 0.36, 0.25, 0.52], [0.15, 0.08, 0.05, 0.5],
  ], 24), mats.glass);
  const wing = wingShape({ halfSpan: 5.43, rootChord: 2.35, tipChord: 1.2, centreZ: 0, sweep: 0.7, y: -0.32, rise: 0.25, thick: 0.12 });
  addMirrored(group, wing.geometry, mats.accent);
  const stab = wingShape({ halfSpan: 2.2, rootChord: 1.3, tipChord: 0.6, centreZ: 4.75, sweep: 0.65, y: 0.82, thick: 0.09 });
  addMirrored(group, stab.geometry, mats.accent);
  mesh(group, surfaceGeometry([
    { x: 0, y: 0.5, z: 3.7, chord: 2.1, thick: 0.1 },
    { x: 0, y: 1.6, z: 4.5, chord: 1.5, thick: 0.1 },
    { x: 0, y: 2.6, z: 5.25, chord: 0.95, thick: 0.09 },
  ], true), mats.accent);
  for (const side of [-1, 1]) {
    // Tip tanks with a white nose, side intakes and the exhaust.
    ellipsoid(group, [0.27, 0.32, 1.95], [side * 5.3, -0.12, 0.1], mats.accent);
    ellipsoid(group, [0.2, 0.24, 0.45], [side * 5.3, -0.12, -1.5], mats.white);
    ellipsoid(group, [0.27, 0.42, 1.05], [side * 0.74, -0.08, -0.35], mats.accent);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), mats.dark);
    intake.scale.y = 1.5;
    intake.rotation.y = Math.PI;
    intake.position.set(side * 0.8, -0.08, -1.32);
    group.add(intake);
  }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.3, 18, 1, true), mats.metal);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.25, 6.5);
  group.add(nozzle);
  const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), mats.dark);
  exhaust.position.set(0, 0.25, 6.45);
  group.add(exhaust);
  return { wing, stab, wingY: -0.28 };
}

export function createAircraft(def) {
  const group = new THREE.Group();
  const mats = commonMaterials(ACCENTS[def.model] ?? 0x173f6b);
  mats.nacelle = mats.white;
  mats.inlet = new THREE.MeshStandardMaterial({ color: 0x1b2127, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  const gear = new THREE.Group();
  group.add(gear);
  const builder = { trainer: buildTrainer, airliner: buildAirliner, jet: buildJet, ...FLEET_BUILDERS }[def.model] || buildJet;
  const built = builder(group, mats, def);
  const { propeller = null, propDisc = null, wing, stab } = built;
  const propellers = built.propellers || (propeller ? [{ propeller, propDisc, engine: 0, spin: 1 }] : []);
  const fixedGear = !def.controls.retractableGear;
  // Undercarriage: struts from the structure down to the actual contact points.
  for (const leg of def.gear) {
    const p = bodyToModel(...leg.pos);
    const twin = def.id === 'airliner' || built.twinWheels;
    const width = leg.radius * (twin ? 0.7 : 0.75);
    for (const dx of twin ? [-leg.radius * 0.62, leg.radius * 0.62] : [0]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(leg.radius, leg.radius, width, 18), mats.tyre);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(p.x + dx, p.y, p.z);
      gear.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(leg.radius * 0.5, leg.radius * 0.5, width * 1.04, 12), mats.metal);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(tyre.position);
      gear.add(hub);
    }
    const top = new THREE.Vector3(def.id === 'trainer' && leg.name !== 'nose' ? Math.sign(p.x) * 0.35 : p.x, def.id === 'trainer' ? -0.45 : p.y * 0.35, p.z);
    rod(gear, top, new THREE.Vector3(p.x, p.y, p.z), Math.max(0.035, leg.radius * 0.16), def.id === 'trainer' && leg.name !== 'nose' ? mats.white : mats.metal);
    if (fixedGear && leg.name !== 'nose' && leg.name !== 'tail') {
      // Wheel fairings.
      const r = leg.radius;
      const pant = ellipsoid(gear, [r * 0.75, r * 1.3, r * 2.75], [p.x, p.y + r * 0.2, p.z - r * 0.25], mats.white, 16);
      pant.material = mats.white;
    }
  }
  // Control surfaces hinge on the trailing edges computed from the same wing shape.
  const controls = [];
  const control = (name, surface, x, span, depth, factor, material) => {
    const a = surface.at(x), b = surface.at(Math.abs(x) + 0.5);
    const pivot = new THREE.Group();
    // Yaw the hinge line along the swept trailing edge; deflection turns about that line.
    pivot.rotation.order = 'YXZ';
    pivot.position.set(x, a.y, a.te - depth * 0.15);
    pivot.rotation.y = -Math.atan((b.te - a.te) / 0.5) * Math.sign(x || 1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(span, Math.max(0.03, depth * 0.09), depth), material);
    box.position.z = depth / 2;
    pivot.add(box);
    group.add(pivot);
    controls.push({ name, pivot, factor });
  };
  const span = def.wing.span;
  const large = def.id === 'airliner' || isLarge(def);
  const surfaceMat = built.surfaces?.material || (large ? mats.grey : def.id === 'jet' ? mats.accent : mats.white);
  const depth = built.surfaces || { aileron: large ? 0.75 : 0.3, flap: large ? 1.0 : 0.36, elevator: large ? 1.0 : 0.34 };
  for (const side of [-1, 1]) {
    control('aileron', wing, side * span * 0.36, span * 0.17, depth.aileron, -side, surfaceMat);
    control('flaps', wing, side * span * (large ? 0.2 : 0.18), span * (large ? 0.18 : 0.2), depth.flap, 0.7, surfaceMat);
    control('elevator', stab, side * stab.halfSpan * 0.48, stab.halfSpan * 0.9, depth.elevator, -1, surfaceMat);
  }
  // Navigation, strobe, beacon and landing lights as glowing sprites.
  const glow = createGlowMaterial({ worldSize: large ? 1.6 : 0.9, minPx: 2.5, maxPx: 40 });
  const lights = [];
  for (const [name, pos] of Object.entries(def.lights)) {
    const color = name === 'navL' || name === 'beacon' ? new THREE.Color(1, 0.12, 0.15) : name === 'navR' ? new THREE.Color(0.15, 1, 0.4) : new THREE.Color(1, 1, 1);
    const light = new THREE.Group();
    light.position.copy(bodyToModel(...pos));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(large ? 0.15 : 0.05, 6, 4), new THREE.MeshBasicMaterial({ color }));
    light.add(bulb);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([color.r, color.g, color.b], 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute([0], 1));
    const sprite = new THREE.Points(geometry, glow);
    sprite.renderOrder = 12;
    sprite.frustumCulled = false;
    light.add(sprite);
    group.add(light);
    lights.push({ name, mesh: light });
  }
  const materials = new Set();
  group.traverse((o) => {
    if (o.material) materials.add(o.material);
  });
  group.userData = { gear, propeller, propDisc, propellers, flames: built.flames || [], lights, controls, glow, materials: [...materials] };
  return group;
}

export function disposeObject(object) {
  const geometries = new Set();
  const materials = new Set();
  object.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    for (const key of ['map', 'roughnessMap', 'metalnessMap', 'alphaMap']) {
      // Shared procedural textures (detail noise, tyre marks) live for the whole session.
      if (m[key] && !m[key].userData?.shared) m[key].dispose();
    }
    m.dispose();
  }
}
