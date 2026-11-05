# Cieli Aperti – Space Edition — Architecture & module contracts

Plain modern JavaScript ES modules, **no bundler**. Runs in Electron (Windows desktop app) and in any
WebGL2 browser via `node tools/serve.mjs` (static server). Code style: 2-space indent, single quotes,
semicolons, English code comments, **all user-visible text in Italian**.

`three` (r180) is the only runtime dependency, loaded through an import map in `index.html`
(relative `./node_modules/...`, so it also works from `file://` inside Electron; dev pages under
`tools/dev/` use absolute `/node_modules/...`, see `tools/dev-importmap.txt`).

## Directory layout

| Path | Content |
|---|---|
| `src/core/` | `math.js` (V3, Quat, clamp, lerp, rng, …), `noise.js` (Simplex2, Simplex3 with fbm/ridged), `device.js` (phone / iPhone / tablet / desktop detection), `units.js` |
| `src/sim/` | physics — **read-only for other modules** (see below) |
| `src/render/` | three.js scene: planets (cube-sphere LOD in workers), atmosphere scattering, space background, vehicles, stations, debris, effects |
| `src/input/` | keyboard / mouse / gamepad / joystick (`input.js`), multitouch controls (`touch-controls.js`) |
| `src/audio/` | WebAudio synthesis (`audio.js`), Italian speech (`speech.js`) |
| `src/missions/` | mission catalogue, runner and scoring, saved results |
| `src/ui/` | menus, free-flight setup, in-flight interface (`flight-ui.js`), help and glossary, overlays, settings |
| `src/app.js`, `src/main.js`, `index.html`, `styles/` | application shell and main loop |
| `assets/planets/` | Earth / Moon / Mars colour maps and 16-bit heightmaps, planet textures, `planets.json` |
| `tools/` | dev server, web build, smoke tests, `make-planet-data.py`, `dev/view.html` (renderer test page) |
| `tests/` | `node --test` suite |

## Frames, units and time

* **Global frame**: heliocentric, axes of the J2000 Earth equator (x towards the March equinox, z towards
  the Earth's north pole). SI units throughout (m, s, kg, N).
* **Time** `sim.t`: seconds from J2000 (2000-01-01 12:00). `j2000FromDate(date)` / `dateFromJ2000(t)`.
* **Ship state** is relative to its reference body `ship.ref` (`ship.pos`, `ship.vel`, inertial axes).
  The reference changes at sphere-of-influence boundaries (patched conics). `sim.absolute(ref, pos)`
  gives the heliocentric position.
* **Body-fixed frames**: `toFixed(id, t, v)` / `fromFixed(id, t, v)` rotate between inertial axes and the
  body's rotating frame (x towards longitude 0, z towards the north pole). The Moon is tidally locked
  (x towards the Earth).
* **Vehicle stack frame**: x forward (thrust direction), y right, z down, metres from the stack origin;
  stages are listed first-to-be-dropped first. `ship.com` is the centre of mass along x.
* **Rendering**: floating origin. The camera sits at the three.js origin; every object is placed at
  `renderer.rel(absPos)` computed in double precision. Logarithmic depth buffer, far plane 1e14 m.
  Sim → three axes: `(x, y, z) → (x, z, −y)` (`toThree`, `quatToThree`, `quatToThreeAxes`).

## Solar System (`src/sim/system.js`)

`BODIES` (Sun, Mercury … Neptune, Moon) with `{id, name, parent, radius, mu, soi, atmosphere, terrain,
rotation, ocean}`; `SITES` (malindi, grottaglie, tranquillitatis, jezero); `OBJECTS` (aurora station,
detriti debris field, selene shuttle, Phobos, Deimos). Functions: `bodyState(id, t)` (heliocentric,
cached per t), `relativeState(id, ref, t)`, `bodyOrientation`, `bodySpin`, `heightAt(id, t, rel)`,
`atmosphereAt(body, h)` (US76 for the Earth, exponential elsewhere), `siteFrame(site, t, east, north)`,
`childrenOf`, `swarmAsteroids`, `localSolarHour`.

Terrain (`terrain.js`): `EarthTerrain`, `MoonTerrain`, `MarsTerrain` sample the real heightmaps (installed
by `planet-data.js`: `loadPlanetData()` in the browser, `loadPlanetDataNode()` in Node) plus procedural
detail and crater octaves, and flatten the sites; `CrateredTerrain` for Mercury.

## Orbits and manoeuvres

* `orbit.js`: `propagate(r0, v0, dt, mu, rOut, vOut)` (universal variables), `elements(r, v, mu)`
  → `{a, e, i, lan, argp, nu, p, rp, ra, period, timeToPe, timeToAp, energy, h, …}`, `circularState`,
  `stateFromElements`, `conicPoints`, `orbitalFrame`.
* `maneuver.js`: `predict(ref, pos, vel, t0)` → segments `[{ref, t0, tEnd, pos, vel, el, end:
  'encounter'|'soi-exit'|'atmosphere'|'impact'|'none', next}]`; `predictWithNode`; `closestApproach`;
  `lambert`; `porkchop`; planners `planCircularize`, `planApsis`, `planMatchPlane`, `planRendezvous`,
  `planTransfer` (Moon: patched-conic search; planets: Lambert porkchop and the burn point that aligns the
  escape asymptote with v∞), `planReturn`, `planCourseCorrection`, `planDeorbit`, `refine`.
  A node is `{t, pro, nor, rad}` (m/s in the local orbital frame at time t).

## Vehicles (`ships.js`, `spacecraft.js`, `assist.js`)

`SHIPS` definitions: `stages[{id, name, dryMass, fuel, x, length, radius, engine{thrustVac, thrustSL,
ispVac, ispSL, gimbal, x, minThrottle}, legs?, parachute?, heatShield?}]`, `rcs{thrust, torque, isp, fuel}`,
`wheels`, `dockingPort{pos, dir}`, `hull`, `contacts`, `aero`, `heat`, `camera`, `lights`, `controlStyle`
(`spacecraft` | `lander` | `aircraft`), `becomes` (launcher → capsule).

`Spacecraft`: mass and inertia of the remaining stack, `step(dt, env)` (RK4 translation, Euler rotation,
thrust with gimbal, RCS, wheels, drag/lift in co-rotating air, Sutton-Graves heating, parachute, contacts
with the rotating ground and water), `separate()`, `deltaV()`, `actionLabel()`, `damage()`.

`assist.js`: `SAS_MODES`, `rotationCommand` (attitude hold to prograde/normal/radial/target/manoeuvre/port
/up), `killVelocityCommand`, `flightAssistCommand` (pod), `verticalSpeedThrottle` (landing).

## Simulation API (`src/sim/simulation.js`)

```js
const sim = new Simulation();
sim.setup({
  ship: 'pod'|'capsule'|'translunar'|'lander'|'spaceplane'|'rocket'|'ntr',
  date: '2031-05-20T08:00:00Z',          // or time: J2000 seconds
  start: { type: 'orbit', body, altitude, inclination, lan, argLat, departureTo }
       | { type: 'near'|'offset', object, port, distance, lateral, relVel, lvlh, attitude }
       | { type: 'surface', site, pad, runway } | { type: 'hover', site, altitude }
       | { type: 'approach', site, altitude, north, east, heading, pitch, vel },
  target: 'moon' | 'aurora' | { id, port },
  objects: ['aurora', …], fuel: 0..1, mono: 0..1, stage: n, node: {in, pro, nor, rad},
  assists: { sas, rcs, fa }, legs, lights,
});
sim.update(dtReal);        // fixed physics steps (≤ ×4 warp) or Kepler rails (up to ×1e6)
sim.command(name, arg);    // see below
sim.plan(kind);            // circAp, circPe, raiseAp, lowerPe, deorbit, rendezvous, plane, transfer, return, correction
```

Commands: `throttle v` · `action` · `separate` · `parachute` · `undock` · `legs` · `lights` · `rcs` ·
`sas` · `sasMode id` · `fa` · `vsHold` · `ascent {inclination}` · `autoBurn bool` · `target
'next'|'prev'|'port'|id` · `warp ±1|0|{level}` · `warpTo 'node'|'soi'` · `node {pro,nor,rad,dt}|'delete'` ·
`plan kind`.

State read by the other modules: `sim.ship` (Spacecraft: `ref, pos, vel, q, omega, stages, stageIndex,
mass, thrust, throttle, mono, agl, altitude, airspeed, temperature, gForce, landed, destroyed, …`),
`sim.def`, `sim.body`, `sim.t`, `sim.info` (altitude, vs, speeds, `el`, ap/pe, inclination, lat/lon,
gravity, twr, deltaV, `target{name, distance, relSpeed, closing}`, `port{range, x, y, closing,
yawErr, pitchErr, rollErr}`, `node`), `sim.prediction`, `sim.nodePrediction`, `sim.node`, `sim.approach`,
`sim.sas`, `sim.warpIndex`, `sim.objects`, `sim.debris`, `sim.docked`, `sim.dockReport`, `sim.crashed`,
`sim.paused`, `sim.settings` (`crashes, unlimitedFuel, autoWarpStop`).

`sim.pilot` is **written by the input module**: `{pitch, yaw, roll, tx, ty, tz (−1..1, body frame),
throttle (0..1), killVel, brake}`.

`sim.events[]` (consumed and cleared by the app every frame): `stage`, `dock`, `dock-fail`, `undock`,
`collision`, `crash {reason}`, `touchdown {speed}`, `splashdown`, `landed`, `parachute`, `chute-torn`,
`burn-complete`, `soi {ref}`, `warp {level}`, `sas`, `rcs`, `legs`, `callout {value}`.
`sim.messages[]` are toasts `{text, kind, duration}`.

## Renderer (`src/render/renderer.js`)

```js
const r = new SceneRenderer(canvas, { quality, device });
await r.init(onProgress);
r.setScenario(sim);               // vehicle model, objects, bodies
r.setMarkers(markers);            // mission rings / points
await r.warmup(sim, onProgress);  // build the terrain around the ship before the first frame
r.update(sim, dt); r.render();
r.setView('cockpit'|'chase'|'orbit'|'target'|'map'); r.nextView(±1); r.look(dx, dy); r.zoom(d); r.resetView();
r.project(absPos);                // screen position for labels
r.getStats();                     // {triangles, calls, chunks}
```

Planets: `PlanetLOD` splits the six cube faces in a quadtree by camera distance; chunks are built by
`planet-worker.js` (`buildChunk` in `planet-build.js`) from the same terrain code as the physics, with
skirts against cracks. Atmosphere: single-scattering Rayleigh/Mie (`ATMOSPHERE_GLSL`) per vertex on the
ground and on a sky shell. Cloud and Milky Way cube maps are baked once (`bakeCube`). Vehicle models
(`vessels.js`) are built procedurally per stage in the stack frame, so a dropped stage becomes debris.

## Interface, input, audio, missions

* `App` (`app.js`) owns the states `boot → menu → loading → flight ⇄ flight-settings`, the overlays
  (pause, crash, debrief, help) and the main loop. `window.__cieli` exposes it for the smoke tests.
* `FlightUI` (`flight-ui.js`): top bar, orbit and target panels, navball with markers and SAS buttons,
  gauges, navigation computer, map labels, docking display.
* `InputManager`: key bindings (`BINDINGS`), held keys, gamepad standard mapping, bound joystick axes,
  `pilotToBody(def, rotation, translation)` for the lander's side-window cockpit. `TouchControls` writes
  pilot-frame values to `input.touch`.
* `AudioEngine.update(sim, dt, {view, cameraDistance})` and `handleEvent(ev)`; `Speech` picks the best
  Italian voice.
* Missions: `{id, category, title, subtitle, ship, difficulty, duration, briefing, setup, objectives[{text,
  check(sim, ctx), hint?}], fail?, markers?, score?}`. `MissionRunner` runs them in sequence and builds
  the debrief (400 base points + score items, up to 1000; stars at 700 and 880).

## Tests

`npm test` runs `tests/*.test.js` with `node --test`: orbit mathematics and Lambert, ephemerides and
rotation, atmosphere and sites on the real heightmaps, rocket equation for every vehicle, input and touch
helpers, the mission catalogue and runner, every free-flight start, and end-to-end flights (docking,
bounce, lunar landing, crash, launch to orbit, reentry with splashdown, burn-up without the shield,
Hohmann, TLI, trans-Mars injection, rendezvous). `npm run smoke` / `smoke:mobile` drive the real app in
headless Chromium (desktop, phone, iPad, iPhone 16).
