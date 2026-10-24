// Procedural models use the same dimensions and contact positions as the simulation.
import * as THREE from 'three';
import { bodyToModel } from './coords.js';

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...extra });
}

function box(parent, size, pos, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...pos);
  parent.add(mesh);
  return mesh;
}

function ellipsoid(parent, size, pos, mat) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mat);
  mesh.scale.set(...size);
  mesh.position.set(...pos);
  parent.add(mesh);
  return mesh;
}

function wing(parent, halfSpan, rootChord, tipChord, rootZ, sweep, y, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -rootZ - rootChord / 2);
  shape.lineTo(halfSpan, -rootZ - sweep - tipChord / 2);
  shape.lineTo(halfSpan, -rootZ - sweep + tipChord / 2);
  shape.lineTo(0, -rootZ + rootChord / 2);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.07, rootChord * 0.065), bevelEnabled: false });
  // Shape's X/Y plane becomes the aircraft X/Z plane, extrusion extends upward.
  geom.rotateX(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = y;
    mesh.scale.x = side;
    parent.add(mesh);
  }
}

export function createAircraft(def) {
  const group = new THREE.Group();
  const white = material(0xe6eaeb);
  const blue = material(def.id === 'jet' ? 0x173d66 : 0x174a74);
  const dark = material(0x161e25);
  const glass = material(0x315e77, { roughness: 0.12, metalness: 0.45 });
  const red = material(0xb92832);
  const gear = new THREE.Group();
  group.add(gear);
  let propeller = null;
  if (def.id === 'trainer') {
    ellipsoid(group, [0.62, 0.65, 3.7], [0, 0, 1.2], white);
    ellipsoid(group, [0.64, 0.6, 1.1], [0, 0.57, -0.1], glass);
    box(group, [1.24, 0.12, 3.5], [0, -0.08, 0.3], blue);
    wing(group, 5.5, 1.65, 1.35, -0.1, 0.06, 1.12, white);
    wing(group, 1.9, 1.2, 0.7, 4.65, 0.4, 0.25, white);
    const fin = box(group, [0.12, 1.55, 1.35], [0, 0.95, 4.75], blue);
    fin.rotation.x = -0.22;
    ellipsoid(group, [0.57, 0.52, 0.65], [0, 0, -1.9], white);
    propeller = new THREE.Group();
    propeller.position.z = -2.18;
    box(propeller, [0.12, 1.9, 0.045], [0, 0, 0], dark);
    ellipsoid(propeller, [0.18, 0.18, 0.23], [0, 0, -0.1], blue);
    group.add(propeller);
    // Wing struts, aligned between their actual endpoints.
    for (const side of [-1, 1]) {
      const a = new THREE.Vector3(side * 0.4, -0.3, 0.4);
      const b = new THREE.Vector3(side * 3.5, 1.12, 0.3);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, a.distanceTo(b), 6), white);
      strut.position.copy(a).add(b).multiplyScalar(0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
      group.add(strut);
    }
  } else if (def.id === 'airliner') {
    ellipsoid(group, [1.95, 2.05, 19], [0, 0, 1], white);
    ellipsoid(group, [1.55, 0.5, 2.0], [0, 1.1, -14.3], glass);
    box(group, [3.88, 0.3, 23], [0, 0.3, 1], blue);
    wing(group, 17.05, 6.0, 1.65, -0.6, 6.6, -0.7, white);
    wing(group, 6.2, 3.7, 1.4, 16.0, 3.1, 1.1, white);
    const fin = box(group, [0.35, 6.8, 5.1], [0, 4.4, 15.7], blue);
    fin.rotation.x = -0.33;
    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.05, 3.5, 20), white);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 5.75, -1.7, -2.6);
      group.add(engine);
      const intake = new THREE.Mesh(new THREE.CircleGeometry(0.91, 20), dark);
      intake.rotation.y = Math.PI;
      intake.position.set(side * 5.75, -1.7, -4.37);
      group.add(intake);
      box(group, [0.26, 1.25, 1.6], [side * 5.75, -0.9, -1.9], blue);
      for (let j = 0; j < 26; j++) ellipsoid(group, [0.035, 0.14, 0.105], [side * 1.91, 0.64, -9.6 + j * 0.73], glass);
      const winglet = box(group, [0.13, 1.4, 1.4], [side * 17.05, 0, 6.8], blue);
      winglet.rotation.z = -side * 0.22;
    }
  } else {
    ellipsoid(group, [0.7, 0.73, 5.4], [0, 0, 1], blue);
    ellipsoid(group, [0.5, 0.65, 1.7], [0, 0.64, -1.8], glass);
    wing(group, 5.43, 2.35, 1.2, 0, 0.7, -0.3, blue);
    wing(group, 2.2, 1.4, 0.6, 4.8, 0.65, 0.8, white);
    const fin = box(group, [0.13, 2.0, 1.9], [0, 1.65, 4.7], blue);
    fin.rotation.x = -0.35;
    for (const side of [-1, 1]) {
      ellipsoid(group, [0.26, 0.32, 1.9], [side * 5.3, -0.24, 0.1], white);
      box(group, [2.9, 0.08, 0.5], [side * 2.2, -0.16, 0], red);
      ellipsoid(group, [0.25, 0.45, 1.0], [side * 0.77, -0.1, -0.4], dark);
    }
  }
  for (const leg of def.gear) {
    const p = bodyToModel(...leg.pos);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(leg.radius, leg.radius, leg.radius * 0.8, 12), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.copy(p);
    gear.add(wheel);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(leg.radius * 0.18, leg.radius * 0.18, Math.abs(p.y) * 0.65, 6), white);
    strut.position.copy(p);
    strut.position.y *= 0.65;
    gear.add(strut);
  }
  const controls = [];
  const control = (name, size, pos, factor = 1, mat = white) => {
    const pivot = new THREE.Group();
    pivot.position.set(...pos);
    box(pivot, size, [0, 0, size[2] / 2], mat);
    group.add(pivot);
    controls.push({ name, pivot, factor });
  };
  const large = def.id === 'airliner';
  const trainer = def.id === 'trainer';
  const wingY = trainer ? 1.14 : large ? -0.68 : -0.28;
  for (const side of [-1, 1]) {
    control('aileron', [def.wing.span * 0.17, large ? 0.1 : 0.045, large ? 0.7 : 0.28], [side * def.wing.span * 0.36, wingY, large ? 5.7 : trainer ? 0.63 : 1.05], -side);
    control('flaps', [def.wing.span * 0.21, large ? 0.12 : 0.05, large ? 1.05 : 0.36], [side * def.wing.span * 0.18, wingY - 0.02, large ? 3.5 : trainer ? 0.65 : 1.05], 0.7);
  }
  control('elevator', [large ? 10 : trainer ? 3.3 : 3.6, large ? 0.13 : 0.05, large ? 1 : 0.35], [0, large ? 1.2 : trainer ? 0.3 : 0.85, large ? 18.5 : trainer ? 5.2 : 5.45], -1);
  const lights = [];
  for (const [name, pos] of Object.entries(def.lights)) {
    const color = name === 'navL' || name === 'beacon' ? 0xff2633 : name === 'navR' ? 0x38ff7a : 0xffffff;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.id === 'airliner' ? 0.15 : 0.05, 6, 4), new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(bodyToModel(...pos));
    group.add(mesh);
    lights.push({ name, mesh });
  }
  group.userData = { gear, propeller, lights, controls };
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
    if (m.map) m.map.dispose();
    m.dispose();
  }
}
