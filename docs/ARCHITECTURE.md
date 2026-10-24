# Cieli Aperti Flight Simulator — Architecture & module contracts

Plain modern JavaScript ES modules, **no bundler**. Runs in Electron (Windows desktop app) and in any
WebGL2 browser via `node tools/serve.mjs` (static server). Code style: 2-space indent, single quotes,
semicolons, English code comments, **all user-visible text in Italian**.

`three` (r180) is the only runtime dependency. Pages declare an import map:

```html
<script type="importmap">
{ "imports": { "three": "./node_modules/three/build/three.module.js", "three/addons/": "./node_modules/three/examples/jsm/" } }
</script>
```

(`index.html` uses relative `./node_modules/...` so it also works from `file://` inside Electron. Dev/test
pages under `tools/dev/` use absolute `/node_modules/...`, see `tools/dev-importmap.txt`.)

## Directory layout

| Path | Owner | Content |
|---|---|---|
| `src/core/` | sim | `math.js` (V3, Quat, clamp, lerp, table1, rng, hash2, wrap360/180, DEG/RAD/G0), `units.js` (KT, FT, FPM, NM, INHG, HPA, conversions), `noise.js` (Simplex2) |
| `src/sim/` | sim | physics & systems (see below) — **read-only for other modules** |
| `src/world/` | sim | `world-data.js` (airports, navaids, cities, lakes, ridges, layouts), `terrain-height.js` (deterministic terrain model) |
| `src/render/` | render | three.js scene: terrain LOD, water, sky, clouds, airports, vegetation, aircraft models, cameras, effects. `coords.js` = frame conversions |
| `src/cockpit/` | cockpit | 2D instrument panels (canvas) + clickable controls, HUD |
| `src/input/` | input | keyboard / gamepad / joystick / mouse |
| `src/audio/` | audio | WebAudio synthesized sound |
| `src/missions/` | missions | mission definitions, runner, scoring, checklists |
| `src/ui/` | ui | menus, overlays (HUD strip, map, pause, debrief), settings screens |
| `src/app.js`, `src/main.js`, `index.html`, `styles/` | ui | application shell, main loop |
| `electron/` | ui | Electron main/preload |
| `tools/` | all | dev server (`serve.mjs`), dev tools, smoke tests |

## Coordinate frames

* **Simulation**: local flat-earth NED frame in metres: `x = north (n)`, `y = east (e)`, `z = down`.
  Altitudes are metres MSL (`alt = -pos.z`). Body frame: `x` forward, `y` right wing, `z` down.
  Headings are degrees true (no magnetic variation), 0 = north, 90 = east.
* **three.js world**: `x = east`, `y = up`, `z = south` (= -north). Use `src/render/coords.js`:
  `nedToThree(n, e, d)`, `v3ToThree(v)`, `groundToThree(n, e, h)`, `bodyToModel(bx, by, bz)`,
  `quatToThree(simQuat)`.
* Aircraft 3D models are built with the **nose towards -Z, right wing towards +X, up +Y**, origin at the
  aircraft centre of gravity (the body-frame origin). A body point `(bx, by, bz)` is `(by, -bz, -bx)` in model space.
* Precision rule: the world spans ±90 km. **Keep vertex and instance coordinates local** (within a few km of
  the owning object's origin) and position objects with `object.position`. three.js computes
  model-view matrices in double precision on the CPU, so this avoids float32 jitter.

## Simulation API (`src/sim/simulation.js`) — read by every other module

```js
const sim = new Simulation();
sim.setup({
  aircraft: 'trainer' | 'airliner' | 'jet',
  start: { type: 'runway'|'parking'|'air'|'final', airport: 'XAQU', runway: '07', parking: 0,
           distanceNm, altitudeFt, speedKt, heading, n, e, flaps, gearDown, apAltFt },
  weather,            // object like WEATHER_PRESETS.sereno (src/sim/atmosphere.js)
  time: 10.5,         // hour of day (local solar time)
  fuel: 0.8,          // fraction of capacity
  coldDark: false,    // engines off, all switches off
  route: [{ id, n, e, alt? }],   // GPS flight plan
  failures: [{ system: 'engine'|'vacuum'|'electrical', atTime?: s, atAltitudeFt?: ft }],
});
sim.update(dtRealSeconds);   // fixed 240 Hz internal steps, honours sim.paused and sim.simRate
sim.command(name, arg);      // cockpit commands (see list below)
```

Main read-only state:

* `sim.def` — aircraft definition (`src/sim/aircraft/*.js`): `id, name, category, description, specs[], panel ('ga'|'airliner'|'jet'), model, sound ('piston'|'turbofan'|'turbojet'), mass, wing{area,span,chord}, engines[], gear[], controls{flapDetents[{name,flaps,slats,vfe}], retractableGear, spoilers, reversers, autobrake, smoke, ...}, limits{vne,vno,vle,mmo,gPos,gNeg}, speeds{vr,vx,vy,cruise,vapp,vref,vs0,vs1,...}, camera{eye:[bx,by,bz], fov, chaseDist, chaseHeight}, lights{navL,navR,tail,beacon,landing,strobeL,strobeR: [bx,by,bz]}, autopilot{type,maxBank,autothrottle,autoland}`.
* `sim.fm` — FlightModel:
  * kinematics: `pos` (V3 NED), `vel` (V3 NED m/s), `q` (Quat w,x,y,z body→NED), `omega` (body rad/s), `euler{phi,theta,psi}` (rad)
  * air data: `iasKt, tas (m/s), mach, gsKt, vs (m/s, +up), alt (m), altFt, agl (m, radio altitude of the wheels), aglFt, heading, pitch, roll, track (deg), alpha, beta (rad), nz, ny (g), indicatedAlt (m), kollsman (Pa), oatC, wind (V3 NED), env{T,p,rho,a}, cloudDensity, onGround, stallWarning, overspeed, maxG, touchdown{vsFpm,ias,...}, damage{crashed,reason,flapsDamaged,gearDamaged,engineDamaged}`
  * surfaces: `defl{elevator, aileron, rudder, stab, spoilerL, spoilerR}` (rad; elevator +=trailing edge up/pull, aileron + = right roll, rudder + = nose right), `nosewheelSteer` (-1..1), `input{pitch,roll,yaw,elevTrim,ailTrim,rudTrim,brakeL,brakeR}`
  * `engines[]` — piston: `{type:'piston', running, rpm, throttle, mixture, magnetos (0 OFF,1 R,2 L,3 BOTH,4 START), carbHeat, carbIce, map (Pa), fuelFlow (kg/s), egt, cht, oilTemp (K), oilPress (psi), propAngle (rad), thrust (N), roughness 0..1, failed, p:{propDiameter,redline,...}}`; jet: `{type:'jet', running, n1, n2 (%), egt (K), fuelFlow, thrust, throttle, reverser 0..1, master, starter, startPhase ('off'|'crank'|'light'|'run'), oilPress}`
  * `gear{position 0..1, legs[{d:{name,pos,radius,steer}, contact, compression (m), wheelAngle (rad), wheelSpeed, steerAngle (rad), skid 0..1, force (N), surface}], contacts[]}`
  * `systems`: `battery, alternator, avionics, busVolts, ammeter, avionicsPowered, batteryCharge, lights{nav,beacon,strobe,landing,taxi,panel,logo}, fuelPump, fuelSelector ('off'|'left'|'both'|'right'), tanks[{name,capacity,qty}], fuelTotal (kg, getter), pitotHeat, antiIce, pitotIce, airframeIce, vacuum (inHg), gyroSpin, flapsLever (detent index), flaps (0..1), slats, gearLever (0 up/1 down), gearPos (0..1), spoilerLever, spoilersArmed, spoilers (0..1), parkingBrake, autobrake (0..3), autobrakeActive, hydraulics, apuMaster, apuN (%), apuBleed, engineStartSel ('norm'|'ign'), smoke, warnings{stall,overspeed,gear,lowFuel,lowVolts,oilPress,parkingBrake,flapsOverspeed}, masterWarning, masterCaution`
* `sim.engineMaster[]` (jets: fuel lever / ENG MASTER per engine)
* `sim.ap` — autopilot: `engaged, fd, athr, athrMode ('SPEED'|'THR CLB'|'THR IDLE'|'RETARD'), lateral ('ROL'|'HDG'|'NAV'|'LOC'), vertical ('PIT'|'VS'|'ALT'|'GS'|'FLC'), armedNav, armedApr, armedAlt, hdgBug, altSel (ft), vsSel (fpm), spdSel (kt), navSource ('NAV1'|'GPS'), autoland ('OFF'|'FLARE'|'RETARD'|'ROLLOUT'), phiCmd, thetaCmd` (flight-director bank/pitch, deg)
* `sim.nav1`, `sim.nav2` — `{active, standby, obs, valid, isLoc, cdi (-1..1, + = course is to the right), gs (-1..1, + = glidepath above), gsValid, toFrom (1 TO, -1 FROM, 0 off), dme (NM|null), ident, radial, locCourse}`
* `sim.adf` `{active, standby (kHz), valid, relBearing (deg), ident}`; `sim.gps` `{plan[], active, current, dtk, xtk (m), dist (m), brg, ete (s)}`; `sim.com1 {active, standby}`; `sim.xpdr {code, mode}`
* `sim.instruments` — instrument-side values with realistic lags/errors: `asi (kt), alt (ft), vsi (fpm), aiPitch, aiRoll (deg), dg (heading indicator, drifts), compass, turnRate (deg/s, standard rate = 3), ball (-1..1), gMeter, gMax, gMin, aoa (deg), clock (s), timer (s), radioAlt (ft)`
* `sim.pilot` — **written by the input module**: `{pitch, roll, yaw (-1..1; + = pull/right/right pedal), throttle (0..1), throttle2?, mixture (0..1), brakeL, brakeR (0..1), reverse (bool), trimRate, rudTrimRate, ailTrimRate (-1..1, + = nose up / right)}`
* `sim.events[]` — produced each update, consumed by audio/ui/missions; **the app clears it once per frame** after dispatching: `{type:'touchdown', data}`, `{type:'crash', reason}`, `{type:'ap', what:'engage'|'disengage'|'disengage-warn'|'capture'|'altcapture'|'flare'|'retard'|'athr-off'}`, `{type:'callout', value}` (radio altitude ft), `{type:'marker', which:'OM'|'MM'}`, `{type:'atis', airport, text}`, `{type:'failure', what}`, `{type:'gearMoving'}`, `{type:'flapsMoving'}`
* `sim.messages[]` — `{text, kind:'info'|'warn'|'alert', duration (s), t}` toasts; the UI displays and removes them.
* `sim.timeOfDay` (hours, advances with sim time), `sim.atm` (Atmosphere: `weather` (preset object), `qnh` (Pa), `visibility` (m), `precip` (0..1), `cloudDensityAt(altM)`, `meanWind(agl, alt)`), `sim.paused`, `sim.simRate`, `sim.crashed`, `sim.settings` (`crashes, gyroDrift, autoRudder, unlimitedFuel, fbwNormalLaw, icing, carbIce`), `sim.terrain` (see below), `sim.landed`, `sim.flightTime`, `sim.distanceFlown`, `sim.fuelStart`.

### `sim.command(name, arg)` list

`battery|alternator|master|avionics|fuelPump|pitotHeat|antiIce|carbHeat|parkingBrake|apuMaster|apuBleed|smoke` (toggle, or set with boolean arg) ·
`light {which:'nav'|'beacon'|'strobe'|'landing'|'taxi'|'panel'|'logo', value?}` · `allLights` ·
`magnetos 0..4|'inc'|'dec'` · `magnetoRelease` (key returns from START to BOTH) · `mixture v` · `mixtureStep d` ·
`fuelSelector 'off'|'left'|'both'|'right'|'next'` · `flaps 'inc'|'dec'|'full'|'up'|index` · `gear 'up'|'down'|undefined(toggle)` ·
`spoilers undefined(toggle)|'arm'|0..1` · `autobrake 0..3|'next'` · `engineMaster {index, value?}` · `engineStartSel 'norm'|'ign'` · `starter` (jet trainer start button) ·
`autostart` · `shutdown` · `kollsman 'std'|'local'|±hPa` · `dgSync` · `dgAdjust ±deg` ·
`ap` (toggle AP) · `apDisconnect` · `apHdg` · `apNav` · `apApr` · `apAlt` · `apVs` · `apFlc` · `apAthr` · `apNavSource` ·
`hdgBug ±deg|'sync'` · `altSel ±ft` · `vsSel ±fpm` · `spdSel ±kt` · `obs ±deg` · `obs2 ±deg` ·
`nav1Swap` · `nav2Swap` · `nav1Tune ±MHz` · `nav2Tune ±MHz` · `com1Swap` · `com1Tune ±MHz` · `adfSwap` · `adfTune ±kHz` ·
`xpdr 'mode'|code` · `timer` / `timer 'reset'` · `gpsDirect {id, n, e}`.

## World

* `src/world/world-data.js`: `AIRPORTS[] {icao, name, city, n, e, elev, size ('large'|'medium'|'small'), atis, tower, runways[{id, heading, length, width, surface ('asphalt'|'grass'), ends[{ident, ils?{freq, ident, gs}, als}]}], taxiSide}`, `NAVAIDS[] {id, name, type ('VOR'|'VORDME'|'NDB'), freq, n, e, elev, range}`, `CITIES[] {name, n, e, radius, density, tall}`, `LAKES[] {name, n, e, radius, level, depth}`, `RIDGES`, `VALLEYS`, `ISLANDS`, `WORLD_HALF_SIZE` (90 km).
  Helpers: `runwayGeometry(ap, rw)` → `{cn, ce, dn, de, half, ends[{ident, heading, thrN, thrE, dirN, dirE, elev, length, width, ils, als, airport, runway}]}` (threshold position + unit vector pointing down the runway in the landing direction); `airportLayouts()` → per airport `{airport, geometry, surfaces[{n, e, heading, length, width, surface, kind ('runway'|'taxiway'|'apron')}], parking[{n, e, heading, name}], buildings[{type ('terminal'|'hangar'|'tower'), n, e, heading, length, width, height}], tower{n,e,height}, windsock{n,e}, holds[{n,e,endIndex}], flat (terrain flattening rect), runway}`; `allRunwayEnds()`, `ilsList()` (localizer/glideslope antenna positions, `markers`), `allNavaids()`, `findAirport(icao)`, `findRunwayEnd(icao, ident)`.
* `src/world/terrain-height.js`: `getTerrain()` singleton with `height(n, e)` (m MSL; negative = sea floor, water surface at 0), `rawHeight`, `groundInfo(n, e) → {h, surface, kind, nx, ny, nz}`, `landFactor(n, e)` (0 sea … 1 land), `lakeLevel(n, e)` (number|null), `forestFactor(n, e, h, slope)` (0..1), `cityFactor(n, e)` (0..1), `fieldCell(n, e)` (0..1 hash of agricultural field), `naturalSurface(n, e, h, slope)` (`'sand'|'grass'|'forest'|'rock'|'snow'`), `noiseDetail(n, e, scale)`. About 3 µs per `height()` call — generate geometry incrementally / within a per-frame time budget.

## Render module (`src/render/`)

```js
import { SceneRenderer } from './render/renderer.js';
const r = new SceneRenderer(canvas, { quality: 'low'|'medium'|'high' });
await r.init(onProgress?);          // onProgress(fraction 0..1, label) — builds static world content
r.setAircraft(def);                 // build/replace the procedural model for def.model
r.setQuality(q);
r.resize(widthCss, heightCss);
r.setPanelFraction(f);              // fraction (0..1) of the window height covered by the 2D cockpit panel (bottom)
r.setMarkers(markers);              // mission markers: [{type:'ring'|'waypoint'|'gate', n, e, alt, radius, heading, active, done}]
await r.warmup(sim, onProgress);    // build terrain LOD/vegetation around the aircraft before the first frame
r.update(sim, dtReal);              // sync camera, aircraft, environment (time of day, weather), effects
r.render();
// camera / views
r.setView('cockpit'|'chase'|'orbit'|'tower'|'flyby'); r.view; r.nextView(+1|-1);
r.look(dxPixels, dyPixels); r.zoom(delta); r.resetView();
r.getStats();                       // {triangles, calls, chunks}
```

## Cockpit module (`src/cockpit/`)

```js
import { Cockpit } from './cockpit/cockpit.js';
const c = new Cockpit(containerElement, sim);
c.setAircraft(def);                 // picks the panel for def.panel
c.setMode('full'|'mini'|'hidden');  c.cycleMode();   // W key
c.panelFraction;                    // fraction of window height covered (0 when hidden or not in cockpit view)
c.setView(viewMode);                // panel only visible in 'cockpit' view
c.update(dt);  c.resize(w, h);  c.setNight(0..1);
c.setHudVisible(bool);              // jet HUD in cockpit view (default true)
```

The cockpit dispatches `window.dispatchEvent(new CustomEvent('cieli:click', { detail: { kind: 'switch'|'knob'|'button'|'lever' } }))`
whenever the user operates a control; the audio engine listens and plays the matching click. Mouse events
handled by the panel must not reach the 3D view (stopPropagation / the panel canvas captures them).

## Input (`src/input/input.js`), audio (`src/audio/audio.js`), missions (`src/missions/`)

```js
const input = new InputManager(sim, { onAction(action, data) {} });
input.attach(window, canvas3d);     // keyboard on window, mouse (look/zoom/mouse-yoke) on the 3D canvas
input.update(dt);                   // keyboard ramps + gamepad/joystick axes -> sim.pilot; button actions
input.setEnabled(bool);             // false while menus are open (keys not consumed)
input.setSim(sim);                  // when a new Simulation instance is created
input.getBindingsList();            // [{group, label, keys: ['F5', ...]}] Italian labels, for the help screen
input.settings;                     // { axes: { roll|pitch|yaw|throttle|throttle2|brakeL|brakeR|mixture:
                                    //   {gamepadId, axis, invert} | null }, deadzone, expo, keyboardSensitivity,
                                    //   gamepadEnabled, mouseYoke }
input.saveSettings(); input.resetDefaults();
input.listGamepads();               // [{index, id, axes, buttons}]
input.captureAxis();                // Promise<{gamepadId, index, axis} | null> — resolves when an axis is moved (8 s timeout)
input.setAxisBinding(target, binding | null);
input.getAxisValues();              // live {roll, pitch, yaw, throttle, ...} for the settings preview
```

UI actions delivered through `onAction(action, data)`: `'pause'`, `'menu'` (Esc), `'view-next'`, `'view-prev'`,
`'view-cockpit'`, `'view-chase'`, `'panel-cycle'` (W), `'hud-toggle'` (H), `'map'` (M), `'checklist'` (K),
`'sim-rate'` (R), `'restart'` (Ctrl+;), `'reset-view'` (Backspace), `'look'` `{dx, dy}` (right-drag),
`'zoom'` `{delta}` (wheel), `'mouse-yoke'` `{enabled}` (Y), `'atis-repeat'`.

```js

const audio = new AudioEngine(); await audio.resume(); audio.setAircraft(def);
audio.update(sim, dt, { view, cameraDistance }); audio.handleEvent(ev); audio.setVolume(v); audio.setMuted(b); audio.speak(text);

audio.click(kind);                  // also triggered by the 'cieli:click' window event

import { MISSIONS } from './missions/missions.js';
// MISSIONS[i] = { id, title, subtitle, aircraft, difficulty (1..5), duration, briefing (Italian), setup (sim.setup options), ... }
import { MissionRunner } from './missions/runner.js';
sim.setup(mission.setup); const run = new MissionRunner(mission, sim); run.start();
run.update(dt); run.handleEvent(ev);
run.status;        // 'running' | 'success' | 'failed'
run.objectives;    // [{text, state: 'pending'|'active'|'done'|'failed'}]
run.hint;          // current guidance text, e.g. "Waypoint SIERRA: 3,2 NM per 045°"
run.getMarkers();  // markers for SceneRenderer.setMarkers
run.debrief;       // null while running, then {success, title, score, maxScore, stars (0..3), breakdown[{label, value, points}], text}
run.elapsed;       // seconds
import { loadResults, saveResult } from './missions/progress.js';   // localStorage 'cieli-aperti.missions'
import { getChecklists } from './missions/checklists.js';
// getChecklists(def) -> [{id, title, items: [{text, value, check?: (sim) => boolean}]}]
```

## Main loop (`src/app.js`)

```
requestAnimationFrame →
  input.update(dt) → sim.update(dt) → mission?.update(dt)
  for ev of sim.events: audio.handleEvent(ev); mission?.handleEvent(ev); ui.handleEvent(ev)
  sim.events.length = 0
  renderer.setPanelFraction(cockpit.panelFraction); renderer.setMarkers(mission?.getMarkers() || [])
  renderer.update(sim, dt); renderer.render(); cockpit.update(dt); audio.update(sim, dt, …); ui.update(dt)
```
