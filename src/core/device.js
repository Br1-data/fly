// Pointer capability is more useful than browser/user-agent names for touch controls.
// iPads are the exception: iPadOS Safari presents itself as a Mac ("desktop-class browsing")
// and reports a fine pointer when a trackpad is attached, so they are recognised explicitly.

/** A Mac user agent on a multi-touch screen: iPadOS, or an iPhone in "desktop website" mode. */
function touchMac(nav) {
  return /\bMacintosh\b/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1;
}

/** True on an iPad, including iPadOS Safari with the desktop (Macintosh) user agent. */
export function isIPad(nav = globalThis.navigator) {
  if (!nav) return false;
  if (/\biPad\b/.test(nav.userAgent || '')) return true;
  const side = shortSide();
  return touchMac(nav) && (side === 0 || side >= 600);
}

/** True on an iPhone or iPod touch (also when Safari requests the desktop website). */
export function isIPhone(nav = globalThis.navigator) {
  if (!nav) return false;
  if (/\b(iPhone|iPod)\b/.test(nav.userAgent || '')) return true;
  const side = shortSide();
  return touchMac(nav) && side > 0 && side < 600;
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
 * 'phone', 'iphone', 'tablet' or 'desktop'. Tablets are touch devices whose short side is at
 * least 600 CSS px (every iPad, including the mini). iPhones are phones with Apple GPUs and
 * high-density screens: they get a sharper, smoother profile than other phones.
 */
export function deviceClass() {
  if (isIPad()) return 'tablet';
  if (isIPhone()) return 'iphone';
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
