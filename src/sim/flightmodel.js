// Six-degree-of-freedom rigid-body flight model with component build-up aerodynamics.
// Each lifting surface (wing panels, tail planes, fuselage) computes its own local angle
// of attack from the local airflow (including rotation, downwash, propwash) so that
// damping, dihedral effect, adverse yaw, stalls and spins emerge naturally.
import { V3, Quat, clamp, DEG, RAD, G0, moveTowards, approach, smoothstep, lerp } from '../core/math.js';
import { KT, FT } from '../core/units.js';
import { createEngine } from './engines.js';
import { LandingGear } from './gear.js';
import { Systems } from './systems.js';
import { impactPressure, casFromQc, indicatedAltitude, P0 } from './atmosphere.js';

const tmp1 = new V3();
const tmp2 = new V3();
const tmp3 = new V3();
const vLocal = new V3();
const fS = new V3();
const lDir = new V3();
const vpDir = new V3();

function liftSlope(ar, sweepDeg = 0) {
  const t = Math.tan(sweepDeg * DEG);
  return (2 * Math.PI * ar) / (2 + Math.sqrt(ar * ar * (1 + t * t) + 4));
}

/** Prepare a surface definition (precompute axes and stall scaling). */
function prepareSurface(s) {
  const o = { ...s };
  o.pos = new V3().fromArray(s.pos);
  const inc = (s.incidence || 0) * DEG;
  if (s.vertical) {
    o.c = new V3(Math.cos(inc), Math.sin(inc), 0);
    o.n = new V3(-Math.sin(inc), Math.cos(inc), 0);
  } else {
    const gam = (s.dihedral || 0) * DEG * (s.side === 'L' ? 1 : s.side === 'R' ? -1 : 0);
    const c0 = new V3(Math.cos(inc), 0, -Math.sin(inc));
    const n0 = new V3(-Math.sin(inc), 0, -Math.cos(inc));
    // rotate about x by gam
    const rot = (v) => new V3(v.x, v.y * Math.cos(gam) - v.z * Math.sin(gam), v.y * Math.sin(gam) + v.z * Math.cos(gam));
    o.c = rot(c0);
    o.n = rot(n0);
  }
  o.s = new V3().crossVectors(o.n, o.c);
  o.clAlpha = s.clAlpha || liftSlope(s.ar || 6, s.sweep || 0);
  o.alpha0 = (s.alpha0 || 0) * DEG;
  o.clMax = s.clMax ?? 1.4;
  o.clMin = s.clMin ?? -o.clMax * 0.8;
  o.cd0 = s.cd0 ?? 0.008;
  o.e = s.e ?? 0.8;
  o.cm0 = s.cm0 ?? 0;
  o.ar = s.ar || 6;
  o.tau = s.tau ?? 0.45;
  o.cmCtrl = s.cmCtrl ?? 0.25;
  o.flapMax = (s.flap?.maxDeg || 0) * DEG;
  o.state = { alpha: 0, cl: 0, cd: 0, stall: 0, ratio: 0, q: 0, lift: 0 };
  // stall shaping: scale lim so that the curve peak equals clMax
  o.peakScale = 1;
  o.peakScaleNeg = 1;
  for (let iter = 0; iter < 3; iter++) {
    let peak = 0,
      peakN = 0;
    for (let a = -40; a <= 40; a += 0.1) {
      const r = liftCurve(o, a * DEG, 0, o.clMax, o.clMin, 1);
      peak = Math.max(peak, r);
      peakN = Math.min(peakN, r);
    }
    o.peakScale *= o.clMax / peak;
    o.peakScaleNeg *= o.clMin / peakN;
  }
  return o;
}

const curveOut = { stall: 0, ratio: 0, clAtt: 0 };
/** Lift coefficient with smooth stall and flat-plate post-stall behaviour. */
function liftCurve(o, alphaGeom, shift, clMax, clMin, pg) {
  const clAtt = o.clAlpha * pg * (alphaGeom + shift - o.alpha0);
  const pos = clAtt >= 0;
  const lim = pos ? clMax * o.peakScale : -clMin * o.peakScaleNeg;
  const x = Math.abs(clAtt) / Math.max(lim, 1e-3);
  const soft = x < 0.75 ? x : 0.75 + 0.25 * Math.tanh((x - 0.75) / 0.25);
  const sigma = 1 / (1 + Math.exp(-(x - 1.12) / 0.07));
  const sgn = pos ? 1 : -1;
  const clSoft = sgn * soft * lim;
  // separated flow: a post-stall plateau decaying towards flat-plate behaviour
  const aEff = alphaGeom + shift * 0.3;
  const aStall = (1.12 * lim) / (o.clAlpha * pg);
  const beyond = Math.max(0, Math.abs(alphaGeom + shift - o.alpha0) - aStall);
  const plateau = 0.8 * lim * Math.max(0, 1 - beyond / 0.55);
  const flat = 1.05 * Math.sin(2 * aEff);
  const clSep = Math.abs(flat) > plateau || Math.sign(flat) !== sgn ? flat : sgn * plateau;
  curveOut.stall = sigma;
  curveOut.ratio = x;
  curveOut.clAtt = clAtt;
  return (1 - sigma) * clSoft + sigma * clSep;
}

export class FlightModel {
  constructor(def, terrain, atmosphere) {
    this.def = def;
    this.terrain = terrain;
    this.atm = atmosphere;
    this.pos = new V3();
    this.vel = new V3();
    this.q = new Quat();
    this.omega = new V3();
    this.fBody = new V3();
    this.mBody = new V3();
    this.accBody = new V3();
    this.engines = def.engines.map((e) => createEngine(e));
    this.enginePos = def.engines.map((e) => new V3().fromArray(e.pos));
    this.gear = new LandingGear(def.gear, def.contacts);
    this.systems = new Systems(def);
    this.surfaces = def.surfaces.map(prepareSurface);
    this.wingArea = def.wing.area;
    this.wingSpan = def.wing.span;
    this.wingChord = def.wing.chord;
    // pilot / autopilot command inputs
    this.input = { pitch: 0, roll: 0, yaw: 0, elevTrim: 0, ailTrim: 0, rudTrim: 0, brakeL: 0, brakeR: 0 };
    // actual surface deflections
    this.defl = { elevator: 0, aileron: 0, rudder: 0, stab: 0, spoilerL: 0, spoilerR: 0 };
    this.nosewheelSteer = 0;
    this.brakeLeft = 0;
    this.brakeRight = 0;
    this.pilotBrake = 0;
    this.epsLag = 0;
    this.fcs = def.fbw ? { mode: 'normal', pitchInt: 0, rollInt: 0, bankHold: 0, autoTrim: true, flare: false } : null;
    this.env = { T: 288, p: P0, rho: 1.225, a: 340, sigma: 1 };
    this.wind = new V3();
    this.vAir = new V3(); // body-frame air-relative velocity
    this.euler = { phi: 0, theta: 0, psi: 0 };
    this.groundHint = 0;
    this.time = 0;
    this.damage = { crashed: false, reason: '', flapsDamaged: false, gearDamaged: false, engineDamaged: false };
    this.maxG = 1;
    this.minG = 1;
    this.touchdown = null;
    this.onGround = false;
    this.wow = false;
    this.cloudDensity = 0;
    this.precip = 0;
    this.kollsman = 101325;
    this.rigCl = 0;
    this.rigCn = 0;
    this.nz = 1;
    this.ny = 0;
    this.nx = 0;
    this.agl = 0;
    this.accelLongitudinal = 0;
    this.updateMass();
    this._derive();
    if (def.engines[0].type === 'piston') this._computeRigging();
  }

  /** Rig the airframe (fixed trim tabs / fin offset) so it flies hands-off at cruise power. */
  _computeRigging() {
    const saved = this.engines.map((e) => ({ running: e.running, rpm: e.rpm, omega: e.omega, magnetos: e.magnetos, throttle: e.throttle, mixture: e.mixture }));
    for (const e of this.engines) e.reset(true);
    this.place({ n: 0, e: 0, alt: 1500, heading: 0, speed: 50 });
    const V = (this.def.speeds.cruise || 100) * KT;
    this.trimLevel(V, 0);
    this.computeAero();
    const qSb = 0.5 * this.env.rho * V * V * this.wingArea * this.wingSpan;
    this.rigCl = -this.mBody.x / qSb;
    this.rigCn = -this.mBody.z / qSb;
    this.engines.forEach((e, i) => Object.assign(e, saved[i]));
    this.input.elevTrim = 0;
  }

  // ------------------------------------------------------------------ mass
  updateMass() {
    const def = this.def;
    const fuel = this.systems.fuelTotal;
    this.mass = def.mass.empty + (def.mass.payload ?? 0) + fuel;
    const k = this.mass / def.mass.reference;
    this.Ixx = def.inertia[0] * k;
    this.Iyy = def.inertia[1] * k;
    this.Izz = def.inertia[2] * k;
    this.Ixz = (def.inertia[3] || 0) * k;
    // lateral CG offset from fuel imbalance
    let my = 0;
    for (const t of this.systems.tanks) my += t.qty * t.y;
    this.cgOffsetY = my / this.mass;
  }

  // ------------------------------------------------------------------ setup
  /** Place the aircraft. heading in degrees, altitude metres MSL, speed m/s (air). */
  place({ n, e, alt, heading, pitch = 0, roll = 0, speed = 0 }) {
    this.pos.set(n, e, -alt);
    this.q.setFromEuler(roll * DEG, pitch * DEG, heading * DEG);
    const h = heading * DEG;
    const gam = 0;
    this.vel.set(Math.cos(h) * Math.cos(gam) * speed, Math.sin(h) * Math.cos(gam) * speed, 0);
    // account for wind so that "speed" is airspeed
    this.omega.zero();
    this.epsLag = 0;
    this.maxG = this.minG = 1;
    this.damage = { crashed: false, reason: '', flapsDamaged: false, gearDamaged: false, engineDamaged: false };
    this.touchdown = null;
    this.gear.events.length = 0;
    for (const l of this.gear.legs) {
      l.wasContact = false;
      l.wheelSpeed = 0;
    }
    for (const c of this.gear.contacts) c.was = false;
    if (this.fcs) {
      this.fcs.pitchInt = 0;
      this.fcs.rollInt = 0;
      this.fcs.bankHold = roll * DEG;
    }
    this.groundHint = this.terrain.height(n, e);
    this._derive();
  }

  /** Place the aircraft at rest on the ground and let the gear settle. */
  placeOnGround({ n, e, heading }) {
    const g = this.terrain.groundInfo(n, e, {});
    this.place({ n, e, alt: g.h + (this.def.cgHeight || 1) + 0.05, heading, speed: 0 });
    const savedPB = this.systems.parkingBrake;
    this.systems.parkingBrake = true;
    const thr = this.engines.map((en) => en.throttle);
    for (const en of this.engines) en.throttle = 0;
    for (let i = 0; i < 240 * 3; i++) {
      this.step(1 / 240);
      this.pos.x = n;
      this.pos.y = e;
      this.vel.x = this.vel.y = 0;
      this.omega.z = 0;
    }
    this.vel.zero();
    this.omega.zero();
    this.systems.parkingBrake = savedPB;
    this.engines.forEach((en, i) => (en.throttle = thr[i]));
    this.maxG = this.minG = 1;
    this.touchdown = null;
    this._airborneTime = 0;
    this.gear.events.length = 0;
  }

  // ------------------------------------------------------------------ controls
  updateControls(dt) {
    const def = this.def;
    const c = def.controls;
    const inp = this.input;
    const sys = this.systems;
    let pitch = inp.pitch,
      roll = inp.roll,
      yaw = inp.yaw;

    let elevCmd, ailCmd, rudCmd;
    if (this.fcs && this.fcs.mode === 'normal') {
      ({ elevCmd, ailCmd, rudCmd } = this.flyByWire(dt, pitch, roll, yaw));
    } else {
      elevCmd = clamp(pitch + (c.trimType === 'stab' ? 0 : inp.elevTrim * c.trimAuthority), -1, 1);
      ailCmd = clamp(roll + inp.ailTrim * 0.15, -1, 1);
      rudCmd = clamp(yaw + inp.rudTrim * 0.3, -1, 1);
      if (c.yawDamper && sys.avionicsPowered && !this.onGround) {
        rudCmd = clamp(rudCmd - this.omega.z * c.yawDamper, -1, 1);
      }
      if (c.trimType === 'stab') {
        this.defl.stab = moveTowards(this.defl.stab, inp.elevTrim * (inp.elevTrim > 0 ? c.stabUp : c.stabDown) * DEG, c.stabRate * DEG, dt);
      }
    }
    const rate = (c.surfaceRate || 80) * DEG;
    const eTarget = elevCmd * (elevCmd > 0 ? c.elevatorUp : c.elevatorDown) * DEG;
    this.defl.elevator = moveTowards(this.defl.elevator, eTarget, rate, dt);
    this.defl.aileron = moveTowards(this.defl.aileron, ailCmd * c.aileron * DEG, rate, dt);
    this.defl.rudder = moveTowards(this.defl.rudder, rudCmd * c.rudder * DEG, rate * 0.7, dt);
    // roll spoilers (airliner): deflect on the down-going wing for large roll commands
    const sb = sys.spoilers;
    if (c.rollSpoilers) {
      const k = clamp((Math.abs(ailCmd) - 0.15) / 0.85, 0, 1) * 0.7;
      this.defl.spoilerL = Math.max(sb, ailCmd < 0 ? k : 0);
      this.defl.spoilerR = Math.max(sb, ailCmd > 0 ? k : 0);
    } else {
      this.defl.spoilerL = this.defl.spoilerR = sb;
    }

    // nosewheel steering (speed scheduled)
    const gs = this.gsKt;
    const hiFrac = c.steerHighSpeedFrac ?? 1;
    const sched = lerp(1, hiFrac, smoothstep(c.steerBlendLo ?? 10, c.steerBlendHi ?? 40, gs));
    this.nosewheelSteer = clamp(inp.yaw + inp.rudTrim * 0.3, -1, 1) * sched;

    // brakes
    const pb = sys.parkingBrake ? 1 : 0;
    this.pilotBrake = Math.max(inp.brakeL, inp.brakeR);
    const auto = this._autobrakeCmd || 0;
    this.brakeLeft = Math.max(inp.brakeL, pb, auto);
    this.brakeRight = Math.max(inp.brakeR, pb, auto);
  }

  /** Airbus-style normal law: C* pitch law with auto-trim, roll-rate law with bank hold. */
  flyByWire(dt, pitch, roll, yaw) {
    const f = this.fcs;
    const c = this.def.controls;
    const fbw = this.def.fbw;
    const { phi, theta } = this.euler;
    const V = Math.max(this.tas, 30);
    const radioAlt = this.aglFt;
    let elevCmd, ailCmd, rudCmd;

    if (this.onGround || this.wow) {
      // ground: direct law
      elevCmd = pitch;
      ailCmd = roll;
      rudCmd = yaw;
      f.pitchInt = 0;
      f.rollInt = 0;
      f.bankHold = 0;
      f.flare = false;
      if (this.gsKt < 40) this.defl.stab = moveTowards(this.defl.stab, this.input.elevTrim * c.stabUp * DEG, 0.5 * DEG, dt);
      return { elevCmd, ailCmd, rudCmd };
    }
    // flare mode below 50 ft: stick to pitch-attitude, gentle nose-down bias
    f.flare = radioAlt < 50 && this.vs < 2 && !this.apEngaged;

    // ---- pitch: C* = dNz + Vco/g * q
    const nzCmdBase = Math.cos(theta) / Math.max(Math.cos(phi), 0.5);
    let dnzCmd = pitch >= 0 ? pitch * (fbw.nzMax - 1) : pitch * (1 - fbw.nzMin);
    // pitch attitude protection
    if (theta > fbw.pitchMax * DEG && dnzCmd > 0) dnzCmd *= Math.max(0, 1 - (theta - fbw.pitchMax * DEG) / (3 * DEG));
    if (theta < fbw.pitchMin * DEG && dnzCmd < 0) dnzCmd *= Math.max(0, 1 + (theta - fbw.pitchMin * DEG) / (3 * DEG));
    // alpha protection: stick commands alpha above alphaProt
    const alphaDeg = this.alpha * RAD;
    const aProt = fbw.alphaProt,
      aMax = fbw.alphaMax;
    if (alphaDeg > aProt - 2) {
      const aCmd = aProt + Math.max(pitch, 0) * (aMax - aProt);
      dnzCmd = Math.min(dnzCmd, (aCmd - alphaDeg) * 0.25);
    }
    // high speed protection
    if (this.iasKt > c.vmo + 6) dnzCmd = Math.max(dnzCmd, Math.min((this.iasKt - c.vmo - 6) * 0.02, 0.6));
    dnzCmd = clamp(dnzCmd, fbw.nzMin - 1, fbw.nzMax - 1);
    const nz = this.nz;
    // pitch rate expected in a steady coordinated turn is not a pilot demand
    const phiC = clamp(phi, -1.2, 1.2);
    const qTurn = ((G0 / V) * Math.sin(phiC) * Math.tan(phiC)) * Math.cos(theta);
    const cstar = nz - nzCmdBase + (fbw.vco / G0) * (this.omega.y - qTurn);
    let err = dnzCmd - cstar;
    if (f.flare) {
      // direct-ish law during flare with slight nose-down tendency
      const thCmd = 2 * DEG + pitch * 10 * DEG;
      err = (thCmd - theta) * 4 - this.omega.y * 1.5;
      f.pitchInt = approach(f.pitchInt, 0, dt, 2);
    }
    f.pitchInt = clamp(f.pitchInt + err * fbw.pitchKi * dt, -1, 1);
    elevCmd = clamp(err * fbw.pitchKp + f.pitchInt, -1, 1);
    // auto-trim: THS slowly takes over the elevator's average deflection
    if (!f.flare && Math.abs(phi) < 33 * DEG) {
      const stabRate = c.stabRate * DEG;
      const target = this.defl.stab + this.defl.elevator * 0.9;
      this.defl.stab = clamp(moveTowards(this.defl.stab, target, stabRate * (0.2 + Math.abs(elevCmd)), dt), -c.stabDown * DEG, c.stabUp * DEG);
      this.input.elevTrim = this.defl.stab >= 0 ? this.defl.stab / (c.stabUp * DEG) : this.defl.stab / (c.stabDown * DEG);
    }

    // ---- roll: rate command, bank hold, spiral stability beyond 33 deg
    const pCmdMax = fbw.rollRate * DEG;
    let pCmd = roll * pCmdMax;
    if (Math.abs(roll) < 0.05) {
      if (Math.abs(f.bankHold) > 33 * DEG) f.bankHold = moveTowards(f.bankHold, Math.sign(f.bankHold) * 33 * DEG, 5 * DEG, dt);
      pCmd = (f.bankHold - phi) * 1.2;
    } else {
      f.bankHold = phi;
      const lim = fbw.bankMax * DEG;
      if (pCmd > 0) pCmd = Math.min(pCmd, (lim - phi) * 2);
      else pCmd = Math.max(pCmd, (-lim - phi) * 2);
    }
    const pErr = pCmd - this.omega.x;
    f.rollInt = clamp(f.rollInt + pErr * fbw.rollKi * dt, -0.6, 0.6);
    ailCmd = clamp(pErr * fbw.rollKp + f.rollInt, -1, 1);

    // ---- yaw: damper + turn coordination + pedals
    const rCmd = (G0 * Math.tan(clamp(phi, -1.2, 1.2))) / V;
    rudCmd = clamp(yaw + (rCmd - this.omega.z) * fbw.yawK - this.beta * fbw.betaK, -1, 1);
    return { elevCmd, ailCmd, rudCmd };
  }

  // ------------------------------------------------------------------ forces
  /** Aerodynamic + propulsive forces and moments in body axes for the current state. */
  computeAero() {
    const def = this.def;
    const sys = this.systems;
    const env = this.env;
    const F = this.fBody.zero();
    const M = this.mBody.zero();
    const vAir = this.vAir;
    const V = vAir.len();
    const omega = this.omega;
    const rho = env.rho;
    const mach = V / env.a;
    const pg = 1 / Math.sqrt(1 - Math.min(mach, 0.8) ** 2);
    const machClMax = 1 - 0.55 * clamp(mach - 0.35, 0, 0.5);
    const ice = sys.airframeIce;
    const flap = sys.flaps;
    const slat = sys.slats;
    // propwash from the first engine with a propeller
    let slip = 0;
    for (const e of this.engines) slip = Math.max(slip, e.slipVelocity || 0);
    // ground effect height (wing)
    const hWing = Math.max(this.agl + (def.wing.groundHeight || 0), 0.3);
    const b = this.wingSpan;
    const ge = (16 * hWing / b) ** 2;
    const geInduced = ge / (1 + ge);
    const geLift = 1 + 0.1 * (1 - geInduced);

    let wingLift = 0;
    let stallWarn = 0;
    let maxStall = 0;
    let wingAlpha = 0;
    let wingCount = 0;
    const eps = this.epsLag;

    for (const s of this.surfaces) {
      // local airflow velocity of the surface (body frame)
      vLocal.crossVectors(omega, s.pos).add(vAir);
      if (s.propwash) vLocal.x += slip * s.propwash;
      if (s.swirl) vLocal.y -= slip * s.swirl;
      const vc = vLocal.dot(s.c);
      const vn = vLocal.dot(s.n);
      const vp2 = vc * vc + vn * vn;
      const st = s.state;
      if (vp2 < 1) {
        st.q = 0;
        st.cl = 0;
        continue;
      }
      const vp = Math.sqrt(vp2);
      let alpha = Math.atan2(-vn, vc);
      if (s.downwash) alpha -= eps;
      // control shift (rad of effective alpha)
      let shift = 0;
      if (s.elevator) shift += s.elevator * this.defl.elevator * s.tau;
      if (s.aileron) shift += s.aileron * this.defl.aileron * s.tau;
      if (s.rudder) shift += s.rudder * this.defl.rudder * s.tau;
      if (s.stab) shift += s.stab * this.defl.stab;
      let clMax = s.clMax,
        clMin = s.clMin,
        cd = s.cd0,
        cm = s.cm0;
      const ctrlShift = shift;
      if (s.flap && flap > 0) {
        shift += s.flap.tau * flap * s.flapMax;
        clMax += s.flap.clMax * flap;
        clMin += s.flap.clMax * flap * 0.25;
        cd += s.flap.cd * flap;
        cm += s.flap.cm * flap;
      }
      if (s.slat && slat > 0) {
        clMax += s.slat.clMax * slat;
        cd += s.slat.cd * slat;
      }
      if (s.group === 'wing') {
        clMax *= machClMax * (1 - 0.3 * ice);
        clMin *= machClMax;
        cd += 0.012 * ice;
      }
      cm -= s.cmCtrl * ctrlShift;
      cd += 0.35 * ctrlShift * ctrlShift;
      const ge2 = s.group === 'wing' ? geLift : 1;
      let cl = liftCurve(s, alpha, shift, clMax, clMin, (s.group === 'wing' ? pg : 1) * ge2);
      const stall = curveOut.stall;
      const ratio = curveOut.ratio;
      // spoilers dump lift
      const spl = s.spoiler ? (s.side === 'L' ? this.defl.spoilerL : this.defl.spoilerR) : 0;
      if (spl > 0) {
        cl *= 1 - s.spoiler.lift * spl;
        cd += s.spoiler.drag * spl;
      }
      // drag: profile + induced (attached) + separated flat plate + wave
      const ind = (s.group === 'wing' ? geInduced : 1) / (Math.PI * s.e * s.ar);
      const sa = Math.sin(alpha);
      cd += (1 - stall) * cl * cl * ind + stall * 1.25 * sa * sa;
      if (s.mcrit) {
        const mc = s.mcrit - 0.08 * Math.abs(cl);
        if (mach > mc) cd += 20 * (mach - mc) ** 4;
      }
      cm = (1 - stall) * cm - stall * 0.3 * sa;
      const q = 0.5 * rho * vp2;
      const qa = q * s.area;
      // directions
      vpDir.set(0, 0, 0).addScaled(s.c, vc / vp).addScaled(s.n, vn / vp);
      lDir.crossVectors(vpDir, s.s);
      fS.set(0, 0, 0).addScaled(lDir, cl * qa).addScaled(vpDir, -cd * qa);
      F.add(fS);
      tmp1.crossVectors(s.pos, fS);
      M.add(tmp1);
      // pitching moment of the section about the span axis
      M.addScaled(s.s, -cm * qa * s.chord);

      st.alpha = alpha + shift;
      st.cl = cl;
      st.cd = cd;
      st.stall = stall;
      st.ratio = ratio;
      st.q = q;
      if (s.group === 'wing') {
        wingLift += cl * qa;
        stallWarn = Math.max(stallWarn, ratio);
        maxStall = Math.max(maxStall, stall);
        wingAlpha += alpha;
        wingCount++;
      }
    }

    // fuselage / parasite drag (gear, speedbrake) along -V
    if (V > 0.5) {
      const qInf = 0.5 * rho * V * V;
      let f = def.parasiteArea;
      if (def.controls.retractableGear) f += def.gearDragArea * this.gear.position;
      if (def.speedbrakeArea) f += def.speedbrakeArea * sys.spoilers;
      if (mach > (def.fuselageMcrit || 0.8)) f *= 1 + 20 * (mach - (def.fuselageMcrit || 0.8)) ** 2;
      const D = qInf * f;
      F.addScaled(vAir, -D / V);
      // fuselage side force
      const yf = -qInf * (def.fuselageSideArea || 0) * 0.5 * (vAir.y / V);
      F.y += yf;
    }

    // propulsion
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      const ep = this.enginePos[i];
      const T = e.thrust;
      tmp2.set(T, 0, 0);
      F.add(tmp2);
      tmp3.crossVectors(ep, tmp2);
      M.add(tmp3);
      if (e.type === 'piston') {
        // torque reaction (rolls left for a clockwise prop), P-factor
        M.x -= e.engineTorque * (def.torqueFactor ?? 0.5);
        M.z -= (def.pFactor || 0) * T * clamp(this.alpha, -0.3, 0.5);
      }
    }

    // wing CL and downwash (with lag for alpha-dot damping)
    const qS = 0.5 * rho * V * V * this.wingArea;
    this.wingCL = qS > 1 ? wingLift / qS : 0;
    const epsTarget = ((def.downwashFactor ?? 1) * 2 * this.wingCL) / (Math.PI * def.wing.ar) * (0.3 + 0.7 * geInduced);
    this._epsTarget = epsTarget;
    this.stallRatio = stallWarn;
    this.stallFactor = maxStall;
    this.wingAlpha = wingCount ? wingAlpha / wingCount : 0;
    // airframe rigging (fixed tabs)
    if (V > 1) {
      const qSb = 0.5 * rho * V * V * this.wingArea * this.wingSpan;
      M.x += this.rigCl * qSb;
      M.z += this.rigCn * qSb;
    }
    // fuel imbalance roll moment
    M.x += this.cgOffsetY * this.mass * G0 * Math.cos(this.euler.phi) * Math.cos(this.euler.theta);
  }

  // ------------------------------------------------------------------ main step
  step(dt) {
    const def = this.def;
    const sys = this.systems;
    this.time += dt;
    const alt = -this.pos.z;
    this.atm.sample(alt, this.env);
    this.groundHint = this.terrain.height(this.pos.x, this.pos.y);
    const lake = this.terrain.lakeLevel(this.pos.x, this.pos.y);
    if (this.groundHint < 0) this.groundHint = 0;
    else if (lake !== null && this.groundHint < lake) this.groundHint = lake;
    this.agl = alt - this.groundHint - (def.cgHeight || 1);
    this.cloudDensity = this.atm.cloudDensityAt(alt);
    this.precip = this.atm.precip;
    this.oatC = this.env.T - 273.15;
    // wind
    this.atm.update(dt, this.tas || 0, Math.max(this.agl, 0), alt);
    this.atm.windAt(Math.max(this.agl, 0), alt, this.wind);
    tmp1.copy(this.vel).sub(this.wind);
    this.q.rotateInv(tmp1, this.vAir);
    // differential vertical gust across the span is applied as a roll disturbance
    const turbRoll = this.atm.turbRoll;

    // systems & controls
    sys.update(dt, this);
    this.updateControls(dt);

    // engines
    const V = this.vAir.len();
    const humidity = clamp(0.4 + this.cloudDensity * 0.6 + this.precip * 0.5, 0, 1);
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      if (e.type === 'piston') e.step(dt, { rho: this.env.rho, p: this.env.p, T: this.env.T, vAxial: this.vAir.x, humidity });
      else {
        e.bleedAvailable = def.systems?.apu ? sys.apuN > 95 && sys.apuBleed || this.engines.some((o) => o !== e && o.running) : sys.battery && sys.busVolts > 18;
        e.step(dt, { rho: this.env.rho, p: this.env.p, T: this.env.T, mach: V / this.env.a, onGround: this.onGround });
      }
    }

    // forces
    this.computeAero();
    this.epsLag = approach(this.epsLag, this._epsTarget, dt, (def.tailArm || 5) / Math.max(V, 10));
    if (turbRoll && V > 10) {
      const qS = 0.5 * this.env.rho * V * this.wingArea;
      this.mBody.x += qS * turbRoll * this.wingSpan * 0.08;
    }
    // ground
    const prevGround = this.onGround;
    this.onGround = this.gear.compute(this, this.terrain, this.fBody, this.mBody, dt);
    this.wow = this.gear.legs.some((l) => l.contact && l.force > this.mass * G0 * 0.05);

    // gravity CG offset moment (fuel imbalance) handled in aero; add gravity
    const m = this.mass;
    this.q.rotate(this.fBody, tmp1); // total non-gravity force in world
    // load factor (body, positive up) from non-gravity forces
    this.nz = -this.fBody.z / (m * G0);
    this.ny = this.fBody.y / (m * G0);
    this.nx = this.fBody.x / (m * G0);
    this.accBody.copy(this.fBody).scale(1 / m);
    tmp1.scale(1 / m);
    tmp1.z += G0;
    this.vel.addScaled(tmp1, dt);
    this.pos.addScaled(this.vel, dt);
    this.accelLongitudinal = this.fBody.x / m;

    // rotational dynamics with engine angular momentum
    let H = 0;
    for (const e of this.engines) if (e.type === 'piston') H += e.p.inertia * e.omega;
    const p = this.omega.x,
      qq = this.omega.y,
      r = this.omega.z;
    const A = this.Ixx,
      B = this.Iyy,
      C = this.Izz,
      E = this.Ixz;
    const hx = A * p - E * r + H;
    const hy = B * qq;
    const hz = -E * p + C * r;
    const Mx = this.mBody.x - (qq * hz - r * hy);
    const My = this.mBody.y - (r * hx - p * hz);
    const Mz = this.mBody.z - (p * hy - qq * hx);
    const det = A * C - E * E;
    const pd = (C * Mx + E * Mz) / det;
    const qd = My / B;
    const rd = (E * Mx + A * Mz) / det;
    this.omega.x += pd * dt;
    this.omega.y += qd * dt;
    this.omega.z += rd * dt;
    // keep numerically sane
    const wl = this.omega.len();
    if (wl > 8) this.omega.scale(8 / wl);
    this.q.integrate(this.omega, dt);

    // static friction "sleep": aircraft at rest with brakes stays put
    if (this.onGround && V < 0.3 && this.brakeLeft > 0.5 && this.brakeRight > 0.5) {
      const gsp = Math.hypot(this.vel.x, this.vel.y);
      if (gsp < 0.05) {
        this.vel.x *= 0.5;
        this.vel.y *= 0.5;
      }
    }

    // fuel burn changes mass
    if (Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.updateMass();
    this._derive();
    this._checkLimits(prevGround, dt);
  }

  // ------------------------------------------------------------------ derived values
  _derive() {
    const def = this.def;
    this.q.toEuler(this.euler);
    const vAir = this.vAir;
    const V = vAir.len();
    this.tas = V;
    this.alpha = Math.atan2(vAir.z, Math.max(Math.abs(vAir.x), 0.1) * Math.sign(vAir.x || 1));
    this.beta = V > 1 ? Math.asin(clamp(vAir.y / V, -1, 1)) : 0;
    const env = this.env;
    this.mach = V / env.a;
    // pitot: impact pressure along body x
    const vx = Math.max(vAir.x, 0);
    let qc = impactPressure(vx, env.p, env.a);
    const ice = this.systems.pitotIce;
    if (ice > 0.6) {
      // blocked pitot: reading drifts with altitude change (acts like an altimeter)
      if (this._frozenQc === undefined) this._frozenQc = qc;
      qc = Math.max(0, this._frozenQc + (this._frozenP - env.p || 0) * 0.5);
    } else {
      this._frozenQc = undefined;
      this._frozenP = env.p;
    }
    this.cas = casFromQc(qc);
    this.ias = this.cas; // position error neglected
    this.iasKt = this.ias / KT;
    this.gs = Math.hypot(this.vel.x, this.vel.y);
    this.gsKt = this.gs / KT;
    this.track = (Math.atan2(this.vel.y, this.vel.x) * RAD + 360) % 360;
    this.vs = -this.vel.z;
    this.alt = -this.pos.z;
    this.altFt = this.alt / FT;
    this.aglFt = this.agl / FT;
    this.heading = this.euler.psi * RAD;
    this.pitch = this.euler.theta * RAD;
    this.roll = this.euler.phi * RAD;
    this.staticPressure = env.p;
    this.indicatedAlt = indicatedAltitude(env.p, this.kollsman);
    this.pressureAlt = indicatedAltitude(env.p, 101325);
    const ws = def.warnings || {};
    this.stallWarning = !this.onGround && (this.stallRatio || 0) > (ws.stallRatio || 0.9) && this.iasKt > 15;
    this.overspeed = this.iasKt > def.limits.vne || this.mach > (def.limits.mmo || 9);
  }

  _checkLimits(prevGround, dt) {
    const def = this.def;
    const L = def.limits;
    if (this.damage.crashed) return;
    if (!this.onGround) {
      this.maxG = Math.max(this.maxG, this.nz);
      this.minG = Math.min(this.minG, this.nz);
    }
    // structural failure
    if (this.nz > L.gPos * 1.5 || this.nz < L.gNeg * 1.5) this.crash('Cedimento strutturale: fattore di carico eccessivo (' + this.nz.toFixed(1) + ' g)');
    if (this.iasKt > L.vne * 1.25 || this.mach > (L.mmo || 9) + 0.12) this.crash('Cedimento strutturale: velocità oltre i limiti');
    if (this.systems.flaps > 0.05 && this.iasKt > this._currentVfe() * 1.25) this.damage.flapsDamaged = true;
    if (this.gear.position > 0.05 && def.controls.retractableGear && this.iasKt > L.vle * 1.3) this.damage.gearDamaged = true;

    // ground events
    for (const ev of this.gear.events) {
      if (ev.type === 'touch') {
        if (!this.touchdown && ev.vs > 0.05 && this._airborneTime > 2) {
          this.touchdown = {
            vs: ev.vs,
            vsFpm: ev.vs / 0.00508,
            ias: this.iasKt,
            pitch: this.pitch,
            roll: this.roll,
            g: this.nz,
            n: this.pos.x,
            e: this.pos.y,
            heading: this.heading,
            beta: this.beta * RAD,
            surface: ev.surface,
            time: this.time,
          };
        }
        if (ev.surface === 'water') this.crash('Ammaraggio: il velivolo è finito in acqua');
        else if (ev.vs > (L.gearVsLimit || 3.6) * 1.7) this.crash('Atterraggio troppo duro: carrello distrutto (' + Math.round(ev.vs / 0.00508) + ' ft/min)');
        else if (ev.vs > (L.gearVsLimit || 3.6)) this.damage.gearDamaged = true;
      } else if (ev.type === 'strike') {
        if (ev.surface === 'water' && ev.speed > 8) this.crash('Impatto con l\'acqua');
        else if (ev.critical && (ev.vs > 2.5 || ev.speed > 25)) this.crash('Impatto al suolo (' + ev.point + ')');
        else if (ev.point === 'prop' && this.engines[0].rpm > 200) {
          this.engines[0].failed = true;
          this.damage.engineDamaged = true;
        } else if (ev.point === 'tail' && ev.speed > 5) this.damage.tailStrike = true;
      } else if (ev.type === 'bottom' && ev.vs > 4) this.crash('Cedimento del carrello');
    }
    this.gear.events.length = 0;
    if (this.onGround && this.gear.legs.some((l) => l.contact && l.surface === 'water') && this.gs > 3) this.crash('Il velivolo è finito in acqua');
    if (!this.onGround) this._airborneTime = (this._airborneTime || 0) + dt;
    else if (this.gs < 20) this._airborneTime = 0;
    // fully inverted on ground or wing on ground at speed
    if (this.onGround && Math.abs(this.roll) > 60) this.crash('Il velivolo si è capovolto');
    if (this.alt < this.groundHint - 5) this.crash('Impatto con il terreno');
  }

  _currentVfe() {
    const det = this.def.controls.flapDetents;
    let v = 999;
    for (const d of det) if (d.flaps <= this.systems.flaps + 1e-3 && d.flaps > 0) v = Math.min(v, d.vfe || 999);
    for (const d of det) if (d.flaps >= this.systems.flaps - 1e-3 && d.flaps > 0) return Math.min(v, d.vfe || 999);
    return v;
  }

  crash(reason) {
    if (this.damage.crashed) return;
    this.damage.crashed = true;
    this.damage.reason = reason;
  }

  // ------------------------------------------------------------------ trim
  /**
   * Trim for straight & level (or given flight path angle) flight at true airspeed V.
   * Solves for alpha, elevator trim and throttle. Returns {ok, alpha, trim, throttle}.
   */
  trimLevel(V, gammaDeg = 0, opts = {}) {
    const heading = this.heading * DEG;
    const gam = gammaDeg * DEG;
    const saveInput = { ...this.input };
    this.input.pitch = 0;
    this.input.roll = 0;
    this.input.yaw = 0;
    const thrFixed = opts.throttle;
    this.gear.position = this.systems.gearPos;
    let x = [4 * DEG, 0, thrFixed ?? 0.6];
    const residual = (xx) => {
      const [a, trim, thr] = xx;
      const theta = a + gam;
      this.q.setFromEuler(0, theta, heading);
      this.vel.set(Math.cos(heading) * Math.cos(gam) * V, Math.sin(heading) * Math.cos(gam) * V, -Math.sin(gam) * V);
      this.omega.zero();
      this.atm.sample(-this.pos.z, this.env);
      this.atm.meanWind(1000, -this.pos.z, this.wind);
      this.wind.zero();
      tmp1.copy(this.vel);
      this.q.rotateInv(tmp1, this.vAir);
      this.input.elevTrim = clamp(trim, -1, 1);
      const c = this.def.controls;
      if (c.trimType === 'stab') {
        this.defl.stab = trim >= 0 ? trim * c.stabUp * DEG : trim * c.stabDown * DEG;
        this.defl.elevator = 0;
      } else {
        const e = clamp(trim * c.trimAuthority, -1, 1);
        this.defl.elevator = e * (e > 0 ? c.elevatorUp : c.elevatorDown) * DEG;
      }
      this.defl.aileron = 0;
      this.defl.rudder = 0;
      for (const e of this.engines) {
        e.throttle = clamp(thr, 0, 1);
        if (e.type === 'piston') {
          const env = { rho: this.env.rho, p: this.env.p, T: this.env.T, vAxial: this.vAir.x, humidity: 0.3 };
          for (let k = 0; k < 2000; k++) {
            const r0 = e.rpm;
            e.step(0.02, env);
            if (k > 20 && Math.abs(e.rpm - r0) < 1e-4) break;
          }
        } else {
          const env = { rho: this.env.rho, p: this.env.p, T: this.env.T, mach: V / this.env.a, onGround: false };
          for (let k = 0; k < 4000; k++) {
            const r0 = e.n2;
            e.step(0.05, env);
            if (k > 20 && Math.abs(e.n2 - r0) < 1e-6 && Math.abs(e.n1FromN2(e.n2) - e.n1) < 1e-5) break;
          }
        }
      }
      this.agl = 2000;
      this.epsLag = 0;
      this.computeAero();
      this.epsLag = this._epsTarget;
      this.computeAero();
      // gravity in body
      tmp2.set(0, 0, this.mass * G0);
      this.q.rotateInv(tmp2, tmp2);
      const W = this.mass * G0;
      const qS = 0.5 * this.env.rho * V * V * this.wingArea * this.wingChord;
      return [(this.fBody.x + tmp2.x) / W, (this.fBody.z + tmp2.z) / W, this.mBody.y / qS];
    };
    let ok = false;
    for (let it = 0; it < 30; it++) {
      const r0 = residual(x);
      const err = Math.abs(r0[0]) + Math.abs(r0[1]) + Math.abs(r0[2]);
      if (err < 1e-5) {
        ok = true;
        break;
      }
      // numerical jacobian
      const h = [1e-4, 1e-4, 1e-4];
      const J = [];
      const nVar = thrFixed !== undefined ? 2 : 3;
      for (let j = 0; j < nVar; j++) {
        const xp = x.slice();
        xp[j] += h[j];
        const rp = residual(xp);
        J.push(rp.map((v, i) => (v - r0[i]) / h[j]));
      }
      // solve J^T dx = -r (3x3 or least squares 3x2)
      let dx;
      if (nVar === 3) {
        dx = solve3(
          [
            [J[0][0], J[1][0], J[2][0]],
            [J[0][1], J[1][1], J[2][1]],
            [J[0][2], J[1][2], J[2][2]],
          ],
          [-r0[0], -r0[1], -r0[2]],
        );
      } else {
        // use only z-force and moment equations
        const a11 = J[0][1],
          a12 = J[1][1],
          a21 = J[0][2],
          a22 = J[1][2];
        const det = a11 * a22 - a12 * a21;
        dx = [(-r0[1] * a22 + r0[2] * a12) / det, (-r0[2] * a11 + r0[1] * a21) / det, 0];
      }
      if (!dx || dx.some((v) => !Number.isFinite(v))) break;
      const maxStep = [3 * DEG, 0.2, 0.2];
      for (let j = 0; j < 3; j++) x[j] += clamp(dx[j], -maxStep[j], maxStep[j]);
      x[0] = clamp(x[0], -10 * DEG, 20 * DEG);
      x[2] = clamp(x[2], 0, 1);
      if (it === 29) ok = err < 1e-3;
    }
    residual(x);
    Object.assign(this.input, saveInput);
    this.input.elevTrim = clamp(x[1], -1, 1);
    this._derive();
    return { ok, alpha: x[0] * RAD, trim: x[1], throttle: x[2] };
  }
}

function solve3(A, b) {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[piv][i])) piv = k;
    [m[i], m[piv]] = [m[piv], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < 3; k++) {
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = m[i][3];
    for (let j = i + 1; j < 3; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x;
}
