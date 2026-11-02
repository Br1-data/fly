// Point lights drawn as glowing sprites with a minimum on-screen size, so runway, approach,
// PAPI, city and aircraft lights stay visible from many kilometres away at night.
import * as THREE from 'three';
import { FOG_PARS_FRAGMENT, FOG_PARS_VERTEX, FOG_VERTEX, fogUniforms } from './atmosphere.js';

/** Shared per-frame values: projection scale in pixels and the time for flashing lights. */
export const glowUniforms = {
  uPixelScale: { value: 600 },
  uPixelRatio: { value: 1 },
  uTime: { value: 0 },
};

const VERTEX = /* glsl */`
attribute vec3 color;
attribute float aPhase;
uniform float uPixelScale;
uniform float uPixelRatio;
uniform float uTime;
uniform float uWorldSize;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uFlash;
varying vec3 vColor;
varying float vBoost;
${FOG_PARS_VERTEX}
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.1);
  float px = uWorldSize * uPixelScale / dist;
  float minPx = uMinPx * uPixelRatio;
  // Lights smaller than the minimum keep a fixed size but get dimmer, like real distant lamps.
  vBoost = clamp(px / minPx, 0.6, 1.0);
  if (uFlash > 0.5) {
    // Sequenced flashers ("rabbit") run towards the runway twice per second.
    float f = fract(uTime * 2.0 - aPhase);
    vBoost *= (1.0 - smoothstep(0.0, 0.08, f)) * 1.6;
  }
  gl_PointSize = clamp(px, minPx, uMaxPx * uPixelRatio);
  vColor = color;
  ${FOG_VERTEX}
}
`;

const FRAGMENT = /* glsl */`
uniform float uIntensity;
uniform float uCoreWhite;
varying vec3 vColor;
varying float vBoost;
${FOG_PARS_FRAGMENT}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.38, d);
  float halo = pow(1.0 - d, 2.4) * 0.55;
  float a = (core + halo) * vBoost * uIntensity;
  vec3 col = mix(vColor, vec3(1.0), core * uCoreWhite) * a;
  #ifdef USE_FOG
    // Bright lights pierce the haze much further than the scenery around them.
    col *= 1.0 - 0.85 * atmoFogFactor(vFogWorld);
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * @param {object} o worldSize (m), minPx, maxPx, intensity, flash (sequenced flashing)
 */
export function createGlowMaterial({ worldSize = 3, minPx = 3, maxPx = 48, intensity = 1, flash = false, coreWhite = 0.55 } = {}) {
  return new THREE.ShaderMaterial({
    name: 'glow-lights',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...fogUniforms(),
      ...glowUniforms,
      uWorldSize: { value: worldSize },
      uMinPx: { value: minPx },
      uMaxPx: { value: maxPx },
      uIntensity: { value: intensity },
      uFlash: { value: flash ? 1 : 0 },
      uCoreWhite: { value: coreWhite },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

/** Points object from flat position/colour arrays (optional per-light flash phase). */
export function createGlowPoints(positions, colors, material, phases = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases || new Array(positions.length / 3).fill(0), 1));
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 12;
  return points;
}
