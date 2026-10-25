// Pointer capability is more useful than browser/user-agent names for touch controls.
export function isTouchDevice() {
  if (typeof globalThis.matchMedia === 'function') return globalThis.matchMedia('(pointer: coarse)').matches;
  return (globalThis.navigator?.maxTouchPoints || 0) > 0;
}

export function defaultQuality() {
  return isTouchDevice() ? 'low' : 'medium';
}
