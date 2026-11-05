// Shared GLSL: 3D simplex noise and single-scattering atmosphere (Rayleigh + Mie).
// All positions in the shaders are camera-relative (floating origin), in metres.

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * snoise(p);
    n += a;
    a *= 0.5;
    p *= 2.03;
  }
  return s / n;
}
`;

/**
 * Atmosphere uniforms (per body with an atmosphere). uPlanet: centre relative to the
 * camera (three axes). Radii in metres.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uPlanet;
uniform float uR;
uniform float uAtmR;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform vec3 uMieColor;
uniform float uHR;
uniform float uHM;
uniform float uSunPower;
uniform vec3 uSunDir;
#define PI_A 3.14159265
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float b = dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e12, -1e12);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
// Optical depth (Rayleigh, Mie) from p towards the sun, three samples; large if the planet blocks.
vec2 sunDepth(vec3 p) {
  vec2 ps = rsi(p, uSunDir, uR * 0.9995);
  if (ps.x > 0.0) return vec2(1e9);
  float lt = rsi(p, uSunDir, uAtmR).y;
  float ds = lt / 3.0;
  vec2 od = vec2(0.0);
  for (int j = 0; j < 3; j++) {
    vec3 q = p + uSunDir * (ds * (float(j) + 0.5));
    float hq = max(length(q) - uR, 0.0);
    od += exp(-hq / vec2(uHR, uHM)) * ds;
  }
  return od;
}
// Inscattered light along r0 + rd * [0, tMax] (r0 relative to the planet centre).
vec3 scatter(vec3 r0, vec3 rd, float tMax, int steps, out vec3 tr) {
  tr = vec3(1.0);
  vec2 a = rsi(r0, rd, uAtmR);
  if (a.x > a.y) return vec3(0.0);
  float t0 = max(a.x, 0.0);
  float t1 = min(a.y, tMax);
  if (t1 <= t0) return vec3(0.0);
  float ds = (t1 - t0) / float(steps);
  float mu = dot(rd, uSunDir);
  float pr = 3.0 / (16.0 * PI_A) * (1.0 + mu * mu);
  float g = 0.76;
  float pm = 3.0 / (8.0 * PI_A) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  vec3 totR = vec3(0.0), totM = vec3(0.0);
  vec2 od = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    vec3 p = r0 + rd * (t0 + ds * (float(i) + 0.5));
    float h = max(length(p) - uR, 0.0);
    vec2 dd = exp(-h / vec2(uHR, uHM)) * ds;
    od += dd;
    vec2 ls = sunDepth(p);
    vec3 att = exp(-(uBetaR * (od.x + ls.x) + uBetaM * uMieColor * 1.1 * (od.y + ls.y)));
    totR += dd.x * att;
    totM += dd.y * att;
  }
  tr = exp(-(uBetaR * od.x + uBetaM * uMieColor * 1.1 * od.y));
  return uSunPower * (pr * uBetaR * totR + pm * uBetaM * uMieColor * totM);
}
// Colour of direct sunlight reaching p (relative to the planet centre).
vec3 sunlightAt(vec3 p) {
  vec2 od = sunDepth(p);
  return exp(-(uBetaR * od.x + uBetaM * uMieColor * 1.1 * od.y));
}
`;

/** Equirectangular lookup by a body-fixed direction (sim axes), seam-safe mip selection. */
export const EQUIRECT_GLSL = /* glsl */ `
vec4 equirect(sampler2D t, vec3 d) {
  float lon = atan(d.y, d.x);
  float lat = asin(clamp(d.z, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 + lat / 3.1415927);
  vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
  return textureGrad(t, uv, dx, dy);
}
`;
