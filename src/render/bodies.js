// Celestial bodies in the renderer: terrain LOD with real colour maps (Earth, Moon, Mars,
// Mercury), cloud deck and atmosphere shells, textured spheres (Venus, giants), Saturn's
// rings and the Sun. Each body has a group rotated with its real orientation.
import * as THREE from 'three';
import { PlanetLOD, bakeCube, CLOUD_BAKE } from './planet.js';
import { NOISE_GLSL, ATMOSPHERE_GLSL, EQUIRECT_GLSL } from './shaders.js';
import { BODIES } from '../sim/system.js';
import { getMaterialTexture, getGlowTexture } from './textures.js';

const LOGDEPTH_V = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGDEPTH_F = '#include <logdepthbuf_pars_fragment>';

const textureCache = new Map();
/** Planet colour map from assets/planets (sRGB, mipmapped). */
export function planetTexture(name) {
  if (textureCache.has(name)) return textureCache.get(name);
  const uniform = { value: null };
  const placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  placeholder.needsUpdate = true;
  uniform.value = placeholder;
  textureCache.set(name, uniform);
  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load(new URL(`../../assets/planets/${name}`, import.meta.url).href, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = THREE.RepeatWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      uniform.value = t;
    });
  }
  return uniform;
}

/** Atmosphere parameters per body (scattering coefficients per metre). */
const ATMO = {
  earth: { height: 100e3, betaR: [5.8e-6, 13.5e-6, 33.1e-6], betaM: 4e-6, mie: [1, 1, 1], HR: 8000, HM: 1200, power: 10 },
  mars: { height: 80e3, betaR: [0.4e-6, 0.8e-6, 1.6e-6], betaM: 3e-6, mie: [1.0, 0.62, 0.38], HR: 11100, HM: 11100, power: 7 },
};

export function atmosphereUniforms(id) {
  const b = BODIES[id];
  const a = ATMO[id] || ATMO.earth;
  return {
    uPlanet: { value: new THREE.Vector3() },
    uR: { value: b.radius },
    uAtmR: { value: b.radius + a.height },
    uBetaR: { value: new THREE.Vector3(...a.betaR) },
    uBetaM: { value: a.betaM },
    uMieColor: { value: new THREE.Vector3(...a.mie) },
    uHR: { value: a.HR },
    uHM: { value: a.HM },
    uSunPower: { value: a.power },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
}

// Vertex code shared by the terrain materials: world normal and direction, body-fixed
// direction for texture lookups, aerial perspective per vertex (when the body has air).
const TERRAIN_VERTEX = (air) => /* glsl */ `
  ${air ? ATMOSPHERE_GLSL : 'uniform vec3 uPlanet; uniform vec3 uSunDir;'}
  ${LOGDEPTH_V}
  attribute vec3 aDir;
  attribute vec3 aInfo;
  attribute vec3 aTile;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vDirW;
  varying vec3 vDirF;
  varying vec3 vInfo;
  varying vec3 vTile;
  varying vec3 vIn;
  varying vec3 vTr;
  varying vec3 vSun;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    mat3 rot = mat3(modelMatrix);
    vNormal = normalize(rot * normal);
    vDirW = normalize(rot * vec3(aDir.x, aDir.z, -aDir.y));
    vDirF = aDir;
    vInfo = aInfo;
    vTile = aTile;
    ${air ? `
    float dist = length(wp.xyz);
    vec3 tr;
    vIn = scatter(-uPlanet, wp.xyz / max(dist, 1e-3), dist, STEPS, tr);
    vTr = tr;
    vSun = sunlightAt(wp.xyz - uPlanet);` : 'vIn = vec3(0.0); vTr = vec3(1.0); vSun = vec3(1.0);'}
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

const TERRAIN_VARYINGS = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vDirW;
  varying vec3 vDirF;
  varying vec3 vInfo;
  varying vec3 vTile;
  varying vec3 vIn;
  varying vec3 vTr;
  varying vec3 vSun;
  vec3 tri(sampler2D t, vec3 p, vec3 w) {
    return texture2D(t, p.yz).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
  }`;

function finish(material) {
  material.extensions = { derivatives: true };
  return material;
}

/** Earth: Blue Marble colours, oceans with glint, night lights, cloud shadows, air. */
export function earthMaterial(quality, cloudCube) {
  const uniforms = {
    ...atmosphereUniforms('earth'),
    uSunLight: { value: 2.6 },
    uTime: { value: 0 },
    uCloudRot: { value: new THREE.Matrix3() },
    uCloudCover: { value: 0.55 },
    tClouds: { value: cloudCube },
    tColor: planetTexture(quality === 'low' ? 'earth_color_small.jpg' : 'earth_color.jpg'),
    tRock: getMaterialTexture('rock'),
    tGrass: getMaterialTexture('grass'),
    tSand: getMaterialTexture('sand'),
  };
  return finish(new THREE.ShaderMaterial({
    uniforms,
    defines: { DETAIL: quality !== 'low' ? 1 : 0, STEPS: quality === 'high' ? 6 : quality === 'low' ? 3 : 4 },
    vertexShader: TERRAIN_VERTEX(true),
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${EQUIRECT_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform float uTime;
      uniform mat3 uCloudRot;
      uniform float uCloudCover;
      uniform samplerCube tClouds;
      uniform sampler2D tColor;
      uniform sampler2D tRock;
      uniform sampler2D tGrass;
      uniform sampler2D tSand;
      ${LOGDEPTH_F}
      ${TERRAIN_VARYINGS}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDirW);
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vWorld);
        float dist = length(vWorld);
        float h = vInfo.x;
        bool water = h <= 0.0;
        vec3 L = uSunDir;
        vec3 col = equirect(tColor, normalize(vDirF)).rgb;
        // Blue Marble is a photograph: undo some of its baked-in brightness and haze.
        col = pow(col, vec3(1.18)) * 0.95;
        float slope = 1.0 - dot(N, D);
        if (water) col = mix(col, vec3(0.008, 0.035, 0.085), 0.35);
        #if DETAIL
        float near = 1.0 - smoothstep(1500.0, 9000.0, dist);
        if (!water && near > 0.001) {
          vec3 w = abs(N); w = pow(w, vec3(4.0)); w /= dot(w, vec3(1.0));
          vec3 p = vTile / 11.0;
          vec3 tex = mix(tri(tGrass, p, w), tri(tRock, p * 0.6, w), smoothstep(0.08, 0.25, slope));
          float lum = dot(tex, vec3(0.333));
          col *= mix(vec3(1.0), tex / max(0.15, lum) * 0.55 + 0.45, near * 0.75);
          col *= 0.92 + 0.16 * snoise(vTile * 0.004);
        }
        #endif
        float cs = textureCube(tClouds, uCloudRot * normalize(vDirF + vec3(0.0))).r;
        float shadow = 1.0 - 0.6 * smoothstep(0.55, 0.75, cs) * uCloudCover;
        float ndl = max(dot(N, L), 0.0);
        float dayside = dot(D, L);
        vec3 sun = vSun * uSunLight;
        vec3 sky = vec3(0.18, 0.28, 0.45) * 0.3 * smoothstep(-0.2, 0.3, dayside);
        vec3 c = col * (sun * ndl * shadow + sky);
        if (water) {
          float waves = 1.0 - smoothstep(3000.0, 40000.0, dist);
          vec3 wn = normalize(D + 0.035 * waves * vec3(snoise(vTile * 0.03 + uTime * 0.1), snoise(vTile.zxy * 0.03 - uTime * 0.08), snoise(vTile.yzx * 0.03)));
          vec3 R = reflect(-V, wn);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
          float glint = pow(max(dot(R, L), 0.0), mix(1200.0, 90.0, smoothstep(0.0, 2.0e6, dist)));
          c = mix(c, vec3(0.2, 0.34, 0.55) * 0.4 * smoothstep(-0.2, 0.3, dayside), fres * 0.55);
          c += sun * glint * shadow * mix(5.0, 1.0, smoothstep(0.0, 2.0e6, dist));
        }
        // City lights on the night side: dense near coasts and in green, low lands.
        float night = smoothstep(0.06, -0.14, dayside);
        if (!water && night > 0.0 && h < 1800.0) {
          float green = smoothstep(0.02, 0.1, col.g - col.b * 0.6) * (1.0 - smoothstep(0.35, 0.6, dot(col, vec3(0.33))));
          float cl = smoothstep(0.55, 0.85, snoise(vDirF * 900.0) * 0.5 + 0.5) * 0.7 + smoothstep(0.75, 0.95, snoise(vDirF * 160.0) * 0.5 + 0.5);
          float grain = smoothstep(0.3, 0.8, snoise(vDirF * 24000.0) * 0.5 + 0.5);
          c += vec3(1.0, 0.7, 0.36) * clamp(cl, 0.0, 1.0) * grain * green * night * 0.8;
        }
        c = c * vTr + vIn;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
}

/** Airless rocky bodies: colour map (or grey), Lommel-Seeliger look, close-up rock detail. */
export function rockyMaterial(id, quality, colorMap) {
  const air = !!ATMO[id];
  const uniforms = {
    ...(air ? atmosphereUniforms(id) : { uPlanet: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(1, 0, 0) } }),
    uSunLight: { value: id === 'mars' ? 2.4 : 2.2 },
    uShine: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(id === 'mercury' ? 0x8f8a84 : 0xffffff) },
    uHasMap: { value: colorMap ? 1 : 0 },
    tColor: colorMap ? planetTexture(colorMap) : { value: null },
    tRock: getMaterialTexture('rock'),
  };
  return finish(new THREE.ShaderMaterial({
    uniforms,
    defines: { DETAIL: quality !== 'low' ? 1 : 0, STEPS: 3, MARS: id === 'mars' ? 1 : 0 },
    vertexShader: TERRAIN_VERTEX(air),
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${EQUIRECT_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform vec3 uShine;
      uniform vec3 uTint;
      uniform float uHasMap;
      uniform sampler2D tColor;
      uniform sampler2D tRock;
      ${LOGDEPTH_F}
      ${TERRAIN_VARYINGS}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDirW);
        vec3 N = normalize(vNormal);
        vec3 V = normalize(-vWorld);
        float dist = length(vWorld);
        vec3 col = uTint * 0.55;
        if (uHasMap > 0.5) col = equirect(tColor, normalize(vDirF)).rgb;
        float n1 = snoise(vDirF * 1800.0) * 0.5 + 0.5;
        col *= 0.86 + 0.28 * n1;
        float slope = 1.0 - dot(N, D);
        col *= 1.0 + smoothstep(0.08, 0.3, slope) * 0.12;
        #if DETAIL
        float near = 1.0 - smoothstep(400.0, 4000.0, dist);
        if (near > 0.001) {
          vec3 w = abs(N); w = pow(w, vec3(4.0)); w /= dot(w, vec3(1.0));
          vec3 t = tri(tRock, vTile / 7.0, w);
          col *= mix(1.0, 0.4 + dot(t, vec3(0.333)) * 1.3, near * 0.8);
        }
        #endif
        vec3 L = uSunDir;
        float ndl = max(dot(N, L), 0.0);
        float ndv = max(dot(N, V), 0.05);
        float ls = 2.0 * ndl / (ndl + ndv);
        float lit = mix(ndl, ls * 0.5, MARS > 0 ? 0.15 : 0.45);
        vec3 c = col * (vSun * uSunLight * lit + uShine * max(dot(N, -normalize(vWorld)), 0.0) * 0.3 + vec3(0.003));
        c = c * vTr + vIn;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
}

export function cloudMaterial(quality, cloudCube) {
  const uniforms = {
    ...atmosphereUniforms('earth'),
    uSunLight: { value: 2.4 },
    uCloudRot: { value: new THREE.Matrix3() },
    uCloudCover: { value: 0.55 },
    uTime: { value: 0 },
    uBelow: { value: 0 },
    tClouds: { value: cloudCube },
  };
  return finish(new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    defines: { STEPS: quality === 'low' ? 2 : 3 },
    vertexShader: TERRAIN_VERTEX(true),
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uSunDir;
      uniform float uSunLight;
      uniform mat3 uCloudRot;
      uniform float uCloudCover;
      uniform float uTime;
      uniform float uBelow;
      uniform samplerCube tClouds;
      ${LOGDEPTH_F}
      ${TERRAIN_VARYINGS}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 D = normalize(vDirW);
        float dist = length(vWorld);
        float c = textureCube(tClouds, uCloudRot * normalize(vDirF)).r;
        float fine = snoise(vDirF * 9000.0 + uTime * 0.002) * (1.0 - smoothstep(30000.0, 400000.0, dist));
        float a = smoothstep(0.52, 0.78, c + fine * 0.08) * uCloudCover * 1.4;
        a *= smoothstep(150.0, 2500.0, dist);
        if (a < 0.003) discard;
        float dayside = dot(D, uSunDir);
        float thick = smoothstep(0.55, 0.85, c);
        float lit = mix(0.55, 1.0, smoothstep(-0.1, 0.4, dayside)) * mix(1.0, 0.62 - thick * 0.2, uBelow);
        vec3 col = vSun * uSunLight * 0.42 * lit * smoothstep(-0.12, 0.08, dayside) + vec3(0.02, 0.025, 0.04) * smoothstep(-0.3, 0.2, dayside);
        col = col * vTr + vIn * 0.6;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
}

/** Sky / limb shell: rays that miss the ground (terrain draws its own aerial perspective). */
export function createAtmosphereShell(id, quality) {
  const uniforms = atmosphereUniforms(id);
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    defines: { STEPS: quality === 'high' ? 14 : quality === 'low' ? 6 : 10 },
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      ${LOGDEPTH_F}
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 rd = normalize(vWorld);
        vec3 r0 = -uPlanet;
        vec2 ground = rsi(r0, rd, uR);
        float tMax = ground.x > 0.0 && ground.x < ground.y ? ground.x : 1e12;
        vec3 tr;
        vec3 inS = scatter(r0, rd, tMax, STEPS, tr);
        float alpha = clamp(1.0 - (tr.r + tr.g + tr.b) / 3.0, 0.0, 1.0);
        gl_FragColor = vec4(inS, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, quality === 'low' ? 64 : 96, quality === 'low' ? 32 : 48), material);
  mesh.scale.setScalar(uniforms.uAtmR.value);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

/** Textured sphere for bodies seen only from afar (Venus, gas giants) and the Sun. */
function sphereMaterial(id, map) {
  const b = BODIES[id];
  const star = id === 'sun';
  const tints = { venus: 0xe8d9a8, jupiter: 0xd9c2a0, saturn: 0xe3d2a4, uranus: 0x9fd7df, neptune: 0x5577d8, sun: 0xffffff };
  return new THREE.ShaderMaterial({
    uniforms: {
      tColor: map ? planetTexture(map) : { value: null },
      uHasMap: { value: map ? 1 : 0 },
      uTint: { value: new THREE.Color(tints[id] || 0xcccccc) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uStar: { value: star ? 1 : 0 },
      uHaze: { value: new THREE.Color(id === 'venus' ? 0xfff0c8 : id === 'neptune' ? 0x88aaff : id === 'uranus' ? 0xc8f4ff : 0xfff2dc) },
    },
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V}
      varying vec3 vN;
      varying vec3 vF;
      varying vec3 vV;
      void main() {
        vF = vec3(position.x, -position.z, position.y);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * position);
        vV = -wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${EQUIRECT_GLSL}
      uniform sampler2D tColor;
      uniform float uHasMap;
      uniform vec3 uTint;
      uniform vec3 uSunDir;
      uniform float uStar;
      uniform vec3 uHaze;
      ${LOGDEPTH_F}
      varying vec3 vN;
      varying vec3 vF;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 F = normalize(vF);
        vec3 N = normalize(vN);
        vec3 V = normalize(vV);
        vec3 col = uTint * (0.85 + 0.15 * snoise(vec3(F.z * 30.0, F.x * 2.0, F.y * 2.0)));
        if (uHasMap > 0.5) col = equirect(tColor, F).rgb;
        float mu = max(dot(N, V), 0.0);
        if (uStar > 0.5) {
          // Limb darkening and granulation.
          vec3 sc = vec3(1.0, 0.93, 0.82) * (0.45 + 0.55 * pow(mu, 0.45)) * (0.92 + 0.08 * snoise(F * 400.0));
          gl_FragColor = vec4(sc * 30.0, 1.0);
        } else {
          float ndl = max(dot(N, uSunDir), 0.0);
          float rim = pow(1.0 - mu, 3.0);
          vec3 c = col * ndl * 2.4 + uHaze * rim * smoothstep(-0.2, 0.4, dot(N, uSunDir)) * 0.6;
          gl_FragColor = vec4(c, 1.0);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function ringMaterial(b) {
  return new THREE.ShaderMaterial({
    uniforms: { uInner: { value: b.rings.inner }, uOuter: { value: b.rings.outer }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uPlanet: { value: new THREE.Vector3() }, uR: { value: b.radius } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V}
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uInner;
      uniform float uOuter;
      uniform vec3 uSunDir;
      uniform vec3 uPlanet;
      uniform float uR;
      ${LOGDEPTH_F}
      varying vec3 vLocal;
      varying vec3 vWorld;
      float band(float r, float a, float b) { return smoothstep(a, a + 400e3, r) * (1.0 - smoothstep(b - 400e3, b, r)); }
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vLocal.xy);
        // C ring, B ring, Cassini division, A ring with the Encke gap, F ring.
        float a = band(r, 74.5e6, 92e6) * 0.18 + band(r, 92e6, 117.5e6) * 0.85 + band(r, 122e6, 136.8e6) * 0.6 + band(r, 140.1e6, 140.6e6) * 0.5;
        a *= 1.0 - (smoothstep(133.3e6, 133.5e6, r) * (1.0 - smoothstep(133.7e6, 133.9e6, r)));
        a *= 0.85 + 0.15 * sin(r * 1.7e-6) * sin(r * 0.43e-6);
        if (a < 0.01) discard;
        // Shadow of the planet on the rings.
        vec3 p = vWorld - uPlanet;
        float b = dot(p, uSunDir);
        float d2 = dot(p, p) - b * b;
        float sh = b < 0.0 && d2 < uR * uR ? 0.15 : 1.0;
        vec3 col = vec3(0.9, 0.82, 0.68) * sh * 1.6;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Build the visual for every body. Returns { [id]: view } where view has a `group` rotated
 * with the body and optional lod / clouds / atmosphere / sphere members.
 */
export function createBodies(scene, renderer, profile, builder) {
  const q = profile.quality;
  const cloudRT = bakeCube(renderer, q === 'low' ? 512 : 1024, CLOUD_BAKE);
  const views = {};
  const lodBody = (id, material, maxLevel, extra = {}) => {
    const b = BODIES[id];
    const group = new THREE.Group();
    group.name = id;
    scene.add(group);
    const lod = new PlanetLOD(group, { kind: id, radius: b.radius, material, res: profile.lodRes, maxLevel, split: profile.split, builder, terrain: b.terrain.flat ? null : b.terrain, ocean: !!b.ocean, cacheSize: 1100 });
    views[id] = { id, body: b, group, lod, material, ...extra };
    return views[id];
  };
  const earth = lodBody('earth', earthMaterial(q, cloudRT.texture), 16);
  earth.cloudMat = cloudMaterial(q, cloudRT.texture);
  earth.cloudAlt = 8000;
  earth.clouds = new PlanetLOD(earth.group, { kind: 'flat', radius: BODIES.earth.radius + earth.cloudAlt, material: earth.cloudMat, res: 16, maxLevel: 11, split: 1.8, builder, renderOrder: 8, cacheSize: 500 });
  earth.atmosphere = createAtmosphereShell('earth', q);
  scene.add(earth.atmosphere);
  lodBody('moon', rockyMaterial('moon', q, 'moon_color.jpg'), 15);
  const mars = lodBody('mars', rockyMaterial('mars', q, 'mars_color.jpg'), 15);
  mars.atmosphere = createAtmosphereShell('mars', q);
  scene.add(mars.atmosphere);
  lodBody('mercury', rockyMaterial('mercury', q, null), 13);
  for (const [id, map] of [['venus', null], ['jupiter', 'jupiter.jpg'], ['saturn', 'saturn.jpg'], ['uranus', null], ['neptune', 'neptune.jpg'], ['sun', null]]) {
    const b = BODIES[id];
    const group = new THREE.Group();
    group.name = id;
    scene.add(group);
    const material = sphereMaterial(id, map);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 96, 48), material);
    sphere.frustumCulled = false;
    group.add(sphere);
    views[id] = { id, body: b, group, sphere, material };
    if (b.rings) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(b.rings.inner, b.rings.outer, 256, 4), ringMaterial(b));
      ring.rotation.x = -Math.PI / 2; // into the equatorial plane (three x / −z)
      ring.renderOrder = 9;
      group.add(ring);
      views[id].ring = ring;
    }
  }
  // Point sprites so bodies smaller than a pixel still show as bright dots.
  const ids = Object.keys(views);
  const pos = new Float32Array(ids.length * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dots = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: getGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true }));
  const colors = new Float32Array(ids.length * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  dots.frustumCulled = false;
  dots.renderOrder = -5;
  scene.add(dots);
  return { views, cloudRT, dots, dotIds: ids };
}
