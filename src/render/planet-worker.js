// Planet chunk generation off the main thread (module worker). The first message carries
// the decoded elevation maps; then jobs arrive and their typed arrays are returned.
import { buildChunk, chunkTransfers } from './planet-build.js';
import { installPlanetData } from '../sim/planet-data.js';

self.onmessage = (event) => {
  const job = event.data;
  if (job.type === 'maps') {
    installPlanetData(job.maps);
    return;
  }
  try {
    const data = buildChunk(job);
    self.postMessage({ id: job.id, data }, chunkTransfers(data));
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message || error) });
  }
};
