// ISA atmosphere with non-standard QNH/temperature, wind profile, gusts and turbulence.
import { DEG, G0, clamp, rng, V3 } from '../core/math.js';
import { KT, HPA } from '../core/units.js';

export const R_AIR = 287.053;
export const GAMMA = 1.4;
export const P0 = 101325;
export const T0 = 288.15;
export const RHO0 = 1.225;
export const LAPSE = 0.0065;
const EXP = G0 / (R_AIR * LAPSE); // 5.25588

/** Weather presets (Italian names shown in UI). */
export const WEATHER_PRESETS = {
  sereno: {
    name: 'Sereno',
    windDir: 250,
    windSpeedKt: 5,
    gustKt: 0,
    turbulence: 0.05,
    visibilityKm: 60,
    qnhHpa: 1018,
    tempC: 20,
    clouds: [{ baseFt: 6500, thickFt: 1200, coverage: 0.08, type: 'cumulus' }],
    precipitation: 0,
  },
  poche_nubi: {
    name: 'Poche nubi',
    windDir: 270,
    windSpeedKt: 9,
    gustKt: 4,
    turbulence: 0.18,
    visibilityKm: 35,
    qnhHpa: 1013,
    tempC: 17,
    clouds: [{ baseFt: 4500, thickFt: 2500, coverage: 0.35, type: 'cumulus' }],
    precipitation: 0,
  },
  nuvoloso: {
    name: 'Nuvoloso',
    windDir: 230,
    windSpeedKt: 14,
    gustKt: 8,
    turbulence: 0.3,
    visibilityKm: 18,
    qnhHpa: 1006,
    tempC: 13,
    clouds: [
      { baseFt: 3000, thickFt: 2500, coverage: 0.6, type: 'cumulus' },
      { baseFt: 9000, thickFt: 1500, coverage: 0.5, type: 'stratus' },
    ],
    precipitation: 0,
  },
  coperto_pioggia: {
    name: 'Coperto con pioggia',
    windDir: 200,
    windSpeedKt: 18,
    gustKt: 10,
    turbulence: 0.4,
    visibilityKm: 6,
    qnhHpa: 998,
    tempC: 9,
    clouds: [{ baseFt: 1400, thickFt: 5000, coverage: 1.0, type: 'stratus' }],
    precipitation: 0.7,
  },
  temporale: {
    name: 'Temporale',
    windDir: 190,
    windSpeedKt: 24,
    gustKt: 18,
    turbulence: 0.8,
    visibilityKm: 4,
    qnhHpa: 992,
    tempC: 16,
    clouds: [
      { baseFt: 2200, thickFt: 9000, coverage: 0.85, type: 'cumulus' },
      { baseFt: 3500, thickFt: 4000, coverage: 1.0, type: 'stratus' },
    ],
    precipitation: 1.0,
  },
  nebbia: {
    name: 'Nebbia',
    windDir: 90,
    windSpeedKt: 2,
    gustKt: 0,
    turbulence: 0.02,
    visibilityKm: 0.6,
    qnhHpa: 1024,
    tempC: 6,
    clouds: [{ baseFt: 250, thickFt: 900, coverage: 1.0, type: 'stratus' }],
    precipitation: 0,
  },
  invernale: {
    name: 'Inverno (gelo)',
    windDir: 20,
    windSpeedKt: 12,
    gustKt: 6,
    turbulence: 0.25,
    visibilityKm: 25,
    qnhHpa: 1028,
    tempC: -4,
    clouds: [{ baseFt: 3500, thickFt: 3000, coverage: 0.7, type: 'stratus' }],
    precipitation: 0.2,
  },
};

export function cloneWeather(w) {
  return JSON.parse(JSON.stringify(w));
}

/**
 * Atmosphere sampler. Altitudes are true altitudes above MSL in metres.
 */
export class Atmosphere {
  constructor(weather) {
    this.time = 0;
    this._rand = rng(12345);
    this.gustState = 0;
    this.gustTarget = 0;
    this.gustTimer = 0;
    this.turb = new V3();
    this.turbRoll = 0; // differential vertical gust across the span (m/s)
    this.setWeather(weather || WEATHER_PRESETS.sereno);
  }

  setWeather(w) {
    this.weather = cloneWeather(w);
    this.qnh = (w.qnhHpa || 1013.25) * HPA;
    this.tempSL = T0 + ((w.tempC ?? 15) - 15); // sea-level actual temperature (K)
    this.windFrom = (w.windDir || 0) * DEG;
    this.windSpeed = (w.windSpeedKt || 0) * KT;
    this.gust = (w.gustKt || 0) * KT;
    this.turbulence = clamp(w.turbulence || 0, 0, 1);
    this.visibility = (w.visibilityKm ?? 30) * 1000;
    this.precip = w.precipitation || 0;
  }

  /** Fill `out` with T (K), p (Pa), rho (kg/m3), a (m/s) at true altitude h (m MSL). */
  sample(h, out = {}) {
    const hh = Math.min(Math.max(h, -500), 20000);
    const Tsl = this.tempSL;
    let T, p;
    if (hh <= 11000) {
      T = Tsl - LAPSE * hh;
      p = this.qnh * Math.pow(T / Tsl, EXP);
    } else {
      const T11 = Tsl - LAPSE * 11000;
      const p11 = this.qnh * Math.pow(T11 / Tsl, EXP);
      T = T11;
      p = p11 * Math.exp((-G0 * (hh - 11000)) / (R_AIR * T11));
    }
    out.T = T;
    out.p = p;
    out.rho = p / (R_AIR * T);
    out.a = Math.sqrt(GAMMA * R_AIR * T);
    out.sigma = out.rho / RHO0;
    return out;
  }

  /** Static outside air temperature in Celsius. */
  oatC(h) {
    return this.sample(h).T - 273.15;
  }

  /** Is position (altitude) inside a cloud layer? Returns density 0..1 (approximate, coverage based). */
  cloudDensityAt(altM) {
    let d = 0;
    for (const c of this.weather.clouds || []) {
      const base = c.baseFt * 0.3048;
      const top = base + c.thickFt * 0.3048;
      if (altM > base && altM < top) {
        const edge = Math.min(altM - base, top - altM);
        const k = clamp(edge / 60, 0, 1);
        d = Math.max(d, (c.type === 'stratus' ? c.coverage : c.coverage * 0.6) * k);
      }
    }
    return d;
  }

  /** Mean wind (NED, m/s, the direction the air moves to) at height above ground `agl` (m). */
  meanWind(agl, alt, out = new V3()) {
    const h = Math.max(agl, 0.5);
    let f;
    if (h < 600) f = Math.pow(h / 10, 0.14);
    else f = Math.pow(60, 0.14) + (alt - 600) * 0.00012;
    f = clamp(f, 0.35, 3.5);
    const veer = clamp(h / 600, 0, 1) * 15 * DEG + clamp((alt - 600) / 6000, 0, 1) * 15 * DEG;
    const from = this.windFrom + veer;
    const spd = this.windSpeed * f + clamp((alt - 1000) / 9000, 0, 1) * 25 * KT;
    out.x = -Math.cos(from) * spd;
    out.y = -Math.sin(from) * spd;
    out.z = 0;
    return out;
  }

  /** Advance gust / turbulence filters. airspeed (m/s) sets turbulence time constants. */
  update(dt, airspeed, agl, alt) {
    this.time += dt;
    const r = this._rand;
    // Discrete gusts (1-cos shaped) superposed on the mean wind.
    if (this.gust > 0) {
      this.gustTimer -= dt;
      if (this.gustTimer <= 0) {
        this.gustTarget = r() * this.gust;
        this.gustTimer = 2 + r() * 6;
      }
      this.gustState += (this.gustTarget - this.gustState) * (1 - Math.exp(-dt / 1.2));
    } else {
      this.gustState = 0;
    }
    // Dryden-like first-order filtered noise.
    const lowAlt = clamp(1 - agl / 1500, 0.25, 1);
    const cloud = this.cloudDensityAt(alt);
    const intensity = this.turbulence * (0.6 + 0.6 * lowAlt) + cloud * 0.25 + this.precip * 0.1;
    const sigma = intensity * 3.2; // m/s
    const V = Math.max(airspeed, 15);
    const L = 120 + Math.min(agl, 600) * 0.5;
    const tau = L / V;
    const a = Math.exp(-dt / tau);
    const b = Math.sqrt(1 - a * a) * sigma;
    const gauss = () => {
      // Box-Muller
      const u = Math.max(r(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    };
    this.turb.x = this.turb.x * a + b * gauss();
    this.turb.y = this.turb.y * a + b * gauss();
    this.turb.z = this.turb.z * a + b * 0.8 * gauss();
    const aR = Math.exp(-dt / (tau * 0.5));
    this.turbRoll = this.turbRoll * aR + Math.sqrt(1 - aR * aR) * sigma * 0.5 * gauss();
  }

  /** Total wind vector (NED) at the aircraft. */
  windAt(agl, alt, out = new V3()) {
    this.meanWind(agl, alt, out);
    const spd = Math.hypot(out.x, out.y);
    if (spd > 0.01 && this.gustState > 0) {
      const k = (spd + this.gustState) / spd;
      out.x *= k;
      out.y *= k;
    }
    // Vertical gusts are damped near the ground.
    const vz = clamp(agl / 60, 0.1, 1);
    out.x += this.turb.x;
    out.y += this.turb.y;
    out.z += this.turb.z * vz;
    return out;
  }
}

/** Pressure altitude-style altimeter: indicated altitude (m) for static pressure p and Kollsman setting (Pa). */
export function indicatedAltitude(p, kollsmanPa) {
  return (T0 / LAPSE) * (1 - Math.pow(p / kollsmanPa, 1 / EXP));
}

/** Calibrated airspeed (m/s) from impact pressure qc (Pa) using the subsonic compressible formula. */
export function casFromQc(qc) {
  if (qc <= 0) return 0;
  return Math.sqrt(((2 * GAMMA) / (GAMMA - 1)) * (P0 / RHO0) * (Math.pow(qc / P0 + 1, (GAMMA - 1) / GAMMA) - 1));
}

/** Impact pressure (Pa) for true airspeed V at static pressure p and speed of sound a. */
export function impactPressure(V, p, a) {
  const M = V / a;
  return p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
}
