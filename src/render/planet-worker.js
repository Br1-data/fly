// Planet chunk generation off the main thread (module worker).
import { buildChunk, chunkTransfers } from './planet-build.js';

self.onmessage = (event) => {
  const job = event.data;
  try {
    const data = buildChunk(job);
    self.postMessage({ id: job.id, data }, chunkTransfers(data));
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message || error) });
  }
};
