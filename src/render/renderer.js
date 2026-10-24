import * as THREE from 'three';
import { bodyToModel, quatToThree, v3ToThree, groundToThree } from './coords.js';
import { createAircraft, disposeObject } from './aircraft.js';
import { TerrainTiles } from './terrain.js';
import { buildAirports, buildCities } from './airports.js';
import { airportLayouts, LAKES } from '../world/world-data.js';
import { getTerrain } from '../world/terrain-height.js';
import { clamp, DEG, hash2 } from '../core/math.js';

const VIEWS = ['cockpit', 'chase', 'orbit', 'tower', 'flyby'];
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

export class SceneRenderer {
  constructor(canvas, { quality = 'medium' } = {}) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x92bed4);
    this.scene.fog = new THREE.FogExp2(0x92bed4, 0.000035);
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.1;
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.15, 130000);
    this.width = 1280;
    this.height = 720;
    this.panelFraction = 0;
    this.view = 'cockpit';
    this.yaw = 0;
    this.tilt = 0;
    this.zoomFactor = 1;
    this.markerKey = '';
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.position = new THREE.Vector3();
    this.orientation = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.headingQuaternion = new THREE.Quaternion();
    this.headQuaternion = new THREE.Quaternion();
    this.terrain = new TerrainTiles(this.scene, quality);
    this.setQuality(quality);
    this._warmupToken = 0;
    this.elapsed = 0;
  }

  async init(onProgress = () => {}) {
    onProgress(0.05, 'Preparazione del cielo…');
    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x626a41, 2.4);
    this.sun = new THREE.DirectionalLight(0xffedcc, 3);
    this.scene.add(this.hemi, this.sun);
    this.sun.position.set(-30000, 40000, 10000);
    const seaMaterial = new THREE.MeshStandardMaterial({ color: 0x287e94, roughness: 0.38, metalness: 0.25 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(300000, 300000), seaMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.15;
    this.scene.add(sea);
    this.sea = sea;
    for (const lake of LAKES) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(lake.radius * 1.5, 64), seaMaterial);
      water.rotation.x = -Math.PI / 2;
      groundToThree(lake.n, lake.e, lake.level, water.position);
      this.scene.add(water);
    }
    onProgress(0.2, 'Costruzione degli aeroporti…');
    await nextFrame();
    this.airports = buildAirports(this.scene);
    buildCities(this.scene);
    onProgress(0.6, 'Preparazione delle nubi…');
    this.createClouds();
    this.createRain();
    await nextFrame();
    onProgress(1, 'Mondo pronto');
  }

  createClouds() {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: false });
    this.clouds = new THREE.InstancedMesh(geometry, this.cloudMaterial, 180);
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);
    this.clouds.count = 0;
    this.cloudCell = '';
  }

  createRain() {
    const vertices = new Float32Array(500 * 6);
    for (let j = 0; j < 500; j++) {
      const x = (hash2(j, 11) - 0.5) * 180;
      const z = (hash2(j, 53) - 0.5) * 180;
      const y = hash2(j, 37) * 120;
      vertices.set([x, y, z, x - 0.4, y - 5, z], j * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb3c9d2, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  updateClouds(sim) {
    const layer = sim.atm.weather.clouds?.find((c) => c.coverage > 0);
    const nn = Math.round(sim.fm.pos.x / 8000), ee = Math.round(sim.fm.pos.y / 8000);
    const key = `${nn}:${ee}:${layer?.baseFt}:${layer?.coverage}`;
    if (key === this.cloudCell) return;
    this.cloudCell = key;
    const count = layer ? Math.round(layer.coverage * (this.quality === 'low' ? 80 : 180)) : 0;
    this.clouds.count = count;
    this.clouds.position.set(ee * 8000, (layer?.baseFt || 3000) * 0.3048, -nn * 8000);
    const dummy = new THREE.Object3D();
    for (let j = 0; j < count; j++) {
      dummy.position.set((hash2(j, nn + 201) - 0.5) * 60000, hash2(j, 13) * (layer.thickFt || 2000) * 0.22, (hash2(j, ee + 637) - 0.5) * 60000);
      const r = 300 + hash2(j, 123) * 700;
      dummy.scale.set(r * 2.2, layer.type === 'stratus' ? 160 : r * 0.6, r * 1.5);
      dummy.rotation.y = hash2(j, 4) * 6.28;
      dummy.updateMatrix();
      this.clouds.setMatrixAt(j, dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  setQuality(quality) {
    this.quality = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'low' ? 1 : 1.5));
    this.terrain.setQuality(this.quality);
    this.cloudCell = '';
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.webgl.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.updateProjection();
  }

  updateProjection() {
    this.camera.fov = (this.def?.camera.fov || 72) / (this.view === 'cockpit' ? this.zoomFactor : 1);
    this.camera.setViewOffset(this.width, this.height, 0, this.view === 'cockpit' ? this.height * this.panelFraction / 2 : 0, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  setPanelFraction(fraction) {
    const f = clamp(fraction, 0, 0.75);
    if (f === this.panelFraction) return;
    this.panelFraction = f;
    this.updateProjection();
  }

  setAircraft(def) {
    if (this.def?.id === def.id && this.aircraft) return;
    if (this.aircraft) {
      this.scene.remove(this.aircraft);
      disposeObject(this.aircraft);
    }
    this.def = def;
    this.aircraft = createAircraft(def);
    this.scene.add(this.aircraft);
    this.updateProjection();
  }

  setView(view) {
    this.view = VIEWS.includes(view) ? view : 'cockpit';
    this.resetView();
  }

  nextView(direction = 1) {
    this.setView(VIEWS[(VIEWS.indexOf(this.view) + direction + VIEWS.length) % VIEWS.length]);
    return this.view;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.004;
    this.tilt = clamp(this.tilt + dy * 0.003, -1.25, 1.25);
  }

  zoom(delta) {
    this.zoomFactor = clamp(this.zoomFactor * Math.exp(-delta * 0.001), 0.5, 2.5);
    this.updateProjection();
  }

  resetView() {
    this.yaw = this.view === 'orbit' ? 0.7 : 0;
    this.tilt = this.view === 'orbit' ? -0.15 : 0;
    this.zoomFactor = 1;
    this.flybyPosition = null;
    this.updateProjection();
  }

  async warmup(sim, onProgress = () => {}) {
    const token = ++this._warmupToken;
    this.terrain.plan(sim.fm.pos.x, sim.fm.pos.y);
    const total = Math.max(1, this.terrain.queue.length);
    let built = 0;
    while (this.terrain.queue.length && token === this._warmupToken) {
      const start = performance.now();
      do {
        this.terrain.buildOne();
        built++;
      } while (this.terrain.queue.length && performance.now() - start < 18);
      onProgress(Math.min(1, built / total));
      await nextFrame();
    }
    if (token !== this._warmupToken) return;
    this.update(sim, 0);
    this.render();
    onProgress(1);
  }

  setMarkers(markers = []) {
    const key = JSON.stringify(markers);
    if (key === this.markerKey) return;
    this.markerKey = key;
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      disposeObject(child);
    }
    for (const marker of markers) {
      if (marker.done) continue;
      const radius = marker.radius || 100;
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(2, radius * 0.025), 6, 40), new THREE.MeshBasicMaterial({ color: marker.active ? 0xffce5e : 0x78cfd2, transparent: true, opacity: marker.active ? 0.95 : 0.5 }));
      groundToThree(marker.n, marker.e, marker.alt ?? getTerrain().height(marker.n, marker.e) + 200, mesh.position);
      mesh.rotation.y = -(marker.heading || 0) * DEG;
      this.markers.add(mesh);
    }
  }

  update(sim, dt) {
    if (!sim.fm || !this.aircraft) return;
    this.elapsed += dt;
    const fm = sim.fm;
    v3ToThree(fm.pos, this.position);
    quatToThree(fm.q, this.orientation);
    this.aircraft.position.copy(this.position);
    this.aircraft.quaternion.copy(this.orientation);
    this.aircraft.visible = this.view !== 'cockpit';
    const { gear, propeller, lights, controls } = this.aircraft.userData;
    gear.scale.y = Math.max(0.02, fm.systems.gearPos);
    gear.visible = fm.systems.gearPos > 0.02;
    if (propeller) propeller.rotation.z += (fm.engines[0]?.rpm || 0) * dt * Math.PI / 30;
    for (const control of controls) control.pivot.rotation.x = control.factor * (control.name === 'flaps' ? fm.systems.flaps : fm.defl[control.name] || 0);
    for (const light of lights) {
      const strobe = light.name.startsWith('strobe');
      const control = strobe ? 'strobe' : light.name.startsWith('nav') || light.name === 'tail' ? 'nav' : light.name;
      light.mesh.visible = !!fm.systems.lights[control] && (!strobe || this.elapsed % 1 < 0.12) && (control !== 'beacon' || this.elapsed % 1.2 < 0.22);
    }
    this.terrain.plan(fm.pos.x, fm.pos.y);
    // Streaming work is bounded to one tile each frame; initial loading happens in warmup.
    if (this.terrain.queue.length) this.terrain.buildOne();
    this.updateCamera(sim);
    this.updateEnvironment(sim);
  }

  updateCamera(sim) {
    const fm = sim.fm;
    this.camera.up.set(0, 1, 0);
    if (this.view === 'cockpit') {
      bodyToModel(...this.def.camera.eye, this.offset).applyQuaternion(this.orientation);
      this.camera.position.copy(this.position).add(this.offset);
      this.headQuaternion.setFromEuler(new THREE.Euler(-this.tilt, this.yaw, 0, 'YXZ'));
      this.camera.quaternion.copy(this.orientation).multiply(this.headQuaternion);
    } else if (this.view === 'tower') {
      const nearest = airportLayouts().reduce((best, item) => Math.hypot(item.airport.n - fm.pos.x, item.airport.e - fm.pos.y) < Math.hypot(best.airport.n - fm.pos.x, best.airport.e - fm.pos.y) ? item : best);
      groundToThree(nearest.tower.n, nearest.tower.e, nearest.airport.elev + nearest.tower.height + 3, this.camera.position);
      this.camera.lookAt(this.position);
    } else if (this.view === 'flyby') {
      if (!this.flybyPosition || this.flybyPosition.distanceTo(this.position) > 2500) {
        this.flybyPosition = this.position.clone();
        this.flybyPosition.x += Math.sin(fm.heading * DEG) * 700 + 140;
        this.flybyPosition.z -= Math.cos(fm.heading * DEG) * 700;
        this.flybyPosition.y += 35;
      }
      this.camera.position.copy(this.flybyPosition);
      this.camera.lookAt(this.position);
    } else {
      const distance = this.def.camera.chaseDist * (this.view === 'orbit' ? 2.8 : 1.6) / this.zoomFactor;
      const heading = this.view === 'chase' ? -fm.heading * DEG + this.yaw : this.yaw;
      this.offset.set(Math.sin(heading) * distance, this.def.camera.chaseHeight - Math.sin(this.tilt) * distance, Math.cos(heading) * distance);
      this.camera.position.copy(this.position).add(this.offset);
      const ground = getTerrain().groundInfo(-this.camera.position.z, this.camera.position.x).h;
      this.camera.position.y = Math.max(this.camera.position.y, ground + 2);
      this.target.copy(this.position);
      this.target.y += this.def.id === 'airliner' ? 1.0 : 0.4;
      this.camera.lookAt(this.target);
    }
  }

  updateEnvironment(sim) {
    const hour = sim.timeOfDay;
    const sunAngle = (hour - 6) * Math.PI / 12;
    const altitude = Math.sin(sunAngle);
    const daylight = clamp((altitude + 0.12) / 0.5, 0, 1);
    const dusk = 1 - clamp(Math.abs(altitude) / 0.25, 0, 1);
    this.scene.background.setRGB(0.025 + daylight * 0.48 + dusk * 0.13, 0.04 + daylight * 0.65, 0.09 + daylight * 0.73);
    const cloudDensity = sim.fm.cloudDensity || 0;
    this.scene.background.lerp(new THREE.Color(0xadb5b9), cloudDensity * 0.75);
    this.scene.fog.color.copy(this.scene.background);
    this.scene.fog.density = 1.8 / Math.max(300, sim.atm.visibility * (1 - cloudDensity * 0.93));
    this.hemi.intensity = 0.18 + daylight * 2;
    this.sun.intensity = daylight * (3 - cloudDensity * 2);
    this.sun.color.setRGB(1, 0.82 + daylight * 0.15 - dusk * 0.25, 0.63 + daylight * 0.28 - dusk * 0.3);
    this.sun.position.set(Math.cos(sunAngle) * -40000, Math.max(500, altitude * 50000), -18000);
    this.cloudMaterial.color.setRGB(0.26 + daylight * 0.74, 0.29 + daylight * 0.71, 0.36 + daylight * 0.64);
    this.sea.material.color.setRGB(0.015 + daylight * 0.035, 0.04 + daylight * 0.32, 0.08 + daylight * 0.4);
    this.updateClouds(sim);
    this.rain.visible = sim.atm.precip > 0.05;
    if (this.rain.visible) {
      this.rain.position.copy(this.camera.position);
      this.rain.position.y -= (this.elapsed * 65) % 120;
      this.rain.material.opacity = sim.atm.precip * 0.5;
    }
    for (const lights of this.airports.nightLights) lights.visible = daylight < 0.8 || sim.atm.visibility < 5000;
    for (const { lights, end } of this.airports.papiGuides) {
      const along = -((sim.fm.pos.x - end.thrN) * end.dirN + (sim.fm.pos.y - end.thrE) * end.dirE) + 300;
      lights.visible = along > 0 && along < 12000;
      if (!lights.visible) continue;
      const angle = Math.atan2(sim.fm.alt - end.elev, along) / DEG;
      const colors = lights.geometry.attributes.color;
      for (let j = 0; j < 4; j++) {
        const white = angle > 2.5 + j / 3;
        colors.setXYZ(j, 1, white ? 0.95 : 0.025, white ? 0.78 : 0.015);
      }
      colors.needsUpdate = true;
    }
    for (const { sock, cloth } of this.airports.windsocks) {
      sock.rotation.y = -(sim.atm.weather.windDir || 0) * DEG - Math.PI / 2;
      cloth.rotation.z = clamp((sim.atm.weather.windSpeedKt || 0) / 15, 0, 1) * Math.PI / 2;
    }
  }

  render() {
    this.webgl.render(this.scene, this.camera);
  }

  getStats() {
    return { triangles: this.webgl.info.render.triangles, calls: this.webgl.info.render.calls, chunks: this.terrain.tiles.size };
  }

  dispose() {
    this._warmupToken++;
    this.terrain.dispose();
    disposeObject(this.scene);
    this.webgl.dispose();
  }
}
