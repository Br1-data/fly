// Loads the real elevation maps (assets/planets/*.png, 16-bit heights packed in the red
// and green channels) and installs them in the terrain models. Browser: fetch + canvas;
// Node (tests): fs + zlib with a small PNG decoder. Workers receive the decoded arrays.
import { BODIES } from './system.js';

let loaded = null;

function decodeHeights(rgba, width, height, channels, info) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * channels], g = rgba[i * channels + 1];
    out[i] = (r * 256 + g) / info.scale - info.offset;
  }
  return { width, height, data: out };
}

/** Install decoded maps { earth, moon, mars } into the terrain models. */
export function installPlanetData(maps) {
  for (const [id, map] of Object.entries(maps)) BODIES[id]?.terrain?.setHeightmap?.(map);
  loaded = maps;
  return maps;
}

export function planetDataLoaded() {
  return !!loaded;
}

export function planetMaps() {
  return loaded;
}

/** Browser loader. `base` is the URL of the assets/planets/ folder. */
export async function loadPlanetData(base = new URL('../../assets/planets/', import.meta.url).href) {
  if (loaded) return loaded;
  const manifest = await (await fetch(new URL('planets.json', base))).json();
  const maps = {};
  await Promise.all(Object.entries(manifest).map(async ([id, info]) => {
    const blob = await (await fetch(new URL(info.file, base))).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    maps[id] = decodeHeights(px, bmp.width, bmp.height, 4, info);
  }));
  return installPlanetData(maps);
}

/** Node loader (tests, tools): reads and decodes the PNG files with zlib. */
export async function loadPlanetDataNode(dir) {
  if (loaded) return loaded;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const zlib = await import('node:zlib');
  const folder = dir || path.join(path.dirname(new URL(import.meta.url).pathname), '../../assets/planets');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'planets.json'), 'utf8'));
  const maps = {};
  for (const [id, info] of Object.entries(manifest)) {
    const png = decodePng(fs.readFileSync(path.join(folder, info.file)), zlib);
    maps[id] = decodeHeights(png.data, png.width, png.height, png.channels, info);
  }
  return installPlanetData(maps);
}

/** Minimal PNG decoder: 8-bit greyscale / RGB / RGBA, non-interlaced. */
export function decodePng(buf, zlib) {
  let p = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG non supportato');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error('PNG: tipo di colore non supportato');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}
