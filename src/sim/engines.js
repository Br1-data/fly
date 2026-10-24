// Engine models: piston + fixed-pitch propeller, and turbofan/turbojet.
import { clamp, table1, approach, moveTowards } from '../core/math.js';
import { P0, T0, RHO0 } from './atmosphere.js';

const TWO_PI = 2 * Math.PI;

/** Mixture power factor as a function of equivalence ratio phi (1 = stoichiometric). */
function mixturePower(phi) {
  if (phi < 0.55 || phi > 2.3) return 0;
  if (phi < 0.85) return 0.25 + ((phi - 0.55) / 0.3) * 0.7;
  if (phi < 1.08) return 0.95 + ((phi - 0.85) / 0.23) * 0.05;
  return Math.max(0.35, 1 - 0.32 * (phi - 1.08) ** 1.6);
}

export class PistonEngine {
  constructor(p) {
    this.p = p;
    this.type = 'piston';
    this.throttle = 0;
    this.mixture = 1;
    this.magnetos = 0; // 0 OFF, 1 R, 2 L, 3 BOTH, 4 START
    this.carbHeat = false;
    this.primed = 0;
    this.fuelAvailable = true;
    this.starterPower = true; // set by electrical system
    this.failed = false;
    this.running = false;
    this.rpm = 0;
    this.omega = 0;
    this.thrust = 0;
    this.propTorque = 0;
    this.engineTorque = 0;
    this.fuelFlow = 0; // kg/s
    this.map = P0; // manifold pressure (Pa)
    this.egt = 288;
    this.cht = 288;
    this.oilTemp = 288;
    this.oilPress = 0; // psi
    this.carbIce = 0;
    this.phi = 1;
    this.power = 0;
    this.roughness = 0;
    this.propAngle = 0;
    this.slipVelocity = 0;
    this._lastAmbient = 288;
  }

  reset(running, amb = 288) {
    this.running = running;
    this.failed = false;
    this.carbIce = 0;
    this._lastAmbient = amb;
    if (running) {
      this.rpm = this.p.idleRPM || 700;
      this.magnetos = 3;
      this.mixture = 1;
      this.oilTemp = amb + 55;
      this.cht = amb + 120;
      this.egt = amb + 600;
      this.oilPress = 60;
    } else {
      this.rpm = 0;
      this.magnetos = 0;
      this.oilTemp = amb;
      this.cht = amb;
      this.egt = amb;
      this.oilPress = 0;
    }
    this.omega = (this.rpm * TWO_PI) / 60;
  }

  /**
   * env: { rho, p, T, vAxial (m/s along thrust line), humidity (0..1), dt }
   */
  step(dt, env) {
    const p = this.p;
    const D = p.propDiameter;
    const n = Math.max(this.omega / TWO_PI, 0);
    const V = Math.max(env.vAxial, 0);

    // ---- induction / mixture ----
    const delta = env.p / P0;
    const tempCorr = Math.sqrt(T0 / env.T);
    const thr = clamp(this.throttle, 0, 1);
    const airFrac = p.idleFrac + (1 - p.idleFrac) * Math.pow(thr, 1.15);
    const mapRatio = 0.3 + 0.67 * Math.pow(thr, 0.8);
    const pumping = clamp(this.rpm / 900, 0, 1);
    this.map = env.p * (1 - pumping * (1 - mapRatio));

    // carburettor ice: forms with high humidity, -10..+25 C and low throttle
    const oatC = env.T - 273.15;
    if (p.carburettor) {
      const iceRisk = env.humidity > 0.5 && oatC > -12 && oatC < 27 ? (env.humidity - 0.5) * 2 * (1.2 - thr) : 0;
      if (this.carbHeat) this.carbIce = Math.max(0, this.carbIce - dt * 0.05);
      else if (this.running) this.carbIce = clamp(this.carbIce + iceRisk * dt * 0.0025, 0, 1);
    }
    const rhoRatio = env.rho / RHO0;
    const heatRich = this.carbHeat ? 1.12 : 1;
    this.phi = this.mixture * 1.18 * Math.pow(1 / Math.max(rhoRatio, 0.2), 0.85) * heatRich * (1 + this.carbIce * 0.4);
    const mixF = mixturePower(this.phi);

    // ignition
    let magF = 0;
    if (this.magnetos === 3 || this.magnetos === 4) magF = 1;
    else if (this.magnetos === 1 || this.magnetos === 2) magF = 0.955;
    const fuel = this.fuelAvailable && !this.failed && this.mixture > 0.04;
    const canFire = fuel && magF > 0 && mixF > 0 && this.rpm > 90;

    if (canFire) {
      if (!this.running && this.rpm > 120) this.running = true;
    } else if (this.running) {
      this.running = false;
    }

    // ---- torques ----
    const omegaRated = (p.ratedRPM * TWO_PI) / 60;
    let qComb = 0;
    if (this.running) {
      const iceLoss = 1 - this.carbIce * 0.65;
      const heatLoss = this.carbHeat ? 0.9 : 1;
      qComb = (p.maxPower / omegaRated) * airFrac * delta * tempCorr * mixF * magF * iceLoss * heatLoss;
      // misfire roughness when lean/rich or iced
      this.roughness = clamp((1 - mixF) * 1.5 + this.carbIce * 0.8 + (magF < 1 ? 0.15 : 0), 0, 1);
    } else {
      this.roughness = 0;
    }
    this.power = qComb * this.omega;

    // propeller
    let J = n > 0.5 ? V / (n * D) : 10;
    let T, Qp;
    const JMAX = 2.0;
    if (J <= JMAX) {
      T = table1(p.ct, J) * env.rho * n * n * D ** 4;
      Qp = (table1(p.cp, J) * env.rho * n * n * D ** 5) / TWO_PI;
    } else {
      const ctS = table1(p.ct, JMAX) / (JMAX * JMAX);
      const cpS = table1(p.cp, JMAX) / (JMAX * JMAX);
      T = ctS * env.rho * V * V * D * D;
      Qp = (cpS * env.rho * V * V * D ** 3) / TWO_PI;
      J = JMAX;
    }

    // friction + compression, starter
    const rpm = this.rpm;
    let qFric = p.frictionTorque + p.frictionPerRPM * rpm;
    if (rpm < 1 && !this.running) qFric = p.frictionTorque * 1.6; // breakaway
    let qStarter = 0;
    if (this.magnetos === 4 && this.starterPower && !this.failed) {
      qStarter = p.starterTorque * clamp(1 - rpm / 320, 0, 1);
    }
    if (this.failed) qFric += 400;

    const qNet = qComb + qStarter - Qp;
    // friction opposes motion
    let omega = this.omega;
    const I = p.inertia;
    const accFree = qNet / I;
    const fricAcc = qFric / I;
    if (omega > 0.01) {
      omega += (accFree - fricAcc) * dt;
      if (omega < 0) omega = 0;
    } else {
      if (Math.abs(accFree) > fricAcc) omega += (accFree - Math.sign(accFree) * fricAcc) * dt;
      if (omega < 0) omega = 0; // no reverse rotation
    }
    this.omega = omega;
    this.rpm = (omega * 60) / TWO_PI;
    this.propAngle = (this.propAngle + omega * dt) % TWO_PI;
    this.thrust = T;
    this.propTorque = Qp;
    this.engineTorque = qComb + qStarter;

    // slipstream velocity increment (momentum theory)
    const A = Math.PI * D * D * 0.25;
    this.slipVelocity = T > 0 ? Math.sqrt(V * V + (2 * T) / (env.rho * A)) - V : 0;

    // ---- fuel flow ----
    if (this.running) {
      const hpGross = (qComb / Math.max(mixF * magF, 0.2)) * omega / 745.7;
      const lbh = hpGross * 0.39 * this.phi;
      this.fuelFlow = (lbh * 0.4536) / 3600;
    } else this.fuelFlow = 0;

    // ---- temperatures (K) / oil pressure ----
    const amb = env.T;
    const powFrac = this.power / p.maxPower;
    const egtTarget = this.running ? amb + (380 + 330 * Math.sqrt(Math.max(powFrac, 0))) * Math.max(0.55, 1 - 1.1 * (this.phi - 1) ** 2) : amb;
    this.egt = approach(this.egt, egtTarget, dt, this.running ? 3 : 25);
    const cooling = 1 + V / 40;
    const chtTarget = this.running ? amb + (60 + 170 * powFrac) * (1.4 / cooling + 0.45) : amb;
    this.cht = approach(this.cht, chtTarget, dt, 60);
    const oilTarget = this.running ? amb + 45 + 50 * powFrac : amb;
    this.oilTemp = approach(this.oilTemp, oilTarget, dt, 120);
    const oilPTarget = clamp(this.rpm / 1100, 0, 1) * (85 - (this.oilTemp - 330) * 0.15);
    this.oilPress = approach(this.oilPress, clamp(oilPTarget, 0, 100), dt, 1.5);
    this._J = J;
    return this;
  }
}

/** Turbofan/turbojet with N1/N2 spool dynamics, start sequence and thrust reverser. */
export class JetEngine {
  constructor(p) {
    this.p = p;
    this.type = 'jet';
    this.throttle = 0;
    this.reverseCmd = false;
    this.master = false; // fuel lever / engine master switch
    this.starter = false; // start selector / start button
    this.bleedAvailable = true;
    this.failed = false;
    this.running = false;
    this.n1 = 0;
    this.n2 = 0;
    this.egt = 288;
    this.fuelFlow = 0;
    this.thrust = 0;
    this.reverser = 0; // 0 stowed .. 1 deployed
    this.oilPress = 0;
    this.startPhase = 'off';
    this.fuelAvailable = true;
    this.slipVelocity = 0;
    this.propTorque = 0;
    this.engineTorque = 0;
    this.omega = 0;
  }

  reset(running, amb = 288) {
    this.running = running;
    this.failed = false;
    this.reverser = 0;
    if (running) {
      this.n2 = this.p.idleN2;
      this.n1 = this.n1FromN2(this.n2);
      this.egt = amb + 380;
      this.master = true;
      this.oilPress = 45;
      this.startPhase = 'run';
    } else {
      this.n1 = this.n2 = 0;
      this.egt = amb;
      this.master = false;
      this.oilPress = 0;
      this.startPhase = 'off';
    }
  }

  n1FromN2(n2) {
    const p = this.p;
    if (n2 <= 20) return n2 * 0.45;
    const x = clamp((n2 - p.idleN2) / (100 - p.idleN2), 0, 1);
    const idleN1 = p.idleN1;
    if (n2 < p.idleN2) return 9 + ((n2 - 20) / (p.idleN2 - 20)) * (idleN1 - 9);
    return idleN1 + (100 - idleN1) * Math.pow(x, 1.25);
  }

  /** env: { rho, p, T, mach, onGround, dt } */
  step(dt, env) {
    const p = this.p;
    const amb = env.T;
    const fuel = this.fuelAvailable && !this.failed;

    // start / run logic (N2 based)
    if (this.running) {
      if (!this.master || !fuel) {
        this.running = false;
        this.startPhase = 'off';
      }
    } else {
      if (this.starter && this.bleedAvailable && !this.failed) {
        this.startPhase = this.n2 < 16 || !this.master ? 'crank' : 'light';
        if (this.master && fuel && this.n2 >= 16) {
          // light-off and accelerate to idle
          this.n2 = moveTowards(this.n2, p.idleN2 + 0.5, (p.idleN2 - 16) / p.startTime, dt);
          if (this.n2 >= p.idleN2) {
            this.running = true;
            this.startPhase = 'run';
          }
        } else {
          this.n2 = moveTowards(this.n2, 24, 2.2, dt);
        }
      } else {
        // windmill / spool down
        const windmill = clamp(env.mach * 40, 0, 18);
        this.n2 = approach(this.n2, windmill, dt, 9);
        this.startPhase = 'off';
      }
    }

    let thr = clamp(this.throttle, 0, 1);
    // reverser (ground only)
    const revTarget = this.reverseCmd && env.onGround ? 1 : 0;
    this.reverser = moveTowards(this.reverser, revTarget, 0.6, dt);
    if (this.reverser > 0.05 && this.reverser < 0.95) thr = 0;

    if (this.running) {
      const flightIdle = env.onGround ? p.idleN2 : p.idleN2 + 3;
      const target = flightIdle + (100.5 - flightIdle) * thr;
      // spool time constant grows at low rpm
      const tau = p.spoolTau * (1 + 2.2 * clamp((80 - this.n2) / 30, 0, 1));
      this.n2 = approach(this.n2, target, dt, tau);
    }
    this.n1 = approach(this.n1, this.n1FromN2(this.n2), dt, 0.35);

    // thrust
    const n1f = this.n1 / 100;
    let tf;
    const idleN1 = p.idleN1 / 100;
    if (n1f < idleN1) tf = 0.05 * (n1f / idleN1) ** 2;
    else tf = 0.05 + 0.95 * Math.pow((n1f - idleN1) / (1 - idleN1), 2.6);
    if (!this.running) tf *= 0.2;
    const sigma = env.rho / RHO0;
    const M = env.mach;
    const lapse = Math.pow(sigma, p.densityExp) * Math.max(0.2, 1 - p.machLapse * M + 0.25 * M * M);
    let T = p.maxThrust * tf * lapse;
    if (this.reverser > 0.95) T = -T * p.reverseFraction;
    else if (this.reverser > 0.05) T *= 0.3;
    this.thrust = T;

    // fuel flow (kg/s)
    if (this.running) {
      const tsfc = p.tsfc0 + p.tsfcMach * M; // lb/(lbf h)
      const ff = Math.abs(T) * tsfc * 2.832e-5;
      this.fuelFlow = Math.max(ff, p.ffIdle * (0.5 + 0.5 * sigma));
    } else if (this.startPhase === 'light') this.fuelFlow = p.ffIdle * 0.6;
    else this.fuelFlow = 0;

    // EGT (K)
    let egtTarget = amb;
    if (this.running) egtTarget = amb + p.egtIdle + (p.egtMax - p.egtIdle) * Math.pow(clamp((this.n1 - p.idleN1) / (100 - p.idleN1), 0, 1), 1.6);
    else if (this.startPhase === 'light') egtTarget = amb + p.egtIdle * 1.5;
    this.egt = approach(this.egt, egtTarget, dt, this.running ? 2.5 : 6);
    this.oilPress = approach(this.oilPress, clamp(this.n2 / p.idleN2, 0, 1.3) * 45, dt, 2);
    this.slipVelocity = 0;
    return this;
  }
}

export function createEngine(def) {
  return def.type === 'piston' ? new PistonEngine(def) : new JetEngine(def);
}
