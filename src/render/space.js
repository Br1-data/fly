// Deep-space backdrop: stars with magnitudes and colours, a baked Milky Way band and the
// Sun (disc, corona glow and lens flare). Everything sits at "infinity" around the
// camera, which is always at the origin (floating origin).
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { rng } from '../core/math.js';
import { bakeCube } from './planet.js';
import { getFlareTextures, getGlowTexture } from './textures.js';

const FAR = 5e13;

const MILKY_BAKE = /* glsl */ `
vec4 bake(vec3 d) {
  vec3 pole = normalize(vec3(0.35, 0.82, -0.45));
  float b = dot(d, pole);
  float band = exp(-b * b * 26.0);
  vec3 core = normalize(vec3(0.8, -0.15, 0.58));
  float bulge = exp(-pow(distance(d, core), 2.0) * 3.0);
  float clouds = fbm3(d * 6.0, 6) * 0.5 + 0.5;
  float dust = smoothstep(0.45, 0.75, fbm3(d * 9.0 + 7.0, 5) * 0.5 + 0.5) * exp(-b * b * 120.0);
  float glow = band * (0.35 + 0.65 * clouds) * (1.0 - dust * 0.85) + bulge * 0.6 * (1.0 - dust * 0.7);
  float neb = smoothstep(0.62, 0.9, fbm3(d * 3.0 - 4.0, 4) * 0.5 + 0.5);
  vec3 col = vec3(0.55, 0.6, 0.75) * glow * 0.11 + vec3(0.9, 0.75, 0.55) * bulge * 0.05 + vec3(0.5, 0.15, 0.25) * neb * band * 0.025;
  return vec4(col, 1.0);
}`;

export class SpaceBackground {
  constructor(scene, renderer, quality) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const count = quality === 'low' ? 2600 : quality === 'high' ? 7000 : 5000;
    const r = rng(2024);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // More stars along the galactic plane.
      let x, y, z;
      for (;;) {
        z = r() * 2 - 1;
        const t = r() * Math.PI * 2;
        const s = Math.sqrt(1 - z * z);
        x = s * Math.cos(t);
        y = s * Math.sin(t);
        const b = x * 0.35 + y * 0.82 - z * 0.45;
        if (r() < 0.35 + 0.65 * Math.exp(-b * b * 10)) break;
      }
      pos.set([x * FAR, y * FAR, z * FAR], i * 3);
      const mag = Math.pow(r(), 2.6); // many faint, few bright
      const temp = r();
      const c = temp < 0.12 ? [1, 0.72, 0.5] : temp < 0.3 ? [1, 0.88, 0.72] : temp < 0.8 ? [1, 0.98, 0.95] : [0.75, 0.85, 1];
      const b = 0.25 + mag * 1.8;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      size[i] = 1.1 + mag * 2.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float size;
        attribute vec3 color;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform float uFade;
        varying vec3 vColor;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a = exp(-dot(p, p) * 3.2);
          gl_FragColor = vec4(vColor * a * uFade, 1.0);
        }`,
    });
    this.stars = new THREE.Points(g, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -20;
    this.group.add(this.stars);
    // Milky Way
    this.milkyRT = bakeCube(renderer, quality === 'low' ? 256 : 512, MILKY_BAKE);
    this.milkyMaterial = new THREE.ShaderMaterial({
      uniforms: { tSky: { value: this.milkyRT.texture }, uFade: { value: 1 } },
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform samplerCube tSky;
        uniform float uFade;
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(textureCube(tSky, normalize(vDir)).rgb * uFade, 1.0);
        }`,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(FAR * 0.95, 48, 24), this.milkyMaterial);
    this.milky.frustumCulled = false;
    this.milky.renderOrder = -21;
    this.group.add(this.milky);
    // Sun: disc, corona and flare.
    const glow = getGlowTexture();
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(4, 3.8, 3.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(1.2, 1.05, 0.85), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    this.sunDisc.renderOrder = -15;
    this.sunGlow.renderOrder = -14;
    this.group.add(this.sunDisc, this.sunGlow);
    this.flare = null;
    if (quality !== 'low') {
      const { glare, ghost } = getFlareTextures();
      this.flare = new Lensflare();
      this.flareElements = [
        [glare, 520, 0, 0xfff0d6], [ghost, 60, 0.3, 0x34445a], [ghost, 110, 0.52, 0x4a412c], [ghost, 46, 0.7, 0x2f4a38], [ghost, 160, 0.95, 0x2c3244],
      ].map(([texture, s, dist, c]) => {
        const e = new LensflareElement(texture, s, dist, new THREE.Color(c));
        this.flare.addElement(e);
        return { e, base: e.color.clone() };
      });
      this.flare.renderOrder = 60;
      this.group.add(this.flare);
    }
  }

  /** sunDir: three-axes unit vector. fade: 0 (bright sky) .. 1 (space). */
  update(sunDir, fade, sunColor, pixelRatio, flareStrength, sunAngle = 0.0047) {
    this.starMaterial.uniforms.uFade.value = fade;
    this.starMaterial.uniforms.uPixelRatio.value = pixelRatio;
    this.milkyMaterial.uniforms.uFade.value = fade;
    const d = FAR * 0.8;
    this.sunDisc.position.copy(sunDir).multiplyScalar(d);
    this.sunGlow.position.copy(this.sunDisc.position);
    // The real angular size of the Sun from here; the glow halo much wider.
    this.sunDisc.scale.setScalar(d * Math.tan(sunAngle) * 4.5);
    this.sunGlow.scale.setScalar(d * Math.max(0.02, Math.tan(sunAngle) * 34));
    this.sunDisc.material.color.copy(sunColor).multiplyScalar(4.2);
    this.sunGlow.material.color.copy(sunColor).multiplyScalar(0.9);
    this.sunGlow.material.opacity = 0.35 + 0.4 * (1 - fade);
    if (this.flare) {
      this.flare.position.copy(this.sunDisc.position);
      this.flare.visible = flareStrength > 0.02;
      for (const { e, base } of this.flareElements) e.color.copy(base).multiplyScalar(flareStrength);
    }
  }

  dispose() {
    this.milkyRT.dispose();
    this.group.removeFromParent();
  }
}
