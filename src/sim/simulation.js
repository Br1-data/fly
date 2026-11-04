// Simulation shell: scenario setup, fixed-step physics, time warp (physics and on rails),
// sphere-of-influence changes, orbiting objects, targets, docking, collisions, maneuver nodes,
// assists, debris and the messages / events consumed by the user interface.
import { V3, Quat, clamp, G0 } from '../core/math.js';
import { Spacecraft } from './spacecraft.js';
import { getShip } from './ships.js';
import { BODIES, AUSONIA, LUCINA, OBJECTS, SITES, lucinaState, sunDirection, siteFrame, swarmAsteroids, atmosphereAt } from './system.js';
import { propagate, elements, circularState, orbitalFrame } from './orbit.js';
import { rotationCommand, killVelocityCommand, flightAssistCommand, verticalSpeedThrottle, lookRotation, SAS_MODES } from './assist.js';
import * as M from './maneuver.js';

export const DEFAULT_SETTINGS = {
  crashes: true,
  unlimitedFuel: false,
  heating: true,
  autoWarpStop: true,
};

export const WARP_LEVELS = [1, 2, 4, 10, 50, 100, 1000, 10000, 100000];
const PHYSICS_WARP_MAX = 4;
const PHYSICS_WARP_LIMIT = 10;
const DT = 1 / 240;

/** Body-frame vector from an array. */
const v3 = (a) => new V3(a[0], a[1], a[2]);

export class Simulation {
  constructor() {
    this.paused = false;
    this.settings = { ...DEFAULT_SETTINGS };
    this.events = [];
    this.messages = [];
    this.warpIndex = 0;
    this.t = 0;
    this.ship = null;
    this.objects = [];
    this.debris = [];
    this.markers = [];
    this.pilot = this.blankPilot();
    this.cockpitInput = {};
  }

  blankPilot() {
    return { pitch: 0, yaw: 0, roll: 0, tx: 0, ty: 0, tz: 0, throttle: 0, killVel: false, brake: false };
  }

  get def() {
    return this.ship?.def;
  }

  get timeWarp() {
    return WARP_LEVELS[this.warpIndex];
  }

  /** Warp levels above ×4 run on rails when possible; ×10 may also run as physics warp. */
  get onRails() {
    const w = this.timeWarp;
    if (w <= PHYSICS_WARP_MAX) return false;
    if (w <= PHYSICS_WARP_LIMIT) return this._railsOk !== false;
    return true;
  }

  get crashed() {
    return !!this.ship?.destroyed;
  }

  get body() {
    return BODIES[this.ship.ref];
  }

  message(text, kind = 'info', duration = 4) {
    this.messages.push({ text, kind, duration, t: this.t });
  }

  emit(ev) {
    this.events.push(ev);
  }

  // ------------------------------------------------------------------ setup
  /**
   * opts: { ship, start, sunLon, lucinaPhase, fuel (0..1), mono (0..1), objects: [ids],
   *         extraObjects: [defs], target, node, stationArgLat, assists: {sas, rcs, fa} }
   */
  setup(opts = {}) {
    this.opts = opts;
    this.t = opts.time || 0;
    this.lucinaPhase = opts.lucinaPhase ?? 0.6;
    this.sunDir = sunDirection(opts.sunLon ?? 25, opts.sunDec ?? 7);
    this.warpIndex = 0;
    this.events = [];
    this.messages = [];
    this.debris = [];
    this.markers = [];
    this.node = null;
    this.autoBurn = false;
    this.ascent = null;
    this.docked = null;
    this.prediction = null;
    this._predTimer = 0;
    this.timeSinceStart = 0;
    this.flightTime = 0;
    this.distanceTravelled = 0;
    this.pilot = this.blankPilot();
    this.cockpitInput = {};
    const def = getShip(opts.ship || 'capsule');
    const ship = (this.ship = new Spacecraft(def));
    for (const st of ship.stages) st.fuelLeft = st.fuel * (opts.fuel ?? 1);
    ship.mono = def.rcs.fuel * (opts.mono ?? 1);
    if (opts.stage) for (let i = 0; i < opts.stage; i++) ship.separate();
    ship.updateMass();
    this.sas = { on: opts.assists?.sas ?? true, mode: 'stab', hold: null };
    ship.rcsEnabled = opts.assists?.rcs ?? true;
    this.fa = !!(def.flightAssist && (opts.assists?.fa ?? true));
    this.vsHold = false;
    this.fuelStart = ship.fuel + ship.mono;
    this.buildObjects(opts);
    this.placeShip(opts.start || { type: 'orbit', body: 'ausonia', altitude: 300e3 });
    this.target = null;
    if (opts.target) this.setTarget(opts.target);
    if (opts.node) this.node = { ...opts.node, t: this.t + opts.node.in };
    ship.legsDeployed = opts.legs ?? (opts.start?.type === 'surface' || opts.start?.type === 'hover' || def.id === 'lander');
    if (def.gearContacts) ship.legsDeployed = opts.legs ?? opts.start?.type === 'surface';
    ship.lights = !!opts.lights;
    this.updateAltitude();
    this.lastShipAbs = this.absolute(ship.ref, ship.pos);
    this.refreshPrediction(true);
    this.updateInfo();
  }

  buildObjects(opts) {
    const ids = opts.objects || ['aurora', 'ardesia', 'selene'];
    this.objects = [];
    for (const id of ids) {
      const d = OBJECTS[id];
      if (d) this.objects.push(this.makeObject(d, opts.objectOrbits?.[id]));
    }
    for (const d of opts.extraObjects || []) this.objects.push(this.makeObject(d, d.orbitOverride));
  }

  /** Object on rails from a circular orbit description (or explicit state). */
  makeObject(def, override) {
    const o = { id: def.id, name: def.name, kind: def.kind, def, ref: def.ref, spin: def.spin || null };
    const orb = { ...def.orbit, ...(override || {}) };
    const body = BODIES[def.ref];
    let state;
    if (orb.state) state = { pos: v3(orb.state.pos), vel: v3(orb.state.vel) };
    else if (orb.followsLucina) {
      // Same circular orbit as Lucina, with an angular offset.
      const th = this.lucinaPhase + orb.argLat;
      const r = LUCINA.orbit.a;
      const n = LUCINA.orbit.n;
      state = { pos: new V3(r * Math.cos(th), r * Math.sin(th), 0), vel: new V3(-r * n * Math.sin(th), r * n * Math.cos(th), 0) };
      // Shift to t = this.t from the phase defined at t = 0.
      const r2 = new V3(), v2 = new V3();
      propagate(state.pos, state.vel, this.t, body.mu, r2, v2);
      state = { pos: r2, vel: v2 };
    } else {
      const r = body.radius + (orb.altitude ?? 300e3);
      state = circularState(body.mu, r, { inclination: orb.inclination || 0, lan: orb.lan || 0, argLat: orb.argLat || 0 });
      if (orb.e) {
        // Mildly eccentric: scale velocity at this point.
        state.vel.scale(Math.sqrt(1 + orb.e));
      }
    }
    o.pos0 = state.pos;
    o.vel0 = state.vel;
    o.t0 = this.t;
    o.pos = state.pos.clone();
    o.vel = state.vel.clone();
    // Fixed inertial attitude: LVLH at the reference time (x prograde, z towards the body).
    const up = o.pos.clone().normalize();
    o.q = def.attitude ? new Quat(...def.attitude) : lookRotation(o.vel.clone().normalize(), up);
    if (def.tumble) o.omega = v3(def.tumble);
    if (def.kind === 'swarm') o.asteroids = swarmAsteroids(def);
    o.radius = def.radius || 20;
    return o;
  }

  objectState(o, t, pos = new V3(), vel = new V3()) {
    if (o.dynamic) {
      pos.copy(o.pos);
      vel.copy(o.vel);
      return { pos, vel };
    }
    propagate(o.pos0, o.vel0, t - o.t0, BODIES[o.ref].mu, pos, vel);
    return { pos, vel };
  }

  /** Ausonia-centred absolute position of a point given relative to `ref`. */
  absolute(ref, pos, out = new V3()) {
    out.copy(pos);
    if (ref === 'lucina') out.add(lucinaState(this.t, this.lucinaPhase).pos);
    return out;
  }

  absoluteVel(ref, vel, out = new V3()) {
    out.copy(vel);
    if (ref === 'lucina') out.add(lucinaState(this.t, this.lucinaPhase).vel);
    return out;
  }

  /** State of an object relative to the ship's current reference body. */
  relToShipRef(o) {
    const s = { pos: o.pos.clone(), vel: o.vel.clone() };
    if (o.ref === this.ship.ref) return s;
    const L = lucinaState(this.t, this.lucinaPhase);
    const sign = o.ref === 'lucina' ? 1 : -1;
    s.pos.addScaled(L.pos, sign);
    s.vel.addScaled(L.vel, sign);
    return s;
  }

  bodyPos(id, out = new V3()) {
    return id === 'lucina' ? lucinaState(this.t, this.lucinaPhase, out).pos : out.set(0, 0, 0);
  }

  placeShip(start) {
    const ship = this.ship;
    const def = ship.def;
    ship.omega.set(0, 0, 0);
    switch (start.type) {
      case 'orbit': {
        const body = BODIES[start.body || 'ausonia'];
        ship.ref = body.id;
        const r = body.radius + (start.altitude ?? 300e3);
        if (start.e || start.pe !== undefined) {
          const rp = body.radius + (start.pe ?? start.altitude);
          const ra = body.radius + (start.ap ?? start.altitude);
          const a = (rp + ra) / 2;
          const s = circularState(body.mu, rp, { inclination: (start.inclination || 0) * Math.PI / 180, lan: (start.lan || 0) * Math.PI / 180, argLat: start.argLat || 0 });
          s.vel.scale(Math.sqrt(body.mu * (2 / rp - 1 / a)) / s.vel.len());
          ship.pos.copy(s.pos);
          ship.vel.copy(s.vel);
          if (start.anomaly) {
            const r2 = new V3(), v2 = new V3();
            const el = elements(s.pos, s.vel, body.mu);
            propagate(s.pos, s.vel, (start.anomaly / (2 * Math.PI)) * el.period, body.mu, r2, v2);
            ship.pos.copy(r2);
            ship.vel.copy(v2);
          }
        } else {
          const s = circularState(body.mu, r, { inclination: (start.inclination || 0) * Math.PI / 180, lan: (start.lan || 0) * Math.PI / 180, argLat: start.argLat || 0 });
          ship.pos.copy(s.pos);
          ship.vel.copy(s.vel);
        }
        this.orient(start.attitude || 'prograde');
        break;
      }
      case 'near':
      case 'offset': {
        const o = this.objects.find((x) => x.id === start.object) || this.objects[0];
        ship.ref = o.ref;
        this.objectState(o, this.t, o.pos, o.vel);
        if (start.type === 'near' && o.def.ports) {
          const port = o.def.ports.find((p) => p.id === start.port) || o.def.ports[0];
          const pw = o.q.rotate(v3(port.pos), new V3()).add(o.pos);
          const dw = o.q.rotate(v3(port.dir), new V3());
          const upw = o.q.rotate(v3(port.up || [0, 0, -1]), new V3());
          const right = new V3().crossVectors(dw, upw);
          const lat = start.lateral || [0, 0];
          const shipPort = this.shipPortOffset();
          const facing = lookRotation(dw.clone().scale(-1), upw);
          if (start.yawError || start.pitchError) {
            const qe = new Quat().setFromEuler(0, (start.pitchError || 0) * Math.PI / 180, (start.yawError || 0) * Math.PI / 180);
            facing.copy(mulQ(facing, qe));
          }
          ship.q.copy(facing);
          const portW = ship.q.rotate(shipPort, new V3());
          ship.pos.copy(pw).addScaled(dw, start.distance ?? 100).addScaled(right, lat[0]).addScaled(upw, lat[1]).sub(portW);
          ship.vel.copy(o.vel);
          if (start.relVel) ship.vel.addScaled(dw, -start.relVel[0]).addScaled(right, start.relVel[1] || 0).addScaled(upw, start.relVel[2] || 0);
          if (start.attitude && start.attitude !== 'port') this.orient(start.attitude, o);
        } else {
          // LVLH offset [along, radial, normal] (m) and velocity (m/s).
          const { pro, nor, rad } = orbitalFrame(o.pos, o.vel);
          const off = start.lvlh || [-500, 0, 0];
          ship.pos.copy(o.pos).addScaled(pro, off[0]).addScaled(rad, off[1]).addScaled(nor, off[2]);
          ship.vel.copy(o.vel);
          const rv = start.relVel || [0, 0, 0];
          ship.vel.addScaled(pro, rv[0]).addScaled(rad, rv[1]).addScaled(nor, rv[2]);
          if (start.circular) {
            // Own circular orbit at that radius (for phasing scenarios).
            const s = circularState(BODIES[o.ref].mu, ship.pos.len());
            const h = new V3().crossVectors(o.pos, o.vel).normalize();
            const dir = new V3().crossVectors(h, ship.pos).normalize();
            ship.vel.copy(dir.scale(s.vel.len()));
          }
          this.orient(start.attitude || 'target', o);
        }
        break;
      }
      case 'surface': {
        const s = SITES[start.site || 'spaceport'];
        const pad = start.pad !== undefined && s.pads ? s.pads[start.pad] : s.pad || { east: 0, north: 0 };
        const f = siteFrame(s, (pad.east || 0) + (start.east || 0), (pad.north || 0) + (start.north || 0));
        ship.ref = s.body;
        // Stand on the lowest contact point.
        const pts = ship.contactPoints();
        const low = Math.min(...pts.map((c) => c.p[0] - ship.com - c.r));
        const heading = ((start.heading ?? 0) * Math.PI) / 180;
        const facing = f.north.clone().scale(Math.cos(heading)).addScaled(f.east, Math.sin(heading));
        if (def.controlStyle === 'aircraft') {
          // Horizontal vehicles: nose along the heading, belly down.
          ship.q.copy(lookRotation(facing, f.up));
          const lowZ = Math.max(...pts.map((c) => c.p[2] + c.r));
          ship.pos.copy(f.up).scale(f.body.radius + f.height + lowZ + 0.02);
        } else {
          // Vertical vehicles: x up, the cockpit (+z for landers, -z otherwise) towards the heading.
          const cockpitBelly = def.camera.look === 'belly';
          ship.q.copy(lookRotation(f.up, cockpitBelly ? facing.clone().scale(-1) : facing));
          ship.pos.copy(f.up).scale(f.body.radius + f.height - low + 0.02);
        }
        ship.vel.set(0, 0, 0);
        ship.landed = true;
        break;
      }
      case 'hover': {
        const s = SITES[start.site || 'lucerna'];
        const f = siteFrame(s, start.east || 0, start.north || 0);
        ship.ref = s.body;
        ship.pos.copy(f.up).scale(f.body.radius + f.height + (start.altitude ?? 500));
        const v = start.vel || [0, 0, 0];
        ship.vel.set(0, 0, 0).addScaled(f.east, v[0]).addScaled(f.north, v[1]).addScaled(f.up, v[2]);
        const heading = ((start.heading ?? 0) * Math.PI) / 180;
        const facing = f.north.clone().scale(Math.cos(heading)).addScaled(f.east, Math.sin(heading));
        const tilt = start.tilt ? lookRotation(f.up.clone().addScaled(facing, Math.tan(start.tilt * Math.PI / 180)).normalize(), facing.clone().scale(-1)) : null;
        ship.q.copy(tilt || lookRotation(f.up, def.camera.look === 'belly' ? facing.clone().scale(-1) : facing));
        break;
      }
      case 'state': {
        ship.ref = start.ref || 'ausonia';
        ship.pos.copy(v3(start.pos));
        ship.vel.copy(v3(start.vel));
        this.orient(start.attitude || 'prograde');
        break;
      }
      default:
        throw new Error(`Partenza sconosciuta: ${start.type}`);
    }
  }

  /** Ship docking-port position relative to the centre of mass (body frame). */
  shipPortOffset() {
    const p = this.ship.def.dockingPort;
    return this.ship.local(p.pos, new V3());
  }

  orient(kind, obj) {
    const ship = this.ship;
    const up = ship.pos.clone().normalize();
    const vel = ship.vel.clone();
    if (obj && (kind === 'target' || kind === 'antiTarget')) {
      const d = obj.pos.clone().sub(ship.pos).normalize();
      if (kind === 'antiTarget') d.scale(-1);
      ship.q.copy(lookRotation(d, up));
      return;
    }
    if (vel.len() < 0.1) {
      ship.q.copy(lookRotation(up, new V3(0, 0, 1)));
      return;
    }
    const { pro, nor, rad } = orbitalFrame(ship.pos, ship.vel);
    const dir = { prograde: pro, retrograde: pro.clone().scale(-1), normal: nor, radialOut: rad, radialIn: rad.clone().scale(-1) }[kind] || pro;
    ship.q.copy(lookRotation(dir, kind === 'radialOut' || kind === 'radialIn' ? pro : up));
  }

  // ------------------------------------------------------------------ targets
  /** Selectable targets: objects (and their ports) and celestial bodies. */
  targetList() {
    const list = [];
    for (const o of this.objects) {
      if (o.hidden) continue;
      list.push({ kind: 'object', id: o.id, name: o.name });
    }
    for (const b of Object.values(BODIES)) if (b.id !== this.ship.ref) list.push({ kind: 'body', id: b.id, name: b.name });
    return list;
  }

  setTarget(spec) {
    if (!spec) {
      this.target = null;
      return;
    }
    const id = typeof spec === 'string' ? spec : spec.id;
    const port = typeof spec === 'object' ? spec.port : undefined;
    const o = this.objects.find((x) => x.id === id);
    if (o) {
      let portIndex = 0;
      if (o.def.ports && port) portIndex = Math.max(0, o.def.ports.findIndex((p) => p.id === port));
      this.target = { kind: 'object', id, object: o, portIndex: o.def.ports ? portIndex : -1 };
    } else if (BODIES[id]) this.target = { kind: 'body', id };
    else this.target = null;
  }

  cycleTarget(dir = 1) {
    const list = this.targetList();
    if (!list.length) return;
    const cur = this.target ? list.findIndex((x) => x.id === this.target.id) : -1;
    let next = cur + dir;
    if (next >= list.length || next < -1) next = -1;
    if (next < -1) next = list.length - 1;
    if (dir < 0 && cur === -1) next = list.length - 1;
    if (next === -1) {
      this.target = null;
      this.message('Nessun bersaglio', 'info', 2);
    } else {
      this.setTarget(list[next].id);
      this.message(`Bersaglio: ${list[next].name}`, 'info', 2.5);
    }
  }

  cyclePort() {
    const t = this.target;
    if (!t || t.kind !== 'object' || !t.object.def.ports) return;
    t.portIndex = (t.portIndex + 1) % t.object.def.ports.length;
    this.message(`Porta: ${t.object.def.ports[t.portIndex].name}`, 'info', 2.5);
  }

  /** Target position / velocity relative to the ship's reference body. */
  targetState() {
    const t = this.target;
    if (!t) return null;
    if (t.kind === 'object') return this.relToShipRef(t.object);
    const L = lucinaState(this.t, this.lucinaPhase);
    if (t.id === 'lucina') return { pos: L.pos.clone(), vel: L.vel.clone() };
    return { pos: L.pos.clone().scale(-1), vel: L.vel.clone().scale(-1) };
  }

  /** World (ship-ref) position, direction and up of the selected docking port. */
  targetPort() {
    const t = this.target;
    if (!t || t.kind !== 'object' || t.portIndex < 0) return null;
    const o = t.object;
    const port = o.def.ports[t.portIndex];
    const rs = this.relToShipRef(o);
    return {
      pos: o.q.rotate(v3(port.pos), new V3()).add(rs.pos),
      dir: o.q.rotate(v3(port.dir), new V3()),
      up: o.q.rotate(v3(port.up || (Math.abs(port.dir[2]) > 0.5 ? [1, 0, 0] : [0, 0, -1])), new V3()),
      vel: rs.vel,
      port,
      object: o,
    };
  }

  // ------------------------------------------------------------------ commands
  command(name, arg) {
    const ship = this.ship;
    if (!ship) return;
    switch (name) {
      case 'sas':
        this.sas.on = typeof arg === 'boolean' ? arg : !this.sas.on;
        this.sas.hold = null;
        if (!this.sas.on) this.autoBurn = false;
        this.emit({ type: 'sas', on: this.sas.on });
        this.message(this.sas.on ? `SAS attivo · ${modeName(this.sas.mode)}` : 'SAS disattivato', 'info', 2);
        break;
      case 'sasMode': {
        const m = SAS_MODES.find((x) => x.id === arg);
        if (!m) break;
        if (['target', 'antiTarget', 'port'].includes(arg) && !this.target) {
          this.message('Seleziona prima un bersaglio (Tab)', 'warn', 3);
          break;
        }
        if (arg === 'port' && this.target?.portIndex < 0) {
          this.message('Il bersaglio non ha porte di attracco', 'warn', 3);
          break;
        }
        if (arg === 'maneuver' && !this.node) {
          this.message('Nessuna manovra pianificata (O: computer di navigazione)', 'warn', 3);
          break;
        }
        this.sas.on = true;
        this.sas.mode = arg;
        this.sas.hold = null;
        this.emit({ type: 'sas', on: true, mode: arg });
        this.message(`SAS · ${m.name}`, 'info', 2);
        break;
      }
      case 'rcs':
        ship.rcsEnabled = typeof arg === 'boolean' ? arg : !ship.rcsEnabled;
        this.emit({ type: 'rcs', on: ship.rcsEnabled });
        this.message(ship.rcsEnabled ? 'RCS attivo' : 'RCS disattivato', 'info', 2);
        break;
      case 'fa':
        if (!ship.def.flightAssist) {
          this.message('Assistenza al volo non disponibile su questo veicolo', 'warn', 3);
          break;
        }
        this.fa = typeof arg === 'boolean' ? arg : !this.fa;
        this.message(this.fa ? 'Assistenza al volo: ATTIVA (la manetta imposta la velocità)' : 'Assistenza al volo: disattivata', 'info', 3);
        break;
      case 'vsHold':
        if (!ship.engineStage) break;
        this.vsHold = typeof arg === 'boolean' ? arg : !this.vsHold;
        if (this.vsHold) this.pilot.throttle = 0.5;
        this.message(this.vsHold ? 'Controllo velocità verticale: manetta al centro = hovering' : 'Controllo velocità verticale disattivato', 'info', 3.5);
        break;
      case 'action': {
        if (this.docked) return this.command('undock');
        const label = ship.actionLabel();
        if (!label) {
          this.message('Nessuna azione disponibile', 'info', 2);
          break;
        }
        if (ship.parachute === 0 && ship.stage.parachute && ship.stageIndex === ship.stages.length - 1) return this.command('parachute');
        return this.command('separate');
      }
      case 'separate': {
        const dropped = ship.separate();
        if (!dropped) break;
        this.spawnDebris(dropped);
        this.emit({ type: 'stage', stage: dropped.id });
        this.message(`${dropped.name} separato`, 'info', 3);
        if (ship.def.becomes && ship.stageIndex >= ship.def.becomes.atStage) this.message('Lanciatore separato: ora piloti la Rondine', 'info', 4);
        this.refreshPrediction(true);
        break;
      }
      case 'parachute': {
        const res = ship.deployParachute({ body: this.body });
        if (res.ok) {
          this.emit({ type: 'parachute' });
          this.message('Paracadute in apertura', 'info', 3);
        } else {
          this.message(res.reason, res.torn ? 'alert' : 'warn', 4);
          if (res.torn) this.emit({ type: 'chute-torn' });
        }
        break;
      }
      case 'undock':
        if (!this.docked) break;
        this.undock();
        break;
      case 'legs':
        if (!ship.hasLegs && !ship.def.gearContacts) break;
        ship.legsDeployed = typeof arg === 'boolean' ? arg : !ship.legsDeployed;
        this.message(ship.legsDeployed ? (ship.def.gearContacts ? 'Carrello estratto' : 'Gambe estese') : ship.def.gearContacts ? 'Carrello retratto' : 'Gambe retratte', 'info', 2);
        this.emit({ type: 'legs', down: ship.legsDeployed });
        break;
      case 'lights':
        ship.lights = typeof arg === 'boolean' ? arg : !ship.lights;
        this.message(ship.lights ? 'Luci accese' : 'Luci spente', 'info', 1.5);
        break;
      case 'target':
        if (arg === 'next') this.cycleTarget(1);
        else if (arg === 'prev') this.cycleTarget(-1);
        else if (arg === 'port') this.cyclePort();
        else this.setTarget(arg);
        this.refreshPrediction(true);
        break;
      case 'warp':
        this.changeWarp(arg);
        break;
      case 'warpTo':
        this.warpTo(arg);
        break;
      case 'throttle':
        this.pilot.throttle = clamp(arg, 0, 1);
        this.autoBurn = false;
        break;
      case 'node':
        this.editNode(arg);
        break;
      case 'plan':
        this.plan(arg);
        break;
      case 'autoBurn':
        if (!this.node) {
          this.message('Nessuna manovra da eseguire', 'warn', 2.5);
          break;
        }
        this.autoBurn = typeof arg === 'boolean' ? arg : !this.autoBurn;
        if (this.autoBurn) {
          this.sas.on = true;
          this.sas.mode = 'maneuver';
        }
        this.message(this.autoBurn ? 'Autopilota di manovra inserito: orientamento e accensione automatici' : 'Autopilota di manovra disinserito', 'info', 3.5);
        break;
      case 'ascent':
        this.toggleAscent(arg);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ maneuvers
  editNode(arg = {}) {
    if (arg === 'delete' || arg?.delete) {
      this.node = null;
      this.autoBurn = false;
      if (this.sas.mode === 'maneuver') this.sas.mode = 'stab';
      this.nodePrediction = null;
      return;
    }
    if (!this.node) this.node = { t: this.t + 300, pro: 0, nor: 0, rad: 0 };
    const n = this.node;
    for (const k of ['pro', 'nor', 'rad']) if (arg[k] !== undefined) n[k] += arg[k];
    if (arg.dt) n.t = Math.max(this.t + 5, n.t + arg.dt);
    if (arg.set) Object.assign(n, arg.set);
    n.started = false;
    n.accum = null;
    this.refreshPrediction(true);
  }

  plan(kind) {
    const s = this.ship;
    const ref = s.ref, pos = s.pos, vel = s.vel, t = this.t;
    let node = null;
    const body = this.body;
    const tgt = this.target?.kind === 'object' ? this.target.object : null;
    try {
      switch (kind) {
        case 'circAp': node = M.planCircularize(ref, pos, vel, t, 'ap'); break;
        case 'circPe': node = M.planCircularize(ref, pos, vel, t, 'pe'); break;
        case 'raiseAp': node = M.planApsis(ref, pos, vel, t, Math.max(elements(pos, vel, body.mu).ra || 0, pos.len()) + 100e3); break;
        case 'lowerPe': node = M.planApsis(ref, pos, vel, t, body.radius + (body.atmosphere ? 40e3 : 15e3)); break;
        case 'deorbit': node = M.planDeorbit(ref, pos, vel, t, body.atmosphere ? 35e3 : 8e3, 60); break;
        case 'rendezvous':
          if (!tgt || tgt.ref !== ref) {
            this.message('Serve un bersaglio in orbita attorno allo stesso corpo', 'warn', 3.5);
            return;
          }
          node = M.planRendezvous(ref, pos, vel, t, (tt) => this.objectState(tgt, tt));
          break;
        case 'plane':
          if (!tgt || tgt.ref !== ref) {
            this.message('Serve un bersaglio in orbita attorno allo stesso corpo', 'warn', 3.5);
            return;
          }
          node = M.planMatchPlane(ref, pos, vel, t, new V3().crossVectors(tgt.pos, tgt.vel));
          break;
        case 'correction':
          node = M.planCourseCorrection(ref, pos, vel, t, this.lucinaPhase, ref === 'ausonia' ? 60e3 : 45e3);
          break;
        case 'lucina':
          if (ref !== 'ausonia') {
            this.message('Sei già nella sfera di influenza di Lucina', 'warn', 3);
            return;
          }
          node = M.planLucinaTransfer(pos, vel, t, this.lucinaPhase, 60e3);
          break;
        case 'return':
          if (ref !== 'lucina') {
            this.message('Il ritorno si pianifica dall’orbita di Lucina', 'warn', 3);
            return;
          }
          node = M.planReturnToAusonia(pos, vel, t, this.lucinaPhase, 45e3);
          break;
        default:
          return;
      }
    } catch (e) {
      console.warn(e);
      node = null;
    }
    if (!node || !Number.isFinite(node.t) || !Number.isFinite(node.pro)) {
      this.message('Manovra non calcolabile da questa orbita', 'warn', 3.5);
      return;
    }
    this.node = { t: node.t, pro: node.pro, nor: node.nor || 0, rad: node.rad || 0 };
    this.autoBurn = false;
    this.refreshPrediction(true);
    const dv = Math.hypot(this.node.pro, this.node.nor, this.node.rad);
    this.message(`Manovra pianificata: Δv ${dv.toFixed(1)} m/s tra ${fmtTime(this.node.t - this.t)}`, 'info', 4);
    this.emit({ type: 'node' });
  }

  /** State at the node time and the burn vector, cached until the orbit changes. */
  nodeInfo() {
    const n = this.node;
    if (!n) return null;
    const s = this.ship;
    if (!n.started) {
      const { r, v } = M.stateAt(s.ref, s.pos, s.vel, this.t, Math.max(n.t, this.t));
      n.dvWorld = M.nodeVector(n, r, v);
      // Close to the node the burn vector is frozen in inertial space.
      const bt = M.burnTime(s, n.dvWorld.len());
      if (this.t >= n.t - (Number.isFinite(bt) ? bt : 0) / 2 - 3) {
        n.started = true;
        n.accum = new V3();
      }
    }
    const dvTotal = n.dvWorld.len();
    const remainingVec = n.accum ? n.dvWorld.clone().sub(n.accum) : n.dvWorld.clone();
    const remaining = n.accum && remainingVec.dot(n.dvWorld) < 0 ? 0 : remainingVec.len();
    const bt = M.burnTime(s, remaining);
    return { dvTotal, remaining, remainingVec, burnTime: bt, timeTo: n.t - this.t, dir: remainingVec.clone().normalize() };
  }

  // ------------------------------------------------------------------ ascent autopilot
  toggleAscent(arg) {
    const s = this.ship;
    if (!s.def.launchVehicle && s.ref !== 'ausonia') return;
    if (this.ascent && arg !== true) {
      this.ascent = null;
      this.message('Autopilota di ascesa disinserito', 'info', 2.5);
      return;
    }
    const site = SITES.spaceport;
    const f = siteFrame(site);
    this.ascent = { targetAp: (arg?.ap || 120e3), heading: 90, east: f.east, phase: 'climb' };
    this.sas.on = true;
    this.sas.mode = 'stab';
    this.message('Autopilota di ascesa: virata gravitazionale verso est, apoasse 120 km', 'info', 4);
  }

  ascentGuidance(dt) {
    const a = this.ascent;
    const s = this.ship;
    if (!a || s.destroyed) return null;
    const up = s.pos.clone().normalize();
    const alt = s.altitude;
    const el = elements(s.pos, s.vel, AUSONIA.mu);
    const east = new V3().crossVectors(new V3(0, 0, 1), up).normalize();
    // Automatic staging when the stage runs dry.
    if (s.engineStage && s.engineStage.fuelLeft <= 0 && s.stageIndex < s.stages.length - 2) this.command('separate');
    if (a.phase === 'climb') {
      const speed = s.vel.len();
      const fpa = (Math.asin(clamp(s.vel.clone().normalize().dot(up), -1, 1)) * 180) / Math.PI;
      let pitch = 90;
      if (speed > 60 && alt < 38000) {
        // Altitude programme, never far from prograde in the dense air.
        const prog = 90 - 88 * Math.pow(clamp((alt - 600) / 46000, 0, 1), 0.5);
        const aoa = s.dynPressure > 8000 ? 4 : 10;
        pitch = speed > 120 ? clamp(prog, fpa - aoa, fpa + aoa) : Math.max(prog, 84);
      } else if (speed > 60) {
        // Above the dense air: hold about 45 s to apoapsis.
        const tAp = el.e < 1 ? el.timeToAp : 0;
        const tWant = 45;
        const err = tAp > el.period / 2 ? 60 : tWant - tAp;
        pitch = clamp(fpa + err * 0.5, -8, 35);
      }
      const pr2 = (pitch * Math.PI) / 180;
      const dir = up.clone().scale(Math.sin(pr2)).addScaled(east, Math.cos(pr2)).normalize();
      if (speed > 150 && el.e < 1 && el.ra - AUSONIA.radius >= a.targetAp && alt > 30000) {
        a.phase = 'coast';
        this.message('Apoasse raggiunto: spegnimento e volo balistico fino all’apoasse', 'info', 4);
        return { dir: s.vel.clone().normalize(), up, throttle: 0 };
      }
      const left = speed > 150 && el.e < 1 ? a.targetAp - (el.ra - AUSONIA.radius) : Infinity;
      return { dir, up: east.clone().scale(-1).addScaled(up, 0.01), throttle: left < 4000 ? Math.max(0.15, left / 4000) : 1 };
    }
    if (a.phase === 'coast') {
      if (alt > AUSONIA.atmosphere.height + 1000 && !this.node) {
        this.plan('circAp');
        if (this.node) this.command('autoBurn', true);
        a.phase = 'circularize';
      }
      return { dir: s.vel.clone().normalize(), up, throttle: 0 };
    }
    if (a.phase === 'circularize' && !this.node) {
      this.ascent = null;
      this.message('Orbita raggiunta: autopilota di ascesa completato', 'info', 4);
    }
    return null;
  }

  // ------------------------------------------------------------------ time warp
  canRails() {
    const s = this.ship;
    if (this.docked) return { ok: true };
    if (s.destroyed) return { ok: false };
    if (s.landed && s.vel.len() < 0.3) return { ok: true };
    if (s.engineOn || this.pilot.throttle > 0.001 && !this.fa) return { ok: false, why: 'motore acceso' };
    const body = this.body;
    if (body.atmosphere && s.altitude < body.atmosphere.height) return { ok: false, why: 'in atmosfera' };
    if (s.agl < 3000) return { ok: false, why: 'troppo vicino alla superficie' };
    return { ok: true };
  }

  changeWarp(arg) {
    let idx = this.warpIndex;
    if (arg === 0 || arg === 'reset') idx = 0;
    else if (typeof arg === 'number' && Math.abs(arg) === 1) idx = clamp(idx + arg, 0, WARP_LEVELS.length - 1);
    else if (typeof arg === 'object' && arg.level) idx = Math.max(0, WARP_LEVELS.indexOf(arg.level));
    if (WARP_LEVELS[idx] > PHYSICS_WARP_MAX) {
      const ok = this.canRails();
      this._railsOk = ok.ok;
      if (!ok.ok) {
        idx = Math.min(idx, WARP_LEVELS.indexOf(PHYSICS_WARP_LIMIT));
        if (this.warpIndex >= idx) {
          this.message(`Accelerazione del tempo limitata: ${ok.why || 'non disponibile'}`, 'warn', 3);
          idx = Math.min(this.warpIndex, idx);
        }
      }
    }
    if (idx !== this.warpIndex) {
      this.warpIndex = idx;
      this.emit({ type: 'warp', level: this.timeWarp });
      if (this.onRails) this.ship.omega.set(0, 0, 0);
    }
  }

  warpTo(what) {
    const s = this.ship;
    const el = elements(s.pos, s.vel, this.body.mu);
    let target = null;
    if (what === 'node' && this.node) {
      const ni = this.nodeInfo();
      target = this.node.t - (ni.burnTime || 0) / 2 - 20;
    } else if (what === 'ap' && el.e < 1) target = this.t + el.timeToAp - 30;
    else if (what === 'pe' && Number.isFinite(el.timeToPe)) target = this.t + el.timeToPe - 30;
    else if (what === 'soi' && this.prediction?.[0]?.end?.startsWith('soi') || what === 'soi' && this.prediction?.[0]?.end === 'encounter') target = this.prediction[0].tEnd + 5;
    if (target === null || target <= this.t + 5) {
      this.message('Niente da raggiungere con il warp', 'info', 2);
      return;
    }
    this.warpTarget = target;
    this.changeWarp({ level: 100000 });
    if (!this.onRails) this.warpTarget = null;
  }

  // ------------------------------------------------------------------ main update
  update(dtReal) {
    if (!this.ship || this.paused) return;
    const dt = Math.min(dtReal, 0.1);
    this.timeSinceStart += dt;
    if (this.ship.destroyed) {
      this.updateDebris(dt);
      this.updateObjects();
      return;
    }
    if (this.onRails) this.railsStep(dt * this.timeWarp);
    else {
      const total = dt * this.timeWarp;
      const n = Math.min(80, Math.max(1, Math.round(total / DT)));
      const h = total / n;
      for (let i = 0; i < n; i++) {
        this.physicsStep(h);
        if (this.ship.destroyed) break;
      }
    }
    this.updateDebris(dt * this.timeWarp);
    this._predTimer -= dt;
    if (this._predTimer <= 0) this.refreshPrediction();
    this.updateInfo();
    // Messages expire in real time.
    for (const m of this.messages) m.age = (m.age || 0) + dt;
  }

  updateAltitude() {
    const s = this.ship;
    const body = this.body;
    s.altitude = s.pos.len() - body.radius;
    const up = s.pos.clone().normalize();
    const gh = body.terrain.height(up.x, up.y, up.z);
    s.agl = s.altitude - (body.ocean ? Math.max(0, gh) : gh);
  }

  updateObjects() {
    for (const o of this.objects) {
      if (!o.dynamic) this.objectState(o, this.t, o.pos, o.vel);
      if (o.omega) {
        o.q.integrate(o.omega, 0); // attitude evolves analytically below
        const ang = o.omega.len() * (this.t - o.t0);
        if (ang > 0) {
          const ax = o.omega.clone().scale(1 / o.omega.len());
          const half = ang / 2;
          const qs = new Quat(Math.cos(half), ax.x * Math.sin(half), ax.y * Math.sin(half), ax.z * Math.sin(half));
          o.qBase = o.qBase || o.q.clone();
          o.q.copy(mulQ(o.qBase, qs));
        }
      }
    }
  }

  gravityFn(ref) {
    const mu = BODIES[ref].mu;
    return (p, out) => {
      const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
      const k = -mu / (r2 * Math.sqrt(r2));
      return out.set(p.x * k, p.y * k, p.z * k);
    };
  }

  /** Pilot + assists → ship commands for one physics step. */
  applyControls(stepDt) {
    const s = this.ship;
    const p = this.pilot;
    const rotIn = new V3(p.roll, p.pitch, p.yaw);
    const transIn = new V3(p.tx, p.ty, p.tz);
    // Attitude target from the SAS mode.
    let target = null;
    let throttle = p.throttle;
    const asc = this.ascent ? this.ascentGuidance(stepDt) : null;
    if (asc) {
      target = { dir: asc.dir, up: asc.up };
      throttle = asc.throttle;
    } else if (this.sas.on && this.sas.mode !== 'stab') target = this.attitudeTarget(this.sas.mode);
    s.cmd.rot.copy(rotationCommand(s, rotIn, this.sas, target));
    s.cmd.trans.copy(transIn);
    // Velocity nulling / flight assist.
    const refState = this.assistReference();
    if (p.killVel) {
      if (refState) {
        const rel = s.vel.clone().sub(refState.vel);
        const kv = killVelocityCommand(s, rel, refState.keepRadial ? s.pos.clone().normalize() : null);
        s.cmd.trans.add(kv);
      }
    }
    if (this.fa && s.def.flightAssist && refState && !refState.keepRadial) {
      const rel = s.vel.clone().sub(refState.vel);
      const fa = flightAssistCommand(s, rel, p.throttle, transIn, s.def.flightAssist.maxSpeed);
      s.cmd.trans.copy(fa.trans);
      throttle = fa.throttle;
    }
    if (this.vsHold && !asc) {
      const up = s.pos.clone().normalize();
      const g = this.body.mu / s.pos.lenSq();
      throttle = verticalSpeedThrottle(s, p.throttle, up, g, s.vel.dot(up));
    }
    // Maneuver autopilot.
    if (this.autoBurn && this.node) {
      const ni = this.nodeInfo();
      throttle = 0;
      const start = this.node.t - ni.burnTime / 2;
      const err = Math.acos(clamp(s.forward(new V3()).dot(ni.dir), -1, 1));
      if (this.t >= start && ni.remaining > 0.05 && err < 0.09) {
        const acc = s.maxAccel();
        throttle = acc > 0 ? clamp(ni.remaining / (acc * 1.2), 0.02, 1) * clamp(1.6 - err * 12, 0, 1) : 0;
      }
    }
    s.throttle = clamp(throttle, 0, 1);
  }

  /** Reference velocity for velocity nulling and flight assist. */
  assistReference() {
    const s = this.ship;
    const t = this.target;
    if (t && t.kind === 'object') {
      const rs = this.relToShipRef(t.object);
      if (rs.pos.clone().sub(s.pos).len() < 200e3) return { vel: rs.vel };
    }
    // Nearest object within 30 km.
    let best = null, bd = 30e3;
    for (const o of this.objects) {
      if (o.ref !== s.ref) continue;
      const d = o.pos.clone().sub(s.pos).len();
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best) return { vel: best.vel.clone() };
    if (s.agl < 30e3) return { vel: new V3(), keepRadial: true };
    return null;
  }

  attitudeTarget(mode) {
    const s = this.ship;
    const up = s.pos.clone().normalize();
    const ts = this.targetState();
    let vRef = s.vel.clone();
    // Near a target the velocity markers are relative to it.
    if (ts && ts.pos.clone().sub(s.pos).len() < 50e3 && this.target.kind === 'object') vRef = s.vel.clone().sub(ts.vel);
    if (vRef.len() < 0.05 && ['prograde', 'retrograde'].includes(mode)) return null;
    const { pro, nor, rad } = orbitalFrame(s.pos, s.vel);
    switch (mode) {
      case 'prograde': return { dir: vRef.normalize() };
      case 'retrograde': return { dir: vRef.normalize().scale(-1) };
      case 'normal': return { dir: nor };
      case 'antinormal': return { dir: nor.scale(-1) };
      case 'radialOut': return { dir: rad };
      case 'radialIn': return { dir: rad.scale(-1) };
      case 'up': return { dir: up };
      case 'target':
        return ts ? { dir: ts.pos.clone().sub(s.pos).normalize() } : null;
      case 'antiTarget':
        return ts ? { dir: ts.pos.clone().sub(s.pos).normalize().scale(-1) } : null;
      case 'port': {
        const tp = this.targetPort();
        return tp ? { dir: tp.dir.clone().scale(-1), up: tp.up } : null;
      }
      case 'maneuver': {
        const ni = this.nodeInfo();
        return ni && ni.remaining > 0.01 ? { dir: ni.dir } : null;
      }
      default:
        return null;
    }
  }

  physicsStep(h) {
    const s = this.ship;
    this.t += h;
    this.flightTime += h;
    this.updateObjects();
    if (this.docked) {
      this.followDock();
      return;
    }
    this.applyControls(h);
    const body = this.body;
    const sunlit = this.sunlit();
    const evs = s.step(h, { body, gravity: this.gravityFn(s.ref), time: this.t, settings: this.settings, sunlit });
    for (const e of evs) this.handleShipEvent(e);
    if (this.settings.crashes === false && s.destroyed) this.reviveAfterCrash();
    // Burn bookkeeping for the node.
    if (this.node && s.engineOn) {
      this.nodeInfo();
      if (!this.node.accum && this.t > this.node.t - 600) this.node.accum = new V3();
      if (this.node.accum) {
        const thrustAcc = s.forward(new V3()).scale(s.thrust / s.mass);
        this.node.accum.addScaled(thrustAcc, h);
        const n2 = this.nodeInfo();
        if (n2.remaining <= 0.05) this.finishBurn();
      }
    }
    this.collide();
    this.checkDocking();
    this.checkSoi();
    // Altitude callouts near the surface.
    if (!s.landed && s.agl < 1200 && s.vel.dot(s.pos.clone().normalize()) < -0.3) {
      for (const v of [1000, 500, 200, 100, 50, 20, 10, 5]) {
        if (this._lastAgl > v && s.agl <= v) this.emit({ type: 'callout', value: v });
      }
    }
    this._lastAgl = s.agl;
  }

  finishBurn() {
    this.emit({ type: 'burn-complete' });
    this.message('Manovra completata', 'info', 3);
    this.node = null;
    this.autoBurn = false;
    if (this.sas.mode === 'maneuver') this.sas.mode = 'stab';
    this.pilot.throttle = 0;
    this.ship.throttle = 0;
    this.refreshPrediction(true);
  }

  handleShipEvent(e) {
    switch (e.type) {
      case 'crash':
        this.warpIndex = 0;
        this.message(e.reason, 'alert', 8);
        break;
      case 'flameout':
        if (!this._flameoutShown) {
          this._flameoutShown = true;
          this.message(this.ship.actionLabel() ? `Propellente esaurito: ${this.ship.actionLabel().toLowerCase()} (Spazio)` : 'Propellente esaurito', 'warn', 5);
        }
        break;
      case 'chute-torn':
        this.message('Paracadute strappato: velocità o pressione dinamica troppo alte', 'alert', 5);
        break;
      case 'splashdown':
        this.message(`Ammaraggio a ${e.speed.toFixed(1)} m/s`, 'info', 5);
        break;
      default:
        break;
    }
    this.emit(e);
  }

  /** "Crashes off": reset the ship to a safe state instead of ending the flight. */
  reviveAfterCrash() {
    const s = this.ship;
    s.destroyed = null;
    s.integrity = 100;
    s.temperature = Math.min(s.temperature, 600);
    this.message('Danni disattivati: il veicolo è stato ripristinato', 'warn', 4);
  }

  sunlit() {
    // Cylindrical shadow of the reference body (and Ausonia when around Lucina).
    const s = this.ship;
    const abs = this.absolute(s.ref, s.pos);
    for (const b of Object.values(BODIES)) {
      const bp = this.bodyPos(b.id);
      const rel = abs.clone().sub(bp);
      const along = rel.dot(this.sunDir);
      if (along > 0) continue;
      const perp = rel.addScaled(this.sunDir, -along).len();
      if (perp < b.radius) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ rails warp
  railsStep(dtw) {
    const s = this.ship;
    // Stop before events.
    let stopAt = Infinity, why = '';
    if (this.warpTarget) {
      stopAt = this.warpTarget;
      why = 'arrivo';
    }
    if (this.node && this.settings.autoWarpStop) {
      const ni = this.nodeInfo();
      const t0 = this.node.t - (ni.burnTime || 0) / 2 - 15;
      if (t0 > this.t && t0 < stopAt) {
        stopAt = t0;
        why = 'manovra in arrivo';
      }
    }
    const seg = this.prediction?.[0];
    if (seg && seg.end !== 'none' && seg.tEnd > this.t && !this.docked && !s.landed) {
      const lead = seg.end === 'atmosphere' || seg.end === 'impact' ? 20 : 0;
      if (seg.tEnd - lead < stopAt) {
        stopAt = seg.tEnd - lead;
        why = seg.end;
      }
    }
    const tEnd = Math.min(this.t + dtw, stopAt);
    const step = tEnd - this.t;
    if (step > 0) {
      if (this.docked) {
        this.t = tEnd;
        this.updateObjects();
        this.followDock();
      } else if (s.landed) {
        this.t = tEnd;
        this.updateObjects();
        s.vel.set(0, 0, 0);
      } else {
        const r = new V3(), v = new V3();
        if (propagate(s.pos, s.vel, step, this.body.mu, r, v)) {
          s.pos.copy(r);
          s.vel.copy(v);
        }
        this.t = tEnd;
        this.flightTime += step;
        this.updateObjects();
        this.updateAltitude();
        if (seg?.end === 'encounter' || seg?.end === 'soi-exit') this.checkSoi();
      }
    }
    if (tEnd >= stopAt - 1e-6) {
      if (why === 'encounter' || why === 'soi-exit') {
        this.checkSoi(true);
        this.refreshPrediction(true);
      } else {
        this.warpIndex = 0;
        this.warpTarget = null;
        const text = { 'manovra in arrivo': 'Warp interrotto: manovra in arrivo', atmosphere: 'Warp interrotto: ingresso in atmosfera', impact: 'Warp interrotto: avvicinamento alla superficie', arrivo: 'Warp completato' }[why];
        if (text) this.message(text, 'info', 3);
        this.emit({ type: 'warp', level: 1 });
      }
    }
    if (!this.canRails().ok) {
      this._railsOk = false;
      this.warpIndex = Math.min(this.warpIndex, WARP_LEVELS.indexOf(PHYSICS_WARP_LIMIT));
    }
  }

  checkSoi(force = false) {
    const s = this.ship;
    const L = lucinaState(this.t, this.lucinaPhase);
    if (s.ref === 'ausonia') {
      const d = s.pos.clone().sub(L.pos).len();
      if (d < LUCINA.soi || (force && d < LUCINA.soi * 1.01)) {
        s.pos.sub(L.pos);
        s.vel.sub(L.vel);
        s.ref = 'lucina';
        this.emit({ type: 'soi', ref: 'lucina' });
        this.message('Ingresso nella sfera di influenza di Lucina', 'info', 4);
        this.refreshPrediction(true);
      }
    } else if (s.ref === 'lucina') {
      if (s.pos.len() > LUCINA.soi || (force && s.pos.len() > LUCINA.soi * 0.99)) {
        s.pos.add(L.pos);
        s.vel.add(L.vel);
        s.ref = 'ausonia';
        this.emit({ type: 'soi', ref: 'ausonia' });
        this.message('Uscita dalla sfera di influenza di Lucina', 'info', 4);
        this.refreshPrediction(true);
      }
    }
  }

  refreshPrediction(now = false) {
    if (!this.ship) return;
    this._predTimer = now ? 0.15 : 0.5;
    const s = this.ship;
    try {
      this.prediction = s.landed || this.docked && false ? null : M.predict(s.ref, s.pos, s.vel, this.t, this.lucinaPhase);
      this.nodePrediction = this.node ? M.predictWithNode(s.ref, s.pos, s.vel, this.t, this.node, this.lucinaPhase) : null;
      const tgt = this.target?.kind === 'object' ? this.target.object : null;
      if (tgt && tgt.ref === s.ref && !this.docked) {
        const el = this.prediction?.[0]?.el;
        const span = el && el.e < 1 ? el.period : 20000;
        const base = this.nodePrediction?.[0];
        this.approach = base
          ? M.closestApproach(s.ref, base.pos, base.vel, base.t0, (tt) => this.objectState(tgt, tt), span)
          : M.closestApproach(s.ref, s.pos, s.vel, this.t, (tt) => this.objectState(tgt, tt), span);
      } else this.approach = null;
    } catch (e) {
      console.warn('prediction', e);
    }
  }

  // ------------------------------------------------------------------ docking & collisions
  checkDocking() {
    const s = this.ship;
    if (!s.def.dockingPort) return;
    const sp = s.q.rotate(this.shipPortOffset(), new V3()).add(s.pos);
    const sd = s.q.rotate(v3(s.def.dockingPort.dir), new V3());
    for (const o of this.objects) {
      if (!o.def.ports || o.ref !== s.ref) continue;
      if (o.pos.clone().sub(s.pos).len() > o.radius + 80) continue;
      for (let i = 0; i < o.def.ports.length; i++) {
        const port = o.def.ports[i];
        const pp = o.q.rotate(v3(port.pos), new V3()).add(o.pos);
        const pd = o.q.rotate(v3(port.dir), new V3());
        const d = sp.clone().sub(pp);
        const along = d.dot(pd);
        if (along > 0.45 || along < -0.6) continue;
        const lateral = d.clone().addScaled(pd, -along).len();
        if (lateral > 0.9) continue;
        const axis = -sd.dot(pd);
        const rel = s.vel.clone().sub(o.vel);
        const closing = -rel.dot(pd);
        const latSpeed = rel.clone().addScaled(pd, -rel.dot(pd)).len();
        const ok = axis > Math.cos((7 * Math.PI) / 180) && lateral < 0.25 && closing < 0.5 && latSpeed < 0.25;
        if (ok) return this.dock(o, i, closing, lateral, Math.acos(clamp(axis, -1, 1)));
        if (along < 0.15 && !this._dockBump) {
          this._dockBump = 1.5;
          const why = axis <= Math.cos((7 * Math.PI) / 180) ? 'disallineato' : lateral >= 0.25 ? 'fuori asse' : closing >= 0.5 ? 'troppo veloce' : 'deriva laterale';
          this.message(`Aggancio non riuscito: ${why}`, 'warn', 3.5);
          this.emit({ type: 'dock-fail', why });
          // Bounce back along the port axis.
          s.vel.addScaled(pd, Math.max(0.05, closing) * 1.3);
        }
      }
    }
    if (this._dockBump) this._dockBump = Math.max(0, this._dockBump - DT);
  }

  dock(o, portIndex, closing, lateral, angle) {
    const s = this.ship;
    const port = o.def.ports[portIndex];
    const pd = o.q.rotate(v3(port.dir), new V3());
    const up = o.q.rotate(v3(port.up || (Math.abs(port.dir[2]) > 0.5 ? [1, 0, 0] : [0, 0, -1])), new V3());
    // Soft capture then hard dock: snap to the ideal pose. Roll is kept to the nearest 90°.
    const ideal = lookRotation(pd.clone().scale(-1), up);
    const bodyUp = s.q.rotate(new V3(0, 0, -1), new V3());
    let best = ideal, bestDot = -2;
    for (let k = 0; k < 4; k++) {
      const qr = new Quat(Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4), 0, 0);
      const cand = mulQ(ideal, qr);
      const dot = cand.rotate(new V3(0, 0, -1), new V3()).dot(bodyUp);
      if (dot > bestDot) {
        bestDot = dot;
        best = cand;
      }
    }
    const oq = o.q;
    const rel = conjQ(oq);
    this.docked = { object: o, portIndex, relQ: mulQ(rel, best), relPos: null, t: this.t };
    s.q.copy(best);
    const pp = o.q.rotate(v3(port.pos), new V3()).add(o.pos);
    const portW = s.q.rotate(this.shipPortOffset(), new V3());
    s.pos.copy(pp).sub(portW);
    this.docked.relPos = oq.rotateInv(s.pos.clone().sub(o.pos), new V3());
    s.vel.copy(o.vel);
    s.omega.set(0, 0, 0);
    s.throttle = 0;
    this.pilot.throttle = 0;
    this.autoBurn = false;
    this.emit({ type: 'dock', object: o.id, port: port.id, closing, lateral, angle: (angle * 180) / Math.PI });
    this.message(`Aggancio confermato: ${o.name} · ${port.name}`, 'info', 5);
    this.dockReport = { closing, lateral, angle: (angle * 180) / Math.PI, object: o.name, port: port.name };
  }

  followDock() {
    const d = this.docked;
    const o = d.object;
    const s = this.ship;
    s.q.copy(mulQ(o.q, d.relQ));
    s.pos.copy(o.q.rotate(d.relPos, new V3())).add(o.pos);
    s.vel.copy(o.vel);
    s.omega.set(0, 0, 0);
    s.throttle = 0;
    s.landed = false;
    s.cmd.rot.set(0, 0, 0);
    s.cmd.trans.set(0, 0, 0);
  }

  undock() {
    const d = this.docked;
    const s = this.ship;
    const port = d.object.def.ports[d.portIndex];
    const pd = d.object.q.rotate(v3(port.dir), new V3());
    s.vel.addScaled(pd, 0.12);
    this.docked = null;
    this.sas.hold = null;
    this.emit({ type: 'undock' });
    this.message('Sgancio: allontanamento a 0,12 m/s', 'info', 3);
  }

  collide() {
    const s = this.ship;
    if (s.destroyed) return;
    for (const o of this.objects) {
      if (o.ref !== s.ref) continue;
      const rel = s.pos.clone().sub(o.pos);
      const dist = rel.len();
      if (dist > o.radius + 60) continue;
      if (o.kind === 'swarm') {
        for (const a of o.asteroids) {
          const c = new V3(a.x, a.y, a.z);
          // Swarm positions are fixed in the swarm's attitude frame.
          const wc = o.q.rotate(c, new V3()).add(o.pos);
          this.collideSphere(wc, a.radius * 0.95, o.vel, `un asteroide dello ${o.name}`);
        }
        if (o.def.outpost) this.collideShapes(o, OUTPOST_SHAPES);
      } else this.collideShapes(o, o.def);
    }
  }

  collideShapes(o, shapes) {
    const s = this.ship;
    const hull = s.def.hull;
    for (const hs of hull) {
      if (hs[0] - hs[3] < Math.min(...s.stages.slice(s.stageIndex).map((st) => st.x - st.length / 2)) - 0.8) continue;
      const hp = s.q.rotate(s.local(hs, new V3()), new V3()).add(s.pos);
      const lp = o.q.rotateInv(hp.clone().sub(o.pos), new V3()); // in object frame
      let best = null;
      for (const c of shapes.capsules || []) {
        const ax = c[0], ay = c[1], az = c[2], bx = c[3], by = c[4], bz = c[5];
        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const t = clamp(((lp.x - ax) * abx + (lp.y - ay) * aby + (lp.z - az) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
        const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
        const dx = lp.x - cx, dy = lp.y - cy, dz = lp.z - cz;
        const dd = Math.hypot(dx, dy, dz);
        const pen = c[6] + hs[3] - dd;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, n: new V3(dx, dy, dz).scale(1 / (dd || 1)) };
      }
      for (const b of shapes.boxes || []) {
        const qx = clamp(lp.x, b[0] - b[3], b[0] + b[3]), qy = clamp(lp.y, b[1] - b[4], b[1] + b[4]), qz = clamp(lp.z, b[2] - b[5], b[2] + b[5]);
        const dx = lp.x - qx, dy = lp.y - qy, dz = lp.z - qz;
        const dd = Math.hypot(dx, dy, dz);
        const pen = hs[3] - dd;
        if (pen > 0 && dd > 1e-6 && (!best || pen > best.pen)) best = { pen, n: new V3(dx, dy, dz).scale(1 / dd) };
      }
      for (const ring of shapes.rings || []) {
        // Torus around the object x axis at x = ring.x.
        const rr = Math.hypot(lp.y, lp.z);
        const cy = rr > 1e-6 ? (lp.y / rr) * ring.radius : ring.radius, cz = rr > 1e-6 ? (lp.z / rr) * ring.radius : 0;
        const dx = lp.x - ring.x, dy = lp.y - cy, dz = lp.z - cz;
        const dd = Math.hypot(dx, dy, dz);
        const pen = ring.tube + hs[3] - dd;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, n: new V3(dx, dy, dz).scale(1 / (dd || 1)) };
      }
      if (best) {
        const nw = o.q.rotate(best.n, new V3());
        this.resolveHit(nw, best.pen, o.vel, o.name, hp);
        return;
      }
    }
  }

  collideSphere(center, radius, vel, name) {
    const s = this.ship;
    for (const hs of s.def.hull) {
      const hp = s.q.rotate(s.local(hs, new V3()), new V3()).add(s.pos);
      const d = hp.clone().sub(center);
      const dd = d.len();
      const pen = radius + hs[3] - dd;
      if (pen > 0) {
        this.resolveHit(d.scale(1 / (dd || 1)), pen, vel, name, hp);
        return;
      }
    }
  }

  resolveHit(n, pen, objVel, name, point) {
    const s = this.ship;
    const rel = s.vel.clone().sub(objVel);
    const vn = rel.dot(n);
    s.pos.addScaled(n, pen);
    if (vn >= 0) return;
    const impact = -vn;
    s.vel.addScaled(n, impact * 1.35);
    // Off-centre hits spin the ship.
    const r = point.clone().sub(s.pos);
    const jb = s.q.rotateInv(n.clone().scale(impact * 1.35 * s.mass), new V3());
    const rb = s.q.rotateInv(r, new V3());
    const dw = new V3().crossVectors(rb, jb);
    s.omega.x += dw.x / s.inertia.x * 0.5;
    s.omega.y += dw.y / s.inertia.y * 0.5;
    s.omega.z += dw.z / s.inertia.z * 0.5;
    if (this._hitCooldown > this.t) return;
    this._hitCooldown = this.t + 0.4;
    this.emit({ type: 'collision', speed: impact, with: name });
    if (impact > s.def.crashSpeed * 1.8) {
      const events = [];
      s.destroy(`Collisione con ${name} a ${impact.toFixed(1)} m/s`, events);
      for (const e of events) this.handleShipEvent(e);
      if (this.settings.crashes === false) this.reviveAfterCrash();
    } else if (impact > 0.35) {
      s.damage(impact * 18, `Danni strutturali dopo la collisione con ${name}`, []);
      this.message(`Urto con ${name} a ${impact.toFixed(1)} m/s · integrità ${Math.round(s.integrity)}%`, 'warn', 3.5);
      if (s.destroyed) this.emit({ type: 'crash', reason: s.destroyed });
    } else this.message(`Contatto con ${name}`, 'info', 1.5);
  }

  // ------------------------------------------------------------------ debris
  spawnDebris(stage) {
    const s = this.ship;
    // The dropped stage centre in world coordinates (old stack, before the shift).
    const offset = s.q.rotate(new V3(stage.x - s.com, 0, 0), new V3());
    const fwd = s.forward(new V3());
    this.debris.push({
      stage,
      ref: s.ref,
      pos: s.pos.clone().add(offset),
      vel: s.vel.clone().addScaled(fwd, -1.6),
      q: s.q.clone(),
      omega: new V3(0.02, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08),
      age: 0,
      resting: false,
      id: `${stage.id}-${Math.round(this.t * 10)}`,
    });
  }

  updateDebris(dt) {
    for (const d of this.debris) {
      d.age += dt;
      if (d.resting) continue;
      const body = BODIES[d.ref];
      const g = this.gravityFn(d.ref)(d.pos, new V3());
      const up = d.pos.clone().normalize();
      const alt = d.pos.len() - body.radius;
      const atm = atmosphereAt(body, alt);
      if (atm.rho > 0) {
        const sp = d.vel.len();
        g.addScaled(d.vel, (-0.5 * atm.rho * sp * 1.0 * d.stage.radius * d.stage.length * 0.6) / (d.stage.dryMass + d.stage.fuelLeft));
      }
      // Sub-step large warp intervals for stability.
      const n = Math.min(200, Math.max(1, Math.ceil(dt / 0.05)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const gi = this.gravityFn(d.ref)(d.pos, new V3());
        if (atm.rho > 0) gi.add(g.clone().sub(this.gravityFn(d.ref)(d.pos, new V3())));
        d.vel.addScaled(gi, h);
        d.pos.addScaled(d.vel, h);
      }
      d.q.integrate(d.omega, dt);
      const gh = body.terrain.height(up.x, up.y, up.z);
      const surf = body.radius + Math.max(gh, body.ocean ? -2 : -1e9);
      if (d.pos.len() < surf + d.stage.radius * 0.6) {
        d.pos.copy(up).scale(surf + d.stage.radius * 0.6);
        d.vel.set(0, 0, 0);
        d.omega.set(0, 0, 0);
        d.resting = true;
        d.sunk = body.ocean && gh < 0;
      }
    }
    // Remove distant debris (but keep stages resting on Lucina).
    const ship = this.ship;
    const abs = this.absolute(ship.ref, ship.pos);
    this.debris = this.debris.filter((d) => {
      if (d.sunk && d.age > 30) return false;
      const da = this.absolute(d.ref, d.pos).sub(abs).len();
      return d.resting ? da < 300e3 : da < 400e3 && d.age < 3600;
    });
  }

  // ------------------------------------------------------------------ derived information
  updateInfo() {
    const s = this.ship;
    const body = this.body;
    const up = s.pos.clone().normalize();
    const vs = s.vel.dot(up);
    const hv = s.vel.clone().addScaled(up, -vs).len();
    const el = elements(s.pos, s.vel, body.mu);
    const info = (this.info = this.info || {});
    info.ref = body.id;
    info.refName = body.name;
    info.altitude = s.pos.len() - body.radius;
    info.agl = s.agl;
    info.vs = vs;
    info.hspeed = hv;
    info.speed = s.vel.len();
    info.el = el;
    info.ap = el.e < 1 ? el.ra - body.radius : Infinity;
    info.pe = el.rp - body.radius;
    info.inclination = (el.i * 180) / Math.PI;
    info.period = el.period;
    info.timeToAp = el.timeToAp;
    info.timeToPe = el.timeToPe;
    info.orbiting = el.e < 1 && info.pe > (body.atmosphere ? body.atmosphere.height : body.terrain.maxHeight);
    info.gravity = body.mu / s.pos.lenSq();
    info.twr = s.engineStage ? s.engineStage.engine.thrustVac / (s.mass * info.gravity) : 0;
    info.deltaV = s.deltaV();
    info.sunlit = this.sunlit();
    const ab = this.absolute(s.ref, s.pos);
    if (this.lastShipAbs) this.distanceTravelled += Math.min(1e6, ab.clone().sub(this.lastShipAbs).len());
    this.lastShipAbs = ab;
    // Target
    const ts = this.targetState();
    if (ts) {
      const rel = ts.pos.clone().sub(s.pos);
      const rv = s.vel.clone().sub(ts.vel);
      info.target = {
        name: this.target.kind === 'object' ? this.target.object.name : BODIES[this.target.id].name,
        distance: this.target.kind === 'body' ? rel.len() - BODIES[this.target.id].radius : rel.len(),
        relVel: rv,
        relSpeed: rv.len(),
        closing: rel.len() > 0 ? rv.dot(rel) / rel.len() : 0,
        dir: rel.normalize(),
      };
      const tp = this.targetPort();
      if (tp && info.target.distance < 3000) {
        const sp = s.q.rotate(this.shipPortOffset(), new V3()).add(s.pos);
        const d = sp.clone().sub(tp.pos);
        const right = new V3().crossVectors(tp.dir, tp.up);
        const sd = s.q.rotate(v3(s.def.dockingPort.dir), new V3());
        const sUp = s.q.rotate(new V3(0, 0, -1), new V3());
        const vrel = s.vel.clone().sub(tp.vel);
        info.port = {
          name: tp.port.name,
          range: d.dot(tp.dir),
          x: d.dot(right),
          y: d.dot(tp.up),
          vx: vrel.dot(right),
          vy: vrel.dot(tp.up),
          closing: -vrel.dot(tp.dir),
          // Angular errors of the ship axis relative to the port axis (deg).
          yawErr: (Math.atan2(sd.dot(right), -sd.dot(tp.dir)) * 180) / Math.PI,
          pitchErr: (Math.atan2(sd.dot(tp.up), -sd.dot(tp.dir)) * 180) / Math.PI,
          rollErr: (Math.atan2(sUp.dot(right), sUp.dot(tp.up)) * 180) / Math.PI,
        };
      } else info.port = null;
    } else {
      info.target = null;
      info.port = null;
    }
    info.node = this.nodeInfo();
    info.docked = !!this.docked;
  }
}

function modeName(id) {
  return SAS_MODES.find((m) => m.id === id)?.name || id;
}

export function mulQ(a, b) {
  return new Quat(
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  ).normalize();
}

export function conjQ(q) {
  return new Quat(q.w, -q.x, -q.y, -q.z);
}

export function fmtTime(s) {
  if (!Number.isFinite(s)) return '—';
  const neg = s < 0;
  s = Math.abs(s);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  const p = (v) => String(v).padStart(2, '0');
  const txt = d > 0 ? `${d}g ${p(hh)}h` : hh > 0 ? `${hh}h ${p(mm)}m` : `${mm}:${p(ss)}`;
  return (neg ? '−' : '') + txt;
}

/** Collision volumes of the mining outpost at the swarm centre (swarm frame). */
export const OUTPOST_SHAPES = {
  capsules: [[0, 0, -14, 0, 0, 12.5, 4.5], [-16, 0, 0, 16, 0, 0, 2.2]],
  boxes: [[0, 0, -22, 9, 9, 6]],
};

export { G0, SAS_MODES };
