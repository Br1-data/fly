// Geometry of one cube-sphere terrain chunk, built from the shared deterministic height
// functions. Pure function (no three.js): runs in a module worker or on the main thread.
// Output arrays are in three.js axes (x = sim x, y = sim z, z = −sim y) and relative to the
// chunk centre so that float32 keeps centimetre precision near the camera.
import { AusoniaTerrain, LucinaTerrain } from '../sim/terrain.js';
import { SITES } from '../sim/system.js';

// Face frames in simulation axes: normal N, then U and V spanning the face.
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

const terrains = {};
function terrainFor(body) {
  if (!terrains[body]) terrains[body] = body === 'lucina' ? new LucinaTerrain([SITES.lucerna]) : body === 'ausonia' ? new AusoniaTerrain([SITES.spaceport]) : null;
  return terrains[body];
}

/** Unit direction (sim axes) of face coordinates (a, b) in [-1, 1]. */
export function faceDir(face, a, b, out = [0, 0, 0]) {
  const [N, U, V] = FACES[face];
  const ta = Math.tan((a * Math.PI) / 4), tb = Math.tan((b * Math.PI) / 4);
  const x = N[0] + U[0] * ta + V[0] * tb, y = N[1] + U[1] * ta + V[1] * tb, z = N[2] + U[2] * ta + V[2] * tb;
  const l = Math.hypot(x, y, z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

const indexCache = new Map();
/** Shared triangle list for a grid of `res` segments plus skirts. */
export function chunkIndices(res) {
  if (indexCache.has(res)) return indexCache.get(res);
  const n = res + 1;
  const idx = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Skirts: one extra vertex below every edge vertex, in edge order.
  const base = n * n;
  const edges = [];
  for (let i = 0; i < n; i++) edges.push(i); // bottom row
  for (let j = 0; j < n; j++) edges.push(j * n + res); // right column
  for (let i = res; i >= 0; i--) edges.push(res * n + i); // top row
  for (let j = res; j >= 0; j--) edges.push(j * n); // left column
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k], b = edges[k + 1], sa = base + k, sb = base + k + 1;
    idx.push(a, sa, b, b, sa, sb);
  }
  const arr = new Uint16Array(idx);
  indexCache.set(res, { indices: arr, edges });
  return indexCache.get(res);
}

/**
 * Job: { body: 'ausonia'|'lucina'|'flat', face, x0, y0, size, res, radius, level }.
 * Returns { center: [x,y,z] (sim axes, metres from the body centre), position, normal, dir,
 * info, tile (Float32Array), radius (bounding sphere), minH, maxH }.
 */
export function buildChunk(job) {
  const { face, x0, y0, size, res, radius } = job;
  const terrain = terrainFor(job.body);
  const n = res + 1;
  const m = n + 2; // with a one-sample border for normals
  const step = size / res;
  // Crater octaves that are still larger than the vertex spacing.
  const spacing = (size * Math.PI * radius) / 4 / res;
  // Every level uses the full height function: shared edge vertices then agree exactly
  // between neighbouring levels of detail and only small cracks remain for the skirts.
  const octaves = undefined;
  const px = new Float64Array(m * m), py = new Float64Array(m * m), pz = new Float64Array(m * m);
  const hs = new Float32Array(m * m), moist = new Float32Array(m * m), maria = new Float32Array(m * m);
  const d = [0, 0, 0];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      faceDir(face, x0 + (i - 1) * step, y0 + (j - 1) * step, d);
      let h = 0, mo = 0, ma = 0;
      if (terrain) {
        if (job.body === 'lucina') {
          h = terrain.height(d[0], d[1], d[2], octaves);
          ma = terrain.maria(d[0], d[1], d[2]);
        } else {
          const s = terrain.sample(d[0], d[1], d[2]);
          h = s.h;
          mo = s.moisture;
        }
      }
      const k = j * m + i;
      hs[k] = h;
      moist[k] = mo;
      maria[k] = ma;
      // Oceans: the visible surface is the sea level.
      const r = radius + (job.body === 'ausonia' ? Math.max(h, 0) : h);
      px[k] = d[0] * r;
      py[k] = d[1] * r;
      pz[k] = d[2] * r;
    }
  }
  const ck = (Math.floor(m / 2)) * m + Math.floor(m / 2);
  const cx = px[ck], cy = py[ck], cz = pz[ck];
  const { edges } = chunkIndices(res);
  const vcount = n * n + edges.length;
  const position = new Float32Array(vcount * 3);
  const normal = new Float32Array(vcount * 3);
  const dir = new Float32Array(vcount * 3);
  const info = new Float32Array(vcount * 3);
  const tile = new Float32Array(vcount * 3);
  let maxR = 0, minH = Infinity, maxH = -Infinity;
  const write = (v, k) => {
    // Sim (x, y, z) → three (x, z, −y)
    const lx = px[k] - cx, ly = py[k] - cy, lz = pz[k] - cz;
    const ox = lx, oy = lz, oz = -ly;
    position[v * 3] = ox;
    position[v * 3 + 1] = oy;
    position[v * 3 + 2] = oz;
    const rl = Math.hypot(px[k], py[k], pz[k]);
    dir[v * 3] = px[k] / rl;
    dir[v * 3 + 1] = pz[k] / rl;
    dir[v * 3 + 2] = -py[k] / rl;
    info[v * 3] = hs[k];
    info[v * 3 + 1] = moist[k];
    info[v * 3 + 2] = maria[k];
    // Continuous tiling coordinates for close-up detail (period 32 km).
    tile[v * 3] = mod(px[k], 32768);
    tile[v * 3 + 1] = mod(pz[k], 32768);
    tile[v * 3 + 2] = mod(-py[k], 32768);
    const r2 = Math.hypot(ox, oy, oz);
    if (r2 > maxR) maxR = r2;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i, k = (j + 1) * m + (i + 1);
      write(v, k);
      if (hs[k] < minH) minH = hs[k];
      if (hs[k] > maxH) maxH = hs[k];
      // Normal from central differences on the bordered grid.
      const kx0 = k - 1, kx1 = k + 1, ky0 = k - m, ky1 = k + m;
      const ax = px[kx1] - px[kx0], ay = py[kx1] - py[kx0], az = pz[kx1] - pz[kx0];
      const bx = px[ky1] - px[ky0], by = py[ky1] - py[ky0], bz = pz[ky1] - pz[ky0];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      // Orient outwards.
      if (nx * px[k] + ny * py[k] + nz * pz[k] < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      normal[v * 3] = nx / nl;
      normal[v * 3 + 1] = nz / nl;
      normal[v * 3 + 2] = -ny / nl;
    }
  }
  // Skirts hang below the edges to hide cracks between levels of detail.
  // The cloud deck needs no skirts: they would show as bright seams through the haze.
  const skirt = job.body === 'flat' ? 0 : Math.max(2, spacing * 1.5);
  for (let e = 0; e < edges.length; e++) {
    const src = edges[e];
    const v = n * n + e;
    for (let c = 0; c < 3; c++) {
      position[v * 3 + c] = position[src * 3 + c] - dir[src * 3 + c] * skirt;
      normal[v * 3 + c] = normal[src * 3 + c];
      dir[v * 3 + c] = dir[src * 3 + c];
      info[v * 3 + c] = info[src * 3 + c];
      tile[v * 3 + c] = tile[src * 3 + c];
    }
  }
  return { center: [cx, cy, cz], position, normal, dir, info, tile, radius: maxR + skirt, minH, maxH };
}

function mod(v, p) {
  const r = v % p;
  return r < 0 ? r + p : r;
}

export function chunkTransfers(data) {
  return [data.position.buffer, data.normal.buffer, data.dir.buffer, data.info.buffer, data.tile.buffer];
}
