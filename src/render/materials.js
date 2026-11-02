// Shared scenery materials: textured paved surfaces and buildings with windows that light up
// at night. All of them use the atmospheric fog.
import * as THREE from 'three';
import { applyAtmosphere } from './atmosphere.js';
import { getDetailTexture, getMaterialTexture } from './textures.js';

/** Night factor 0..1 shared by every emissive scenery material. */
export const sceneryUniforms = {
  uNight: { value: 0 },
};

const WORLD_POS_VERTEX = /* glsl */`
vec4 sceneryWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  sceneryWorld = instanceMatrix * sceneryWorld;
#endif
sceneryWorld = modelMatrix * sceneryWorld;
vSceneryPos = sceneryWorld.xyz;
`;

/** Lambert material with world-space asphalt/concrete texture and large-scale wear. */
export function pavedMaterial(color, texture = 'asphalt') {
  const detail = getDetailTexture();
  const material = new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return applyAtmosphere(material, 'paved', (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.tPaved = getMaterialTexture(texture);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSceneryPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_POS_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform sampler2D tPaved;\nvarying vec3 vSceneryPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 pavedUv = vSceneryPos.xz;
        float pavedA = texture2D(uDetail, pavedUv / 7.0).r;
        float pavedB = texture2D(uDetail, pavedUv / 53.0).g;
        float pavedC = texture2D(uDetail, pavedUv / 290.0).a;
        diffuseColor.rgb *= (0.96 + 0.06 * pavedA) * (0.95 + 0.1 * pavedB) * (0.9 + 0.16 * pavedC);
        vec3 pavedMean = max(textureLod(tPaved, vec2(0.5), 12.0).rgb, vec3(0.03));
        vec2 pavedRot = vec2(0.8 * pavedUv.x - 0.6 * pavedUv.y, 0.6 * pavedUv.x + 0.8 * pavedUv.y);
        vec3 pavedTex = (texture2D(tPaved, pavedUv / 9.0).rgb * 0.6 + texture2D(tPaved, pavedRot / 71.0).rgb * 0.4) / pavedMean;
        diffuseColor.rgb *= mix(vec3(1.0), pavedTex, 0.8);`);
  });
}

/** Painted markings: unlit details are avoided so they darken properly at night. */
export function markingMaterial(color) {
  return applyAtmosphere(new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'marking');
}

/**
 * Building material: procedural window grid on vertical walls (glass by day, a random
 * selection of warmly lit windows at night). Works with InstancedMesh and merged meshes.
 */
export function buildingMaterial({ vertexColors = false, color = 0xffffff, floor = 3.3, bay = 3.6, glass = 0.5 } = {}) {
  const material = new THREE.MeshLambertMaterial({ color, vertexColors });
  return applyAtmosphere(material, `building-${floor}-${bay}-${glass}`, (shader) => {
    shader.uniforms.uNight = sceneryUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSceneryPos;\nvarying vec3 vSceneryNormal;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        ${WORLD_POS_VERTEX}
        vec3 sceneryNormal = objectNormal;
        #ifdef USE_INSTANCING
          sceneryNormal = mat3(instanceMatrix) * sceneryNormal;
        #endif
        vSceneryNormal = normalize(mat3(modelMatrix) * sceneryNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vSceneryPos;
        varying vec3 vSceneryNormal;
        float buildingHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bn = normalize(vSceneryNormal);
        float windowMask = 0.0;
        float windowLit = 0.0;
        if (abs(bn.y) < 0.5) {
          vec2 along = normalize(vec2(-bn.z, bn.x));
          float u = dot(vSceneryPos.xz, along) / ${bay.toFixed(2)};
          float v = vSceneryPos.y / ${floor.toFixed(2)};
          vec2 f = fract(vec2(u, v));
          vec2 aa = fwidth(vec2(u, v));
          float wx = smoothstep(0.18, 0.18 + aa.x, f.x) * (1.0 - smoothstep(0.82 - aa.x, 0.82, f.x));
          float wy = smoothstep(0.3, 0.3 + aa.y, f.y) * (1.0 - smoothstep(0.85 - aa.y, 0.85, f.y));
          // Windows vanish into an average tone where they would shimmer.
          windowMask = wx * wy * (1.0 - smoothstep(0.25, 0.6, max(aa.x, aa.y)));
          windowLit = step(0.58, buildingHash(vec3(floor(u), floor(v), floor(dot(vSceneryPos.xz, vec2(bn.x, bn.z)) * 0.1))));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.07, 0.09), windowMask * ${glass.toFixed(2)});
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.62, 0.28) * windowMask * windowLit * uNight * 0.9;`);
  });
}
