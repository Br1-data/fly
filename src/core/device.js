// Pointer capability is more useful than browser/user-agent names for touch controls.
// iPads are the exception: iPadOS Safari presents itself as a Mac ("desktop-class browsing")
// and reports a fine pointer when a trackpad is attached, so they are recognised explicitly.

/** True on an iPad, including iPadOS Safari with the desktop (Macintosh) user agent. */
export function isIPad(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  if (/\biPad\b/.test(ua)) return true;
  return /\bMacintosh\b/.test(ua) && (nav.maxTouchPoints || 0) > 1;
}

function coarsePointer() {
  if (typeof globalThis.matchMedia === 'function') return globalThis.matchMedia('(pointer: coarse)').matches;
  return (globalThis.navigator?.maxTouchPoints || 0) > 0;
}

/** Shortest screen side in CSS pixels (stable across rotations). */
function shortSide() {
  const s = globalThis.screen;
  const w = s?.width || globalThis.innerWidth || 0, h = s?.height || globalThis.innerHeight || 0;
  return Math.min(w, h);
}

/**
 * 'phone', 'tablet' or 'desktop'. Tablets are touch devices whose short side is at least
 * 600 CSS px (every iPad, including the mini); they get richer defaults than phones.
 */
export function deviceClass() {
  if (isIPad()) return 'tablet';
  if (!coarsePointer()) return 'desktop';
  return shortSide() >= 600 ? 'tablet' : 'phone';
}

export function isTouchDevice() {
  return deviceClass() !== 'desktop';
}

export function isTablet() {
  return deviceClass() === 'tablet';
}

export function defaultQuality() {
  const kind = deviceClass();
  return kind === 'phone' ? 'low' : 'medium';
}
