// Pure terrain-tile generator: heights, land-cover colours, shader weights, normals, skirts and
// tree instances as typed arrays. It has no three.js or DOM dependency, so the same code runs
// inside the terrain Web Worker (keeping the main thread free while tiles stream in) and on
// the main thread as a fallback (Node tests, browsers without module workers).
import { getTerrain, rectDist } from '../world/terrain-height.js';
import { clamp, hash2, smoothstep } from '../core/math.js';

export const TILE = 6000;

// sRGB hex -> linear RGB, matching three.js colour management.
const toLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const hexLinear = (hex) => [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
const PALETTE = Object.fromEntries(Object.entries({
  beach: 0xd8c99c, meadow: 0x6c8a42, dry: 0x9b9858, scrub: 0x5a6b3a,
  alpine: 0x7b8452, forest: 0x2e4a28, pine: 0x263f2c, town: 0xa39a89,
  rock: 0x8e877c, darkRock: 0x655f58, snow: 0xf0f3f6,
  seabedShallow: 0xd9cfa3, seabedMid: 0x6aa197, seabedDeep: 0x0c3a4a,
}).map(([k, v]) => [k, hexLinear(v)]));

function lerp3(c, target, t) {
  c[0] += (target[0] - c[0]) * t;
  c[1] += (target[1] - c[1]) * t;
  c[2] += (target[2] - c[2]) * t;
}

/** Land-cover colour (linear RGB) and shader weights at one vertex. */
function shade(t, n, e, h, slope, color, extra, cover) {
  const lake = t.lakeLevel(n, e);
  const depth = h < 0 ? -h : lake !== null && h < lake ? lake - h : -1;
  if (depth >= 0) {
    color[0] = PALETTE.seabedShallow[0]; color[1] = PALETTE.seabedShallow[1]; color[2] = PALETTE.seabedShallow[2];
    lerp3(color, PALETTE.seabedMid, smoothstep(0.4, 7, depth));
    lerp3(color, PALETTE.seabedDeep, smoothstep(7, 32, depth));
    extra[0] = extra[1] = extra[2] = extra[3] = 0;
    cover[0] = cover[1] = 0;
    cover[2] = 1;
    return;
  }
  const forest = t.forestFactor(n, e, h, slope);
  const city = t.cityFactor(n, e);
  const variation = t.noiseDetail(n, e, 4200);
  color[0] = PALETTE.meadow[0]; color[1] = PALETTE.meadow[1]; color[2] = PALETTE.meadow[2];
  lerp3(color, PALETTE.dry, clamp(0.45 + variation * 0.55, 0, 1));
  lerp3(color, PALETTE.scrub, smoothstep(350, 900, h) * 0.6);
  lerp3(color, PALETTE.alpine, smoothstep(1150, 1650, h) * 0.7);
  lerp3(color, h > 800 ? PALETTE.pine : PALETTE.forest, forest * 0.92);
  lerp3(color, PALETTE.beach, 1 - smoothstep(1.2, 4.5, h));
  lerp3(color, PALETTE.town, clamp(city * 1.3, 0, 0.8));
  const rock = clamp(smoothstep(0.34, 0.95, slope) + smoothstep(1650, 2000, h + variation * 140), 0, 1);
  if (rock > 0) lerp3(color, variation > 0 ? PALETTE.rock : PALETTE.darkRock, rock * 0.92);
  const snow = smoothstep(1950, 2150, h + variation * 160) * (1 - smoothstep(0.75, 1.1, slope));
  if (snow > 0) lerp3(color, PALETTE.snow, snow);
  let airport = 1;
  for (const flat of t.flats) {
    const r = flat.rect;
    if (Math.abs(n - r.n) + Math.abs(e - r.e) > r.length + r.width + 600) continue;
    airport *= smoothstep(150, 500, rectDist(n, e, r));
  }
  const farmland = smoothstep(-0.3, 0.1, t.noiseDetail(n, e, 11000));
  extra[0] = farmland * (1 - forest) * (1 - smoothstep(380, 650, h)) * (1 - smoothstep(0.12, 0.3, slope))
    * smoothstep(2.5, 6, h) * (1 - clamp(city * 2.5, 0, 1)) * (1 - rock) * airport;
  extra[1] = forest * (1 - rock) * (1 - snow);
  extra[2] = t.fieldAngle(n, e);
  extra[3] = clamp(city * 1.6, 0, 1);
  cover[0] = rock;
  cover[1] = snow;
  cover[2] = (1 - smoothstep(1.2, 4.5, h)) * (1 - rock);
}

/**
 * Builds one tile. Positions are world coordinates (three.js frame: x = east, y = up,
 * z = south), exact because tile offsets and grid steps are binary fractions.
 * @returns {{positions, colors, terrain, cover, normals, index, trees}} typed arrays
 */
export function buildTileData({ nn, ee, segments, treeSamples = 0, treeDensity = 1 }) {
  const t = getTerrain();
  const n0 = nn * TILE, e0 = ee * TILE;
  const side = segments + 1;
  const step = TILE / segments;
  const surface = side * side;
  const skirt = 4 * side * 2;
  const count = surface + skirt;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const terrain = new Float32Array(count * 4);
  const cover = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const heights = new Float64Array(surface);
  // Surface grid: row = southward step from the north edge, col = eastward step.
  for (let row = 0; row < side; row++) {
    const z = row * step - TILE / 2;
    for (let col = 0; col < side; col++) {
      const x = col * step - TILE / 2;
      const i = row * side + col;
      const h = t.height(n0 - z, e0 + x);
      heights[i] = h;
      positions[i * 3] = e0 + x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z - n0;
    }
  }
  // Heights one step beyond the tile give seam-consistent slopes and normals at the edges.
  const heightAt = (row, col) => (row >= 0 && row <= segments && col >= 0 && col <= segments
    ? heights[row * side + col]
    : t.height(n0 + TILE / 2 - row * step, e0 - TILE / 2 + col * step));
  const color = [0, 0, 0], extra = [0, 0, 0, 0], cov = [0, 0, 0];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const i = row * side + col;
      const gx = (heightAt(row, col + 1) - heightAt(row, col - 1)) / (2 * step);
      const gn = (heightAt(row - 1, col) - heightAt(row + 1, col)) / (2 * step);
      shade(t, n0 + TILE / 2 - row * step, e0 - TILE / 2 + col * step, heights[i], Math.hypot(gx, gn), color, extra, cov);
      colors.set(color, i * 3);
      terrain.set(extra, i * 4);
      cover.set(cov, i * 3);
      // Smooth normal from central differences (x = east, z = south).
      const l = Math.hypot(gx, 1, gn);
      normals[i * 3] = -gx / l;
      normals[i * 3 + 1] = 1 / l;
      normals[i * 3 + 2] = gn / l;
    }
  }
  // Skirts: a strip hanging 250 m below each edge, sloping slightly under the tile so it also
  // covers sub-pixel cracks seen from above; the top sits 0.2 m low to avoid depth fighting.
  const edges = [[], [], [], []];
  for (let i = 0; i <= segments; i++) {
    edges[0].push(i);
    edges[1].push(i * side + segments);
    edges[2].push(side * segments + segments - i);
    edges[3].push((segments - i) * side);
  }
  const inward = [[0, 8], [-8, 0], [0, -8], [8, 0]];
  const index = new Uint32Array(segments * segments * 6 + 4 * segments * 6);
  let k = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * side + col, b = (row + 1) * side + col, c = b + 1, d = a + 1;
      index[k++] = a; index[k++] = b; index[k++] = d;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  let v = surface;
  edges.forEach((edge, s) => {
    const start = v;
    const [ix, iz] = inward[s];
    for (const i of edge) {
      for (let copy = 0; copy < 2; copy++) {
        positions[v * 3] = positions[i * 3] + (copy ? ix : 0);
        positions[v * 3 + 1] = positions[i * 3 + 1] - (copy ? 250 : 0.2);
        positions[v * 3 + 2] = positions[i * 3 + 2] + (copy ? iz : 0);
        colors.copyWithin(v * 3, i * 3, i * 3 + 3);
        terrain.copyWithin(v * 4, i * 4, i * 4 + 4);
        cover.copyWithin(v * 3, i * 3, i * 3 + 3);
        normals.copyWithin(v * 3, i * 3, i * 3 + 3);
        v++;
      }
    }
    for (let j = 0; j < edge.length - 1; j++) {
      const a = start + j * 2;
      index[k++] = a; index[k++] = a + 1; index[k++] = a + 2;
      index[k++] = a + 1; index[k++] = a + 3; index[k++] = a + 2;
    }
  });
  return { positions, colors, terrain, cover, normals, index: count < 65536 ? Uint16Array.from(index) : index, trees: treeSamples ? buildTrees(t, n0, e0, nn, ee, treeSamples * treeDensity) : null };
}

/** Tree instances: local 4×4 matrices (column-major, relative to the tile centre) and colours. */
function buildTrees(t, n0, e0, nn, ee, samples) {
  const sets = { conifer: { matrices: [], colors: [] }, broadleaf: { matrices: [], colors: [] } };
  for (let j = 0; j < samples; j++) {
    const n = n0 + (hash2(nn * 281 + j, ee * 17) - 0.5) * TILE;
    const e = e0 + (hash2(nn * 53, ee * 109 + j) - 0.5) * TILE;
    const h = t.height(n, e);
    if (h < 6 || h > 1900 || t.airportSurface(n, e)) continue;
    const r1 = hash2(nn + j * 7, ee), r2 = hash2(j, nn * 31 + ee), r3 = hash2(ee * 13 + j, nn);
    const forest = t.forestFactor(n, e, h, 0);
    let conifer, height, width;
    if (forest >= 0.3) {
      conifer = h > 650 || r2 < 0.22;
      height = conifer ? 11 + r1 * 13 : 8 + r1 * 8;
      width = height * (conifer ? 0.42 : 0.75);
    } else if (r3 < 0.07 && h < 650 && t.cityFactor(n, e) < 0.15) {
      // Scattered Mediterranean trees in the open country: slender cypresses and olives.
      conifer = r2 < 0.45;
      height = conifer ? 10 + r1 * 8 : 5 + r1 * 3;
      width = conifer ? height * 0.2 : height * 1.1;
    } else continue;
    const angle = r3 * 6.28, c = Math.cos(angle), s = Math.sin(angle);
    const sx = width, sy = height, sz = width * (0.85 + r2 * 0.3);
    const set = sets[conifer ? 'conifer' : 'broadleaf'];
    set.matrices.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, e - e0, h - 0.4, -(n - n0), 1);
    const shadeK = 0.75 + r1 * 0.35;
    const rgb = conifer ? [0.2 * shadeK, 0.3 * shadeK, 0.2 * shadeK] : [(0.29 + r2 * 0.1) * shadeK, (0.38 + r3 * 0.07) * shadeK, 0.19 * shadeK];
    set.colors.push(...rgb.map(toLinear));
  }
  const pack = (set) => ({ matrices: new Float32Array(set.matrices), colors: new Float32Array(set.colors) });
  return { conifer: pack(sets.conifer), broadleaf: pack(sets.broadleaf) };
}

/** Transferable buffers of a tile result (for postMessage). */
export function tileTransfers(data) {
  const list = [data.positions, data.colors, data.terrain, data.cover, data.normals, data.index];
  if (data.trees) for (const set of [data.trees.conifer, data.trees.broadleaf]) list.push(set.matrices, set.colors);
  return list.map((a) => a.buffer);
}
