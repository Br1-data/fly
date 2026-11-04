// "Colibrì H-6": five-seat light turbine helicopter (class of the Bell 206 JetRanger).
// Two-blade teetering rotor, skids, one 420 shp turboshaft.
import { body, hstab, fin, lights, heliControls, skids, heliContacts } from './parts.js';

export default {
  id: 'heli',
  name: 'Colibrì H-6',
  category: 'Elicottero leggero a turbina',
  role: 'civil',
  helicopter: true,
  description:
    'Elicottero leggero da cinque posti con rotore bipala e una turbina da 420 shp. Collettivo sulla manetta, ciclico sulla cloche, pedali per il rotore di coda. La stabilizzazione (AFCS) mantiene l’assetto quando lasci i comandi. In caso di avaria si scende in autorotazione.',
  specs: ['Crociera 110 kt', 'Rotore bipala Ø 10,2 m', 'Turbina 420 shp', 'Hovering e autorotazione'],
  panel: 'ga',
  model: 'heli',
  sound: 'heli',
  takeoffTrim: 0,
  mass: { empty: 742, payload: 170, reference: 1250, mtow: 1451 },
  inertia: [1300, 4000, 3600, 200],
  cgHeight: 1.12,
  wing: { area: 1, span: 10.16, chord: 0.33, ar: 1, groundHeight: 0 },
  tailArm: 6,
  parasiteArea: 0.9,
  fuselageSideArea: 7,
  rotor: {
    radius: 5.08, blades: 2, chord: 0.33, rpm: 394, inertia: 750, hub: [0.1, 0, -1.65], rotation: 1,
    thetaMin: 0.02, thetaMax: 0.3, twist: -0.08, cyclicMax: 0.26, hubStiffness: 4000, lock: 5, cd0: 0.011, loadingMax: 0.12, maxPower: 236000,
    tail: { pos: [-6.05, 0, -0.65], radius: 0.79, ratio: 6.4, thrustMax: 3500, bias: 0.2, gain: 0.6 },
  },
  surfaces: [
    hstab({ area: 1.1, x: -4.4, z: -0.3, ar: 3.5, incidence: 2.5, tau: 0, cmCtrl: 0 }),
    fin({ area: 1.05, x: -5.9, z: -0.8, ar: 1.4, sweep: 40, tau: 0 }),
    ...body({ length: 9.5, width: 1.3, height: 1.7, x: 0.3 }),
  ],
  engines: [{
    type: 'jet', name: 'Turbina', pos: [-1.3, 0, -1.0], shaft: { power: 313000, rpm: 6016, bsfc: 1.05e-7 },
    maxThrust: 0, idleN1: 62, idleN2: 62, spoolTau: 0.8, startTime: 25, ffIdle: 0.012, tsfc0: 0, tsfcMach: 0, densityExp: 0.75, machLapse: 0, reverseFraction: 0, egtIdle: 420, egtMax: 780,
  }],
  fuel: { type: 'jeta', capacity: 290, defaultFraction: 0.8, tanks: [{ name: 'Principale', capacity: 290, y: 0 }] },
  gear: skids({ x0: 1.1, x1: -1.0, y: 1.0, z: 1.12 }),
  contacts: heliContacts({ nose: 2.4, tail: -6.2, belly: 0.75, hub: [0.1, 0, -1.65], radius: 5.08, tailRotor: [-6.05, 0, 0.1] }),
  controls: heliControls(),
  limits: { vne: 130, vno: 110, va: 110, vle: 999, gPos: 3.5, gNeg: -0.5, gearVsLimit: 3.2 },
  speeds: { vr: 0, vy: 52, vapp: 60, vref: 40, vs0: 0, vs1: 0, climb: 60, cruise: 110 },
  warnings: { stallRatio: 0.9 },
  systems: { volts: 28, batteryAh: 17, vacuum: false, hydraulic: true, apu: false },
  autopilot: { type: 'ga', maxBank: 20, maxVs: 1000, rollKp: 1, rollKd: 0.3, rollKi: 0.1, pitchKp: 1, pitchKd: 0.3, pitchKi: 0.2, vsGain: 0.0005, autoTrim: false, autothrottle: false },
  camera: { eye: [1.25, 0.35, -0.85], fov: 78, chaseDist: 17, chaseHeight: 4 },
  lights: lights({ half: 0.75, tipX: -0.2, tipZ: 0.2, tail: -6.4, tailZ: -0.9, beacon: [-1.5, 0, -1.25], landing: [1.6, 0, 0.75] }),
};
