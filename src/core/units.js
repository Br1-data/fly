// Unit conversions. Internally everything is SI.
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const FPM = 0.00508; // m/s per ft/min
export const NM = 1852; // m per nautical mile
export const INHG = 3386.389; // Pa per inHg
export const HPA = 100; // Pa per hPa
export const LB = 0.45359237; // kg per lb
export const LBF = 4.448222; // N per lbf
export const GAL = 3.785411; // L per US gallon
export const HP = 745.7; // W per hp
export const AVGAS_KG_PER_L = 0.72;
export const JETA_KG_PER_L = 0.8;

export const toKt = (ms) => ms / KT;
export const toFt = (m) => m / FT;
export const toFpm = (ms) => ms / FPM;
export const toNm = (m) => m / NM;
export const cToF = (c) => c * 1.8 + 32;
export const kToC = (k) => k - 273.15;

export function fmt(v, digits = 0) {
  if (!Number.isFinite(v)) return '---';
  return v.toFixed(digits);
}

export function pad(n, width, ch = '0') {
  const s = String(Math.round(n));
  return s.length >= width ? s : ch.repeat(width - s.length) + s;
}
