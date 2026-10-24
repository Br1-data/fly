// Radio navigation receivers: NAV (VOR/LOC/GS + DME), ADF (NDB), marker beacons, COM (ATIS) and GPS.
import { DEG, RAD, clamp, wrap180, wrap360, bearingDeg } from '../core/math.js';
import { NM, FT } from '../core/units.js';
import { allNavaids, AIRPORTS } from '../world/world-data.js';

const NAVAIDS = allNavaids();

/** Line-of-sight radio range (m) for two heights above ground (m). */
function losRange(hA, hB) {
  return 4120 * (Math.sqrt(Math.max(hA, 1)) + Math.sqrt(Math.max(hB, 1)));
}

export function findNavaidByFreq(freq, kind) {
  return NAVAIDS.filter((n) => Math.abs(n.freq - freq) < 0.004 && (kind === 'adf' ? n.type === 'NDB' : n.type !== 'NDB'));
}

export class NavRadio {
  constructor(active = 113.5, standby = 110.3) {
    this.active = active;
    this.standby = standby;
    this.obs = 0;
    this.reset();
  }
  reset() {
    this.station = null;
    this.valid = false;
    this.isLoc = false;
    this.cdi = 0; // -1..1 (positive = needle right: fly right)
    this.gs = 0; // -1..1 (positive = needle up: fly up)
    this.gsValid = false;
    this.toFrom = 0; // 1 TO, -1 FROM, 0 OFF
    this.radial = 0;
    this.dme = null; // NM
    this.ident = '';
    this.locCourse = 0;
    this.xtrack = 0; // metres right of course (positive = aircraft right of course)
  }
  swap() {
    const t = this.active;
    this.active = this.standby;
    this.standby = t;
  }

  update(fm, powered) {
    if (!powered) {
      this.reset();
      return;
    }
    const n = fm.pos.x,
      e = fm.pos.y,
      alt = fm.alt;
    const cands = findNavaidByFreq(this.active, 'nav');
    let best = null,
      bestD = Infinity;
    for (const st of cands) {
      const d = Math.hypot(st.n - n, st.e - e);
      const range = Math.min(st.range, losRange(alt - st.elev, 10));
      if (d < range && d < bestD) {
        best = st;
        bestD = d;
      }
    }
    if (!best) {
      this.reset();
      return;
    }
    this.station = best;
    this.ident = best.id;
    this.valid = true;
    const slant = Math.hypot(bestD, alt - best.elev);
    this.dme = best.type === 'VOR' ? null : slant / NM;
    const brgFromStation = bearingDeg(best.n, best.e, n, e); // radial
    this.radial = brgFromStation;
    if (best.type === 'ILS') {
      this.isLoc = true;
      this.locCourse = best.course;
      // localizer: angle between aircraft and course line as seen from the antenna (approach side)
      const back = wrap360(best.course + 180);
      // negative angle = aircraft right of course when flying the approach course
      const ang = wrap180(brgFromStation - back);
      const inFront = Math.abs(ang) < 90;
      const a = inFront ? ang : -wrap180(180 - ang);
      // full scale deflection 2.5 deg each side; needle shows where the course is
      this.cdi = clamp(a / 2.5, -1, 1);
      this.xtrack = -Math.sin(a * DEG) * bestD;
      this.toFrom = 1;
      // glideslope
      const dGs = Math.hypot(best.gsN - n, best.gsE - e);
      const elevAng = Math.atan2(alt - best.elev, dGs) * RAD;
      this.gsValid = inFront && dGs < 18 * NM && Math.abs(a) < 10;
      this.gs = this.gsValid ? clamp((best.gsAngle - elevAng) / 0.7, -1, 1) : 0;
      this.gsDeviationDeg = elevAng - best.gsAngle;
      this.gsDist = dGs;
    } else {
      this.isLoc = false;
      this.gsValid = false;
      this.gs = 0;
      const obs = this.obs;
      // TO/FROM: compare OBS with bearing to station
      const brgTo = wrap360(brgFromStation + 180);
      const diffTo = wrap180(brgTo - obs);
      if (Math.abs(diffTo) < 90) {
        this.toFrom = 1;
        this.cdi = clamp(diffTo / 10, -1, 1);
      } else {
        this.toFrom = -1;
        this.cdi = clamp(-wrap180(brgFromStation - obs) / 10, -1, 1);
      }
      if (bestD < 600) this.toFrom = 0; // cone of confusion
      this.xtrack = Math.sin(wrap180(brgFromStation - obs) * DEG) * bestD;
    }
  }
}

export class AdfRadio {
  constructor(freq = 385) {
    this.active = freq;
    this.standby = 275;
    this.valid = false;
    this.relBearing = 90;
    this.ident = '';
    this.card = 0; // fixed card heading
  }
  swap() {
    const t = this.active;
    this.active = this.standby;
    this.standby = t;
  }
  update(fm, powered) {
    if (!powered) {
      this.valid = false;
      return;
    }
    const n = fm.pos.x,
      e = fm.pos.y;
    const cands = NAVAIDS.filter((s) => s.type === 'NDB' && Math.abs(s.freq - this.active) < 0.6);
    let best = null,
      bestD = Infinity;
    for (const st of cands) {
      const d = Math.hypot(st.n - n, st.e - e);
      if (d < st.range && d < bestD) {
        best = st;
        bestD = d;
      }
    }
    if (!best) {
      // needle parks at 90 deg when no signal
      this.valid = false;
      this.relBearing += (90 - this.relBearing) * 0.02;
      return;
    }
    this.valid = true;
    this.ident = best.id;
    const brg = bearingDeg(n, e, best.n, best.e);
    const target = wrap360(brg - fm.heading);
    this.relBearing = wrap360(this.relBearing + wrap180(target - this.relBearing) * 0.1);
    this.dist = bestD;
  }
}

/** Simple GPS flight plan navigator. */
export class Gps {
  constructor() {
    this.plan = []; // [{id, n, e, alt?}]
    this.active = 0;
    this.directTo = null;
    this.dtk = 0;
    this.xtk = 0; // metres (positive = right of course)
    this.dist = 0;
    this.brg = 0;
    this.ete = 0;
  }
  setPlan(wps) {
    this.plan = wps.slice();
    this.active = wps.length > 1 ? 1 : 0;
    this.directTo = null;
  }
  direct(wp) {
    this.directTo = { ...wp, fromN: null, fromE: null };
  }
  get current() {
    return this.directTo || this.plan[this.active] || null;
  }
  update(fm) {
    const n = fm.pos.x,
      e = fm.pos.y;
    const wp = this.current;
    if (!wp) {
      this.dist = 0;
      return;
    }
    if (this.directTo && this.directTo.fromN === null) {
      this.directTo.fromN = n;
      this.directTo.fromE = e;
    }
    const from = this.directTo ? { n: this.directTo.fromN, e: this.directTo.fromE } : this.plan[this.active - 1] || { n, e };
    this.dist = Math.hypot(wp.n - n, wp.e - e);
    this.brg = bearingDeg(n, e, wp.n, wp.e);
    this.dtk = bearingDeg(from.n, from.e, wp.n, wp.e);
    // cross-track: positive right of the desired track
    const tn = Math.cos(this.dtk * DEG),
      te = Math.sin(this.dtk * DEG);
    const rn = n - from.n,
      re = e - from.e;
    this.xtk = rn * -te + re * tn;
    this.ete = fm.gs > 5 ? this.dist / fm.gs : 0;
    // sequence waypoints
    if (!this.directTo && this.dist < Math.max(600, fm.gs * 8) && this.active < this.plan.length - 1) this.active++;
    if (this.directTo && this.dist < 400) {
      // continue with plan if the direct-to target was in it
      const idx = this.plan.findIndex((p) => p.id === this.directTo.id);
      if (idx >= 0 && idx < this.plan.length - 1) {
        this.active = idx + 1;
        this.directTo = null;
      }
    }
  }
}

/** Marker beacons (outer/middle) along ILS approaches. */
export function markerAt(fm) {
  for (const ils of NAVAIDS) {
    if (ils.type !== 'ILS' || !ils.markers) continue;
    const end = ils.runwayEnd;
    for (const m of ils.markers) {
      const mn = end.thrN - end.dirN * m.dist;
      const me = end.thrE - end.dirE * m.dist;
      const d = Math.hypot(fm.pos.x - mn, fm.pos.y - me);
      const h = fm.alt - end.elev;
      // cone of roughly +/- 40 deg above the beacon
      if (d < Math.max(150, h * 0.8) && h < 2500) return m.type;
    }
  }
  return null;
}

/** ATIS text for an airport, generated from the current weather. */
export function atisText(ap, atm, letterIdx = 0) {
  const w = atm.weather;
  const letters = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
  const windDir = Math.round((w.windDir || 0) / 10) * 10 || 360;
  const windKt = Math.round(w.windSpeedKt || 0);
  const vis = w.visibilityKm >= 10 ? '10 chilometri o più' : `${Math.round(w.visibilityKm * 1000)} metri`;
  const clouds = (w.clouds || [])
    .map((c) => {
      const cov = c.coverage > 0.9 ? 'coperto' : c.coverage > 0.6 ? 'molto nuvoloso' : c.coverage > 0.3 ? 'sparse' : 'poche';
      return `${cov} ${Math.round(c.baseFt / 100) * 100} piedi`;
    })
    .join(', ');
  // active runway: the end most into the wind
  let best = null,
    bestHead = -Infinity;
  for (const rw of ap.runways) {
    rw.ends.forEach((end, i) => {
      const hdg = i === 0 ? rw.heading : (rw.heading + 180) % 360;
      const head = Math.cos((windDir - hdg) * DEG);
      if (head > bestHead) {
        bestHead = head;
        best = end.ident;
      }
    });
  }
  const qnh = Math.round(w.qnhHpa);
  const t = Math.round(w.tempC);
  return `${ap.name} informazioni ${letters[letterIdx % letters.length]}. Pista in uso ${best}. Vento ${windKt < 3 ? 'calmo' : `${String(windDir).padStart(3, '0')} gradi ${windKt} nodi`}${w.gustKt > 3 ? ` raffiche ${windKt + Math.round(w.gustKt)}` : ''}. Visibilità ${vis}. ${clouds ? 'Nubi ' + clouds + '.' : 'Cielo sereno.'} Temperatura ${t}. QNH ${qnh}. Informate di aver ricevuto ${letters[letterIdx % letters.length]}.`;
}

export function airportByAtis(freq) {
  return AIRPORTS.find((a) => a.atis && Math.abs(a.atis - freq) < 0.004) || null;
}

export function nearestAirport(n, e) {
  let best = null,
    bd = Infinity;
  for (const a of AIRPORTS) {
    const d = Math.hypot(a.n - n, a.e - e);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return { airport: best, dist: bd };
}
