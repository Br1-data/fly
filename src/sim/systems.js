// Aircraft systems: electrical, fuel, lights, flaps/gear/spoiler actuators, brakes,
// anti-ice, APU and warnings.
import { clamp, moveTowards, approach } from '../core/math.js';

export class Systems {
  constructor(def) {
    this.def = def;
    const s = def.systems || {};
    this.s = s;
    // electrical
    this.battery = false;
    this.alternator = false;
    this.avionics = false;
    this.batteryCharge = 1; // 0..1
    this.busVolts = 0;
    this.ammeter = 0;
    this.avionicsPowered = false;
    // lights
    this.lights = { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: false, logo: false };
    // fuel
    this.fuelPump = false;
    this.fuelSelector = 'both'; // both | left | right | off
    this.tanks = def.fuel.tanks.map((t) => ({ name: t.name, capacity: t.capacity, qty: t.capacity * 0.8, y: t.y || 0, x: t.x || 0 }));
    this.crossfeed = false;
    this.infiniteFuel = false;
    // anti-ice
    this.pitotHeat = false;
    this.antiIce = false;
    this.pitotIce = 0;
    this.airframeIce = 0;
    // vacuum (gyros)
    this.vacuum = 0;
    this.gyroSpin = 0; // 0..1 attitude/heading gyro rotor speed
    // flaps / gear / spoilers
    this.flapsLever = 0; // detent index
    this.flaps = 0; // actual 0..1 (fraction of max flap angle)
    this.slats = 0;
    this.gearLever = 1;
    this.gearPos = 1;
    this.spoilerLever = 0; // 0..1 (speedbrake)
    this.spoilersArmed = false;
    this.spoilers = 0;
    this.groundSpoilers = 0;
    // brakes
    this.parkingBrake = true;
    this.autobrake = 0; // 0 off, 1 LO, 2 MED, 3 MAX
    this.autobrakeActive = false;
    // hydraulic pressure 0..1
    this.hydraulics = 0;
    // APU
    this.apuMaster = false;
    this.apuN = 0;
    this.apuBleed = false;
    this.engineStartSel = 'norm'; // norm | ign
    this.smoke = false;
    // warnings
    this.warnings = {};
    this.masterCaution = false;
    this.masterWarning = false;
  }

  /** Cold & dark or ready-to-fly state. */
  reset(running, opts = {}) {
    const on = !!running;
    this.battery = on;
    this.alternator = on;
    this.avionics = on;
    this.batteryCharge = 1;
    this.fuelPump = false;
    this.fuelSelector = 'both';
    for (const k of Object.keys(this.lights)) this.lights[k] = false;
    if (on) {
      this.lights.nav = true;
      this.lights.beacon = true;
      this.lights.strobe = opts.inAir || false;
      this.lights.landing = opts.inAir ? false : false;
      this.lights.panel = !!opts.night;
      this.lights.logo = !!opts.night;
    }
    this.pitotHeat = false;
    this.antiIce = false;
    this.pitotIce = 0;
    this.airframeIce = 0;
    this.busVolts = on ? this.def.systems?.volts || 28 : 0;
    this.avionicsPowered = on;
    this.vacuum = on ? 5 : 0;
    this.gyroSpin = on ? 1 : 0;
    this.parkingBrake = !opts.inAir;
    this.autobrake = 0;
    this.autobrakeActive = false;
    this.spoilerLever = 0;
    this.spoilersArmed = false;
    this.spoilers = 0;
    this.groundSpoilers = 0;
    this.hydraulics = on ? 1 : 0;
    this.apuMaster = false;
    this.apuN = 0;
    this.apuBleed = false;
    this.engineStartSel = 'norm';
    this.smoke = false;
    const retract = this.def.controls.retractableGear && opts.inAir && !opts.gearDown;
    this.gearLever = retract ? 0 : 1;
    this.gearPos = retract ? 0 : 1;
    this.flapsLever = opts.flaps ?? 0;
    this.flaps = this.def.controls.flapDetents[this.flapsLever].flaps;
    this.slats = this.def.controls.flapDetents[this.flapsLever].slats ?? 0;
    const fuelFrac = opts.fuel ?? 0.8;
    for (const t of this.tanks) t.qty = t.capacity * fuelFrac;
  }

  get fuelTotal() {
    return this.tanks.reduce((a, t) => a + t.qty, 0);
  }

  flapsDetents() {
    return this.def.controls.flapDetents;
  }

  /** Main update. fm: flight model. */
  update(dt, fm) {
    const def = this.def;
    const ctl = def.controls;
    const engines = fm.engines;
    const anyRunning = engines.some((e) => e.running);
    const onGround = fm.onGround;

    // ---------------- APU ----------------
    if (def.systems?.apu) {
      const apuTarget = this.apuMaster && this.battery && this.fuelTotal > 1 ? 100 : 0;
      this.apuN = moveTowards(this.apuN, apuTarget, apuTarget > this.apuN ? 9 : 14, dt);
    }
    const apuOn = this.apuN > 95;

    // ---------------- electrical ----------------
    const nominal = def.systems?.volts || 28;
    const engineGen = engines.some((e) => (e.type === 'piston' ? e.rpm > 900 : e.n2 > 55));
    const altOnline = this.alternator && (engineGen || apuOn);
    let load = 0;
    if (this.battery) {
      load += 3;
      if (this.avionics) load += 9;
      const L = this.lights;
      load += (L.nav ? 2 : 0) + (L.beacon ? 1.5 : 0) + (L.strobe ? 2.5 : 0) + (L.landing ? 8 : 0) + (L.taxi ? 5 : 0) + (L.panel ? 1 : 0);
      if (this.pitotHeat) load += 7;
      if (this.fuelPump) load += 3;
      for (const e of engines) if (e.type === 'piston' && e.magnetos === 4) load += 90;
    }
    const batteryVolts = (nominal - 4) * (0.8 + 0.2 * clamp(this.batteryCharge * 1.4, 0, 1)) * (this.batteryCharge > 0.05 ? 1 : 0.3);
    if (this.battery) {
      if (altOnline) {
        this.busVolts = approach(this.busVolts, nominal, dt, 0.5);
        this.ammeter = clamp((1 - this.batteryCharge) * 60, 0, 30);
        this.batteryCharge = clamp(this.batteryCharge + dt * 0.0008, 0, 1);
      } else {
        this.busVolts = approach(this.busVolts, batteryVolts - load * 0.02, dt, 0.3);
        this.ammeter = -load;
        this.batteryCharge = clamp(this.batteryCharge - (load * dt) / (3600 * (def.systems?.batteryAh || 35)), 0, 1);
      }
    } else {
      this.busVolts = approach(this.busVolts, 0, dt, 0.2);
      this.ammeter = 0;
    }
    const powered = this.busVolts > nominal * 0.62;
    this.avionicsPowered = powered && this.avionics;
    for (const e of engines) if (e.type === 'piston') e.starterPower = this.battery && this.busVolts > nominal * 0.55;

    // ---------------- vacuum / gyros ----------------
    const pistonRpm = engines[0].type === 'piston' ? engines[0].rpm : 0;
    if (def.systems?.vacuum) {
      this.vacuum = approach(this.vacuum, clamp((pistonRpm - 300) / 900, 0, 1) * 5.2, dt, 1);
      const spinTarget = this.vacuum > 3.5 ? 1 : this.vacuum / 3.5;
      this.gyroSpin = approach(this.gyroSpin, spinTarget, dt, spinTarget > this.gyroSpin ? 20 : 90);
    } else {
      // electric gyros / IRS
      this.gyroSpin = approach(this.gyroSpin, powered ? 1 : 0, dt, powered ? 12 : 60);
    }

    // ---------------- hydraulics ----------------
    const hydSrc = def.systems?.hydraulic ? engines.some((e) => e.running) || (this.def.systems.apu && apuOn && false) : powered;
    this.hydraulics = approach(this.hydraulics, hydSrc ? 1 : 0, dt, hydSrc ? 1.5 : 20);

    // ---------------- fuel ----------------
    let totalFlow = 0;
    for (const e of engines) totalFlow += e.fuelFlow;
    if (apuOn) totalFlow += 0.03;
    if (this.infiniteFuel) totalFlow = 0;
    const feeding = this.tanks.filter((t, i) => {
      if (this.fuelSelector === 'off') return false;
      if (this.fuelSelector === 'both') return true;
      return (this.fuelSelector === 'left' && i === 0) || (this.fuelSelector === 'right' && i === 1) || (this.tanks.length > 2 && i >= 2);
    });
    const avail = feeding.filter((t) => t.qty > 0.05);
    if (avail.length && totalFlow > 0) {
      const each = (totalFlow * dt) / avail.length;
      for (const t of avail) t.qty = Math.max(0, t.qty - each);
    }
    let fuelOk = avail.length > 0;
    // gravity-fed piston: needs selector on; high-wing works without pump. Jets need pump/power for start.
    for (const e of engines) e.fuelAvailable = fuelOk;

    // ---------------- flaps / slats ----------------
    const detents = ctl.flapDetents;
    const idx = clamp(Math.round(this.flapsLever), 0, detents.length - 1);
    this.flapsLever = idx;
    const det = detents[idx];
    const flapTarget = det.flaps;
    const slatTarget = det.slats ?? 0;
    const flapPower = ctl.flapsHydraulic ? this.hydraulics > 0.5 : powered;
    if (flapPower) {
      this.flaps = moveTowards(this.flaps, flapTarget, ctl.flapRate, dt);
      this.slats = moveTowards(this.slats, slatTarget, ctl.flapRate * 1.5, dt);
    }

    // ---------------- landing gear ----------------
    if (ctl.retractableGear) {
      if (onGround && this.gearLever === 0) this.gearLever = 1; // squat switch prevents retraction
      const gearPower = this.hydraulics > 0.5 || this.gearLever === 1; // gravity extension backup
      if (gearPower) this.gearPos = moveTowards(this.gearPos, this.gearLever, 1 / ctl.gearTime, dt);
    } else {
      this.gearLever = 1;
      this.gearPos = 1;
    }
    fm.gear.position = this.gearPos;

    // ---------------- spoilers ----------------
    if (ctl.spoilers) {
      // ground spoilers deploy on touchdown when armed (or with reversers selected)
      const thrIdle = engines.every((e) => e.throttle < 0.08);
      const wheelSpin = fm.gear.legs.some((l) => l.contact && Math.abs(l.wheelSpeed * (l.d.radius || 0.5)) > 30);
      if (onGround && thrIdle && (this.spoilersArmed || engines.some((e) => e.reverseCmd)) && (wheelSpin || fm.gsKt > 60)) this.groundSpoilers = 1;
      if (!thrIdle || fm.gsKt < 5) {
        if (!onGround || !thrIdle) this.groundSpoilers = 0;
      }
      const target = Math.max(this.spoilerLever, this.groundSpoilers);
      this.spoilers = moveTowards(this.spoilers, target, 1.5, dt);
    }

    // ---------------- autobrake ----------------
    if (this.autobrake > 0 && onGround && this.groundSpoilers > 0.5) this.autobrakeActive = true;
    if (!onGround) this.autobrakeActive = false;
    if (fm.pilotBrake > 0.6) this.autobrakeActive = false;
    if (this.autobrakeActive) {
      const decel = [0, 1.7, 3.0, 6.0][this.autobrake];
      const actual = -fm.accelLongitudinal;
      fm._autobrakeCmd = clamp((fm._autobrakeCmd || 0) + (decel - actual) * dt * 0.8, 0, 1);
    } else fm._autobrakeCmd = 0;

    // ---------------- icing ----------------
    const oat = fm.oatC;
    const inCloud = fm.cloudDensity > 0.3 || fm.precip > 0.3;
    if (inCloud && oat < 2 && oat > -25) {
      if (!this.pitotHeat || !powered) this.pitotIce = clamp(this.pitotIce + dt / 90, 0, 1);
      if (!this.antiIce) this.airframeIce = clamp(this.airframeIce + dt / 900, 0, 1);
    }
    if (this.pitotHeat && powered) this.pitotIce = Math.max(0, this.pitotIce - dt / 20);
    if (oat > 3) {
      this.pitotIce = Math.max(0, this.pitotIce - dt / 60);
      this.airframeIce = Math.max(0, this.airframeIce - dt / 300);
    }
    if (this.antiIce && powered) this.airframeIce = Math.max(0, this.airframeIce - dt / 200);

    // ---------------- warnings ----------------
    const w = this.warnings;
    w.stall = fm.stallWarning && powered;
    w.overspeed = fm.overspeed;
    w.gear = ctl.retractableGear && this.gearPos < 0.99 && !onGround && fm.aglFt < 800 && engines.every((e) => e.throttle < 0.25) && powered;
    w.lowFuel = this.fuelTotal < def.fuel.capacity * 0.1;
    w.lowVolts = this.battery && this.busVolts < nominal * 0.85;
    w.oilPress = engines.some((e) => (e.type === 'piston' ? e.rpm > 400 && e.oilPress < 20 : e.running && e.oilPress < 10));
    w.parkingBrake = this.parkingBrake && engines.some((e) => e.throttle > 0.6);
    w.flapsOverspeed = this.flaps > 0.01 && fm.iasKt > (det.vfe || 999) + 5;
    w.engineFire = false;
    this.masterWarning = w.stall || w.overspeed || w.gear;
    this.masterCaution = w.lowFuel || w.lowVolts || w.oilPress || w.parkingBrake;
    this.anyRunning = anyRunning;
  }
}
