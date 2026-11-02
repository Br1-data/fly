// Sky dome, sun/moon/stars and the atmospheric fog shared by every scene material.
// The fog colour depends on the view direction (warmer towards the sun), thins out with
// altitude and fades the terrain into the horizon haze before the streamed tiles end, so the
// sky dome and the fogged landscape always meet without a visible seam.
import * as THREE from 'three';
import { clamp, DEG, rng, smoothstep } from '../core/math.js';

/** Uniforms shared by all atmosphere-aware materials (updated once per frame). */
export const atmosphereUniforms = {
  fogSun: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb = sun-side haze colour, a = strength
  fogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  fogHeight: { value: new THREE.Vector3(0, 0, 1) }, // x = reference height, y = 1/scale height (0 = off), z = minimum factor
  fogRange: { value: new THREE.Vector2(0, 0) }, // horizon fade start/end distance (0 = off)
};

export const FOG_PARS_VERTEX = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif
`;

export const FOG_VERTEX = /* glsl */`
#ifdef USE_FOG
  // World-space vector camera -> vertex (rotation part of the inverse view matrix).
  vFogWorld = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif
`;

export const FOG_PARS_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 fogSun;
  uniform vec3 fogSunDir;
  uniform vec3 fogHeight;
  uniform vec2 fogRange;
  vec3 atmoFogColor(vec3 dir) {
    return mix(fogColor, fogSun.rgb, fogSun.a * pow(max(dot(dir, fogSunDir), 0.0), 6.0));
  }
  float atmoFogFactor(vec3 rel) {
    float dist = length(rel);
    #ifdef FOG_EXP2
      float density = fogDensity;
      if (fogHeight.y > 0.0) {
        // Exponential height fog integrated analytically along the view ray.
        float k = fogHeight.y;
        float start = exp(-max(cameraPosition.y - fogHeight.x, 0.0) * k);
        float t = rel.y * k;
        float avg = abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0;
        density *= clamp(start * avg, fogHeight.z, 1.0);
      }
      float f = 1.0 - exp(-density * density * dist * dist);
    #else
      float f = smoothstep(fogNear, fogFar, dist);
    #endif
    if (fogRange.y > 0.0) f = max(f, pow(smoothstep(fogRange.x, fogRange.y, dist), 1.6));
    return f;
  }
#endif
`;

export const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoFogColor(normalize(vFogWorld)), atmoFogFactor(vFogWorld));
#endif
`;

/** Install the atmospheric fog into a built-in material; `patch` may edit the shader further. */
export function applyAtmosphere(material, key = 'base', patch = null) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX)
      .replace('#include <fog_vertex>', FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
    patch?.(shader);
  };
  material.customProgramCacheKey = () => `atmo-${key}`;
  return material;
}

/** Uniform set for a ShaderMaterial that uses the atmospheric fog. */
export function fogUniforms() {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...atmosphereUniforms };
}

const LATITUDE = 42 * DEG;
/** Sun direction for a local hour (equinox at 42°N): rises east at 6, south at noon, sets west at 18. */
export function sunDirection(hour, out = new THREE.Vector3()) {
  const H = (hour - 12) * 15 * DEG;
  const up = Math.cos(LATITUDE) * Math.cos(H);
  const east = -Math.sin(H);
  const north = -Math.sin(LATITUDE) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

// Sky colours keyed on the sine of the sun elevation (sRGB hex, interpolated in linear space).
const SKY_KEYS = [
  { s: -0.35, zenith: 0x020408, horizon: 0x070b15, sunward: 0x070b15, light: 0x8ea4d8 },
  { s: -0.16, zenith: 0x040916, horizon: 0x0e1529, sunward: 0x161c36, light: 0x8ea4d8 },
  { s: -0.07, zenith: 0x0c1734, horizon: 0x283050, sunward: 0x5e4058, light: 0xff6a3a },
  { s: -0.01, zenith: 0x1a2d5a, horizon: 0x67607c, sunward: 0xe27a48, light: 0xff7b3c },
  { s: 0.05, zenith: 0x2a4c86, horizon: 0x9ca2b2, sunward: 0xf3a86a, light: 0xffa765 },
  { s: 0.14, zenith: 0x33639f, horizon: 0xb2c2d0, sunward: 0xf0d0a6, light: 0xffd2a0 },
  { s: 0.32, zenith: 0x2f6ab2, horizon: 0xb0cbe0, sunward: 0xd8e2e8, light: 0xffeedb },
  { s: 1.0, zenith: 0x2662b4, horizon: 0xa8c7e0, sunward: 0xc8dae6, light: 0xfff6ea },
].map((k) => ({ s: k.s, zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), sunward: new THREE.Color(k.sunward), light: new THREE.Color(k.light) }));

function sampleKeys(s, field, out) {
  if (s <= SKY_KEYS[0].s) return out.copy(SKY_KEYS[0][field]);
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const b = SKY_KEYS[i];
    if (s <= b.s) {
      const a = SKY_KEYS[i - 1];
      return out.lerpColors(a[field], b[field], (s - a.s) / (b.s - a.s));
    }
  }
  return out.copy(SKY_KEYS[SKY_KEYS.length - 1][field]);
}

const SKY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SKY_FRAGMENT = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uGlow;
uniform float uDisc;
uniform float uMoon;
uniform vec3 fogColor;
uniform vec4 fogSun;
uniform vec3 fogSunDir;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 horizon = mix(fogColor, fogSun.rgb, fogSun.a * pow(max(dot(d, fogSunDir), 0.0), 6.0));
  float up = max(d.y, 0.0);
  vec3 col = mix(horizon, uZenith, 1.0 - exp(-up * 5.0));
  #ifdef ENV_MAP
    // Environment for reflections: add a ground hemisphere and output linear colour.
    col = mix(uGround, col, smoothstep(-0.12, 0.0, d.y));
  #endif
  float c = max(dot(d, fogSunDir), 0.0);
  // Forward scattering around the sun: a wide warm glow plus a tight bright halo.
  float lowSun = 1.0 - smoothstep(0.0, 0.5, fogSunDir.y);
  col += uSunColor * uGlow * (0.10 * pow(c, 6.0) * (0.4 + lowSun) + 0.35 * pow(c, 60.0) + 1.2 * pow(c, 900.0));
  col += uSunColor * uDisc * smoothstep(0.99992, 0.99996, c) * smoothstep(-0.02, 0.01, d.y);
  float m = dot(d, uMoonDir);
  col += vec3(0.75, 0.8, 0.9) * uMoon * (smoothstep(0.99988, 0.99992, m) * 1.5 + 0.06 * pow(max(m, 0.0), 120.0)) * smoothstep(-0.02, 0.02, d.y);
  // Sky colours are display-referred (sRGB), exactly like three.js fog colours, so the
  // horizon of the dome matches the fogged scenery pixel for pixel.
  #ifdef ENV_MAP
    col = pow(col, vec3(2.2));
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERTEX = /* glsl */`
attribute float aSize;
attribute float aBright;
uniform float uPixelRatio;
uniform float uTime;
varying float vAlpha;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uPixelRatio;
  float twinkle = 0.8 + 0.2 * sin(uTime * (1.5 + aBright * 3.0) + aBright * 40.0);
  vAlpha = aBright * twinkle * smoothstep(0.0, 0.18, normalize(position).y);
}
`;

const STAR_FRAGMENT = /* glsl */`
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), a * a * vAlpha * uOpacity);
}
`;

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.uniforms = {
      ...atmosphereUniforms,
      fogColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: 1 },
      uDisc: { value: 1 },
      uMoon: { value: 0 },
      uGround: { value: new THREE.Color(0.2, 0.22, 0.15) },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'sky', vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.dome.scale.setScalar(100000);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.stars = this.createStars();
    this.group.add(this.stars);
    scene.add(this.group);
    // A copy of the dome (same uniforms) rendered into the reflection environment map.
    this.envScene = new THREE.Scene();
    const envMaterial = new THREE.ShaderMaterial({
      name: 'sky-env', vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, defines: { ENV_MAP: 1 },
    });
    const envDome = new THREE.Mesh(this.dome.geometry, envMaterial);
    envDome.scale.setScalar(100);
    this.envScene.add(envDome);
    // Results of the last update, read by the renderer for lights, water and clouds.
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.sunward = new THREE.Color();
    this.sunLight = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.lightIntensity = 0;
    this.daylight = 1;
    this.night = 0;
    this._grey = new THREE.Color();
  }

  createStars() {
    const count = 2200;
    const r = rng(4049);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const bright = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      positions.set([Math.cos(a) * s * 90000, z * 90000, Math.sin(a) * s * 90000], i * 3);
      const m = Math.pow(r(), 6);
      sizes[i] = 1.4 + m * 2.6;
      bright[i] = 0.25 + m * 0.75;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    this.starUniforms = { uOpacity: { value: 0 }, uPixelRatio: { value: 1 }, uTime: { value: 0 } };
    const stars = new THREE.Points(geometry, new THREE.ShaderMaterial({
      name: 'stars', vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, uniforms: this.starUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    stars.frustumCulled = false;
    stars.renderOrder = -10;
    return stars;
  }

  /**
   * @param {number} hour local time of day
   * @param {object} o overcast 0..1 (cloud deck above the camera), time (s), pixelRatio
   */
  update(hour, { overcast = 0, haze = 0, inCloud = 0, time = 0, pixelRatio = 1 } = {}) {
    sunDirection(hour, this.sunDir);
    sunDirection(hour + 12.8, this.moonDir);
    const s = this.sunDir.y;
    sampleKeys(s, 'zenith', this.zenith);
    sampleKeys(s, 'horizon', this.horizon);
    sampleKeys(s, 'sunward', this.sunward);
    sampleKeys(s, 'light', this.sunLight);
    this.daylight = smoothstep(-0.1, 0.22, s);
    this.night = 1 - smoothstep(-0.16, -0.02, s);
    // An overcast deck turns the sky into a flat grey whose brightness follows the daylight.
    if (overcast > 0) {
      const level = 0.035 + this.daylight * 0.42;
      this._grey.setRGB(level * 0.95, level, level * 1.04);
      this.zenith.lerp(this._grey.clone().multiplyScalar(0.8), overcast);
      this.horizon.lerp(this._grey, overcast);
      this.sunward.lerp(this._grey, overcast * 0.85);
    }
    // Inside cloud or thick mist the whole sky fades into the fog colour.
    if (inCloud > 0) {
      const level = 0.05 + this.daylight * 0.62;
      this._grey.setRGB(level * 0.97, level, level * 1.03);
      this.horizon.lerp(this._grey, inCloud * 0.9);
      haze = Math.max(haze, inCloud);
    }
    if (haze > 0) {
      this.zenith.lerp(this.horizon, haze);
      this.sunward.lerp(this.horizon, haze * 0.7);
      overcast = Math.max(overcast, haze);
    }
    const u = this.uniforms;
    u.fogColor.value.copy(this.horizon).convertLinearToSRGB();
    u.uZenith.value.copy(this.zenith).convertLinearToSRGB();
    u.uSunColor.value.copy(this.sunLight).multiplyScalar(1 - overcast * 0.95).convertLinearToSRGB();
    u.uGlow.value = clamp((s + 0.12) / 0.12, 0, 1) * (1 - overcast);
    u.uDisc.value = 18 * smoothstep(-0.03, 0.02, s) * (1 - overcast);
    u.uMoonDir.value.copy(this.moonDir);
    u.uMoon.value = this.night * (1 - overcast);
    atmosphereUniforms.fogSunDir.value.copy(this.sunDir);
    this._grey.copy(this.sunward).convertLinearToSRGB();
    atmosphereUniforms.fogSun.value.set(this._grey.r, this._grey.g, this._grey.b, 1);
    this.starUniforms.uOpacity.value = this.night * (1 - overcast);
    this.starUniforms.uPixelRatio.value = pixelRatio;
    this.starUniforms.uTime.value = time % 1000;
    this.stars.visible = this.starUniforms.uOpacity.value > 0.01;
    // Direct light: the sun by day, a faint bluish moon at night (the switch happens in darkness).
    const sunUp = smoothstep(-0.04, 0.1, s);
    if (s > -0.04) {
      this.lightDir.copy(this.sunDir);
      this.lightColor.copy(this.sunLight);
      this.lightIntensity = 3.1 * sunUp * (1 - overcast * 0.8);
    } else {
      this.lightDir.copy(this.moonDir);
      this.lightColor.setRGB(0.5, 0.6, 0.95);
      this.lightIntensity = 0.13 * this.night * smoothstep(0.02, 0.25, this.moonDir.y) * (1 - overcast * 0.85);
    }
  }

  follow(camera) {
    this.group.position.copy(camera.position);
  }
}
