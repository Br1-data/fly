// Landing gear and structural ground-contact model.
import { V3, clamp } from '../core/math.js';
import { SURFACES } from '../world/terrain-height.js';

const tmpW = new V3();
const tmpR = new V3();
const tmpV = new V3();
const tmpF = new V3();
const tmpDir = new V3();
const tmpLat = new V3();
const tmpN = new V3();

export class GearLeg {
  constructor(d) {
    this.d = d;
    this.pos = new V3().fromArray(d.pos);
    this.compression = 0;
    this.compressionRate = 0;
    this.force = 0; // normal force (N)
    this.contact = false;
    this.wheelSpeed = 0; // rad/s
    this.wheelAngle = 0;
    this.steerAngle = 0;
    this.surface = 'asphalt';
    this.skid = 0; // 0..1 tyre skid intensity
    this.lastTouchVs = 0;
  }
}

export class LandingGear {
  constructor(gearDefs, contactDefs) {
    this.legs = gearDefs.map((g) => new GearLeg(g));
    this.contacts = (contactDefs || []).map((c) => ({ name: c.name, pos: new V3().fromArray(c.pos), contact: false, force: 0, critical: c.critical !== false }));
    this.position = 1; // 0 = up, 1 = down & locked
    this.events = [];
    this._g = {};
  }

  /**
   * Compute ground forces & moments (body frame) for the aircraft state.
   * fm: flight model (pos, vel, q, omega, brake inputs etc.), terrain: ground model.
   * Adds into fBody / mBody.
   */
  compute(fm, terrain, fBody, mBody, dt) {
    const q = fm.q;
    const g = this._g;
    let anyContact = false;
    const gearDown = this.position > 0.98;
    const brakeL = fm.brakeLeft;
    const brakeR = fm.brakeRight;
    for (const leg of this.legs) {
      const d = leg.d;
      leg.contact = false;
      leg.force = 0;
      leg.skid = 0;
      if (!gearDown && d.retractable) {
        leg.compression = 0;
        continue;
      }
      // contact point world position
      q.rotate(leg.pos, tmpW);
      const wn = fm.pos.x + tmpW.x;
      const we = fm.pos.y + tmpW.y;
      const wd = fm.pos.z + tmpW.z;
      const quickAgl = -wd - fm.groundHint;
      if (quickAgl > 25) {
        leg.compression = 0;
        leg.wheelSpeed *= 0.995;
        continue;
      }
      terrain.groundInfo(wn, we, g);
      leg.surface = g.surface;
      // penetration along ground normal (approx. vertical)
      const pen = g.h - -wd; // positive when below ground
      if (pen <= 0) {
        leg.compression = 0;
        leg.wheelSpeed *= 0.995;
        continue;
      }
      // velocity of contact point (world)
      tmpR.copy(leg.pos);
      tmpV.crossVectors(fm.omega, tmpR); // body
      q.rotate(tmpV, tmpV);
      tmpV.add(fm.vel);
      tmpN.set(g.nx, g.ny, g.nz); // up normal (NED)
      const vN = tmpV.dot(tmpN); // positive = moving away from ground (up)
      const comp = Math.min(pen, d.travel * 1.6);
      const compRate = -vN;
      if (!leg.wasContact) {
        leg.lastTouchVs = compRate;
        this.events.push({ type: 'touch', leg: d.name, vs: compRate, surface: g.surface });
      }
      let Fn = d.k * comp + d.c * compRate;
      if (pen > d.travel) {
        Fn += d.k * 12 * (pen - d.travel) + d.c * 2 * compRate;
        if (compRate > 2.5) this.events.push({ type: 'bottom', leg: d.name, vs: compRate });
      }
      Fn = Math.max(Fn, 0);
      leg.compression = comp;
      leg.compressionRate = compRate;
      leg.force = Fn;
      leg.contact = true;
      anyContact = true;
      const surf = SURFACES[g.surface] || SURFACES.grass;

      // wheel heading: body x rotated by steering about body z
      let steer = 0;
      if (d.steer) steer = fm.nosewheelSteer * d.steer;
      leg.steerAngle = steer;
      tmpDir.set(Math.cos(steer), Math.sin(steer), 0);
      q.rotate(tmpDir, tmpDir);
      // project on ground plane
      const dn = tmpDir.dot(tmpN);
      tmpDir.addScaled(tmpN, -dn).normalize();
      tmpLat.crossVectors(tmpN, tmpDir); // lateral (sign irrelevant, used symmetrically)
      const vLong = tmpV.dot(tmpDir);
      const vLat = tmpV.dot(tmpLat);

      // braking / rolling resistance
      let brake = 0;
      if (d.brake === 'left') brake = brakeL;
      else if (d.brake === 'right') brake = brakeR;
      else if (d.brake === 'both') brake = Math.max(brakeL, brakeR);
      const muRoll = (d.muRoll || 0.02) + surf.roll;
      const muBrake = brake * (d.muBrake || 0.8) * surf.brake;
      const vRefL = brake > 0.05 ? 0.06 : 0.4;
      const satL = clamp(vLong / vRefL, -1, 1);
      let fLong = -(muRoll + muBrake) * Fn * satL;
      // lateral friction with tyre slip saturation
      const muSide = (d.muSide || 0.85) * surf.side;
      const satLat = clamp(vLat / 0.12, -1, 1);
      let fLat = -muSide * Fn * satLat;
      // friction circle
      const fMax = Math.max(muSide, muRoll + muBrake) * Fn;
      const fTot = Math.hypot(fLong, fLat);
      if (fTot > fMax && fTot > 0) {
        fLong *= fMax / fTot;
        fLat *= fMax / fTot;
      }
      leg.skid = clamp((Math.abs(vLat) - 0.6) / 3, 0, 1) + (brake > 0.9 && Math.abs(vLong) > 3 ? 0.3 : 0);
      // surface bumps (grass strips)
      if (surf.bump > 0 && Math.abs(vLong) > 1) {
        const b = Math.sin(wn * 1.7 + we * 2.3) * Math.sin(wn * 0.43 - we * 0.91);
        Fn *= 1 + surf.bump * 0.06 * b * clamp(Math.abs(vLong) / 15, 0, 1);
      }

      tmpF.set(0, 0, 0);
      tmpF.addScaled(tmpN, Fn);
      tmpF.addScaled(tmpDir, fLong);
      tmpF.addScaled(tmpLat, fLat);
      // to body
      q.rotateInv(tmpF, tmpF);
      fBody.add(tmpF);
      // moment arm: contact point (approx at leg pos shifted up by compression)
      tmpR.copy(leg.pos);
      tmpR.z -= comp;
      tmpV.crossVectors(tmpR, tmpF);
      mBody.add(tmpV);

      // wheel spin for animation / spin-up smoke
      const target = vLong / (d.radius || 0.3);
      leg.wheelSpeed += (target - leg.wheelSpeed) * clamp(dt * (brake > 0.5 ? 6 : 25), 0, 1);
    }
    for (const leg of this.legs) {
      leg.wasContact = leg.contact;
      leg.wheelAngle += leg.wheelSpeed * dt;
    }

    // structural contact points (and retracted gear / belly)
    for (const c of this.contacts) {
      c.contact = false;
      c.force = 0;
      q.rotate(c.pos, tmpW);
      const wn = fm.pos.x + tmpW.x;
      const we = fm.pos.y + tmpW.y;
      const wd = fm.pos.z + tmpW.z;
      if (-wd - fm.groundHint > 30) continue;
      terrain.groundInfo(wn, we, g);
      const pen = g.h + wd;
      if (pen <= 0) {
        c.was = false;
        continue;
      }
      tmpR.copy(c.pos);
      tmpV.crossVectors(fm.omega, tmpR);
      q.rotate(tmpV, tmpV);
      tmpV.add(fm.vel);
      tmpN.set(g.nx, g.ny, g.nz);
      const vN = tmpV.dot(tmpN);
      if (!c.was) this.events.push({ type: 'strike', point: c.name, vs: -vN, speed: tmpV.len(), surface: g.surface, critical: c.critical });
      c.was = true;
      const k = fm.mass * 60;
      let Fn = k * Math.min(pen, 1.5) - k * 0.25 * vN;
      Fn = Math.max(Fn, 0);
      tmpF.set(0, 0, 0).addScaled(tmpN, Fn);
      // sliding friction
      const vt = tmpLat.copy(tmpV).addScaled(tmpN, -vN);
      const vtl = vt.len();
      if (vtl > 0.01) tmpF.addScaled(vt, (-0.5 * Fn * clamp(vtl / 0.5, 0, 1)) / vtl);
      q.rotateInv(tmpF, tmpF);
      fBody.add(tmpF);
      tmpV.crossVectors(c.pos, tmpF);
      mBody.add(tmpV);
      c.contact = true;
      c.force = Fn;
      anyContact = true;
    }
    return anyContact;
  }
}
