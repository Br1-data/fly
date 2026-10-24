// Static description of the simulated region: a fictional Mediterranean landscape
// ("Regione Aquilana") with airports, radio navaids, towns, lakes and mountain ridges.
// Coordinates are metres in a local NED plane: n = north, e = east. Elevations are metres MSL.
import { DEG } from '../core/math.js';

export const WORLD_HALF_SIZE = 90000; // terrain is generated in [-90 km, 90 km]^2 (ocean beyond)

export const AIRPORTS = [
  {
    icao: 'XAQU',
    name: 'Aquila Internazionale',
    city: 'Aquila',
    n: 0,
    e: 0,
    elev: 115,
    size: 'large',
    atis: 127.25,
    tower: 118.7,
    runways: [
      {
        id: '07/25',
        heading: 72,
        length: 3200,
        width: 45,
        surface: 'asphalt',
        ends: [
          { ident: '07', ils: { freq: 110.3, ident: 'IAQE', gs: 3.0 }, als: true },
          { ident: '25', ils: { freq: 109.5, ident: 'IAQW', gs: 3.0 }, als: true },
        ],
      },
    ],
    taxiSide: -1,
  },
  {
    icao: 'XBRG',
    name: 'Borgo Valle',
    city: 'Borgo',
    n: 19000,
    e: 21000,
    elev: 230,
    size: 'medium',
    atis: 124.8,
    tower: 119.25,
    runways: [
      {
        id: '15/33',
        heading: 152,
        length: 1900,
        width: 30,
        surface: 'asphalt',
        ends: [
          { ident: '15', als: false },
          { ident: '33', ils: { freq: 111.1, ident: 'IBRG', gs: 3.2 }, als: true },
        ],
      },
    ],
    taxiSide: 1,
  },
  {
    icao: 'XMNT',
    name: 'Montecervo',
    city: 'Montecervo',
    n: 31000,
    e: 36000,
    elev: 1170,
    size: 'small',
    atis: null,
    tower: 122.5,
    runways: [
      {
        id: '02/20',
        heading: 18,
        length: 800,
        width: 18,
        surface: 'asphalt',
        ends: [{ ident: '02', als: false }, { ident: '20', als: false }],
      },
    ],
    taxiSide: 1,
  },
  {
    icao: 'XSRN',
    name: 'Isola Serena',
    city: 'Serena',
    n: -36000,
    e: -30000,
    elev: 26,
    size: 'medium',
    atis: 128.3,
    tower: 120.1,
    runways: [
      {
        id: '12/30',
        heading: 118,
        length: 1600,
        width: 30,
        surface: 'asphalt',
        ends: [{ ident: '12', als: false }, { ident: '30', als: false }],
      },
    ],
    taxiSide: 1,
  },
  {
    icao: 'XLGO',
    name: 'Lago Azzurro',
    city: 'Lago',
    n: -11000,
    e: 24000,
    elev: 104,
    size: 'small',
    atis: null,
    tower: 123.5,
    runways: [
      {
        id: '04/22',
        heading: 42,
        length: 900,
        width: 25,
        surface: 'grass',
        ends: [{ ident: '04', als: false }, { ident: '22', als: false }],
      },
    ],
    taxiSide: -1,
  },
  {
    icao: 'XCST',
    name: 'Costa Verde',
    city: 'Costa Verde',
    n: 26000,
    e: -30000,
    elev: 55,
    size: 'large',
    atis: 126.55,
    tower: 118.3,
    runways: [
      {
        id: '18/36',
        heading: 176,
        length: 2600,
        width: 45,
        surface: 'asphalt',
        ends: [
          { ident: '18', ils: { freq: 108.7, ident: 'ICSS', gs: 3.0 }, als: true },
          { ident: '36', ils: { freq: 109.9, ident: 'ICSN', gs: 3.0 }, als: true },
        ],
      },
    ],
    taxiSide: 1,
  },
];

export const NAVAIDS = [
  { id: 'AQV', name: 'Aquila VOR/DME', type: 'VORDME', freq: 113.5, n: 1500, e: -1400, elev: 120, range: 120000 },
  { id: 'BRG', name: 'Borgo VOR/DME', type: 'VORDME', freq: 115.2, n: 17200, e: 23400, elev: 240, range: 90000 },
  { id: 'CST', name: 'Costa Verde VOR/DME', type: 'VORDME', freq: 112.4, n: 28500, e: -28800, elev: 60, range: 110000 },
  { id: 'PSS', name: 'Passo Grande VOR', type: 'VOR', freq: 116.8, n: 6000, e: 44000, elev: 900, range: 100000 },
  { id: 'SRN', name: 'Serena NDB', type: 'NDB', freq: 385, n: -35200, e: -31500, elev: 26, range: 60000 },
  { id: 'MNT', name: 'Montecervo NDB', type: 'NDB', freq: 330, n: 29800, e: 35400, elev: 1170, range: 45000 },
  { id: 'LGO', name: 'Lago NDB', type: 'NDB', freq: 275, n: -10200, e: 23000, elev: 104, range: 40000 },
];

export const CITIES = [
  { name: 'Aquila', n: 6500, e: -5500, radius: 2600, density: 1.0, tall: 0.6 },
  { name: 'Borgo', n: 21500, e: 17800, radius: 1100, density: 0.8, tall: 0.15 },
  { name: 'Costa Verde', n: 23500, e: -32800, radius: 1800, density: 0.9, tall: 0.35 },
  { name: 'Serena', n: -34300, e: -32300, radius: 650, density: 0.7, tall: 0.05 },
  { name: 'Lago', n: -12800, e: 21300, radius: 500, density: 0.6, tall: 0.0 },
  { name: 'Montecervo', n: 29500, e: 34600, radius: 320, density: 0.6, tall: 0.0 },
  { name: 'Porto Nuovo', n: -24500, e: 6000, radius: 1300, density: 0.85, tall: 0.25 },
  { name: 'San Rocco', n: -3000, e: 15000, radius: 600, density: 0.6, tall: 0.05 },
  { name: 'Valfonda', n: 12000, e: -16000, radius: 700, density: 0.6, tall: 0.05 },
];

export const LAKES = [{ name: 'Lago Azzurro', n: -8200, e: 27800, radius: 2600, level: 92, depth: 25 }];

// Mountain ridge lines (n, e) with peak scale. Mountains are generated within `width` metres.
export const RIDGES = [
  { pts: [[14000, 31000], [26000, 40000], [38000, 44000], [52000, 50000]], width: 15000, height: 2350 },
  { pts: [[34000, 14000], [44000, 24000], [56000, 30000]], width: 11000, height: 1700 },
  { pts: [[-4000, 38000], [8000, 46000], [20000, 52000]], width: 9000, height: 1300 },
];

// Valleys carve passages through the ridges (floor elevations interpolated along the line).
export const VALLEYS = [
  { pts: [[19000, 21000], [25000, 28500], [31000, 36000], [40000, 39500]], floor: [230, 620, 1170, 1350], width: 1700 },
  { pts: [[6000, 44000], [3000, 36000], [-6000, 30000]], floor: [880, 500, 140], width: 1400 },
];

export const ISLANDS = [
  { n: -36000, e: -30000, r: 6500 },
  { n: -27000, e: -51000, r: 3200 },
  { n: -46000, e: 4000, r: 2600 },
  { n: 52000, e: -46000, r: 4200 },
];

/** Unit direction (n, e) for a heading in degrees. */
export function headingVec(hdgDeg) {
  return [Math.cos(hdgDeg * DEG), Math.sin(hdgDeg * DEG)];
}

/** Derived per-runway geometry: thresholds, landing headings, ILS antenna positions. */
export function runwayGeometry(ap, rw) {
  const [dn, de] = headingVec(rw.heading);
  const cn = ap.n + (rw.offsetN || 0);
  const ce = ap.e + (rw.offsetE || 0);
  const half = rw.length / 2;
  const ends = rw.ends.map((end, i) => {
    const s = i === 0 ? -1 : 1; // end 0 lies at the start of rw.heading
    const hdg = i === 0 ? rw.heading : (rw.heading + 180) % 360;
    const thrN = cn + s * dn * half;
    const thrE = ce + s * de * half;
    const fwdN = -s * dn;
    const fwdE = -s * de;
    return {
      ...end,
      runway: rw,
      airport: ap,
      heading: hdg,
      thrN,
      thrE,
      dirN: fwdN,
      dirE: fwdE,
      elev: ap.elev,
      length: rw.length,
      width: rw.width,
    };
  });
  return { cn, ce, dn, de, half, ends };
}

/** Oriented rectangle helper. */
function rect(n, e, heading, length, width, surface, kind) {
  return { n, e, heading, length, width, surface, kind };
}

/**
 * Build the ground layout of an airport: runway, taxiways, apron, buildings and parking spots.
 * Shared by the physics (ground surfaces) and the renderer.
 */
export function buildAirportLayout(ap) {
  const big = ap.size === 'large';
  const med = ap.size === 'medium';
  const rw = ap.runways[0];
  const g = runwayGeometry(ap, rw);
  const [dn, de] = [g.dn, g.de];
  const side = ap.taxiSide || 1;
  // right-hand normal of runway direction
  const rn = -de * side;
  const re = dn * side;
  const twW = big ? 23 : med ? 18 : 10;
  const twOff = rw.width / 2 + (big ? 160 : med ? 110 : 60);
  const surfaces = [];
  const grassStrip = rw.surface === 'grass';
  surfaces.push(rect(g.cn, g.ce, rw.heading, rw.length, rw.width, rw.surface, 'runway'));
  const twLen = rw.length - (big ? 120 : 60);
  surfaces.push(rect(g.cn + rn * twOff, g.ce + re * twOff, rw.heading, twLen, twW, grassStrip ? 'grass' : 'asphalt', 'taxiway'));
  // connectors at both ends and in the middle
  const conns = big ? [-0.5, -0.18, 0.18, 0.5] : [-0.5, 0, 0.5];
  const holds = [];
  for (const f of conns) {
    const along = f * (twLen - twW);
    const cN = g.cn + dn * along + rn * (twOff / 2 + rw.width / 4);
    const cE = g.ce + de * along + re * (twOff / 2 + rw.width / 4);
    surfaces.push(rect(cN, cE, (rw.heading + 90) % 360, twOff - rw.width / 2 + twW, twW, grassStrip ? 'grass' : 'asphalt', 'taxiway'));
    if (Math.abs(f) === 0.5) {
      // holding point on the connector, short of the runway
      const hd = rw.width / 2 + (big ? 75 : 45);
      holds.push({ n: g.cn + dn * along + rn * hd, e: g.ce + de * along + re * hd, endIndex: f < 0 ? 0 : 1 });
    }
  }
  // apron
  const apronDepth = big ? 190 : med ? 120 : 70;
  const apronLen = big ? 620 : med ? 300 : 140;
  const apronOff = twOff + twW / 2 + apronDepth / 2 + 10;
  const aN = g.cn + rn * apronOff;
  const aE = g.ce + re * apronOff;
  surfaces.push(rect(aN, aE, rw.heading, apronLen, apronDepth, 'asphalt', 'apron'));
  // apron link
  surfaces.push(rect(g.cn + rn * (twOff + apronOff) / 2, g.ce + re * (twOff + apronOff) / 2, (rw.heading + 90) % 360, apronOff - twOff, twW * 1.5, 'asphalt', 'taxiway'));

  // parking spots: nose pointing towards the taxiway
  const parking = [];
  const nSpots = big ? 8 : med ? 5 : 4;
  const facing = (Math.atan2(-re, -rn) / DEG + 360) % 360;
  for (let i = 0; i < nSpots; i++) {
    const along = (i / (nSpots - 1) - 0.5) * (apronLen - (big ? 90 : 40));
    const off = apronOff + apronDepth * 0.12;
    parking.push({ n: g.cn + dn * along + rn * off, e: g.ce + de * along + re * off, heading: facing, name: `Stand ${i + 1}` });
  }

  // buildings beyond the apron
  const buildings = [];
  const bOff = apronOff + apronDepth / 2;
  if (big) {
    buildings.push({ type: 'terminal', n: aN + rn * (apronDepth / 2 + 45), e: aE + re * (apronDepth / 2 + 45), heading: rw.heading, length: apronLen * 0.8, width: 60, height: 22 });
    for (let i = 0; i < 3; i++) {
      const along = apronLen / 2 + 90 + i * 85;
      buildings.push({ type: 'hangar', n: g.cn + dn * along + rn * (bOff - 40), e: g.ce + de * along + re * (bOff - 40), heading: rw.heading, length: 70, width: 60, height: 20 });
    }
  } else {
    buildings.push({ type: 'terminal', n: aN + rn * (apronDepth / 2 + 22), e: aE + re * (apronDepth / 2 + 22), heading: rw.heading, length: apronLen * 0.55, width: 22, height: med ? 10 : 6 });
    for (let i = 0; i < (med ? 2 : 1); i++) {
      const along = apronLen / 2 + 40 + i * 45;
      buildings.push({ type: 'hangar', n: g.cn + dn * along + rn * (bOff - 20), e: g.ce + de * along + re * (bOff - 20), heading: rw.heading, length: 36, width: 30, height: 10 });
    }
  }
  const towerAlong = -apronLen / 2 - (big ? 70 : 30);
  const tower = {
    type: 'tower',
    n: g.cn + dn * towerAlong + rn * (bOff + 10),
    e: g.ce + de * towerAlong + re * (bOff + 10),
    height: big ? 42 : med ? 22 : 12,
  };
  buildings.push(tower);
  const windsock = { n: g.cn + dn * (-rw.length * 0.32) + rn * (rw.width / 2 + 45), e: g.ce + de * (-rw.length * 0.32) + re * (rw.width / 2 + 45) };

  // bounding rectangle for terrain flattening
  const across = apronOff + apronDepth / 2 + (big ? 120 : 60);
  const flat = {
    n: g.cn + rn * (across - rw.width / 2 - 60) / 2,
    e: g.ce + re * (across - rw.width / 2 - 60) / 2,
    heading: rw.heading,
    length: rw.length + (big ? 700 : 300),
    width: across + rw.width / 2 + (big ? 140 : 80),
  };
  return { geometry: g, surfaces, parking, buildings, tower, windsock, holds, flat, runway: rw };
}

let _layouts = null;
export function airportLayouts() {
  if (!_layouts) _layouts = AIRPORTS.map((ap) => ({ airport: ap, ...buildAirportLayout(ap) }));
  return _layouts;
}

/** All runway ends across all airports (with geometry). */
export function allRunwayEnds() {
  const out = [];
  for (const ap of AIRPORTS) for (const rw of ap.runways) out.push(...runwayGeometry(ap, rw).ends);
  return out;
}

export function findAirport(icao) {
  return AIRPORTS.find((a) => a.icao === icao);
}

export function findRunwayEnd(icao, ident) {
  return allRunwayEnds().find((r) => r.airport.icao === icao && r.ident === ident);
}

/** ILS installations derived from runway ends. */
export function ilsList() {
  const out = [];
  for (const end of allRunwayEnds()) {
    if (!end.ils) continue;
    const len = end.length;
    // localizer antenna 300 m beyond the far end; glideslope 300 m past threshold, 120 m to the side
    const locN = end.thrN + end.dirN * (len + 300);
    const locE = end.thrE + end.dirE * (len + 300);
    const gsN = end.thrN + end.dirN * 300 + end.dirE * 120;
    const gsE = end.thrE + end.dirE * 300 - end.dirN * 120;
    out.push({
      id: end.ils.ident,
      name: `ILS ${end.airport.icao} ${end.ident}`,
      type: 'ILS',
      freq: end.ils.freq,
      course: end.heading,
      gsAngle: end.ils.gs,
      n: locN,
      e: locE,
      gsN,
      gsE,
      elev: end.elev,
      range: 46000,
      runwayEnd: end,
      // outer/middle marker distances from threshold
      markers: [
        { type: 'OM', dist: 7400 },
        { type: 'MM', dist: 1050 },
      ],
    });
  }
  return out;
}

/** Every tunable navaid (VOR, NDB, ILS). */
export function allNavaids() {
  return [...NAVAIDS, ...ilsList()];
}
