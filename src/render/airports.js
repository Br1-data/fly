// Airports are built from the shared runway/taxiway layout, not separate visual coordinates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { airportLayouts, CITIES } from '../world/world-data.js';
import { getTerrain } from '../world/terrain-height.js';
import { DEG, hash2 } from '../core/math.js';

export function buildAirports(scene) {
  const airportGroups = [];
  const nightLights = [];
  const papiGuides = [];
  const windsocks = [];
  for (const layout of airportLayouts()) {
    const { airport: ap, geometry: g, runway: rw } = layout;
    const group = new THREE.Group();
    group.position.set(ap.e, ap.elev, -ap.n);
    const batches = new Map();
    const add = (geometry, color, n, e, y, heading = 0) => {
      geometry.rotateY(-heading * DEG);
      geometry.translate(e - ap.e, y, -(n - ap.n));
      if (!batches.has(color)) batches.set(color, []);
      batches.get(color).push(geometry);
    };
    const rect = (n, e, heading, length, width, y, color) => {
      const geometry = new THREE.BoxGeometry(width, 0.05, length);
      add(geometry, color, n, e, y, heading);
    };
    for (const s of layout.surfaces) rect(s.n, s.e, s.heading, s.length, s.width, 0.15 + (s.kind === 'runway' ? 0.03 : 0), s.surface === 'grass' ? 0x65824a : s.kind === 'apron' ? 0x777b7b : 0x45494a);
    const along = (distance, across = 0) => ({ n: g.cn + g.dn * distance - g.de * across, e: g.ce + g.de * distance + g.dn * across });
    for (let distance = -g.half + 180; distance < g.half - 150; distance += 100) {
      const p = along(distance);
      rect(p.n, p.e, rw.heading, 35, 0.9, 0.25, 0xe8e5ce);
    }
    for (const side of [-1, 1]) {
      const p = along(0, side * (rw.width / 2 - 0.8));
      rect(p.n, p.e, rw.heading, rw.length - 5, 0.35, 0.25, 0xe8e5ce);
    }
    for (const end of g.ends) {
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const n = end.thrN + end.dirN * 20 - end.dirE * i * rw.width / 10;
        const e = end.thrE + end.dirE * 20 + end.dirN * i * rw.width / 10;
        rect(n, e, end.heading, 23, rw.width / 18, 0.25, 0xe8e5ce);
      }
      // Runway numbers stay readable from an approaching cockpit.
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#eeeada';
      ctx.font = 'bold 100px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(end.ident, 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(rw.width * 0.5, 32), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      label.rotation.set(-Math.PI / 2, 0, -end.heading * DEG);
      label.position.set(end.thrE - ap.e + end.dirE * 70, 0.3, -(end.thrN - ap.n + end.dirN * 70));
      group.add(label);
      // Aiming point blocks.
      for (const side of [-1, 1]) rect(end.thrN + end.dirN * 300 - end.dirE * side * rw.width * 0.3, end.thrE + end.dirE * 300 + end.dirN * side * rw.width * 0.3, end.heading, 35, rw.width * 0.12, 0.25, 0xe8e5ce);
    }
    for (const end of g.ends) {
      const positions = [], colors = [];
      for (let j = 0; j < 4; j++) {
        const across = -(rw.width / 2 + 20 + j * 9);
        positions.push(end.thrE + end.dirE * 300 + end.dirN * across - ap.e, 0.9, -(end.thrN + end.dirN * 300 - end.dirE * across - ap.n));
        colors.push(1, 0.1, 0.05);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const lights = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 5, sizeAttenuation: true }));
      group.add(lights);
      papiGuides.push({ lights, end });
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 6), new THREE.MeshLambertMaterial({ color: 0xd9d9cf }));
    pole.position.set(layout.windsock.e - ap.e, 3, -(layout.windsock.n - ap.n));
    group.add(pole);
    const sock = new THREE.Group();
    sock.position.copy(pole.position);
    sock.position.y = 6;
    const cloth = new THREE.Group();
    cloth.rotation.z = Math.PI / 2;
    for (let j = 0; j < 5; j++) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.45 - j * 0.06, 0.39 - j * 0.06, 0.65, 8, 1, true), new THREE.MeshLambertMaterial({ color: j % 2 ? 0xf3e7c5 : 0xe46731, side: THREE.DoubleSide }));
      stripe.position.y = -j * 0.65;
      cloth.add(stripe);
    }
    sock.add(cloth);
    group.add(sock);
    windsocks.push({ sock, cloth });
    for (const b of layout.buildings) {
      const tower = b.type === 'tower';
      add(new THREE.BoxGeometry(b.width || 7, b.height, b.length || 7), 0xb5b7b2, b.n, b.e, b.height / 2, b.heading || 0);
      add(new THREE.BoxGeometry(tower ? 12 : b.width || 7, tower ? 4 : 1, tower ? 12 : b.length || 7), tower ? 0x344e60 : 0x6b7475, b.n, b.e, b.height, b.heading || 0);
    }
    for (const [color, geometries] of batches) {
      const merged = mergeGeometries(geometries, false);
      group.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color })));
      for (const geometry of geometries) geometry.dispose();
    }
    // One draw call for all runway edge and approach lights of each airport.
    const positions = [];
    const colors = [];
    const light = (n, e, color) => {
      positions.push(e - ap.e, 0.65, -(n - ap.n));
      const c = new THREE.Color(color);
      colors.push(c.r, c.g, c.b);
    };
    for (let distance = -g.half; distance <= g.half; distance += 60) {
      for (const side of [-1, 1]) {
        const p = along(distance, side * (rw.width / 2 + 1.5));
        light(p.n, p.e, Math.abs(distance) > g.half - 600 ? 0xffda6b : 0xe9f4ff);
      }
    }
    for (const end of g.ends) {
      for (let i = -4; i <= 4; i++) light(end.thrN - end.dirE * i * rw.width / 9, end.thrE + end.dirN * i * rw.width / 9, 0x4dff89);
      if (end.als) for (let d = 60; d <= 700; d += 60) light(end.thrN - end.dirN * d, end.thrE - end.dirE * d, 0xffe6b5);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lights = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 5, sizeAttenuation: true }));
    group.add(lights);
    nightLights.push(lights);
    scene.add(group);
    airportGroups.push(group);
  }
  return { airportGroups, nightLights, papiGuides, windsocks };
}

export function buildCities(scene) {
  const terrain = getTerrain();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0xc4b99f });
  const dummy = new THREE.Object3D();
  for (const city of CITIES) {
    const count = Math.round(300 * city.density);
    const buildings = new THREE.InstancedMesh(geometry, material, count);
    buildings.position.set(city.e, 0, -city.n);
    for (let j = 0; j < count; j++) {
      const n = (hash2(j * 7, city.n) - 0.5) * city.radius * 1.6;
      const e = (hash2(j * 13, city.e) - 0.5) * city.radius * 1.6;
      const h = 5 + hash2(j, 53) * (10 + city.tall * 80);
      dummy.position.set(e, terrain.height(city.n + n, city.e + e) + h / 2, -n);
      dummy.rotation.y = Math.round(hash2(j, 4) * 4) * Math.PI / 2;
      dummy.scale.set(14 + hash2(j, 3) * 30, h, 14 + hash2(j, 12) * 25);
      dummy.updateMatrix();
      buildings.setMatrixAt(j, dummy.matrix);
      buildings.setColorAt(j, new THREE.Color().setHSL(0.09, 0.1 + hash2(j, 77) * 0.2, 0.5 + hash2(j, 17) * 0.25));
    }
    buildings.computeBoundingSphere();
    scene.add(buildings);
  }
}
