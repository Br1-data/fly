// Terrain tile generation off the main thread (module worker). Messages carry a job
// { id, nn, ee, segments, treeSamples, treeDensity } and return the tile's typed arrays.
import { buildTileData, tileTransfers } from './terrain-build.js';

self.onmessage = (event) => {
  const job = event.data;
  try {
    const data = buildTileData(job);
    self.postMessage({ id: job.id, data }, tileTransfers(data));
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message || error) });
  }
};
