// Procedural textures generated in plain JavaScript (no DOM): they are shared by the terrain,
// water, clouds and light sprites, and also work in the Node test environment.
import * as THREE from 'three';
import { rng } from '../core/math.js';

/** Periodic value noise on a size×size grid with `cells` lattice cells per side. */
function periodicNoise(size, cells, seed) {
  const r = rng(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = r();
  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale, iy = Math.floor(fy), ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells, y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * scale, ix = Math.floor(fx), tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = lattice[y0 + x0] + (lattice[y0 + x1] - lattice[y0 + x0]) * sx;
      const b = lattice[y1 + x0] + (lattice[y1 + x1] - lattice[y1 + x0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** Tileable fractal noise in [0, 1]. */
export function periodicFbm(size, baseCells, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves && cells <= size; o++) {
    const layer = periodicNoise(size, cells, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= gain;
    cells *= 2;
  }
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  // Stretch to the full range so the shaders get predictable contrast.
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / span;
  return out;
}

function dataTexture(data, size, { repeat = true, mipmaps = true, colorSpace = THREE.NoColorSpace } = {}) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.anisotropy = 4;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

let detailTexture = null;
/**
 * Ground detail noise (tileable, 256²):
 * R = fine grain, G = medium blotches, B = clumpy canopy cells, A = soft macro variation.
 */
export function getDetailTexture() {
  if (detailTexture) return detailTexture;
  const size = 256;
  const r = periodicFbm(size, 8, 5, 11, 0.55);
  const g = periodicFbm(size, 4, 4, 23, 0.5);
  const b = periodicFbm(size, 32, 3, 37, 0.45);
  const a = periodicFbm(size, 2, 3, 41, 0.5);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const clump = Math.min(1, Math.max(0, (b[i] - 0.35) * 2.2));
    data[i * 4] = r[i] * 255;
    data[i * 4 + 1] = g[i] * 255;
    data[i * 4 + 2] = clump * 255;
    data[i * 4 + 3] = a[i] * 255;
  }
  detailTexture = dataTexture(data, size);
  return detailTexture;
}

let waterNormals = null;
/** Tileable normal map for small wind waves (xy = slope, z = up). */
export function getWaterNormalTexture() {
  if (waterNormals) return waterNormals;
  const size = 256;
  const h1 = periodicFbm(size, 8, 5, 77, 0.55);
  const h2 = periodicFbm(size, 16, 3, 91, 0.5);
  const height = new Float32Array(size * size);
  // Ridged component makes the crests sharper than the troughs, like real wind waves.
  for (let i = 0; i < height.length; i++) height[i] = 1 - Math.abs(h1[i] * 2 - 1) * 0.8 + h2[i] * 0.35;
  const data = new Uint8Array(size * size * 4);
  const k = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)], rr = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x], u = height[((y + 1) % size) * size + x];
      const nx = (l - rr) * k, ny = (d - u) * k, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = (nx / len * 0.5 + 0.5) * 255;
      data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  waterNormals = dataTexture(data, size);
  return waterNormals;
}

let cloudTexture = null;
/** 2×2 atlas of soft cumulus puffs (white, alpha = density). */
export function getCloudTexture() {
  if (cloudTexture) return cloudTexture;
  const size = 256, half = 128;
  const noise = periodicFbm(size, 8, 5, 503, 0.55);
  const fine = periodicFbm(size, 32, 2, 811, 0.5);
  const data = new Uint8Array(size * size * 4);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * half, oy = Math.floor(tile / 2) * half;
    const r = rng(1000 + tile);
    // A few overlapping lobes per puff give irregular, cauliflower-like outlines.
    const lobes = [{ x: 0, y: 0.05, r: 0.5 }];
    for (let j = 0; j < 5; j++) lobes.push({ x: (r() - 0.5) * 0.7, y: (r() - 0.5) * 0.5, r: 0.22 + r() * 0.22 });
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const u = (x + 0.5) / half * 2 - 1, v = (y + 0.5) / half * 2 - 1;
        // Overlapping gaussian lobes eroded by noise: soft, irregular, never ball-shaped.
        let d = 0;
        for (const lobe of lobes) {
          const q = Math.hypot(u - lobe.x, v - lobe.y) / lobe.r;
          d += Math.exp(-q * q * 1.6) * 0.75;
        }
        const n = noise[(oy + y) * size + ox + x], f = fine[(oy + y) * size + ox + x];
        const edge = Math.min(1, Math.max(0, (1 - Math.hypot(u, v)) * 3));
        let density = (Math.min(d, 1.2) - 0.18 + (n - 0.5) * 0.9 + (f - 0.5) * 0.35) * edge;
        density = Math.min(1, Math.max(0, density * 1.25));
        const i = ((oy + y) * size + ox + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        // Brightness channel: denser cores are slightly darker (self shadowing).
        data[i + 1] = (0.75 + 0.25 * (1 - density)) * 255;
        data[i + 3] = density * density * (3 - 2 * density) * 255;
      }
    }
  }
  cloudTexture = dataTexture(data, size, { repeat: false });
  return cloudTexture;
}

let tireTexture = null;
/** Alpha texture of rubber deposits in the touchdown zone (u across, v along the runway). */
export function getTireMarkTexture() {
  if (tireTexture) return tireTexture;
  const w = 64, h = 256;
  const r = rng(907);
  const streaks = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    // Two main-gear tracks either side of the centreline plus random streaks.
    const tracks = Math.exp(-(((u - 0.3) / 0.1) ** 2)) + Math.exp(-(((u - 0.7) / 0.1) ** 2));
    streaks[x] = Math.min(1, tracks * (0.55 + r() * 0.45) + r() * 0.15);
  }
  const noise = periodicFbm(256, 4, 4, 913, 0.5);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const along = Math.min(1, v / 0.12) * Math.pow(1 - v, 1.3);
    for (let x = 0; x < w; x++) {
      const n = noise[(y % 256) * 256 + ((x * 4) % 256)];
      const a = Math.min(1, streaks[x] * along * (0.5 + n * 0.8));
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = a * 255;
      data[i + 3] = 255;
    }
  }
  tireTexture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tireTexture.wrapS = tireTexture.wrapT = THREE.ClampToEdgeWrapping;
  tireTexture.minFilter = THREE.LinearMipmapLinearFilter;
  tireTexture.magFilter = THREE.LinearFilter;
  tireTexture.generateMipmaps = true;
  tireTexture.anisotropy = 8;
  tireTexture.needsUpdate = true;
  return tireTexture;
}

const materialTextures = new Map();
/**
 * Uniform holding a photographic-style material texture from assets/textures (generated by
 * tools/make-textures.py). It starts as a neutral 1×1 placeholder (white, or a flat normal)
 * and switches to the real texture once loaded, so shaders never sample an empty texture.
 */
export function getMaterialTexture(name) {
  if (materialTextures.has(name)) return materialTextures.get(name);
  const normal = name.endsWith('_normal');
  const placeholder = new THREE.DataTexture(new Uint8Array(normal ? [128, 128, 255, 255] : [255, 255, 255, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniform = { value: placeholder };
  materialTextures.set(name, uniform);
  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load(`./assets/textures/${name}.jpg`, (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      texture.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.userData.shared = true;
      uniform.value = texture;
    });
  }
  return uniform;
}

let flareTextures = null;
/** Lens flare sprites: a starburst glare and a soft hexagonal ghost (premultiplied white). */
export function getFlareTextures() {
  if (flareTextures) return flareTextures;
  const make = (size, fn) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
        const a = Math.min(1, Math.max(0, fn(Math.hypot(u, v), Math.atan2(v, u))));
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = a * 255;
        data[i + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, size, size);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  const glare = make(256, (r, t) => {
    const core = Math.exp(-r * r * 60) * 1.2 + Math.exp(-r * 7) * 0.35;
    const rays = Math.pow(Math.abs(Math.cos(t * 3)), 40) * 0.5 + Math.pow(Math.abs(Math.cos(t * 7 + 0.4)), 60) * 0.25;
    return (core + rays * Math.exp(-r * 3.2)) * (1 - Math.min(1, r));
  });
  const ghost = make(128, (r, t) => {
    // Six-bladed aperture: a soft hexagon with a brighter rim.
    const hex = r * Math.cos(Math.PI / 6) / Math.cos(((t % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6);
    return (1 - Math.min(1, Math.max(0, (hex - 0.82) / 0.12))) * (0.35 + 0.65 * Math.min(1, hex * hex));
  });
  flareTextures = { glare, ghost };
  return flareTextures;
}
