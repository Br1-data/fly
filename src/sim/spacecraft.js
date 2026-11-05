// Rigid-body spacecraft: mass properties from the remaining stages, main engine with gimbal,
// RCS (translation + rotation), reaction wheels, atmospheric drag / lift, re-entry heating,
// parachute, landing legs and hull contacts with the terrain and the sea.
// Position / velocity are relative to the reference body (`ref`), inertial axes.
import { V3, Quat, clamp, G0 } from '../core/math.js';
import { atmosphereAt } from './system.js';

const SIGMA = 5.670e-8;
const tmpA = new V3(), tmpB = new V3(), tmpC = new V3(), tmpD = new V3();

/** Torque turning body x towards the body-frame unit direction (tx, ty, tz), gain k. */
function alignTorque(torque, tx, ty, tz, k) {
  torque.y += -tz * k;
  torque.z += ty * k;
}

function dampTorque(torque, omega, k) {
  torque.x -= omega.x * k * 0.3;
  torque.y -= omega.y * k;
  torque.z -= omega.z * k;
}

export class Spacecraft {
  constructor(def) {
    this.def = def;
    this.pos = new V3();
    this.vel = new V3();
    this.q = new Quat();
    this.omega = new V3(); // body rates rad/s (x roll, y pitch, z yaw)
    this.ref = 'earth';
    this.stageIndex = 0;
    this.stages = def.stages.map((s) => ({ ...s, fuelLeft: s.fuel }));
    this.mono = def.rcs.fuel;
    this.throttle = 0; // commanded engine throttle 0..1 (after assists)
    this.engineOn = false;
    this.thrust = 0; // N, current
    this.rcsEnabled = true;
    this.temperature = 280;
    this.heatFlux = 0;
    this.integrity = 100;
    this.destroyed = null; // reason string
    this.parachute = 0; // 0 stowed, 0..1 opening, 1 open, -1 cut/torn
    this.legsDeployed = true;
    this.lights = false;
    this.landed = false;
    this.splashed = false;
    this.contacts = 0;
    this._touching = new Set();
    this.hullTouch = false;
    this.gForce = 0;
    this.maxG = 0;
    this.accel = new V3();
    this.lastImpact = null;
    // Per-step command written by Simulation (after assists): rotation -1..1, translation -1..1.
    this.cmd = { rot: new V3(), trans: new V3() };
    this.rcsActivity = { trans: new V3(), rot: new V3() };
    this.dynPressure = 0;
    this.mach = 0;
    this.altitude = 0;
    this.agl = 0;
    this.updateMass();
  }

  get stage() {
    return this.stages[this.stageIndex];
  }

  /** The lowest remaining stage with an engine that still has propellant (or null). */
  get engineStage() {
    const s = this.stages[this.stageIndex];
    return s?.engine ? s : null;
  }

  get fuel() {
    return this.engineStage ? this.engineStage.fuelLeft : 0;
  }

  get fuelCapacity() {
    return this.engineStage ? this.engineStage.fuel : 0;
  }

  get hasLegs() {
    return this.stages.slice(this.stageIndex).some((s) => s.legs);
  }

  get heatShieldStage() {
    const s = this.stages[this.stageIndex];
    return s?.heatShield ? s : null;
  }

  /** Recompute mass, centre of mass and the diagonal inertia of the remaining stack. */
  updateMass() {
    let m = 0, mx = 0;
    const rest = this.stages.slice(this.stageIndex);
    for (const s of rest) {
      const sm = s.dryMass + s.fuelLeft;
      m += sm;
      mx += sm * s.x;
    }
    m += this.mono;
    const com = mx / Math.max(1, m - this.mono);
    let ix = 0, iy = 0;
    for (const s of rest) {
      const sm = s.dryMass + s.fuelLeft;
      ix += 0.5 * sm * s.radius * s.radius;
      iy += sm * ((3 * s.radius * s.radius + s.length * s.length) / 12 + (s.x - com) ** 2);
    }
    if (this.def.id === 'spaceplane') {
      // Wide wings: much more roll inertia than a cylinder.
      ix *= 6;
      iy *= 1.1;
    }
    this.mass = m;
    this.com = com;
    this.inertia = new V3(Math.max(ix, 50), Math.max(iy, 80), Math.max(iy, 80));
  }

  /** Body-frame offset of a stack-frame point from the centre of mass. */
  local(p, out = new V3()) {
    return out.set(p[0] - this.com, p[1], p[2]);
  }

  /** World direction of the body x axis (thrust / nose). */
  forward(out = new V3()) {
    return this.q.rotate(tmpA.set(1, 0, 0), out);
  }

  /** Remaining Δv of the active stage (main engine, vacuum Isp), m/s. */
  deltaV() {
    const s = this.engineStage;
    if (!s) return 0;
    const m0 = this.mass, m1 = m0 - s.fuelLeft;
    return s.engine.ispVac * G0 * Math.log(m0 / Math.max(1, m1));
  }

  /** Available main engine acceleration (vacuum, full throttle), m/s². */
  maxAccel() {
    const s = this.engineStage;
    return s && s.fuelLeft > 0 ? s.engine.thrustVac / this.mass : 0;
  }

  /** Torque available per axis (N·m) right now. */
  torqueAvailable() {
    let t = this.def.wheels || 0;
    if (this.rcsEnabled && this.mono > 0) t += this.rcsTorque();
    return t;
  }

  /** RCS torque: the vehicle's thrusters plus those carried by launcher stages. */
  rcsTorque() {
    let t = this.def.rcs.torque;
    for (let i = this.stageIndex; i < this.stages.length; i++) t += this.stages[i].rcsTorque || 0;
    return t;
  }

  /** Contact points of the remaining stack: legs (when deployed), skids / gear, hull spheres. */
  contactPoints() {
    const key = `${this.stageIndex}:${this.legsDeployed}`;
    if (this._cpKey === key) return this._cp;
    const rest = this.stages.slice(this.stageIndex);
    const minX = Math.min(...rest.map((s) => s.x - s.length / 2)) - 0.8;
    const pts = [];
    if (this.legsDeployed) for (const s of rest) for (const l of s.legs || []) pts.push({ p: l.pos, r: l.radius, leg: l });
    const gear = this.def.gearContacts && this.legsDeployed;
    for (const c of this.def.contacts) if (c[0] >= minX) pts.push({ p: c, r: c[3], leg: gear ? { stroke: 0.45, wheel: !!this.def.rollingGear } : null });
    for (const c of this.def.hull) if (c[0] - c[3] >= minX) pts.push({ p: c, r: c[3] * 0.92, leg: null });
    pts.forEach((p, i) => (p.key = i));
    this._cpKey = key;
    this._cp = pts;
    return pts;
  }

  /** Can the action key do something, and what? */
  actionLabel() {
    if (this.parachute === 0 && this.stages.length - this.stageIndex === 1 && this.stage.parachute) return 'Apri il paracadute';
    if (this.stageIndex < this.stages.length - 1 && this.stage.dropLabel) return this.stage.dropLabel;
    return null;
  }

  /**
   * Physics step. `env` provides { body, gravity(pos, out) → acceleration, terrainHeight(dir),
   * time, settings }. Returns an array of events.
   */
  step(dt, env) {
    const events = [];
    if (this.destroyed) return events;
    const def = this.def;
    const body = env.body;
    const r = this.pos.len();
    // Terrain height in the rotating body frame; ground and air move with the body.
    const groundH = env.height(this.pos);
    const spin = env.spin;
    const surfaceR = body.radius + Math.max(groundH, body.ocean ? 0 : -1e9);
    this.altitude = r - body.radius;
    this.agl = r - surfaceR;
    const atm = atmosphereAt(body, this.altitude);
    const force = tmpB.set(0, 0, 0); // world N (non-gravitational)
    const torque = tmpC.set(0, 0, 0); // body N·m

    // ---------------------------------------------------------- main engine
    const st = this.engineStage;
    const p = atm.p;
    const pRatio = body.atmosphere ? clamp(p / body.atmosphere.p0, 0, 1) : 0;
    let thrust = 0;
    if (st && st.fuelLeft > 0 && this.throttle > 0.001) {
      const e = st.engine;
      const th = Math.max(e.minThrottle, this.throttle);
      thrust = th * (e.thrustVac + (e.thrustSL - e.thrustVac) * pRatio);
      const isp = e.ispVac + (e.ispSL - e.ispVac) * pRatio;
      const flow = thrust / (isp * G0);
      const burn = flow * dt;
      if (!env.settings?.unlimitedFuel) st.fuelLeft = Math.max(0, st.fuelLeft - burn);
      if (st.fuelLeft <= 0) events.push({ type: 'flameout' });
      // Gimbal adds pitch / yaw authority proportional to thrust.
      if (e.gimbal > 0) {
        const lever = Math.abs(e.x - this.com);
        const gim = thrust * lever * Math.sin((e.gimbal * Math.PI) / 180);
        torque.y += clamp(this.cmd.rot.y, -1, 1) * gim;
        torque.z += clamp(this.cmd.rot.z, -1, 1) * gim;
      }
    }
    if ((thrust > 0) !== this.engineOn) events.push({ type: thrust > 0 ? 'ignition' : 'shutdown' });
    this.engineOn = thrust > 0;
    this.thrust = thrust;
    const fwd = this.q.rotate(tmpD.set(1, 0, 0), new V3());
    force.addScaled(fwd, thrust);

    // ---------------------------------------------------------- RCS and wheels
    const rcs = def.rcs;
    const rcsOn = this.rcsEnabled && this.mono > 0;
    const tr = this.cmd.trans;
    const ta = this.rcsActivity.trans.set(0, 0, 0);
    const ra = this.rcsActivity.rot.set(0, 0, 0);
    let monoUse = 0;
    if (rcsOn) {
      ta.set(clamp(tr.x, -1, 1), clamp(tr.y, -1, 1), clamp(tr.z, -1, 1));
      const bodyForce = new V3(ta.x * rcs.thrust, ta.y * rcs.thrust, ta.z * rcs.thrust);
      force.add(this.q.rotate(bodyForce, new V3()));
      monoUse += (Math.abs(ta.x) + Math.abs(ta.y) + Math.abs(ta.z)) * rcs.thrust;
    }
    const wheels = def.wheels || 0;
    const rc = this.cmd.rot;
    for (const axis of ['x', 'y', 'z']) {
      const c = clamp(rc[axis], -1, 1);
      // Reaction wheels first; RCS jets add the rest of the requested torque.
      const rcsT = rcsOn ? this.rcsTorque() : 0;
      const wanted = c * (wheels + rcsT);
      const fromWheels = clamp(wanted, -wheels, wheels);
      const fromRcs = rcsOn ? wanted - fromWheels : 0;
      torque[axis] += fromWheels + fromRcs;
      ra[axis] = rcsT > 0 ? fromRcs / rcsT : 0;
      monoUse += (Math.abs(fromRcs) / Math.max(1, rcsT)) * rcs.thrust * 0.6;
    }
    if (monoUse > 0 && !env.settings?.unlimitedFuel) this.mono = Math.max(0, this.mono - (monoUse / (rcs.isp * G0)) * dt);

    // ---------------------------------------------------------- aerodynamics & heating
    // The atmosphere co-rotates with the body: airspeed is relative to the rotating air.
    const vAir = this.vel.clone().sub(new V3().crossVectors(spin, this.pos));
    this.airspeed = vAir.len();
    const speed = vAir.len();
    const q = 0.5 * atm.rho * speed * speed;
    this.dynPressure = q;
    this.mach = body.atmosphere ? speed / body.atmosphere.sound : 0;
    let heatIn = 0;
    if (atm.rho > 0 && speed > 0.5) {
      const vb = this.q.rotateInv(vAir, new V3()).scale(1 / speed); // airflow direction in body (direction of motion)
      const aero = def.aero;
      const along = Math.abs(vb.x);
      let cdA = aero.area * (aero.cdSide + (aero.cdFront - aero.cdSide) * along);
      // Parachute
      const chute = this.stage.parachute;
      if (this.parachute > 0 && chute) {
        if (this.parachute < 1) this.parachute = Math.min(1, this.parachute + dt / 3.5);
        const open = this.parachute * this.parachute;
        cdA += chute.area * chute.cd * open;
        // Lines pull the capsule apex (+x) into the direction opposite to the motion.
        alignTorque(torque, -vb.x, -vb.y, -vb.z, q * 60 * open);
        dampTorque(torque, this.omega, q * 60 * open * 0.6);
        if (q > 42000) {
          this.parachute = -1;
          events.push({ type: 'chute-torn' });
        }
      }
      force.addScaled(vAir, (-q * cdA) / speed);
      if (aero.lift) {
        // Winged vehicles: lift in the body x-z plane, static stability, damping and
        // control surfaces that answer the same commands as the RCS.
        const L = aero.lift;
        const alpha = Math.atan2(vb.z, vb.x); // + = nose above the velocity vector
        const beta = Math.asin(clamp(vb.y, -1, 1));
        const max = (L.maxAlpha * Math.PI) / 180;
        const a = clamp(alpha, -Math.PI / 2, Math.PI / 2);
        const stalled = Math.abs(a) > max;
        const cl = (vb.x > 0 ? 1 : 0.2) * L.slope * (stalled ? Math.sign(a) * max * Math.max(0.3, 1 - (Math.abs(a) - max) * 1.5) : a);
        const lift = q * L.wingArea * cl;
        const zb = this.q.rotate(tmpD.set(0, 0, -1), new V3());
        const vhat = new V3().copy(vAir).scale(1 / speed);
        const ldir = zb.addScaled(vhat, -zb.dot(vhat)).normalize();
        force.addScaled(ldir, lift);
        force.addScaled(vAir, (-q * L.wingArea * L.k * cl * cl) / speed);
        const S = L.wingArea, c = L.chord || 6, b = L.span || 12;
        torque.y += -q * S * c * 0.6 * (alpha - 0.035);
        torque.z += q * S * b * 0.12 * beta;
        const damp = (q * S * c * c * 15) / Math.max(speed, 30);
        torque.x += -this.omega.x * damp * 0.8;
        torque.y += -this.omega.y * damp;
        torque.z += -this.omega.z * damp;
        const auth = q * S * c * 0.25;
        torque.x += clamp(rc.x, -1, 1) * auth * 1.2;
        torque.y += clamp(rc.y, -1, 1) * auth;
        torque.z += clamp(rc.z, -1, 1) * auth * 0.5;
        this.alpha = alpha;
        this.stalled = stalled && speed > 20;
      } else if (aero.stable !== 'none') {
        // Blunt bodies weathervane: capsules heat shield first, rockets nose first.
        const sgn = aero.stable === 'retrograde' ? -1 : 1;
        const k = q * aero.area * aero.stability * 2.5;
        alignTorque(torque, vb.x * sgn, vb.y * sgn, vb.z * sgn, k);
        dampTorque(torque, this.omega, k * 0.7);
      }
      // Sutton-Graves convective heating at the stagnation point, W/m².
      const flux = 1.7415e-4 * Math.sqrt(atm.rho / def.heat.noseRadius) * speed * speed * speed;
      // Heat shield facing the flow: aft shield for capsules, belly tiles for spaceplanes.
      const ax = def.heat.shieldAxis || [-1, 0, 0];
      const shield = this.heatShieldStage && vb.x * ax[0] + vb.y * ax[1] + vb.z * ax[2] > (def.heat.shieldCos ?? 0.82);
      this.shieldFacing = !!shield;
      heatIn = flux * (shield ? 0.55 : 1);
      this.heatFlux = flux;
    } else {
      this.heatFlux = 0;
      this.shieldFacing = false;
      if (this.parachute > 0 && this.parachute < 1) this.parachute = Math.min(1, this.parachute + dt / 3.5);
    }
    // Lumped skin temperature: convective input minus radiation, with sunlight in space.
    const h = def.heat;
    const sunIn = env.sunlit ? 600 : 0;
    const dT = ((heatIn + sunIn) * h.area * 0.5 - 0.85 * SIGMA * h.area * (this.temperature ** 4 - 3 ** 4)) / h.capacity;
    this.temperature = Math.max(4, this.temperature + dT * dt);
    const limit = this.shieldFacing ? h.shieldMax : h.hullMax;
    this.tempLimit = limit;
    if (this.temperature > limit) {
      this.destroy('Surriscaldamento: la struttura ha ceduto durante il rientro', events);
      return events;
    }

    // ---------------------------------------------------------- contacts with the ground / sea
    this.contacts = 0;
    let legImpact = 0, hullImpact = 0;
    if (this.agl < 80) {
      const m = this.mass;
      const g = body.mu / (r * r);
      const touching = new Set();
      for (const c of this.contactPoints()) {
        const rb = this.local(c.p, new V3());
        const rw = this.q.rotate(rb, new V3());
        const wp = new V3().copy(this.pos).add(rw);
        const wr = wp.len();
        const n = new V3().copy(wp).scale(1 / wr);
        const gh = env.height(wp);
        const water = body.ocean && gh < 0;
        const surf = body.radius + (water ? 0 : gh);
        const pen = surf - (wr - c.r);
        if (pen <= 0) continue;
        this.contacts++;
        touching.add(c.key);
        if (!water && !c.leg) this.hullTouch = true;
        // Contact point velocity relative to the (rotating) ground.
        const wv = this.q.rotate(new V3().crossVectors(this.omega, rb), new V3()).add(this.vel).sub(new V3().crossVectors(spin, wp));
        const vn = wv.dot(n);
        const fresh = !this._touching.has(c.key);
        let k, damp, mu;
        if (water) {
          k = m * g * 0.9;
          damp = m * 1.6;
          mu = 0.1;
          if (!this.splashed) {
            this.splashed = true;
            events.push({ type: 'splashdown', speed: -vn });
            const lim = def.waterSpeed || def.crashSpeed * 3;
            if (-vn > lim) {
              this.destroy(`Impatto in acqua a ${(-vn).toFixed(1)} m/s`, events);
              return events;
            }
          }
        } else if (c.leg) {
          k = (m * Math.max(g, 1.6) * 2.2) / Math.max(0.2, c.leg.stroke);
          damp = 2 * 0.75 * Math.sqrt(k * m * 0.25);
          mu = 0.8;
          if (fresh && -vn > legImpact) legImpact = -vn;
        } else {
          k = m * 900;
          damp = 2 * 0.9 * Math.sqrt(k * m * 0.25);
          mu = 0.6;
          if (fresh && -vn > hullImpact) hullImpact = -vn;
        }
        const fn = Math.max(0, k * pen - damp * vn);
        const f = new V3().copy(n).scale(fn);
        // Friction opposes the tangential velocity (regularised near zero). Wheels roll
        // along the body x axis: low rolling resistance, brakes, strong side grip.
        const vt = new V3().copy(wv).addScaled(n, -vn);
        if (c.leg?.wheel && !water) {
          const fx = this.q.rotate(new V3(1, 0, 0), new V3());
          fx.addScaled(n, -fx.dot(n)).normalize();
          const vlong = vt.dot(fx);
          const vlat = vt.clone().addScaled(fx, -vlong);
          const muLong = this.brakes ? 0.45 : 0.015;
          f.addScaled(fx, -Math.sign(vlong) * muLong * fn * Math.min(1, Math.abs(vlong) / 0.3));
          const ll = vlat.len();
          if (ll > 1e-5) f.addScaled(vlat, (-0.7 * fn * Math.min(1, ll / 0.08)) / ll);
        } else {
          const vtl = vt.len();
          if (vtl > 1e-5) f.addScaled(vt, (-mu * fn * Math.min(1, vtl / 0.04)) / vtl);
        }
        if (water) f.addScaled(vt, -m * 0.3);
        force.add(f);
        const fb = this.q.rotateInv(f, new V3());
        torque.add(new V3().crossVectors(rb, fb));
        // Water and ground damp the spin.
        if (water) dampTorque(torque, this.omega, this.inertia.y * 0.6);
      }
      this._touching = touching;
    } else this._touching.clear();
    if (this.contacts === 0 && this.agl > 3) this.splashed = false;
    const legLimit = def.legSpeed || def.crashSpeed * 1.6;
    const hullLimit = this.stage.parachute && this.stages.length - this.stageIndex === 1 ? def.landSpeed || def.crashSpeed : def.crashSpeed;
    if (legImpact > 0.05 || hullImpact > 0.05) {
      this.lastImpact = { legs: legImpact, hull: hullImpact, t: env.time };
      events.push({ type: 'touchdown', speed: Math.max(legImpact, hullImpact), legs: legImpact > 0 });
    }
    if (legImpact > legLimit) {
      this.destroy(`Contatto troppo violento (${legImpact.toFixed(1)} m/s): gambe distrutte`, events);
      return events;
    }
    if (hullImpact > hullLimit) {
      this.destroy(`Impatto con il suolo a ${hullImpact.toFixed(1)} m/s`, events);
      return events;
    }
    // Sustained overload.
    if (this.gForce > (def.gLimit || 12)) {
      this._overG = (this._overG || 0) + dt;
      if (this._overG > 1.2) {
        this.destroy(`Sovraccarico di ${this.gForce.toFixed(1)} g: struttura ed equipaggio oltre i limiti`, events);
        return events;
      }
    } else this._overG = 0;

    // ---------------------------------------------------------- integrate
    if (thrust > 0 || monoUse > 0) this.updateMass();
    this.integrate(dt, force, torque, env);
    const gNow = force.len() / this.mass / G0;
    this.gForce = gNow;
    if (gNow > this.maxG) this.maxG = gNow;
    const groundVel = new V3().crossVectors(spin, this.pos);
    const resting = this.contacts >= 3 && this.vel.clone().sub(groundVel).len() < 0.25 && this.omega.len() < 0.05;
    if (resting !== this.landed) {
      this.landed = resting;
      if (resting) events.push({ type: 'landed', water: this.splashed });
    }
    return events;
  }

  /**
   * RK4 on the translational state with gravity re-evaluated at every stage, the
   * non-gravitational force held constant over the step. Rotation: Euler's equations with
   * a diagonal inertia.
   */
  integrate(dt, force, torque, env) {
    const m = this.mass;
    const ax = force.x / m, ay = force.y / m, az = force.z / m;
    this.accel.set(ax, ay, az);
    const g = env.gravity;
    const p0 = this.pos, v0 = this.vel;
    const k1v = g(p0, new V3()).add(this.accel);
    const p1 = new V3().copy(p0).addScaled(v0, dt / 2);
    const v1 = new V3().copy(v0).addScaled(k1v, dt / 2);
    const k2v = g(p1, new V3()).add(this.accel);
    const p2 = new V3().copy(p0).addScaled(v1, dt / 2);
    const v2 = new V3().copy(v0).addScaled(k2v, dt / 2);
    const k3v = g(p2, new V3()).add(this.accel);
    const p3 = new V3().copy(p0).addScaled(v2, dt);
    const v3 = new V3().copy(v0).addScaled(k3v, dt);
    const k4v = g(p3, new V3()).add(this.accel);
    this.pos.x += (dt / 6) * (v0.x + 2 * v1.x + 2 * v2.x + v3.x);
    this.pos.y += (dt / 6) * (v0.y + 2 * v1.y + 2 * v2.y + v3.y);
    this.pos.z += (dt / 6) * (v0.z + 2 * v1.z + 2 * v2.z + v3.z);
    this.vel.x += (dt / 6) * (k1v.x + 2 * k2v.x + 2 * k3v.x + k4v.x);
    this.vel.y += (dt / 6) * (k1v.y + 2 * k2v.y + 2 * k3v.y + k4v.y);
    this.vel.z += (dt / 6) * (k1v.z + 2 * k2v.z + 2 * k3v.z + k4v.z);
    const I = this.inertia, w = this.omega;
    const dwx = (torque.x - (I.z - I.y) * w.y * w.z) / I.x;
    const dwy = (torque.y - (I.x - I.z) * w.z * w.x) / I.y;
    const dwz = (torque.z - (I.y - I.x) * w.x * w.y) / I.z;
    w.x += dwx * dt;
    w.y += dwy * dt;
    w.z += dwz * dt;
    // Contact torques can be stiff: keep the spin physically bounded.
    const wl = w.len();
    if (wl > 12) w.scale(12 / wl);
    this.q.integrate(w, dt);
  }

  /** Jettison the lowest stage. Returns the dropped stage (for debris) or null. */
  separate() {
    if (this.stageIndex >= this.stages.length - 1) return null;
    const dropped = this.stages[this.stageIndex];
    const oldCom = this.com;
    this.stageIndex++;
    this.updateMass();
    // Keep the remaining stack where it is: the centre of mass moved along body x.
    const shift = this.q.rotate(new V3(this.com - oldCom, 0, 0), new V3());
    this.pos.add(shift);
    this.throttle = 0;
    return dropped;
  }

  deployParachute(env) {
    const chute = this.stage.parachute;
    if (!chute || this.parachute !== 0) return { ok: false, reason: chute ? 'Paracadute già usato' : 'Nessun paracadute' };
    const speed = this.airspeed ?? this.vel.len();
    if (this.altitude > chute.maxAltitude || !env.body.atmosphere) return { ok: false, reason: `Troppo in alto: il paracadute si apre sotto i ${Math.round(chute.maxAltitude / 1000)} km` };
    this.parachute = 0.02;
    if (speed > chute.maxSpeed) {
      this.parachute = -1;
      return { ok: false, torn: true, reason: `Velocità troppo alta (${speed.toFixed(0)} m/s): paracadute strappato` };
    }
    return { ok: true };
  }

  destroy(reason, events) {
    if (this.destroyed) return;
    this.destroyed = reason;
    this.integrity = 0;
    this.throttle = 0;
    this.engineOn = false;
    events?.push({ type: 'crash', reason });
  }

  /** Apply structural damage (percent). */
  damage(amount, reason, events) {
    this.integrity = Math.max(0, this.integrity - amount);
    if (this.integrity <= 0) this.destroy(reason, events);
  }
}
