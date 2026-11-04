// "Orso UH-6": twin-turbine military utility helicopter (class of the UH-60 Black Hawk).
// Four-blade articulated rotor, canted tail rotor, wheels with a tailwheel.
import { DEG, body, hstab, fin, lights, heliControls, heliContacts } from './parts.js';

export default {
  id: 'heliutility',
  name: 'Orso UH-6',
  category: 'Elicottero da trasporto tattico (militare)',
  role: 'military',
  helicopter: true,
  description:
    'Elicottero da trasporto e soccorso con due turbine da 1900 shp e rotore quadripala da 16 m. Robusto e potente: 11 soldati o un verricello per il soccorso in mare. AFCS con mantenimento di assetto e prua, carrello a ruote.',
  specs: ['Crociera 150 kt', '2 × 1900 shp', 'Rotore Ø 16,4 m', 'Peso max 10 t'],
  panel: 'jet',
  model: 'heliutility',
  sound: 'heli',
  takeoffTrim: 0,
  mass: { empty: 4820, payload: 800, reference: 7500, mtow: 9980 },
  inertia: [7600, 50000, 45000, 2000],
  cgHeight: 1.6,
  wing: { area: 1, span: 16.36, chord: 0.53, ar: 1, groundHeight: 0 },
  tailArm: 9.9,
  parasiteArea: 2.4,
  fuselageSideArea: 22,
  rotor: {
    radius: 8.18, blades: 4, chord: 0.53, rpm: 258, inertia: 8800, hub: [0.1, 0, -2.0], rotation: 1,
    thetaMin: 0.02, thetaMax: 0.36, twist: -0.1, cyclicMax: 0.26, hubStiffness: 45000, lock: 8, cd0: 0.01, loadingMax: 0.13, maxPower: 2.4e6,
    tail: { pos: [-9.9, 0, -1.6], radius: 1.68, ratio: 4.6, thrustMax: 14000, bias: 0.2, gain: 0.6 },
  },
  surfaces: [
    hstab({ area: 4.2, x: -9.4, z: -0.6, ar: 4.0, incidence: 2, tau: 0, cmCtrl: 0 }),
    fin({ area: 3.0, x: -9.2, z: -1.5, ar: 1.5, sweep: 40, tau: 0 }),
    ...body({ length: 15.3, width: 2.4, height: 2.2, x: 0.6 }),
  ],
  engines: [1, -1].map((side) => ({
    type: 'jet', name: side < 0 ? 'Motore 1' : 'Motore 2', pos: [-0.8, 0.6 * side, -1.6], shaft: { power: 1390000, rpm: 20900, bsfc: 8.5e-8 },
    maxThrust: 0, idleN1: 62, idleN2: 62, spoolTau: 0.9, startTime: 28, ffIdle: 0.03, tsfc0: 0, tsfcMach: 0, densityExp: 0.75, machLapse: 0, reverseFraction: 0, egtIdle: 420, egtMax: 820,
  })).reverse(),
  fuel: { type: 'jeta', capacity: 1100, defaultFraction: 0.7, tanks: [{ name: 'Serbatoio sinistro', capacity: 550, y: -0.6 }, { name: 'Serbatoio destro', capacity: 550, y: 0.6 }] },
  gear: [
    { name: 'left', pos: [1.6, -1.35, 1.6], travel: 0.3, k: 260000, c: 40000, brake: 'left', radius: 0.36, muBrake: 0.7, muRoll: 0.02 },
    { name: 'right', pos: [1.6, 1.35, 1.6], travel: 0.3, k: 260000, c: 40000, brake: 'right', radius: 0.36, muBrake: 0.7, muRoll: 0.02 },
    { name: 'tail', pos: [-7.6, 0, 1.05], travel: 0.2, k: 90000, c: 15000, steer: -40 * DEG, radius: 0.22, muRoll: 0.03 },
  ],
  contacts: heliContacts({ nose: 4.4, tail: -10.2, belly: 1.1, hub: [0.1, 0, -2.0], radius: 8.18, tailRotor: [-9.9, 0, 0.1] }),
  controls: heliControls(),
  limits: { vne: 193, vno: 160, va: 160, vle: 999, gPos: 3.0, gNeg: -0.5, gearVsLimit: 4.5 },
  speeds: { vr: 0, vy: 80, vapp: 70, vref: 50, vs0: 0, vs1: 0, climb: 80, cruise: 150 },
  warnings: { stallRatio: 0.9 },
  systems: { volts: 28, batteryAh: 34, vacuum: false, hydraulic: true, apu: false },
  autopilot: { type: 'ga', maxBank: 20, maxVs: 1000, rollKp: 1, rollKd: 0.3, rollKi: 0.1, pitchKp: 1, pitchKd: 0.3, pitchKi: 0.2, vsGain: 0.0005, autoTrim: false, autothrottle: false },
  camera: { eye: [3.1, 0.55, -1.0], fov: 78, chaseDist: 25, chaseHeight: 6 },
  lights: lights({ half: 1.3, tipX: 0.4, tipZ: -0.3, tail: -10.4, tailZ: -2.6, beacon: [-2.5, 0, -1.9], landing: [3.0, 0, 1.3] }),
};
