// Autopilot / flight director with lateral (ROL, HDG, NAV, LOC/APR) and vertical (PIT, VS, ALT,
// ALTS capture, GS, FLC) modes, autothrottle (SPEED / THR CLB / IDLE / RETARD) and autoland.
import { DEG, RAD, clamp, wrap180, approach, moveTowards } from '../core/math.js';
import { FT, FPM, KT } from '../core/units.js';

export class Autopilot {
  constructor(def) {
    this.def = def;
    this.cfg = def.autopilot;
    this.engaged = false;
    this.fd = true;
    this.athr = false;
    this.lateral = 'ROL';
    this.vertical = 'PIT';
    this.armedNav = false;
    this.armedApr = false;
    this.armedAlt = false;
    this.hdgBug = 0;
    this.altSel = 3000;
    this.vsSel = 0;
    this.spdSel = def.speeds.cruise || 120;
    this.navSource = 'NAV1';
    this.athrMode = 'SPEED';
    this.autoland = 'OFF';
    this.rollInt = 0;
    this.pitchInt = 0;
    this.thrInt = 0;
    this.phiCmd = 0;
    this.thetaCmd = 0;
    this.vsCmd = 0;
    this.altHold = 0;
    this.events = [];
    this.rollTarget = 0;
    this.pitchTarget = 0;
  }

  reset() {
    this.engaged = false;
    this.athr = false;
    this.lateral = 'ROL';
    this.vertical = 'PIT';
    this.armedNav = this.armedApr = this.armedAlt = false;
    this.autoland = 'OFF';
    this.rollInt = this.pitchInt = this.thrInt = 0;
  }

  engage(sim) {
    const fm = sim.fm;
    if (fm.onGround || !sim.fm.systems.avionicsPowered) return false;
    this.engaged = true;
    this.rollInt = 0;
    this.pitchInt = 0;
    if (this.lateral === 'ROL') this.rollTarget = Math.abs(fm.roll) < 6 ? 0 : clamp(fm.roll, -this.cfg.maxBank, this.cfg.maxBank);
    if (this.vertical === 'PIT') {
      if (this.cfg.type === 'ga') {
        this.vertical = 'VS';
        this.vsSel = Math.round(fm.vs / FPM / 100) * 100;
        this.armedAlt = true;
      } else this.pitchTarget = clamp(fm.pitch, -10, 15);
    }
    this.events.push('engage');
    return true;
  }

  disengage(reason = 'manual') {
    if (!this.engaged) return;
    this.engaged = false;
    this.autoland = 'OFF';
    this.events.push(reason === 'manual' ? 'disengage' : 'disengage-warn');
  }

  toggle(sim) {
    if (this.engaged) this.disengage('manual');
    else this.engage(sim);
  }

  setLateral(mode, sim) {
    const fm = sim.fm;
    if (mode === 'HDG') {
      this.lateral = this.lateral === 'HDG' ? 'ROL' : 'HDG';
      this.armedNav = this.armedApr = false;
    } else if (mode === 'NAV') {
      if (this.armedNav || this.lateral === 'NAV') {
        this.armedNav = false;
        if (this.lateral === 'NAV') this.lateral = 'ROL';
      } else {
        this.armedNav = true;
        if (this.lateral === 'ROL') this.lateral = 'HDG';
        this.hdgBug = this.lateral === 'HDG' ? this.hdgBug : Math.round(fm.heading);
      }
    } else if (mode === 'APR') {
      if (this.armedApr || this.lateral === 'LOC') {
        this.armedApr = false;
        if (this.lateral === 'LOC') this.lateral = 'ROL';
        if (this.vertical === 'GS') this.vertical = 'VS';
      } else {
        this.armedApr = true;
        if (this.lateral === 'ROL') {
          this.lateral = 'HDG';
          this.hdgBug = Math.round(fm.heading);
        }
      }
    }
    if (this.lateral === 'ROL') this.rollTarget = 0;
    if (!this.engaged && !this.fd) this.fd = true;
  }

  setVertical(mode, sim) {
    const fm = sim.fm;
    if (mode === 'ALT') {
      if (this.vertical === 'ALT') {
        this.vertical = 'VS';
        this.vsSel = 0;
      } else {
        this.vertical = 'ALT';
        this.altHold = Math.round(fm.indicatedAlt / FT / 20) * 20;
      }
    } else if (mode === 'VS') {
      this.vertical = 'VS';
      this.vsSel = Math.round(fm.vs / FPM / 100) * 100;
      this.armedAlt = true;
    } else if (mode === 'FLC') {
      this.vertical = 'FLC';
      this.spdSel = Math.round(fm.iasKt);
      this.armedAlt = true;
      if (this.cfg.autothrottle) this.athr = true;
    }
  }

  /** Main update. Returns stick commands {pitch, roll, yaw, throttle|null}. */
  update(dt, sim) {
    const fm = sim.fm;
    const cfg = this.cfg;
    const out = this._out || (this._out = { pitch: 0, roll: 0, yaw: 0, throttle: null });
    out.throttle = null;
    out.yaw = 0;
    const powered = fm.systems.avionicsPowered;
    if (!powered && this.engaged) this.disengage('power');
    const V = Math.max(fm.tas, 20);
    const nav = this.navSource === 'GPS' ? null : sim.nav1;
    const gps = sim.gps;
    const altFt = fm.indicatedAlt / FT;
    const vsFpm = fm.vs / FPM;

    // ---------------- mode transitions ----------------
    if (this.armedNav) {
      if (this.navSource === 'GPS' ? gps.current : nav.valid && !nav.isLoc && Math.abs(nav.cdi) < 0.8) {
        this.lateral = 'NAV';
        this.armedNav = false;
        this.events.push('capture');
      }
    }
    if (this.armedApr && nav && nav.valid && nav.isLoc && Math.abs(nav.cdi) < 0.85) {
      this.lateral = 'LOC';
      this.events.push('capture');
    }
    if (this.armedApr && this.lateral === 'LOC' && nav.gsValid && nav.gs < 0.25 && nav.gs > -0.9) {
      this.vertical = 'GS';
      this.armedApr = false;
      this.armedAlt = false;
      this.events.push('capture');
    }
    if (this.armedAlt && (this.vertical === 'VS' || this.vertical === 'FLC' || this.vertical === 'PIT')) {
      const err = this.altSel - altFt;
      const capBand = Math.max(80, Math.abs(vsFpm) * 0.12);
      if (Math.abs(err) < capBand && Math.sign(err) === Math.sign(vsFpm || err)) {
        this.vertical = 'ALT';
        this.altHold = this.altSel;
        this.armedAlt = false;
        this.events.push('altcapture');
      }
    }

    // ---------------- lateral: bank command ----------------
    let phiCmd = 0;
    const trackErrTo = (desTrack) => wrap180(desTrack - fm.track);
    const bankFromHeading = (err) => clamp(err * 1.2, -cfg.maxBank, cfg.maxBank);
    if (this.lateral === 'ROL') phiCmd = this.rollTarget;
    else if (this.lateral === 'HDG') phiCmd = bankFromHeading(wrap180(this.hdgBug - fm.heading));
    else if (this.lateral === 'NAV') {
      if (this.navSource === 'GPS' && gps.current) {
        const icpt = clamp(-gps.xtk / 25, -40, 40);
        phiCmd = bankFromHeading(trackErrTo(gps.dtk + icpt));
      } else if (nav && nav.valid) {
        const course = nav.obs;
        const icpt = clamp(-nav.xtrack / 40, -40, 40);
        phiCmd = bankFromHeading(trackErrTo(course + icpt));
      } else phiCmd = 0;
    } else if (this.lateral === 'LOC') {
      if (nav && nav.valid && nav.isLoc) {
        const course = nav.locCourse;
        const icpt = clamp(-nav.xtrack / 12, -30, 30);
        phiCmd = bankFromHeading(trackErrTo(course + icpt));
        if (fm.aglFt < 150) phiCmd = clamp(phiCmd, -5, 5);
      }
    }
    this.phiCmd = phiCmd;

    // ---------------- vertical: vertical speed command ----------------
    let vsCmd = 0; // fpm
    let pitchDirect = null;
    if (this.vertical === 'PIT') pitchDirect = this.pitchTarget;
    else if (this.vertical === 'VS') vsCmd = this.vsSel;
    else if (this.vertical === 'ALT') vsCmd = clamp((this.altHold - altFt) * 2.5, -cfg.maxVs * 0.6, cfg.maxVs * 0.6);
    else if (this.vertical === 'GS' && nav && nav.gsValid) {
      const gsAngle = nav.station.gsAngle * DEG;
      const hGp = nav.gsDist * Math.tan(gsAngle) + nav.station.elev;
      const vsNominal = -fm.gs * Math.tan(gsAngle);
      vsCmd = (vsNominal + clamp((hGp - fm.alt) * 0.25, -4, 4)) / FPM;
    } else if (this.vertical === 'FLC') {
      // speed on elevator: climb or descend towards the selected altitude
      const climb = this.altSel > altFt;
      const spdErr = fm.iasKt - this.spdSel;
      this._flcVs = (this._flcVs ?? vsFpm) + spdErr * 12 * dt * 10;
      this._flcVs = clamp(this._flcVs, climb ? 0 : -cfg.maxVs, climb ? cfg.maxVs : 0);
      vsCmd = this._flcVs;
    }
    if (this.vertical !== 'FLC') this._flcVs = vsFpm;

    // ---------------- autoland ----------------
    if (cfg.autoland && this.engaged && this.vertical === 'GS' && this.lateral === 'LOC') {
      const ra = fm.aglFt;
      if (ra < 65 && this.autoland === 'OFF') {
        this.autoland = 'FLARE';
        this._flareTheta0 = fm.pitch;
        this.events.push('flare');
      }
      if (this.autoland !== 'OFF') {
        vsCmd = -Math.max(110, ra * 6.5);
        if (ra < 30 && this.autoland === 'FLARE') {
          this.autoland = 'RETARD';
          this.events.push('retard');
        }
      }
    }
    if (this.autoland !== 'OFF' && fm.onGround) {
      this.autoland = 'ROLLOUT';
      pitchDirect = 0;
      phiCmd = 0;
      if (nav && nav.isLoc) out.yaw = clamp(-nav.xtrack * 0.04 - fm.omega.z * 4 + wrap180(nav.locCourse - fm.heading) * 0.1, -1, 1);
      if (fm.gsKt < 40) {
        this.disengage('manual');
        this.athr = false;
      }
    }

    // ---------------- inner loops ----------------
    const phi = fm.roll;
    const pDeg = fm.omega.x * RAD;
    const rollErr = phiCmd - phi;
    this.rollInt = clamp(this.rollInt + rollErr * dt * cfg.rollKi * 0.01, -0.15, 0.15);
    let rollStick = (rollErr * cfg.rollKp) / 45 - (pDeg * cfg.rollKd) / 45 + this.rollInt;
    rollStick = clamp(rollStick, -0.6, 0.6);

    let thetaCmd;
    if (pitchDirect !== null) thetaCmd = pitchDirect;
    else {
      const gammaCmd = Math.asin(clamp((vsCmd * FPM) / V, -0.5, 0.5)) * RAD;
      const gamma = Math.asin(clamp(fm.vs / V, -1, 1)) * RAD;
      const alphaEst = fm.pitch - gamma;
      thetaCmd = gammaCmd + alphaEst;
      // turn compensation
    }
    thetaCmd = clamp(thetaCmd, -12, cfg.type === 'ga' ? 15 : 18);
    if (this.autoland === 'RETARD' || this.autoland === 'FLARE') {
      const prog = clamp(1 - fm.aglFt / 65, 0, 1);
      thetaCmd = Math.max(thetaCmd, (this._flareTheta0 ?? fm.pitch) + prog * 3.2, 1.5);
    }
    this.thetaCmd = thetaCmd;
    this.vsCmd = vsCmd;
    const qDeg = fm.omega.y * RAD;
    const pErr = thetaCmd - fm.pitch;
    this.pitchInt = clamp(this.pitchInt + pErr * dt * cfg.pitchKi * 0.02, -0.4, 0.4);
    let pitchStick = (pErr * cfg.pitchKp) / 20 - (qDeg * cfg.pitchKd) / 20 + this.pitchInt;
    pitchStick = clamp(pitchStick, -0.5, 0.5);
    out.pitch = pitchStick;
    out.roll = rollStick;

    // ---------------- autothrottle ----------------
    // A/THR disconnects on the ground once the autoland rollout is finished or without autoland
    if (this.athr && fm.onGround && this.autoland === 'OFF') {
      this.athr = false;
      this.events.push('athr-off');
    }
    if (this.athr && cfg.autothrottle && sim.fm.engines.some((e) => e.running)) {
      let mode = 'SPEED';
      if (this.vertical === 'FLC') mode = this.altSel > altFt ? 'THR CLB' : 'THR IDLE';
      if (this.autoland === 'RETARD' || this.autoland === 'ROLLOUT') mode = 'RETARD';
      this.athrMode = mode;
      let thr = sim.athrThrottle ?? sim.fm.engines[0].throttle;
      if (mode === 'SPEED') {
        const err = this.spdSel - fm.iasKt;
        this.thrInt = clamp(this.thrInt + err * dt * 0.004, -0.5, 0.5);
        const accel = fm.accelLongitudinal - 9.81 * Math.sin(fm.pitch * DEG);
        const target = clamp(0.55 + err * 0.03 + this.thrInt - accel * 0.08, 0.02, 0.98);
        thr = moveTowards(thr, target, 0.12, dt);
      } else if (mode === 'THR CLB') thr = moveTowards(thr, 0.93, 0.15, dt);
      else thr = moveTowards(thr, 0, 0.15, dt);
      out.throttle = thr;
      sim.athrThrottle = thr;
    } else {
      sim.athrThrottle = null;
      if (this.athr && !cfg.autothrottle) this.athr = false;
    }

    // ---------------- safety disconnects ----------------
    if (this.engaged) {
      if (Math.abs(fm.roll) > (cfg.type === 'ga' ? 50 : 60) || fm.pitch > 30 || fm.pitch < -25) this.disengage('limits');
      if (fm.onGround && this.autoland === 'OFF') this.disengage('ground');
    }
    return out;
  }
}
