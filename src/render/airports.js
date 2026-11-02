// Airports are built from the shared runway/taxiway layout, not separate visual coordinates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { airportLayouts, CITIES } from '../world/world-data.js';
import { getTerrain } from '../world/terrain-height.js';
import { DEG, hash2 } from '../core/math.js';
import { applyAtmosphere } from './atmosphere.js';
import { createGlowMaterial, createGlowPoints } from './glow.js';
import { buildingMaterial, markingMaterial, pavedMaterial } from './materials.js';
import { getTireMarkTexture } from './textures.js';

const WHITE_PAINT = 0xe9e6d6;
const YELLOW_PAINT = 0xd8aa33;
const APRON = 0x8a8c88;

/** Shared glow materials so the renderer can dim every airport light at once. */
function lightMaterials() {
  return {
    edge: createGlowMaterial({ worldSize: 2.6, minPx: 2.8, maxPx: 26 }),
    approach: createGlowMaterial({ worldSize: 3.6, minPx: 3.2, maxPx: 34 }),
    rabbit: createGlowMaterial({ worldSize: 5, minPx: 3.5, maxPx: 60, flash: true }),
    taxi: createGlowMaterial({ worldSize: 1.4, minPx: 1.4, maxPx: 16 }),
    flood: createGlowMaterial({ worldSize: 6, minPx: 2.4, maxPx: 70 }),
    papi: createGlowMaterial({ worldSize: 3.2, minPx: 3, maxPx: 40 }),
  };
}

export function buildAirports(scene) {
  const airportGroups = [];
  const nightLights = [];
  const papiGuides = [];
  const windsocks = [];
  const glow = lightMaterials();
  const materials = new Map();
  const surfaceMaterial = (color, kind) => {
    const key = `${kind}:${color}`;
    if (!materials.has(key)) {
      materials.set(key, kind === 'paint' ? markingMaterial(color) : kind === 'paved' ? pavedMaterial(color, color === APRON ? 'concrete' : 'asphalt') : kind === 'building'
        ? buildingMaterial({ color, floor: 4.2, bay: 3.2, glass: 0.75 })
        : applyAtmosphere(new THREE.MeshLambertMaterial({ color }), 'airport-solid'));
    }
    return materials.get(key);
  };
  const tireMaterial = applyAtmosphere(new THREE.MeshLambertMaterial({
    color: 0x1a1b1c, alphaMap: getTireMarkTexture(), transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), 'tires');
  for (const layout of airportLayouts()) {
    const { airport: ap, geometry: g, runway: rw } = layout;
    const group = new THREE.Group();
    group.position.set(ap.e, ap.elev, -ap.n);
    const batches = new Map();
    const add = (geometry, color, n, e, y, heading = 0, kind = 'solid') => {
      geometry.rotateY(-heading * DEG);
      geometry.translate(e - ap.e, y, -(n - ap.n));
      const key = `${kind}|${color}`;
      if (!batches.has(key)) batches.set(key, { color, kind, list: [] });
      batches.get(key).list.push(geometry);
    };
    const rect = (n, e, heading, length, width, y, color, kind = 'paint') => {
      add(new THREE.BoxGeometry(width, 0.05, length), color, n, e, y, heading, kind);
    };
    const grassStrip = rw.surface === 'grass';
    for (const s of layout.surfaces) {
      const grass = s.surface === 'grass';
      const color = grass ? 0x5f7d45 : s.kind === 'apron' ? APRON : s.kind === 'runway' ? 0x3c3f41 : 0x4b4e4f;
      rect(s.n, s.e, s.heading, s.length, s.width, 0.15 + (s.kind === 'runway' ? 0.03 : 0), color, grass ? 'solid' : 'paved');
    }
    const along = (distance, across = 0) => ({ n: g.cn + g.dn * distance - g.de * across, e: g.ce + g.de * distance + g.dn * across });
    if (!grassStrip) {
      // Centreline, edge lines, thresholds, touchdown-zone and aiming-point markings.
      for (let distance = -g.half + 180; distance < g.half - 150; distance += 100) {
        const p = along(distance);
        rect(p.n, p.e, rw.heading, 35, 0.9, 0.25, WHITE_PAINT);
      }
      for (const side of [-1, 1]) {
        const p = along(0, side * (rw.width / 2 - 0.8));
        rect(p.n, p.e, rw.heading, rw.length - 5, 0.35, 0.25, WHITE_PAINT);
      }
      for (const end of g.ends) {
        const at = (d, across) => ({ n: end.thrN + end.dirN * d - end.dirE * across, e: end.thrE + end.dirE * d + end.dirN * across });
        for (let i = -3; i <= 3; i++) {
          if (i === 0) continue;
          const p = at(20, i * rw.width / 10);
          rect(p.n, p.e, end.heading, 23, rw.width / 18, 0.25, WHITE_PAINT);
        }
        for (const side of [-1, 1]) {
          const p = at(300, side * rw.width * 0.3);
          rect(p.n, p.e, end.heading, 45, rw.width * 0.12, 0.25, WHITE_PAINT);
          // Touchdown zone: 3, 2, 2, 1, 1 bar pairs.
          for (const [d, bars] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
            if (d > rw.length / 2 - 100) continue;
            for (let b = 0; b < bars; b++) {
              const q = at(d, side * (rw.width * 0.18 + b * 2.4 + 1));
              rect(q.n, q.e, end.heading, 22, 1.8, 0.25, WHITE_PAINT);
            }
          }
        }
        // Runway numbers stay readable from an approaching cockpit.
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#eeeada';
        ctx.font = 'bold 150px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.scale(0.55, 1);
        ctx.fillText(end.ident, 64 / 0.55, 128);
        ctx.restore();
        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 8;
        texture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Mesh(new THREE.PlaneGeometry(rw.width * 0.42, 30), applyAtmosphere(new THREE.MeshLambertMaterial({
          map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }), 'runway-number'));
        label.rotation.set(-Math.PI / 2, 0, -end.heading * DEG);
        label.position.set(end.thrE - ap.e + end.dirE * 70, 0.3, -(end.thrN - ap.n + end.dirN * 70));
        label.receiveShadow = true;
        group.add(label);
        // Rubber deposits where the main wheels touch down.
        const tires = new THREE.Mesh(new THREE.PlaneGeometry(rw.width * 0.55, 650), tireMaterial);
        tires.rotation.set(-Math.PI / 2, 0, -end.heading * DEG + Math.PI);
        const mid = at(230 + 325, 0);
        tires.position.set(mid.e - ap.e, 0.27, -(mid.n - ap.n));
        tires.receiveShadow = true;
        group.add(tires);
      }
    }
    // Yellow taxiway centrelines and holding-position bars.
    for (const s of layout.surfaces) {
      if (s.kind !== 'taxiway' || s.surface === 'grass') continue;
      rect(s.n, s.e, s.heading, s.length - 6, 0.35, 0.22, YELLOW_PAINT);
    }
    const taxiWidth = ap.size === 'large' ? 23 : ap.size === 'medium' ? 18 : 10;
    if (!grassStrip) {
      for (const hold of layout.holds) {
        for (const k of [-0.7, 0.7]) rect(hold.n - g.de * k, hold.e + g.dn * k, rw.heading, taxiWidth - 1, 0.4, 0.23, YELLOW_PAINT);
      }
    }
    for (const end of g.ends) {
      const positions = [], colors = [];
      for (let j = 0; j < 4; j++) {
        const across = -(rw.width / 2 + 20 + j * 9);
        positions.push(end.thrE + end.dirE * 300 + end.dirN * across - ap.e, 0.9, -(end.thrN + end.dirN * 300 - end.dirE * across - ap.n));
        colors.push(1, 0.1, 0.05);
      }
      const lights = createGlowPoints(positions, colors, glow.papi);
      group.add(lights);
      papiGuides.push({ lights, end });
      // PAPI housings.
      for (let j = 0; j < 4; j++) add(new THREE.BoxGeometry(1.2, 0.8, 0.8), 0x2c2f31, end.thrN + end.dirN * 300 - end.dirE * -(rw.width / 2 + 20 + j * 9), end.thrE + end.dirE * 300 + end.dirN * -(rw.width / 2 + 20 + j * 9), 0.55, end.heading);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 6), surfaceMaterial(0xd9d9cf, 'solid'));
    pole.position.set(layout.windsock.e - ap.e, 3, -(layout.windsock.n - ap.n));
    group.add(pole);
    const sock = new THREE.Group();
    sock.position.copy(pole.position);
    sock.position.y = 6;
    const cloth = new THREE.Group();
    cloth.rotation.z = Math.PI / 2;
    for (let j = 0; j < 5; j++) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.45 - j * 0.06, 0.39 - j * 0.06, 0.65, 8, 1, true), applyAtmosphere(new THREE.MeshLambertMaterial({ color: j % 2 ? 0xf3e7c5 : 0xe46731, side: THREE.DoubleSide }), 'windsock'));
      stripe.position.y = -j * 0.65;
      cloth.add(stripe);
    }
    sock.add(cloth);
    group.add(sock);
    windsocks.push({ sock, cloth });
    const floods = [];
    for (const b of layout.buildings) {
      const heading = b.heading || 0;
      if (b.type === 'tower') {
        // Shaft, glazed cab (the tower view camera sits inside it) and a dark roof.
        // Roof and cab are open towards the inside so the camera sees out of the windows.
        add(new THREE.CylinderGeometry(2.6, 3.4, b.height - 0.5, 10), 0xd8d6cc, b.n, b.e, (b.height - 0.5) / 2, heading);
        add(new THREE.CylinderGeometry(6.4, 4.2, 1.2, 12, 1, true), 0x8d9295, b.n, b.e, b.height - 1.1, heading);
        add(new THREE.CylinderGeometry(6.6, 6.4, 3.8, 12, 1, true), 0x1f3442, b.n, b.e, b.height + 1.4, heading, 'glass');
        add(new THREE.CylinderGeometry(7.2, 7.2, 0.6, 12, 1, true), 0x3a3f42, b.n, b.e, b.height + 3.6, heading);
        add(new THREE.CircleGeometry(7.2, 12).rotateX(-Math.PI / 2), 0x3a3f42, b.n, b.e, b.height + 3.9, heading);
        add(new THREE.CylinderGeometry(0.15, 0.15, 4, 5), 0x9a9a9a, b.n, b.e, b.height + 5.5, heading);
        continue;
      }
      const width = b.width || 7, length = b.length || 7;
      if (b.type === 'hangar') {
        add(new THREE.BoxGeometry(width, b.height * 0.62, length), 0xc5c8c4, b.n, b.e, b.height * 0.31, heading);
        // Barrel-vault roof.
        const roof = new THREE.CylinderGeometry(width / 2, width / 2, length, 16, 1, false, -Math.PI / 2, Math.PI);
        roof.rotateX(Math.PI / 2);
        roof.scale(1, (b.height * 0.38) / (width / 2), 1);
        add(roof, 0x7f8a8e, b.n, b.e, b.height * 0.62, heading);
        // Sliding doors on both gable ends.
        add(new THREE.BoxGeometry(width * 0.86, b.height * 0.56, length + 0.5), 0x66727a, b.n, b.e, b.height * 0.28, heading);
      } else {
        // Terminal: concrete body with a long glass facade and a flat roof with plant rooms.
        add(new THREE.BoxGeometry(width, b.height, length), 0xd2cfc5, b.n, b.e, b.height / 2, heading, 'building');
        add(new THREE.BoxGeometry(width + 1, 0.8, length + 1), 0x7d8487, b.n, b.e, b.height + 0.4, heading);
        add(new THREE.BoxGeometry(width * 0.3, 3, length * 0.2), 0x9aa0a2, b.n, b.e, b.height + 2, heading);
      }
      floods.push(b);
    }
    for (const { kind, color, list } of batches.values()) {
      const merged = mergeGeometries(list, false);
      const material = kind === 'glass'
        ? applyAtmosphere(new THREE.MeshLambertMaterial({ color, emissive: 0x0b1410 }), 'tower-glass')
        : surfaceMaterial(color, kind);
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = kind === 'paved' || kind === 'paint' || kind === 'solid';
      group.add(mesh);
      for (const geometry of list) geometry.dispose();
    }
    // Runway edge, threshold/end and approach lights; blue taxiway edges; apron floodlights.
    const lightSet = () => ({ positions: [], colors: [], phases: [] });
    const sets = { edge: lightSet(), approach: lightSet(), rabbit: lightSet(), taxi: lightSet(), flood: lightSet() };
    const color = new THREE.Color();
    const light = (set, n, e, hex, y = 0.65, phase = 0) => {
      set.positions.push(e - ap.e, y, -(n - ap.n));
      color.set(hex);
      set.colors.push(color.r, color.g, color.b);
      set.phases.push(phase);
    };
    for (let distance = -g.half; distance <= g.half; distance += 60) {
      for (const side of [-1, 1]) {
        const p = along(distance, side * (rw.width / 2 + 1.5));
        light(sets.edge, p.n, p.e, Math.abs(distance) > g.half - 600 ? 0xffc85a : 0xf4f6ff);
      }
    }
    for (const end of g.ends) {
      for (let i = -5; i <= 5; i++) {
        light(sets.edge, end.thrN - end.dirE * i * rw.width / 10 - end.dirN * 1.5, end.thrE + end.dirN * i * rw.width / 10 - end.dirE * 1.5, 0x46ff7e);
        light(sets.edge, end.thrN - end.dirE * i * rw.width / 10 - end.dirN * 3, end.thrE + end.dirN * i * rw.width / 10 - end.dirE * 3, 0xff3326);
      }
      if (end.als) {
        for (let d = 60; d <= 720; d += 30) {
          const bar = d % 60 === 0;
          for (let k = -2; k <= 2; k++) {
            if (!bar && k !== 0) continue;
            light(sets.approach, end.thrN - end.dirN * d - end.dirE * k * 1.8, end.thrE - end.dirE * d + end.dirN * k * 1.8, 0xfff1d6, 1.2 + d * 0.004);
          }
          if (d === 300) for (let k = -7; k <= 7; k++) light(sets.approach, end.thrN - end.dirN * d - end.dirE * k * 2.2, end.thrE - end.dirE * d + end.dirN * k * 2.2, 0xfff1d6, 2.4);
          if (d >= 330) light(sets.rabbit, end.thrN - end.dirN * d, end.thrE - end.dirE * d, 0xffffff, 1.6 + d * 0.004, (720 - d) / 900);
        }
      }
    }
    for (const s of layout.surfaces) {
      if (s.kind === 'runway' || s.surface === 'grass') continue;
      const dn = Math.cos(s.heading * DEG), de = Math.sin(s.heading * DEG);
      const step = s.kind === 'apron' ? 45 : 35;
      for (let d = -s.length / 2; d <= s.length / 2; d += step) {
        for (const side of [-1, 1]) {
          light(sets.taxi, s.n + dn * d - de * side * (s.width / 2 + 1), s.e + de * d + dn * side * (s.width / 2 + 1), 0x3a6dff, 0.45);
        }
      }
    }
    for (const b of floods) {
      const h = b.heading || 0, dn = Math.cos(h * DEG), de = Math.sin(h * DEG);
      const count = Math.max(2, Math.round((b.length || 40) / 80));
      for (let k = 0; k < count; k++) {
        const d = (k / Math.max(1, count - 1) - 0.5) * (b.length || 40);
        light(sets.flood, b.n + dn * d, b.e + de * d, 0xffe2b0, b.height + 6);
      }
    }
    for (const [name, set] of Object.entries(sets)) {
      if (!set.positions.length) continue;
      const points = createGlowPoints(set.positions, set.colors, glow[name], set.phases);
      group.add(points);
      nightLights.push(points);
    }
    scene.add(group);
    airportGroups.push(group);
  }
  return { airportGroups, nightLights, papiGuides, windsocks, glow };
}

export function buildCities(scene) {
  const terrain = getTerrain();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.ConeGeometry(0.75, 1, 4, 1);
  roofGeometry.rotateY(Math.PI / 4);
  roofGeometry.translate(0, 0.5, 0);
  const material = buildingMaterial({ color: 0xffffff, floor: 3.1, bay: 3.4, glass: 0.6 });
  const roofMaterial = applyAtmosphere(new THREE.MeshLambertMaterial({ color: 0xffffff }), 'roofs');
  const lightMaterial = createGlowMaterial({ worldSize: 8, minPx: 2.2, maxPx: 28, coreWhite: 0.25 });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const lights = [];
  for (const city of CITIES) {
    const count = Math.round(300 * city.density);
    const buildings = new THREE.InstancedMesh(geometry, material, count);
    const roofs = new THREE.InstancedMesh(roofGeometry, roofMaterial, count);
    let roofCount = 0;
    buildings.position.set(city.e, 0, -city.n);
    roofs.position.copy(buildings.position);
    for (let j = 0; j < count; j++) {
      // Denser, taller centre; small houses towards the outskirts.
      const r = Math.pow(hash2(j * 7, city.n), 0.75);
      const a = hash2(j * 13, city.e) * Math.PI * 2;
      const n = Math.cos(a) * r * city.radius * 0.95;
      const e = Math.sin(a) * r * city.radius * 0.95;
      const centre = 1 - r;
      const h = 5 + hash2(j, 53) * (6 + city.tall * 80 * centre * centre);
      const w = 10 + hash2(j, 3) * (14 + 20 * centre), d = 9 + hash2(j, 12) * (12 + 16 * centre);
      const ground = terrain.height(city.n + n, city.e + e);
      const heading = Math.round(hash2(j, 4) * 4) * Math.PI / 2 + (hash2(Math.floor(a * 3), 9) - 0.5) * 0.3;
      dummy.position.set(e, ground + h / 2 - 0.5, -n);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(w, h + 1, d);
      dummy.updateMatrix();
      buildings.setMatrixAt(j, dummy.matrix);
      const tall = h > 16;
      // Mediterranean plaster: whites, creams, ochres and soft pinks; concrete for towers.
      if (tall) color.setHSL(0.1, 0.05 + hash2(j, 77) * 0.06, 0.62 + hash2(j, 17) * 0.15, THREE.SRGBColorSpace);
      else color.setHSL(0.07 + hash2(j, 77) * 0.06, 0.18 + hash2(j, 19) * 0.3, 0.7 + hash2(j, 17) * 0.18, THREE.SRGBColorSpace);
      buildings.setColorAt(j, color);
      if (!tall) {
        dummy.position.set(e, ground + h, -n);
        dummy.scale.set(w, Math.min(w, d) * 0.32, d);
        dummy.updateMatrix();
        roofs.setMatrixAt(roofCount, dummy.matrix);
        color.setHSL(0.035 + hash2(j, 91) * 0.025, 0.32 + hash2(j, 92) * 0.18, 0.42 + hash2(j, 93) * 0.1, THREE.SRGBColorSpace);
        roofs.setColorAt(roofCount++, color);
      }
    }
    roofs.count = roofCount;
    buildings.computeBoundingSphere();
    roofs.computeBoundingSphere();
    scene.add(buildings, roofs);
    // Street lighting: warm sodium lamps with a few whiter LED streets.
    const positions = [], colors = [];
    const lamps = Math.round(420 * city.density * Math.min(1.6, city.radius / 1200 + 0.4));
    for (let j = 0; j < lamps; j++) {
      const r = Math.sqrt(hash2(j * 3, city.n + 5)) * city.radius * 1.15;
      const a = hash2(j * 5, city.e + 9) * Math.PI * 2;
      const n = city.n + Math.cos(a) * r, e = city.e + Math.sin(a) * r;
      positions.push(e, terrain.height(n, e) + 7, -n);
      if (hash2(j, 333) < 0.2) colors.push(0.8, 0.86, 1);
      else colors.push(1, 0.52, 0.16);
    }
    const points = createGlowPoints(positions, colors, lightMaterial);
    scene.add(points);
    lights.push(points);
  }
  return { lights, lightMaterial };
}
