// Only successful personal bests count toward the completed-mission total.
const STORAGE_KEY = 'cieli-aperti.missions';
function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function validResult(r) {
  return r && typeof r === 'object' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 1000
    && Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= 3 && r.success === true;
}
export function loadResults() {
  try {
    const data = JSON.parse(storage()?.getItem(STORAGE_KEY) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, r]) => /^[a-z0-9-]+$/.test(id) && validResult(r)));
  } catch { return {}; }
}
export function saveResult(id, result) {
  if (!/^[a-z0-9-]+$/.test(id) || !validResult(result)) return false;
  const results = loadResults();
  const previous = results[id];
  if (previous && previous.score >= result.score) return true;
  results[id] = { success: true, score: result.score, best: result.score, stars: result.stars, completedAt: new Date().toISOString() };
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(results));
    return true;
  } catch { return false; }
}
