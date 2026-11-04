// "Calabrone AH-9": twin-turbine attack helicopter (class of the A129 / AH-64).
// Hingeless four-blade rotor for crisp handling, tandem cockpit, stub wings, HUD.
import { DEG, body, hstab, fin, lights, heliControls, heliContacts } from './parts.js';

export default {
  id: 'heliattack',
  name: 'Calabrone AH-9',
  category: 'Elicottero d’attacco (militare)',
  role: 'military',
  helicopter: true,
  description:
    'Elicottero d’attacco biposto in tandem con rotore quadripala senza cerniere: risposta ai comandi pronta e grande agilità vicino al suolo. Due turbine da 950 shp, ali corte portacarichi, HUD. Ideale per il volo tattico a bassissima quota.',
  specs: ['Crociera 140 kt', '2 × 950 shp', 'Rotore rigido quadripala', 'Volo a bassissima quota'],
  panel: 'jet',
  model: 'heliattack',
  sound: 'heli',
  takeoffTrim: 0,
  mass: { empty: 3000, payload: 600, reference: 4300, mtow: 5100 },
  inertia: [3800, 16000, 14000, 800],
  cgHeight: 1.5,
  wing: { area: 1, span: 11.9, chord: 0.4, ar: 1, groundHeight: 0 },
  tailArm: 7.4,
  parasiteArea: 1.7,
  fuselageSideArea: 12,
  rotor: {
    radius: 5.95, blades: 4, chord: 0.4, rpm: 337, inertia: 2600, hub: [0.2, 0, -1.7], rotation: 1,
    thetaMin: 0.02, thetaMax: 0.34, twist: -0.1, cyclicMax: 0.26, hubStiffness: 70000, lock: 7, cd0: 0.01, loadingMax: 0.13, maxPower: 1.35e6,
    tail: { pos: [-7.4, 0, -1.3], radius: 1.15, ratio: 5.8, thrustMax: 7500, bias: 0.2, gain: 0.6 },
  },
  surfaces: [
    hstab({ area: 2.0, x: -6.9, z: -0.3, ar: 3.6, incidence: 2, tau: 0, cmCtrl: 0 }),
    fin({ area: 1.8, x: -7.0, z: -1.2, ar: 1.5, sweep: 40, tau: 0 }),
    ...body({ length: 12.3, width: 1.0, height: 1.9, x: 0.5 }),
  ],
  engines: [1, -1].map((side) => ({
    type: 'jet', name: side < 0 ? 'Motore 1' : 'Motore 2', pos: [-0.6, 0.55 * side, -1.2], shaft: { power: 700000, rpm: 27000, bsfc: 9e-8 },
    maxThrust: 0, idleN1: 62, idleN2: 62, spoolTau: 0.8, startTime: 26, ffIdle: 0.02, tsfc0: 0, tsfcMach: 0, densityExp: 0.75, machLapse: 0, reverseFraction: 0, egtIdle: 420, egtMax: 800,
  })).reverse(),
  fuel: { type: 'jeta', capacity: 750, defaultFraction: 0.75, tanks: [{ name: 'Anteriore', capacity: 375, y: 0 }, { name: 'Posteriore', capacity: 375, y: 0 }] },
  gear: [
    { name: 'left', pos: [1.4, -1.2, 1.5], travel: 0.28, k: 150000, c: 22000, brake: 'left', radius: 0.3, muBrake: 0.7, muRoll: 0.02 },
    { name: 'right', pos: [1.4, 1.2, 1.5], travel: 0.28, k: 150000, c: 22000, brake: 'right', radius: 0.3, muBrake: 0.7, muRoll: 0.02 },
    { name: 'tail', pos: [-6.5, 0, 0.9], travel: 0.18, k: 50000, c: 8000, steer: -40 * DEG, radius: 0.18, muRoll: 0.03 },
  ],
  contacts: heliContacts({ nose: 4.9, tail: -7.7, belly: 1.0, hub: [0.2, 0, -1.7], radius: 5.95, tailRotor: [-7.4, 0, -0.1] }),
  controls: heliControls(),
  limits: { vne: 170, vno: 150, va: 150, vle: 999, gPos: 3.5, gNeg: -0.5, gearVsLimit: 4.5 },
  speeds: { vr: 0, vy: 75, vapp: 70, vref: 50, vs0: 0, vs1: 0, climb: 75, cruise: 140 },
  warnings: { stallRatio: 0.9 },
  systems: { volts: 28, batteryAh: 24, vacuum: false, hydraulic: true, apu: false },
  autopilot: { type: 'ga', maxBank: 20, maxVs: 1000, rollKp: 1, rollKd: 0.3, rollKi: 0.1, pitchKp: 1, pitchKd: 0.3, pitchKi: 0.2, vsGain: 0.0005, autoTrim: false, autothrottle: false },
  camera: { eye: [1.6, 0, -1.25], fov: 78, chaseDist: 19, chaseHeight: 4.5 },
  lights: lights({ half: 2.3, tipX: 0.3, tipZ: -0.1, tail: -7.9, tailZ: -2.2, beacon: [-1.8, 0, -1.6], landing: [2.6, 0, 1.1] }),
};
