// Persistent application settings (graphics, audio, realism, interface).
import { DEFAULT_SETTINGS } from '../sim/simulation.js';
import { defaultQuality } from '../core/device.js';

const KEY = 'cieli-aperti.settings';

export const DEFAULT_APP_SETTINGS = {
  quality: 'medium',
  volume: 0.8,
  muted: false,
  showHud: true,
  defaultView: 'cockpit',
  realism: { ...DEFAULT_SETTINGS },
  lastFlight: null,
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const s = structuredClone(DEFAULT_APP_SETTINGS);
  s.quality = defaultQuality();
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      Object.assign(s, v);
      s.realism = { ...DEFAULT_SETTINGS, ...(v.realism || {}) };
    }
  } catch {
    // corrupted or unavailable storage: defaults
  }
  if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = defaultQuality();
  return s;
}

export function saveSettings(s) {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore (private mode, quota)
  }
}
