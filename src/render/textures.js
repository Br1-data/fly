// Textures: tiling ground materials from assets/textures, lens flare sprites and small
// procedural canvases for spacecraft details. All generated locally.
import * as THREE from 'three';

const materialTextures = new Map();
export function getMaterialTexture(name) {
  if (materialTextures.has(name)) return materialTextures.get(name);
  const normal = name.endsWith('_normal');
  const placeholder = new THREE.DataTexture(new Uint8Array(normal ? [128, 128, 255, 255] : [255, 255, 255, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniform = { value: placeholder };
  materialTextures.set(name, uniform);
  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load(new URL(`../../assets/textures/${name}.jpg`, import.meta.url).href, (texture) => {
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

/** Canvas texture drawn by `paint(ctx, w, h)`; sRGB colour unless `data` is true. */
export function canvasTexture(w, h, paint, { data = false, repeat = false } = {}) {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let glowTexture = null;
/** Soft round glow (white, premultiplied) for lights, puffs and plasma. */
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(u, v);
      const a = Math.max(0, Math.min(1, Math.exp(-r * r * 5) - 0.007 * (r > 0.98 ? 1 : 0)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  glowTexture = new THREE.DataTexture(data, size, size);
  glowTexture.magFilter = THREE.LinearFilter;
  glowTexture.minFilter = THREE.LinearMipmapLinearFilter;
  glowTexture.generateMipmaps = true;
  glowTexture.needsUpdate = true;
  return glowTexture;
}
