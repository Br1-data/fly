// Pilot aids: SAS (stability augmentation and attitude modes), automatic RCS velocity
// nulling, flight assist (velocity control relative to a nearby object) and the vertical
// speed hold used for powered descents.
import { V3, Quat, clamp } from '../core/math.js';

export const SAS_MODES = [
  { id: 'stab', label: 'STAB', name: 'Stabilizza', key: 'Digit1' },
  { id: 'prograde', label: 'PRO', name: 'Prograde', key: 'Digit2' },
  { id: 'retrograde', label: 'RETRO', name: 'Retrograde', key: 'Digit3' },
  { id: 'normal', label: 'NORM', name: 'Normale', key: 'Digit4' },
  { id: 'antinormal', label: 'A-NORM', name: 'Antinormale', key: 'Digit5' },
  { id: 'radialOut', label: 'RAD+', name: 'Radiale esterno', key: 'Digit6' },
  { id: 'radialIn', label: 'RAD−', name: 'Radiale interno', key: 'Digit7' },
  { id: 'target', label: 'TGT', name: 'Verso il bersaglio', key: 'Digit8' },
  { id: 'antiTarget', label: 'A-TGT', name: 'Opposto al bersaglio', key: 'Digit9' },
  { id: 'maneuver', label: 'MAN', name: 'Vettore di manovra', key: 'Digit0' },
  { id: 'port', label: 'PORTA', name: 'Allinea alla porta di attracco', key: 'Minus' },
  { id: 'up', label: 'VERT', name: 'Verticale locale (atterraggio)', key: 'Equal' },
];

const tmp = new V3(), tmp2 = new V3();

/** Desired angular rate (rad/s) for an angle error with the "no overshoot" square-root law. */
function rateFor(angle, accel, maxRate) {
  const a = Math.abs(angle);
  const r = Math.min(maxRate, Math.sqrt(2 * accel * 0.55 * a), a * 2.2);
  return Math.sign(angle) * r;
}

/**
 * Rotation command (-1..1 per body axis, fraction of available torque).
 * @param ship Spacecraft
 * @param pilot {x roll, y pitch, z yaw} pilot rotation inputs -1..1
 * @param sas {on, mode, hold: Quat|null}
 * @param target {dir: V3 world, up?: V3 world} or null
 */
export function rotationCommand(ship, pilot, sas, target) {
  const out = new V3();
  const T = Math.max(1, ship.torqueAvailable() + gimbalTorque(ship));
  const I = ship.inertia;
  if (!sas.on) {
    out.set(pilot.x, pilot.y, pilot.z);
    return out;
  }
  const maxRate = { x: 0.9, y: 0.6, z: 0.6 }; // rad/s
  const acc = { x: T / I.x, y: T / I.y, z: T / I.z };
  for (const k of ['x', 'y', 'z']) maxRate[k] = Math.min(maxRate[k], Math.max(0.05, Math.sqrt(acc[k]) * 0.9));
  const want = new V3();
  const manual = Math.abs(pilot.x) > 0.02 || Math.abs(pilot.y) > 0.02 || Math.abs(pilot.z) > 0.02;
  if (manual) sas.hold = null;
  if (target?.dir) {
    // Point body x at target.dir (and body -z at target.up when given).
    const db = ship.q.rotateInv(target.dir, tmp);
    const ang = Math.acos(clamp(db.x, -1, 1));
    const axY = -db.z, axZ = db.y;
    const al = Math.hypot(axY, axZ);
    if (al > 1e-6) {
      want.y = rateFor((axY / al) * ang, acc.y, maxRate.y);
      want.z = rateFor((axZ / al) * ang, acc.z, maxRate.z);
    } else if (db.x < 0) want.y = maxRate.y; // exactly opposite: pick an axis
    if (target.up) {
      const ub = ship.q.rotateInv(target.up, tmp2);
      // Roll error: angle of the target up vector around body x, measured from body -z.
      const roll = Math.atan2(ub.y, -ub.z);
      want.x = ang < 0.5 ? rateFor(roll, acc.x, maxRate.x) : 0;
    }
  } else if (sas.mode === 'stab' || !target) {
    if (!manual && !sas.hold && ship.omega.len() < 0.02) sas.hold = ship.q.clone();
    if (sas.hold) {
      // Error quaternion body-frame axis-angle: q_err = q⁻¹ · q_hold
      const q = ship.q, h = sas.hold;
      const w = q.w * h.w + q.x * h.x + q.y * h.y + q.z * h.z;
      const x = q.w * h.x - q.x * h.w - q.y * h.z + q.z * h.y;
      const y = q.w * h.y + q.x * h.z - q.y * h.w - q.z * h.x;
      const z = q.w * h.z - q.x * h.y + q.y * h.x - q.z * h.w;
      const s = w < 0 ? -2 : 2;
      want.set(rateFor(x * s, acc.x, maxRate.x), rateFor(y * s, acc.y, maxRate.y), rateFor(z * s, acc.z, maxRate.z));
    }
  }
  // Pilot input is a rate command while SAS is on.
  if (Math.abs(pilot.x) > 0.02) want.x = pilot.x * maxRate.x;
  if (Math.abs(pilot.y) > 0.02) want.y = pilot.y * maxRate.y;
  if (Math.abs(pilot.z) > 0.02) want.z = pilot.z * maxRate.z;
  const tau = 0.22;
  out.set(
    clamp(((want.x - ship.omega.x) * I.x) / tau / T, -1, 1),
    clamp(((want.y - ship.omega.y) * I.y) / tau / T, -1, 1),
    clamp(((want.z - ship.omega.z) * I.z) / tau / T, -1, 1),
  );
  // Tiny commands would only waste monopropellant.
  for (const k of ['x', 'y', 'z']) if (Math.abs(out[k]) < 0.015) out[k] = 0;
  return out;
}

function gimbalTorque(ship) {
  const st = ship.engineStage;
  if (!st || ship.thrust <= 0 || !st.engine.gimbal) return 0;
  return ship.thrust * Math.abs(st.engine.x - ship.com) * Math.sin((st.engine.gimbal * Math.PI) / 180);
}

/** RCS translation command nulling a relative velocity (world, m/s). Returns body command. */
export function killVelocityCommand(ship, vRelWorld, keepRadial = null) {
  const v = new V3().copy(vRelWorld);
  if (keepRadial) v.addScaled(keepRadial, -v.dot(keepRadial));
  const vb = ship.q.rotateInv(v, new V3());
  const a = ship.def.rcs.thrust / ship.mass;
  const k = 1 / Math.max(0.02, a * 0.7);
  const out = new V3(clamp(-vb.x * k, -1, 1), clamp(-vb.y * k, -1, 1), clamp(-vb.z * k, -1, 1));
  for (const key of ['x', 'y', 'z']) if (Math.abs(vb[key]) < 0.01) out[key] = 0;
  return out;
}

/**
 * Flight assist: the throttle sets the forward speed relative to the reference, the
 * translation inputs set lateral / vertical speeds, the thrusters do the rest.
 * Returns {trans: V3 body command, throttle}.
 */
export function flightAssistCommand(ship, vRelWorld, throttleInput, transInput, maxSpeed) {
  const vb = ship.q.rotateInv(vRelWorld, new V3());
  const want = new V3(throttleInput * maxSpeed + transInput.x * 25, transInput.y * 30, transInput.z * 30);
  const err = new V3().copy(want).sub(vb);
  const aR = ship.def.rcs.thrust / ship.mass;
  const st = ship.engineStage;
  const aM = st && st.fuelLeft > 0 ? st.engine.thrustVac / ship.mass : 0;
  const trans = new V3(clamp(err.x / (aR * 0.6), -1, 1), clamp(err.y / (aR * 0.6), -1, 1), clamp(err.z / (aR * 0.6), -1, 1));
  for (const key of ['x', 'y', 'z']) if (Math.abs(err[key]) < 0.02) trans[key] = 0;
  const throttle = aM > 0 && err.x > 0.5 ? clamp(err.x / (aM * 0.8), 0, 1) : 0;
  return { trans, throttle };
}

/**
 * Vertical speed hold: throttle lever 0.5 = hover, 0 = descend at 12 m/s, 1 = climb at 12 m/s.
 * Returns the engine throttle needed (0..1).
 */
export function verticalSpeedThrottle(ship, lever, up, gravity, vs) {
  const st = ship.engineStage;
  if (!st || st.fuelLeft <= 0) return 0;
  const want = (lever - 0.5) * 2 * 12;
  const cosT = ship.forward(new V3()).dot(up);
  if (cosT < 0.2) return lever; // too tilted to hold height: plain throttle
  const acc = gravity + clamp((want - vs) / 1.1, -4, 4);
  const thrust = (ship.mass * acc) / cosT;
  return clamp(thrust / st.engine.thrustVac, 0, 1);
}

/** Quaternion that points body x along `dir` with body -z as close as possible to `up`. */
export function lookRotation(dir, up) {
  const x = new V3().copy(dir).normalize();
  const upv = new V3().copy(up);
  const zNeg = upv.addScaled(x, -upv.dot(x)).normalize(); // body -z
  const z = new V3().copy(zNeg).scale(-1);
  const y = new V3().crossVectors(z, x);
  // Rotation matrix columns = body axes in world.
  const m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  const q = new Quat();
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q.w = 0.25 * s; q.x = (m21 - m12) / s; q.y = (m02 - m20) / s; q.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q.w = (m21 - m12) / s; q.x = 0.25 * s; q.y = (m01 + m10) / s; q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q.w = (m02 - m20) / s; q.x = (m01 + m10) / s; q.y = 0.25 * s; q.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q.w = (m10 - m01) / s; q.x = (m02 + m20) / s; q.y = (m12 + m21) / s; q.z = 0.25 * s;
  }
  return q.normalize();
}
