import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { bodyToModel, quatToThree, v3ToThree, groundToThree } from './coords.js';
import { createAircraft, disposeObject } from './aircraft.js';
import { TerrainTiles } from './terrain.js';
import { buildAirports, buildCities } from './airports.js';
import { Sky, atmosphereUniforms } from './atmosphere.js';
import { WaterSurfaces } from './water.js';
import { CloudLayer } from './clouds.js';
import { glowUniforms } from './glow.js';
import { sceneryUniforms } from './materials.js';
import { getFlareTextures } from './textures.js';
import { airportLayouts, LAKES } from '../world/world-data.js';
import { getTerrain } from '../world/terrain-height.js';
import { clamp, DEG, hash2, smoothstep } from '../core/math.js';
import { isTouchDevice } from '../core/device.js';

const VIEWS = ['cockpit', 'chase', 'orbit', 'tower', 'flyby'];
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// Fixed device budgets keep drawing cost predictable without changing saved quality.
// Desktop medium/high retain their existing detail and resolution limits.
export function getRenderProfile(quality = 'medium', touch = false) {
  const level = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
  return {
    quality: level,
    antialias: !touch && level !== 'low',
    pixelRatioMax: touch || level === 'low' ? 1 : level === 'high' ? 2 : 1.5,
    maxBufferPixels: touch ? (level === 'low' ? 1_000_000 : level === 'high' ? 2_000_000 : 1_500_000) : level === 'low' ? 1_500_000 : Infinity,
    cloudCount: level === 'low' ? 40 : level === 'high' ? 240 : 180,
    rainCount: level === 'low' ? 100 : 500,
    shadows: !touch && level !== 'low',
    shadowMapSize: level === 'high' ? 2048 : 1024,
    landingLight: !touch && level !== 'low',
  };
}

// Also cap the total drawing buffer on large high-density touch screens.
export function getRenderPixelRatio(profile, width, height, devicePixelRatio = 1) {
  const area = Math.max(1, width) * Math.max(1, height);
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(ratio, profile.pixelRatioMax, Math.sqrt(profile.maxBufferPixels / area));
}

export class SceneRenderer {
  constructor(canvas, { quality = 'medium' } = {}) {
    this.canvas = canvas;
    this.touch = isTouchDevice();
    this.profile = getRenderProfile(quality, this.touch);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x92bed4);
    this.scene.fog = new THREE.FogExp2(0x92bed4, 0.000035);
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: this.profile.antialias, powerPreference: 'high-performance' });
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.shadowMap.enabled = this.profile.shadows;
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
    this.ambient = new THREE.Color();
    this.groundAmbient = new THREE.Color();
    this._tmpColor = new THREE.Color();
    this._tmpVec = new THREE.Vector3();
    this.terrain = new TerrainTiles(this.scene, quality);
    this.terrain.setShadows(this.profile.shadows);
    this.setQuality(quality);
    this._warmupToken = 0;
    this.elapsed = 0;
    this.envState = null;
    this.envTimer = 0;
  }

  async init(onProgress = () => {}) {
    onProgress(0.05, 'Preparazione del cielo…');
    this.sky = new Sky(this.scene);
    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x626a41, 1.6);
    this.sun = new THREE.DirectionalLight(0xffedcc, 3);
    this.sun.castShadow = this.profile.shadows;
    this.sun.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
    this.sun.shadow.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 6000);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.position.set(-30000, 40000, 10000);
    // Landing/taxi light: always present so toggling it never recompiles the shaders.
    if (this.profile.landingLight) {
      this.landingLight = new THREE.SpotLight(0xfff1dc, 0, 1400, 0.2, 0.55, 1);
      this.scene.add(this.landingLight, this.landingLight.target);
    }
    this.water = new WaterSurfaces(this.scene, { zenith: this.sky.uniforms.uZenith, lakes: LAKES, groundToThree });
    onProgress(0.2, 'Costruzione degli aeroporti…');
    await nextFrame();
    this.airports = buildAirports(this.scene);
    this.cities = buildCities(this.scene);
    onProgress(0.6, 'Preparazione delle nubi…');
    this.cloudLayer = new CloudLayer(this.scene, this.profile.cloudCount);
    this.cloudLayer.setDetail(this.profile.quality !== 'low');
    this.createRain();
    this.createLensflare();
    this.pmrem = new THREE.PMREMGenerator(this.webgl);
    await nextFrame();
    onProgress(1, 'Mondo pronto');
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
    geometry.setDrawRange(0, this.profile.rainCount * 2);
    this.rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb3c9d2, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 11;
    this.scene.add(this.rain);
  }

  /** Sun glare and aperture ghosts (medium/high), occluded by terrain and aircraft. */
  createLensflare() {
    const { glare, ghost } = getFlareTextures();
    this.lensflare = new Lensflare();
    this.flareElements = [
      [glare, 460, 0, 0xfff0d6], [ghost, 60, 0.32, 0x34445a], [ghost, 110, 0.52, 0x4a412c],
      [ghost, 42, 0.68, 0x2f4a38], [ghost, 150, 0.95, 0x2c3244],
    ].map(([texture, size, distance, colour]) => {
      const element = new LensflareElement(texture, size, distance, new THREE.Color(colour));
      this.lensflare.addElement(element);
      return { element, base: element.color.clone() };
    });
    this.lensflare.renderOrder = 50;
    this.lensflare.visible = false;
    this.scene.add(this.lensflare);
  }

  setQuality(quality) {
    const before = this.profile;
    this.profile = getRenderProfile(quality, this.touch);
    this.quality = this.profile.quality;
    if (this.rain) this.rain.geometry.setDrawRange(0, this.profile.rainCount * 2);
    this.terrain.setQuality(this.quality);
    this.cloudLayer?.setBudget(this.profile.cloudCount);
    this.cloudLayer?.setDetail(this.profile.quality !== 'low');
    if (before && before.shadows !== this.profile.shadows) {
      this.webgl.shadowMap.enabled = this.profile.shadows;
      this.terrain.setShadows(this.profile.shadows);
      if (this.sun) this.sun.castShadow = this.profile.shadows;
      // Shadow receivers need their shaders rebuilt with or without the shadow map.
      this.scene.traverse((object) => {
        for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) material.needsUpdate = true;
      });
    }
    if (this.sun && before && before.shadowMapSize !== this.profile.shadowMapSize) {
      this.sun.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = getRenderPixelRatio(this.profile, this.width, this.height, window.devicePixelRatio || 1);
    this.webgl.setPixelRatio(ratio);
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
    this.aircraft.traverse((object) => {
      if (object.isMesh) object.castShadow = true;
    });
    this.hiddenAircraft = null;
    this.shadowExtent = Math.max(def.wing.span, 12) * 0.62 + 2;
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
    this.envState = null;
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
      mesh.renderOrder = 5;
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
    // From the cockpit the model writes neither colour nor depth, but it still casts its
    // shadow (the shadow pass uses its own depth materials), so it shows on the runway.
    this.aircraft.visible = true;
    const hidden = this.view === 'cockpit';
    if (hidden !== this.hiddenAircraft) {
      this.hiddenAircraft = hidden;
      for (const material of this.aircraft.userData.materials) {
        material.colorWrite = !hidden;
        material.depthWrite = !hidden && !material.transparent;
      }
    }
    const { gear, propeller, propDisc, lights, controls } = this.aircraft.userData;
    gear.scale.y = Math.max(0.02, fm.systems.gearPos);
    gear.visible = fm.systems.gearPos > 0.02;
    const rpm = fm.engines[0]?.rpm || 0;
    if (propeller) {
      propeller.rotation.z += rpm * dt * Math.PI / 30;
      // Fast propellers blur into a translucent disc instead of strobing.
      const blur = smoothstep(500, 1100, rpm);
      if (propDisc) {
        propDisc.visible = blur > 0.02;
        propDisc.material.opacity = 0.32 * blur;
      }
      propeller.userData.blades.visible = blur < 0.98;
    }
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
    this.updateEnvironment(sim, dt);
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
      // Eye height inside the glazed cab.
      groundToThree(nearest.tower.n, nearest.tower.e, nearest.airport.elev + nearest.tower.height + 1.7, this.camera.position);
      this.camera.lookAt(this.position);
    } else if (this.view === 'flyby') {
      if (!this.flybyPosition || this.flybyPosition.distanceTo(this.position) > 2500) {
        this.flybyPosition = this.position.clone();
        this.flybyPosition.x += Math.sin(fm.heading * DEG) * 700 + 140;
        this.flybyPosition.z -= Math.cos(fm.heading * DEG) * 700;
        this.flybyPosition.y += 35;
        const ground = getTerrain().groundInfo(-this.flybyPosition.z, this.flybyPosition.x).h;
        this.flybyPosition.y = Math.max(this.flybyPosition.y, ground + 3);
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

  /** Cloud deck above the camera (0..1): greys the sky and dims the sunlight. */
  overcastAt(sim, altitude) {
    let overcast = 0;
    for (const c of sim.atm.weather.clouds || []) {
      const base = c.baseFt * 0.3048, top = base + c.thickFt * 0.3048;
      if (altitude > top) continue;
      const cover = smoothstep(0.45, 0.95, c.coverage) * (c.type === 'stratus' ? 1 : 0.85);
      overcast = Math.max(overcast, cover * (altitude < base ? 1 : 1 - smoothstep(base, top, altitude)));
    }
    return Math.max(overcast, clamp(sim.atm.precip * 0.9, 0, 1));
  }

  updateEnvironment(sim, dt = 0) {
    const camera = this.camera;
    const cloudDensity = sim.fm.cloudDensity || 0;
    const visibility = sim.atm.visibility;
    const overcast = this.overcastAt(sim, camera.position.y);
    const mist = 1 - smoothstep(1500, 9000, visibility);
    const sky = this.sky;
    sky.update(sim.timeOfDay, { overcast, haze: mist, inCloud: cloudDensity, time: this.elapsed, pixelRatio: this.webgl.getPixelRatio() });
    sky.follow(camera);
    const daylight = sky.daylight;
    this.scene.background.copy(sky.horizon);
    this.scene.fog.color.copy(sky.horizon);
    this.scene.fog.density = 1.8 / Math.max(300, visibility * (1 - cloudDensity * 0.93));
    // Haze thins out with altitude on clear days; thick fog and cloud stay uniform.
    const ground = getTerrain().height(-camera.position.z, camera.position.x);
    atmosphereUniforms.fogHeight.value.set(Math.max(0, ground), visibility >= 8000 && cloudDensity < 0.05 ? 1 / 2200 : 0, 0.05);
    // Fade the scenery into the horizon haze before the streamed terrain ends.
    const range = this.terrain.visibleRange;
    atmosphereUniforms.fogRange.value.set(range * 0.22, range * 0.97);
    // Sky light (hemisphere): a desaturated mix of zenith and horizon, never fully black.
    const ambient = this.ambient.copy(sky.zenith).lerp(sky.horizon, 0.65);
    const lum = ambient.r * 0.2126 + ambient.g * 0.7152 + ambient.b * 0.0722;
    ambient.lerp(this._tmpColor.setRGB(lum, lum, lum), 0.4).multiplyScalar(2.3);
    ambient.r = Math.max(ambient.r, 0.01);
    ambient.g = Math.max(ambient.g, 0.014);
    ambient.b = Math.max(ambient.b, 0.03);
    this.hemi.color.copy(ambient);
    this.hemi.groundColor.setRGB(0.36, 0.32, 0.22).multiplyScalar(0.15 + lum * 1.6);
    this.hemi.intensity = 1.55;
    this.sun.color.copy(sky.lightColor);
    this.sun.intensity = sky.lightIntensity * (1 - cloudDensity * 0.7);
    this.updateShadow(sky);
    this.updateLandingLight(sim, daylight);
    const lightAmbient = this._tmpColor.copy(ambient).multiplyScalar(this.hemi.intensity * 0.55);
    this.water.update(camera, sky, this.elapsed, lightAmbient);
    const layer = sim.atm.weather.clouds?.find((c) => c.coverage > 0) || null;
    this.cloudLayer.update(layer, camera, dt, { dir: sky.lightDir, color: sky.lightColor, intensity: this.sun.intensity / 3.1, ambient: lightAmbient });
    this.updateEnvironmentMap(sim.timeOfDay, overcast + cloudDensity);
    const flare = this.profile.quality === 'low' ? 0
      : smoothstep(-0.02, 0.08, sky.sunDir.y) * (1 - overcast) * (1 - cloudDensity) * (1 - mist);
    this.lensflare.visible = flare > 0.02;
    if (this.lensflare.visible) {
      this.lensflare.position.copy(camera.position).addScaledVector(sky.sunDir, 90000);
      for (const { element, base } of this.flareElements) element.color.copy(base).multiplyScalar(flare);
    }
    this.rain.visible = sim.atm.precip > 0.05;
    if (this.rain.visible) {
      this.rain.position.copy(camera.position);
      this.rain.position.y -= (this.elapsed * 65) % 120;
      this.rain.material.opacity = sim.atm.precip * 0.5;
      this.rain.material.color.setRGB(0.5, 0.56, 0.6).multiplyScalar(0.3 + daylight * 0.7);
    }
    // Night lighting: airport lights also come on in poor visibility.
    const dusk = 1 - smoothstep(0.25, 0.8, daylight);
    const lowVis = visibility < 5000 ? 0.85 : 0;
    const airportGlow = Math.max(dusk, lowVis);
    for (const lights of this.airports.nightLights) lights.visible = airportGlow > 0.01;
    for (const [name, material] of Object.entries(this.airports.glow)) {
      material.uniforms.uIntensity.value = name === 'papi' ? 0.8 + 0.4 * airportGlow : airportGlow * (name === 'flood' ? 0.8 : 1);
    }
    const cityGlow = 1 - smoothstep(0.12, 0.55, daylight);
    for (const lights of this.cities.lights) lights.visible = cityGlow > 0.01;
    this.cities.lightMaterial.uniforms.uIntensity.value = cityGlow * 0.9;
    sceneryUniforms.uNight.value = cityGlow;
    glowUniforms.uPixelScale.value = this.webgl.domElement.height / (2 * Math.tan(this.camera.fov * DEG / 2));
    glowUniforms.uPixelRatio.value = this.webgl.getPixelRatio();
    glowUniforms.uTime.value = this.elapsed % 1000;
    if (this.aircraft.userData.glow) this.aircraft.userData.glow.uniforms.uIntensity.value = 0.55 + 0.45 * (1 - daylight);
    for (const { lights, end } of this.airports.papiGuides) {
      const along = -((sim.fm.pos.x - end.thrN) * end.dirN + (sim.fm.pos.y - end.thrE) * end.dirE) + 300;
      lights.visible = along > 0 && along < 12000;
      if (!lights.visible) continue;
      const angle = Math.atan2(sim.fm.alt - end.elev, along) / DEG;
      const colors = lights.geometry.attributes.color;
      for (let j = 0; j < 4; j++) {
        const white = angle > 2.5 + j / 3;
        colors.setXYZ(j, 1, white ? 0.95 : 0.06, white ? 0.82 : 0.03);
      }
      colors.needsUpdate = true;
    }
    for (const { sock, cloth } of this.airports.windsocks) {
      sock.rotation.y = -(sim.atm.weather.windDir || 0) * DEG - Math.PI / 2;
      cloth.rotation.z = clamp((sim.atm.weather.windSpeedKt || 0) / 15, 0, 1) * Math.PI / 2;
    }
  }

  /** Small orthographic shadow frustum that follows the aircraft along the light direction. */
  updateShadow(sky) {
    if (!this.profile.shadows) return;
    const s = this.shadowExtent || 20;
    const cam = this.sun.shadow.camera;
    if (cam.right !== s) {
      cam.left = cam.bottom = -s;
      cam.right = cam.top = s;
      cam.updateProjectionMatrix();
    }
    this.sun.target.position.copy(this.position);
    // castShadow stays on: toggling it would recompile every shader at dusk.
    this.sun.position.copy(this.position).addScaledVector(sky.lightDir, 1500);
  }

  updateLandingLight(sim, daylight) {
    if (!this.landingLight) return;
    const on = !!sim.fm.systems.lights.landing || !!sim.fm.systems.lights.taxi;
    this.landingLight.intensity = on ? 900 * (1 - smoothstep(0.2, 0.7, daylight)) : 0;
    if (!this.landingLight.intensity) return;
    bodyToModel(this.def.camera.eye[0] + 1, 0, 0.5, this._tmpVec).applyQuaternion(this.orientation);
    this.landingLight.position.copy(this.position).add(this._tmpVec);
    bodyToModel(120, 0, 9, this._tmpVec).applyQuaternion(this.orientation);
    this.landingLight.target.position.copy(this.landingLight.position).add(this._tmpVec);
  }

  /** Re-render the reflection environment when the sky changed noticeably (throttled). */
  updateEnvironmentMap(hour, cloudiness) {
    if (!this.pmrem) return;
    const state = { hour, cloudiness };
    const prev = this.envState;
    const now = performance.now();
    if (prev) {
      let dh = Math.abs(hour - prev.hour) % 24;
      dh = Math.min(dh, 24 - dh);
      if ((dh < 0.15 && Math.abs(cloudiness - prev.cloudiness) < 0.15) || now - this.envTimer < 3000) return;
    }
    this.envState = state;
    this.envTimer = now;
    this.sky.uniforms.uGround.value.copy(this.ambient).multiplyScalar(0.12).add(this._tmpColor.set(0x4f5a3a).multiplyScalar(this.sun.intensity * 0.06));
    const target = this.pmrem.fromScene(this.sky.envScene, 0, 0.1, 1000, { size: 128 });
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
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
    this.cloudLayer?.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    disposeObject(this.scene);
    this.webgl.dispose();
  }
}
