// Sea and lake surfaces: animated wind waves, Fresnel sky reflection, sun/moon glint and a
// partly transparent surface so that the shallow sea bed coloured by the terrain shows through.
import * as THREE from 'three';
import { FOG_PARS_FRAGMENT, FOG_PARS_VERTEX, FOG_FRAGMENT, FOG_VERTEX, applyAtmosphere, fogUniforms } from './atmosphere.js';
import { getWaterNormalTexture } from './textures.js';

const VERTEX = /* glsl */`
varying vec3 vWorld;
${FOG_PARS_VERTEX}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_VERTEX}
}
`;

const FRAGMENT = /* glsl */`
uniform sampler2D uNormals;
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uWaterColor;
uniform float uAlpha;
uniform float uWaves;
varying vec3 vWorld;
${FOG_PARS_FRAGMENT}
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vWorld.xz;
  vec2 s1 = texture2D(uNormals, p * 0.0109 + uTime * vec2(0.0057, 0.0039)).xy * 2.0 - 1.0;
  vec2 s2 = texture2D(uNormals, p * 0.0317 + uTime * vec2(-0.0089, 0.0067)).xy * 2.0 - 1.0;
  vec2 s3 = texture2D(uNormals, p * 0.127 + uTime * vec2(0.0213, -0.0171)).xy * 2.0 - 1.0;
  float near = 1.0 - smoothstep(80.0, 1500.0, dist);
  vec2 slope = s1 * 0.6 + s2 * 0.45 + s3 * 0.35 * near;
  float strength = uWaves * mix(0.22, 0.75, 1.0 / (1.0 + dist / 1800.0));
  vec3 N = normalize(vec3(slope.x * strength, 1.0, slope.y * strength));
  float NdV = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  // Reflected sky uses the same gradient as the sky dome (colours arrive in display space).
  vec3 horizon = mix(fogColor, fogSun.rgb, fogSun.a * pow(max(dot(R, fogSunDir), 0.0), 6.0));
  vec3 sky = toLinear(mix(horizon, uZenith, 1.0 - exp(-R.y * 5.0)));
  vec3 H = normalize(uLightDir + V);
  float nh = max(dot(N, H), 0.0);
  float glint = pow(nh, 1200.0) * 9.0 + pow(nh, 160.0) * 0.6 + pow(nh, 18.0) * 0.04;
  vec3 body = uWaterColor * (uAmbient + uLightColor * max(uLightDir.y, 0.0) * 0.55);
  vec3 col = mix(body, sky * 0.92, fresnel) + uLightColor * glint * step(0.0, uLightDir.y);
  float alpha = mix(uAlpha, 1.0, max(fresnel, smoothstep(400.0, 6000.0, dist)));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  ${FOG_FRAGMENT}
}
`;

export function createWaterMaterial({ zenith, color = 0x0f4f63, alpha = 0.62, waves = 1 } = {}) {
  const uniforms = {
    ...fogUniforms(),
    uNormals: { value: getWaterNormalTexture() },
    uTime: { value: 0 },
    uZenith: zenith || { value: new THREE.Color(0x3f74b8) },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) },
    uWaterColor: { value: new THREE.Color(color) },
    uAlpha: { value: alpha },
    uWaves: { value: waves },
  };
  return new THREE.ShaderMaterial({
    name: 'water', vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms,
    transparent: true, depthWrite: true, fog: true,
  });
}

/**
 * Builds the sea (a camera-following quad over an opaque deep-water floor) and the lakes.
 * Returns { sea, floor, lakes, materials, update(camera, sky, dt, ambient) }.
 */
export class WaterSurfaces {
  constructor(scene, { zenith, lakes = [], groundToThree }) {
    this.seaMaterial = createWaterMaterial({ zenith, color: 0x0d4c63, alpha: 0.58 });
    this.lakeMaterial = createWaterMaterial({ zenith, color: 0x13434a, alpha: 0.72, waves: 0.6 });
    // Share the per-frame uniforms between the two materials.
    for (const key of ['uTime', 'uLightDir', 'uLightColor', 'uAmbient']) this.lakeMaterial.uniforms[key] = this.seaMaterial.uniforms[key];
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(300000, 300000), this.seaMaterial);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -0.15;
    this.sea.renderOrder = 1;
    this.sea.frustumCulled = false;
    // Deep water floor: what shows through the transparent surface where no terrain is streamed.
    this.floorMaterial = applyAtmosphere(new THREE.MeshBasicMaterial({ color: 0x06222e }), 'floor');
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(300000, 300000), this.floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -38;
    this.floor.frustumCulled = false;
    scene.add(this.sea, this.floor);
    this.lakes = [];
    for (const lake of lakes) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(lake.radius * 1.5, 72), this.lakeMaterial);
      water.rotation.x = -Math.PI / 2;
      groundToThree(lake.n, lake.e, lake.level, water.position);
      water.renderOrder = 1;
      scene.add(water);
      this.lakes.push(water);
    }
  }

  update(camera, sky, elapsed, ambient) {
    const u = this.seaMaterial.uniforms;
    u.uTime.value = elapsed % 3600;
    u.uLightDir.value.copy(sky.lightDir);
    u.uLightColor.value.copy(sky.lightColor).multiplyScalar(sky.lightIntensity / 3.1);
    u.uAmbient.value.copy(ambient);
    // Keep the quads centred under the camera (snapped so the wave pattern stays world-anchored).
    this.sea.position.x = this.floor.position.x = Math.round(camera.position.x / 1000) * 1000;
    this.sea.position.z = this.floor.position.z = Math.round(camera.position.z / 1000) * 1000;
    // The floor colour follows the light so deep water darkens at night.
    this.floorMaterial.color.setRGB(0.004, 0.025, 0.04).multiplyScalar(0.25 + 0.75 * Math.min(1, ambient.g * 2.2));
  }
}
