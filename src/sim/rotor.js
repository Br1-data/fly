// Helicopter rotor system: main rotor (blade-element / momentum theory with Glauert
// inflow, ground effect, vortex-ring losses, blade-loading limit), first-order disc
// flapping (cyclic, blow-back, rate damping, hub stiffness), tail rotor, rotor-speed
// dynamics with turboshaft governor (autorotation emerges when power is lost), and an
// AFCS that makes the aircraft flyable with keyboard, touch or gamepad.
//
// Body axes: x forward, y right, z down. Angles in radians.
import { V3, clamp, G0, DEG } from '../core/math.js';

const vh = new V3(), vip = new V3(), nrm = new V3(), tmp = new V3(), force = new V3(), arm = new V3(), vTail = new V3();

export class Rotor {
  constructor(def) {
    const p = (this.p = def.rotor);
    this.omega0 = (p.rpm * 2 * Math.PI) / 60;
    this.area = Math.PI * p.radius * p.radius;
    this.sigma = (p.blades * p.chord) / (Math.PI * p.radius);
    this.hub = new V3().fromArray(p.hub);
    this.tailPos = new V3().fromArray(p.tail.pos);
    this.tailArea = Math.PI * p.tail.radius * p.tail.radius;
    this.turn = p.rotation ?? 1; // +1: anticlockwise seen from above (nose-right torque)
    this.omega = 0;
    this.lambdaI = 0.05;
    this.thrust = 0;
    this.power = 0;
    this.powerAvailable = 0;
    this.tailThrust = 0;
    this.a1 = 0;
    this.b1 = 0;
    this.ctl = { collective: 0, a1c: 0, b1c: 0, pedal: 0 };
    this.override = null; // explicit controls (trim solver)
    this.gov = 0;
    this.govInt = 0;
    this.afcs = { thetaHold: 0, psiHold: 0, phiTrim: 0, qInt: 0, pInt: 0, rInt: 0, holding: false, holdingYaw: false };
    this.vrs = 0;
  }

  get rpmPct() { return (100 * this.omega) / this.omega0; }

  reset(running) {
    this.omega = running ? this.omega0 : 0;
    this.lambdaI = 0.05;
    this.gov = running ? 0.5 : 0;
    this.govInt = 0;
    this.thrust = 0;
    Object.assign(this.afcs, { qInt: 0, pInt: 0, rInt: 0, holding: false, holdingYaw: false, phiTrim: 0 });
  }

  /** Moment per radian of disc tilt: thrust lever arm above the CG plus hub stiffness. */
  controlPower(fm) {
    return Math.max(fm.mass * G0, this.thrust) * Math.abs(this.hub.z) + (this.p.hubStiffness || 0);
  }

  /**
   * Pilot controls to rotor controls. With the AFCS (fcs mode 'normal'): pitch is rate
   * command / attitude hold, roll is attitude command (35°), pedals are yaw-rate command
   * with heading hold in the hover and turn coordination in forward flight, and the
   * collective gets vertical-speed damping. Direct mode passes the inputs straight through.
   */
  controls(dt, fm, pitch, roll, yaw) {
    const p = this.p, c = this.ctl, inp = fm.input;
    c.collective = clamp(inp.collective ?? 0, 0, 1);
    if (!fm.fcs || fm.fcs.mode !== 'normal' || fm.onGround && c.collective < 0.25) {
      c.a1c = clamp(pitch + inp.elevTrim * 0.4, -1, 1) * p.cyclicMax;
      c.b1c = clamp(roll + inp.ailTrim * 0.4, -1, 1) * p.cyclicMax;
      c.pedal = clamp(yaw + inp.rudTrim * 0.4, -1, 1);
      // Keep the AFCS references aligned so engaging it causes no jump.
      const a = this.afcs;
      a.thetaHold = fm.euler.theta;
      a.psiHold = fm.euler.psi;
      a.qInt = c.a1c;
      a.pInt = c.b1c;
      a.rInt = c.pedal;
      return;
    }
    const a = this.afcs, e = fm.euler, w = fm.omega;
    const Iyy = fm.Iyy, Ixx = fm.Ixx, Izz = fm.Izz;
    const mRad = this.controlPower(fm);
    // ---- hover hold: at low speed with the stick released, attitude references drift to
    // cancel ground velocity (translational rate damping), so the hover stays put.
    const psi = e.psi, gu = fm.vel.x * Math.cos(psi) + fm.vel.y * Math.sin(psi), gv = -fm.vel.x * Math.sin(psi) + fm.vel.y * Math.cos(psi);
    const hover = !fm.onGround && Math.hypot(gu, gv) < 10;
    let thetaBias = 0, phiBias = 0;
    if (hover) {
      if (Math.abs(pitch) < 0.04) { a.thetaHold = clamp(a.thetaHold + 0.012 * gu * dt, -0.3, 0.3); thetaBias = 0.02 * gu; }
      if (Math.abs(roll) < 0.04) { a.phiTrim = clamp(a.phiTrim - 0.012 * gv * dt, -0.2, 0.2); phiBias = -0.02 * gv; }
    }
    // ---- pitch: rate command, attitude hold, ±35° envelope
    let qCmd;
    if (Math.abs(pitch) > 0.04) {
      qCmd = pitch * 0.5;
      a.thetaHold = e.theta;
      a.holding = false;
    } else {
      if (!a.holding) { a.thetaHold = e.theta; a.holding = true; }
      qCmd = 2.2 * (a.thetaHold + thetaBias - e.theta);
    }
    if (e.theta > 35 * DEG && qCmd > 0) qCmd = 2 * (35 * DEG - e.theta);
    if (e.theta < -35 * DEG && qCmd < 0) qCmd = 2 * (-35 * DEG - e.theta);
    const kq = (Iyy * 5) / mRad;
    a.qInt = clamp(a.qInt + kq * 0.9 * (qCmd - w.y) * dt, -p.cyclicMax, p.cyclicMax);
    c.a1c = clamp(kq * (qCmd - w.y) + a.qInt + inp.elevTrim * 0.3 * p.cyclicMax, -p.cyclicMax, p.cyclicMax);
    // ---- roll: attitude command (stick = bank angle), level when released
    const phiCmd = a.phiTrim + phiBias + roll * 35 * DEG;
    const pCmd = 3 * (phiCmd - e.phi);
    const kp = (Ixx * 6) / mRad;
    a.pInt = clamp(a.pInt + kp * 0.8 * (pCmd - w.x) * dt, -p.cyclicMax, p.cyclicMax);
    c.b1c = clamp(kp * (pCmd - w.x) + a.pInt + inp.ailTrim * 0.3 * p.cyclicMax, -p.cyclicMax, p.cyclicMax);
    // ---- yaw: rate command; heading hold in the hover, coordinated turns when fast
    const V = fm.tas || 0;
    let rCmd;
    if (Math.abs(yaw) > 0.04) {
      rCmd = yaw * 0.75;
      a.psiHold = e.psi;
      a.holdingYaw = false;
    } else if (V > 18) {
      rCmd = (G0 * Math.sin(e.phi) * Math.cos(e.theta)) / V + 2 * fm.beta;
      a.psiHold = e.psi;
    } else {
      if (!a.holdingYaw) { a.psiHold = e.psi; a.holdingYaw = true; }
      let d = a.psiHold - e.psi;
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      rCmd = 1.6 * d;
    }
    const trForce = p.tail.thrustMax * Math.max(0.2, (this.omega / this.omega0) ** 2) * (fm.env.rho / 1.225);
    const kr = (Izz * 4) / (Math.abs(this.tailPos.x) * trForce * p.tail.gain);
    a.rInt = clamp(a.rInt + kr * 0.8 * (rCmd - w.z) * dt, -1, 1);
    c.pedal = clamp(kr * (rCmd - w.z) + a.rInt, -1, 1);
    // ---- collective: vertical-speed damping
    c.collective = clamp(c.collective - 0.012 * fm.vs, 0, 1);
  }

  /** Forces and moments of the main and tail rotors, added to F and M (body axes). */
  addForces(fm, F, M) {
    const p = this.p, c = this.override || this.ctl;
    const rho = fm.env.rho, R = p.radius, A = this.area;
    const omega = Math.max(this.omega, 1e-3);
    const vt = omega * R;
    // Disc flapping: cyclic tilt, blow-back with speed, lag behind pitch and roll rates.
    vh.crossVectors(fm.omega, this.hub).add(fm.vAir);
    const mu0 = Math.hypot(vh.x, vh.y) / Math.max(vt, 1);
    const theta0 = p.thetaMin + c.collective * (p.thetaMax - p.thetaMin);
    const mux = clamp(vh.x / Math.max(vt, 1), -0.5, 0.5);
    // Blow-back uses the total inflow of the previous step (induced + climb through the disc).
    const blow = (2 * (4 / 3 * theta0 - (this.lambdaTotal ?? this.lambdaI)) * mux) / (1 + 1.5 * mux * mux);
    const lag = (16 / (p.lock || 8)) / Math.max(omega, 0.4 * this.omega0);
    this.a1 = c.a1c + blow - lag * fm.omega.y;
    this.b1 = c.b1c - lag * fm.omega.x - 0.18 * blow * this.turn;
    nrm.set(-Math.sin(this.a1), Math.sin(this.b1), -Math.cos(this.a1) * Math.cos(this.b1)).normalize();
    // Inflow (Glauert) with ground effect; disc-normal and in-plane velocity components.
    const vn = -vh.dot(nrm); // airflow down through the disc due to motion
    const vClimb = -vn; // positive climbing along the thrust axis
    vip.copy(vh).addScaled(nrm, vh.dot(nrm) * -1);
    const vInPlane = vip.len();
    const mu = vInPlane / Math.max(vt, 1);
    const lc = vClimb / Math.max(vt, 1);
    const hubHeight = Math.max(0.2, fm.agl + (fm.def.cgHeight || 1) + Math.abs(this.hub.z));
    const ge = hubHeight < 2 * R ? clamp(1 - (R / (4 * hubHeight)) ** 2, 0.72, 1) : 1;
    const sa2 = (this.sigma * (p.lift || 5.7)) / 2;
    let li = this.lambdaI, ct = 0;
    const ctMax = this.sigma * (p.loadingMax || 0.13);
    for (let k = 0; k < 6; k++) {
      const lam = lc + li;
      ct = sa2 * ((theta0 / 3) * (1 + 1.5 * mu * mu) + ((p.twist || -0.15) / 4) * (1 + mu * mu) - lam / 2);
      ct = clamp(ct, -0.3 * ctMax, ctMax);
      const lh = Math.sqrt(Math.max(Math.abs(ct), 1e-6) / 2);
      const next = (ct / (2 * Math.sqrt(mu * mu + lam * lam + 0.15 * lh * lh))) * ge;
      li = li * 0.4 + next * 0.6;
    }
    this.lambdaI = li;
    this.lambdaTotal = lc + li;
    // Vortex-ring state: slow vertical descent through the own downwash loses thrust.
    const lh0 = Math.sqrt(Math.max(ct, 1e-6) / 2);
    const vrs = mu < 0.06 && lc < 0 ? clamp(1 - Math.abs(-lc / lh0 - 1) / 0.7, 0, 1) * (1 - mu / 0.06) : 0;
    this.vrs = vrs;
    const T = ct * (1 - 0.3 * vrs) * rho * A * vt * vt;
    this.thrust = T;
    // Power: induced + climb/propulsive + profile (+ tail rotor below).
    const pProfile = (this.sigma * (p.cd0 || 0.011)) / 8 * (1 + 4.65 * mu * mu) * rho * A * vt ** 3;
    let power = T * (li + lc) * vt * (1 + 0.15 * vrs) + pProfile;
    // Main rotor thrust at the hub, in-plane profile drag (H-force).
    force.copy(nrm).scale(T);
    if (vInPlane > 0.1) force.addScaled(vip, -((this.sigma * (p.cd0 || 0.011)) / 4) * mu * rho * A * vt * vt / vInPlane);
    F.add(force);
    tmp.crossVectors(this.hub, force);
    M.add(tmp);
    // Hub stiffness: tilting the disc twists the mast.
    // Hub stiffness grows with the centrifugal stiffening of the blades.
    const kHub = (p.hubStiffness || 0) * Math.min(1, (this.omega / this.omega0) ** 2);
    M.y += kHub * this.a1;
    M.x += kHub * this.b1;
    // Tail rotor: anti-torque thrust from pedal pitch, with inflow damping.
    vTail.crossVectors(fm.omega, this.tailPos).add(fm.vAir);
    const tr = p.tail;
    const trPitch = tr.bias - this.turn * c.pedal * tr.gain;
    const scale = (omega / this.omega0) ** 2 * (rho / 1.225);
    let Ttr = tr.thrustMax * trPitch * scale - rho * this.tailArea * tr.radius * tr.ratio * omega * 0.3 * vTail.y * this.turn;
    Ttr *= this.turn; // + pushes the tail right for an anticlockwise rotor
    this.tailThrust = Ttr;
    arm.set(0, Ttr, 0);
    F.add(arm);
    tmp.crossVectors(this.tailPos, arm);
    M.add(tmp);
    const pTail = Math.abs(Ttr) ** 1.5 / Math.sqrt(2 * rho * this.tailArea) * 1.2 + 0.02 * pProfile;
    power += pTail;
    this.power = power;
    // Torque reaction on the fuselage: the shaft torque the engines deliver to the main
    // rotor (in a steady trim this equals the rotor's aerodynamic torque; in autorotation
    // it is nil).
    const qShaft = this.override || this.qEngine === undefined ? (power - pTail) / omega : this.qEngine - pTail / omega;
    M.z += this.turn * qShaft;
  }

  /** Rotor speed dynamics and the engine governor. */
  step(dt, fm) {
    const p = this.p;
    let available = 0;
    for (const e of fm.engines) {
      if (e.running) available += e._shaftPower || 0;
      e.rpm = (this.omega / this.omega0) * (e.p.shaft?.rpm || 6000);
    }
    available = Math.min(available, p.maxPower || Infinity);
    this.powerAvailable = available;
    const omega = Math.max(this.omega, 0.25 * this.omega0);
    // Transmission torque limit: the engines cannot twist the rotor (and the fuselage) harder.
    const qEngine = Math.min(available / omega, (1.15 * (p.maxPower || available)) / this.omega0);
    this.qEngine = qEngine;
    const qRotor = this.omega > 0.5 ? this.power / Math.max(this.omega, 1) : 0;
    const qFriction = 0.004 * (p.maxPower || 1e5) / this.omega0 * (this.omega / this.omega0) + (this.omega > 0.01 ? 0.002 * (p.maxPower || 1e5) / this.omega0 : 0);
    const prev = this.omega;
    this.omega = Math.max(0, this.omega + ((qEngine - qRotor - qFriction) / p.inertia) * dt);
    const rate = dt > 0 ? (this.omega - prev) / dt / this.omega0 : 0;
    // Governor: hold 100 % NR. The feed-forward inverts the turbines' steady power curve
    // for the power the rotors demand; a gentle PID trims the rest.
    const err = (this.omega0 - this.omega) / this.omega0;
    const running = fm.engines.filter((e) => e.running && !e.failed);
    const sigma = (fm.env.rho || 1.225) / 1.225;
    const maxP = running.reduce((s, e) => s + e.p.shaft.power * Math.pow(sigma, e.p.densityExp), 0) || 1;
    const ff = clamp(Math.max(this.power, 0) / Math.min(maxP, (p.maxPower || maxP) * 1.5), 0, 1);
    this.govInt = clamp(this.govInt + err * 1.2 * dt, -0.3, 0.3);
    this.gov = clamp(throttleFor(running[0] || fm.engines[0], ff, fm.onGround) + err * 3 - rate * 1.2 + this.govInt, 0, 1);
  }
}

/** Throttle that makes a turboshaft deliver `fraction` of its rated power (steady state). */
function throttleFor(engine, fraction, onGround) {
  if (!engine?.n1FromN2) return fraction;
  const p = engine.p;
  const flightIdle = onGround ? p.idleN2 : p.idleN2 + 3;
  const powerAt = (thr) => {
    const n1 = engine.n1FromN2(flightIdle + (100.5 - flightIdle) * thr) / 100;
    const idle = p.idleN1 / 100;
    return n1 < idle ? 0.05 * (n1 / idle) ** 2 : 0.05 + 0.95 * Math.pow((n1 - idle) / (1 - idle), 2.6);
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (powerAt(mid) < fraction) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Gaussian elimination for the trim solver (n × n). */
export function solveLinear(A, b) {
  const n = b.length, m = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
    if (Math.abs(m[piv][i]) < 1e-12) return null;
    [m[i], m[piv]] = [m[piv], m[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let k = i; k <= n; k++) m[r][k] -= f * m[i][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}
