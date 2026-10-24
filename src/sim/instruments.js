// Instrument dynamics: lags, gyro drift/tumble, compass errors and slip ball.
import { DEG, RAD, clamp, approach, wrap180, wrap360 } from '../core/math.js';
import { FT, FPM, KT } from '../core/units.js';

export class Instruments {
  constructor() {
    this.reset();
  }
  reset(heading = 0) {
    this.dg = heading; // heading indicator (deg)
    this.dgDrift = 0.25 / 60; // deg/s
    this.compass = heading;
    this.compassRate = 0;
    this.vsi = 0; // fpm (lagged)
    this.ivsi = 0;
    this.asi = 0; // kt
    this.alt = 0; // ft
    this.aiPitch = 0;
    this.aiRoll = 0;
    this.turnRate = 0; // deg/s
    this.ball = 0; // -1..1
    this.gMeter = 1;
    this.gMax = 1;
    this.gMin = 1;
    this.aoa = 0;
    this.clock = 0;
    this.timer = 0;
    this.timerRun = false;
    this.radioAlt = 0;
  }

  update(dt, sim) {
    const fm = sim.fm;
    const sys = fm.systems;
    const spin = sys.gyroSpin;
    // airspeed (pitot) with small lag
    this.asi = approach(this.asi, fm.iasKt, dt, 0.15);
    // altimeter
    this.alt = approach(this.alt, fm.indicatedAlt / FT, dt, 0.25);
    // VSI: conventional lags ~5 s, IVSI (jets) much faster
    const vs = fm.vs / FPM;
    this.vsi = approach(this.vsi, vs, dt, sim.def.panel === 'ga' ? 2.2 : 0.6);
    // attitude indicator: tumbles slowly when the gyro spins down
    const tgtP = fm.pitch,
      tgtR = fm.roll;
    if (spin > 0.8) {
      this.aiPitch = approach(this.aiPitch, tgtP, dt, 0.05);
      this.aiRoll = this.aiRoll + wrap180(tgtR - this.aiRoll) * clamp(dt / 0.05, 0, 1);
    } else {
      // precess towards a random-ish tumbled attitude
      const k = 1 - spin;
      this.aiPitch = approach(this.aiPitch, tgtP * spin + 18 * k, dt, 6);
      this.aiRoll = approach(this.aiRoll, tgtR * spin + 25 * k, dt, 6);
    }
    // heading indicator drift (needs sync with D key)
    if (spin > 0.8) {
      const yawRate = fm.omega.z * RAD * Math.cos(fm.euler.phi) + fm.omega.y * RAD * Math.sin(fm.euler.phi);
      this.dg = wrap360(this.dg + yawRate * dt + this.dgDrift * dt * (sim.settings.gyroDrift ? 1 : 0));
      if (!sim.settings.gyroDrift) this.dg = wrap360(this.dg + wrap180(fm.heading - this.dg) * clamp(dt, 0, 1));
    }
    // magnetic compass: card with damping; turning error (northerly) and acceleration error
    const bankErr = Math.sin(fm.euler.phi) * Math.cos(fm.heading * DEG) * 25; // dip error
    const accErr = -fm.nx * Math.sin(fm.heading * DEG) * 40;
    const ind = wrap360(fm.heading + bankErr + accErr);
    const err = wrap180(ind - this.compass);
    this.compassRate += (err * 6 - this.compassRate * 2.4) * dt;
    this.compass = wrap360(this.compass + this.compassRate * dt);
    // turn coordinator (electric)
    const powered = sys.busVolts > 18;
    const rate = (fm.omega.z * Math.cos(fm.euler.phi) + fm.omega.y * Math.sin(fm.euler.phi)) * RAD + fm.omega.x * RAD * 0.1;
    this.turnRate = approach(this.turnRate, powered ? rate : 0, dt, 0.4);
    // slip ball (lateral specific force)
    this.ball = approach(this.ball, clamp(-fm.ny * 6, -1, 1), dt, 0.3);
    // g-meter
    this.gMeter = approach(this.gMeter, fm.nz, dt, 0.08);
    this.gMax = Math.max(this.gMax, this.gMeter);
    this.gMin = Math.min(this.gMin, this.gMeter);
    this.aoa = fm.alpha * RAD;
    this.radioAlt = fm.aglFt;
    this.clock += dt;
    if (this.timerRun) this.timer += dt;
  }

  syncDG(heading) {
    this.dg = heading;
  }
}
