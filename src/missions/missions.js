// Missions: briefing, setup, sequential objectives, markers and scoring. Real places and
// real physics; the station, the debris field and the vehicles are imaginary.
import { V3 } from '../core/math.js';
import { M } from './runner.js';
import { SITES, siteFrame, BODIES, bodySpin } from '../sim/system.js';

const ring = (id, local, radius, normal) => ({ object: id, local, radius, normal });

/** Objectives for flying through a list of rings around an object, in order. */
function ringObjectives(rings, names) {
  return rings.map((r, i) => ({
    text: names?.[i] || `Passa nell’anello ${i + 1} di ${rings.length}`,
    check: (sim) => {
      const p = M.objectPoint(sim, r.object, r.local);
      return p && M.distanceTo(sim, p) < r.radius * 0.85;
    },
    hint: (sim) => {
      const p = M.objectPoint(sim, r.object, r.local);
      return p ? `Anello ${i + 1}: ${M.distanceTo(sim, p).toFixed(1)} m` : '';
    },
  }));
}

function ringMarkers(rings) {
  return (sim, ctx, index) => rings.map((r, i) => {
    const o = sim.objects.find((x) => x.id === r.object);
    if (!o) return null;
    const p = M.objectPoint(sim, r.object, r.local);
    return { ref: sim.ship.ref, pos: p, radius: r.radius, normal: o.q.rotate(new V3(...r.normal), new V3()), active: i === index, done: i < index };
  }).filter(Boolean);
}

const relSpeed = (sim) => sim.info.target?.relSpeed ?? Infinity;
const rcsUsed = (sim) => (sim.ship.def.rcs.fuel - sim.ship.mono) / sim.ship.def.rcs.fuel;
const fuelLeftFrac = (sim) => {
  const s = sim.ship;
  const st = s.engineStage;
  return st ? st.fuelLeft / st.fuel : 0;
};

function dockScore(sim, ctx) {
  const r = sim.dockReport || { closing: 1, lateral: 1, angle: 10 };
  return [
    { label: 'Velocità di contatto', value: `${r.closing.toFixed(2)} m/s`, points: M.grade(r.closing, 0.08, 0.45, 220) },
    { label: 'Fuori asse', value: `${(r.lateral * 100).toFixed(0)} cm`, points: M.grade(r.lateral, 0.03, 0.24, 160) },
    { label: 'Errore angolare', value: `${r.angle.toFixed(1)}°`, points: M.grade(r.angle, 0.5, 6, 100) },
    { label: 'Monopropellente usato', value: `${Math.round(rcsUsed(sim) * 100)}%`, points: M.grade(rcsUsed(sim), 0.05, 0.6, 120) },
  ];
}

function landedNear(sim, site, maxDist) {
  const s = sim.ship;
  if (!s.landed || s.ref !== site.body) return false;
  const f = siteFrame(site, sim.t);
  return s.pos.clone().sub(f.pos).len() < maxDist;
}

function siteDistance(sim, site) {
  const f = siteFrame(site, sim.t);
  const p = sim.ship.pos.clone().sub(f.pos);
  return p.addScaled(f.up, -p.dot(f.up)).len();
}

const upright = (sim) => sim.ship.forward(new V3()).dot(sim.ship.pos.clone().normalize());

export const MISSIONS = [
  // ---------------------------------------------------------------- training
  {
    id: 'rcs-intro',
    category: 'addestramento',
    title: 'Primi impulsi',
    subtitle: 'RCS e assistenza al volo attorno alla stazione',
    ship: 'pod',
    difficulty: 1,
    duration: '5 min',
    briefing: 'Sei a bordo del Colibrì, a 40 metri dalla porta di prua della Stazione Aurora, in orbita a 410 km sopra la Terra.\n\nNello spazio non c’è attrito: ogni impulso dei propulsori RCS cambia la velocità finché un impulso opposto non la annulla. Usa I/K (su e giù), J/L (sinistra e destra), H/N (avanti e indietro) e attraversa i tre anelli. Il tasto F annulla la velocità relativa alla stazione; con Y l’assistenza al volo la mantiene da sola.',
    objectivesPreview: ['Tre anelli attorno alla porta di prua', 'Fermati vicino all’ultimo anello'],
    setup: { ship: 'pod', start: { type: 'near', object: 'aurora', port: 'prua', distance: 40 }, target: 'aurora', objects: ['aurora'] },
    init() {},
    objectives: [
      ...ringObjectives([ring('aurora', [76, 0, -12], 3, [0, 0, 1]), ring('aurora', [76, 16, -4], 3, [0, 1, 0]), ring('aurora', [62, 8, 6], 3, [1, 0, 0])]),
      { text: 'Fermati: velocità relativa sotto 0,05 m/s', check: (sim) => relSpeed(sim) < 0.05, hint: (sim) => `Velocità relativa ${relSpeed(sim).toFixed(2)} m/s (tieni F)` },
    ],
    markers: ringMarkers([ring('aurora', [76, 0, -12], 3, [0, 0, 1]), ring('aurora', [76, 16, -4], 3, [0, 1, 0]), ring('aurora', [62, 8, 6], 3, [1, 0, 0])]),
    score: (sim, ctx) => ({ items: [
      { label: 'Tempo', value: `${Math.round(ctx.elapsed)} s`, points: M.grade(ctx.elapsed, 90, 400, 300) },
      { label: 'Monopropellente usato', value: `${Math.round(rcsUsed(sim) * 100)}%`, points: M.grade(rcsUsed(sim), 0.05, 0.5, 300) },
    ] }),
  },
  {
    id: 'stabilize',
    category: 'addestramento',
    title: 'Stabilizzazione',
    subtitle: 'Capsula in rotazione: ferma la rotazione e orientati',
    ship: 'capsule',
    difficulty: 1,
    duration: '3 min',
    briefing: 'Un guasto ha lasciato la Rondine in rotazione su tre assi. Attiva il SAS (T) in modo STAB per fermarla: giroscopi e RCS lavorano insieme.\n\nPoi orientati in direzione prograde (tasto 2) e infine punta la stazione Aurora (tasto 8). Sulla sfera di assetto il simbolo giallo con tre trattini è il prograde, quello viola il bersaglio.',
    setup: { ship: 'capsule', start: { type: 'offset', object: 'aurora', lvlh: [-2500, 0, 0], attitude: 'radialOut' }, target: 'aurora', objects: ['aurora'], assists: { sas: false }, tumble: true },
    init(sim) {
      sim.ship.omega.set(0.12, -0.18, 0.15);
    },
    objectives: [
      { text: 'Ferma la rotazione (sotto 0,5°/s)', check: (sim) => sim.ship.omega.len() < 0.0087, hint: (sim) => `Rotazione ${(sim.ship.omega.len() * 57.3).toFixed(1)}°/s · SAS: T` },
      { text: 'Punta prograde (entro 3°) per 5 s', check: (sim, ctx) => hold(ctx, 'pro', angleTo(sim, sim.ship.vel) < 3, 5, sim), hint: (sim) => `Errore ${angleTo(sim, sim.ship.vel).toFixed(1)}° · tasto 2` },
      { text: 'Punta la stazione (entro 2°) per 5 s', check: (sim, ctx) => hold(ctx, 'tgt', angleTo(sim, sim.targetState().pos.clone().sub(sim.ship.pos)) < 2, 5, sim), hint: () => 'Tasto 8: SAS verso il bersaglio' },
    ],
    score: (sim, ctx) => ({ items: [
      { label: 'Tempo', value: `${Math.round(ctx.elapsed)} s`, points: M.grade(ctx.elapsed, 60, 300, 350) },
      { label: 'Monopropellente usato', value: `${Math.round(rcsUsed(sim) * 100)}%`, points: M.grade(rcsUsed(sim), 0.03, 0.3, 250) },
    ] }),
  },
  {
    id: 'dock-basic',
    category: 'addestramento',
    title: 'Attracco di prova',
    subtitle: 'Porta di prua della Stazione Aurora da 80 m',
    ship: 'capsule',
    difficulty: 2,
    duration: '6 min',
    briefing: 'La Rondine è allineata con la porta di prua, a 80 metri. Seleziona l’allineamento automatico alla porta (Maiusc+8) e avvicinati con H a non più di 0,3 m/s; sotto i 10 metri rallenta a 0,1 m/s.\n\nIl riquadro di attracco a destra mostra lo scostamento laterale (croce) e l’errore di assetto (triangolo): tieni la croce al centro con J/L e I/K. L’aggancio riesce sotto 0,5 m/s, entro 25 cm dall’asse e 7° di errore.',
    setup: { ship: 'capsule', start: { type: 'near', object: 'aurora', port: 'prua', distance: 80, lateral: [1.2, -0.8] }, target: { id: 'aurora', port: 'prua' }, objects: ['aurora'] },
    objectives: [
      { text: 'Aggancia la porta di prua', check: (sim) => !!sim.docked, hint: (sim) => (sim.info.port ? `Porta a ${sim.info.port.range.toFixed(1)} m · ${sim.info.port.closing.toFixed(2)} m/s` : '') },
    ],
    score: (sim, ctx) => ({ items: [...dockScore(sim, ctx), { label: 'Tempo', value: `${Math.round(ctx.elapsed)} s`, points: M.grade(ctx.elapsed, 150, 900, 0) }] }),
  },
  {
    id: 'dock-zenith',
    category: 'addestramento',
    title: 'Porta zenitale',
    subtitle: 'Giro attorno alla stazione e attracco dall’alto',
    ship: 'capsule',
    difficulty: 3,
    duration: '12 min',
    briefing: 'Sei a 300 m dietro e sotto la stazione. La porta zenitale guarda in direzione opposta alla Terra: devi girare attorno ai pannelli solari senza toccarli e presentarti sopra la porta.\n\nAttenzione alla dinamica orbitale: anche a pochi metri di distanza la gravità differenziale fa derivare lentamente le traiettorie. Correggi spesso, a piccoli impulsi.',
    setup: { ship: 'capsule', start: { type: 'offset', object: 'aurora', lvlh: [-300, -60, 20], attitude: 'target' }, target: { id: 'aurora', port: 'zenit' }, objects: ['aurora'] },
    objectives: [
      { text: 'Portati sopra la porta zenitale (entro 40 m)', check: (sim) => sim.info.port && sim.info.port.range > 0 && sim.info.port.range < 40 && Math.hypot(sim.info.port.x, sim.info.port.y) < 6, hint: (sim) => (sim.info.port ? `Distanza ${sim.info.port.range.toFixed(0)} m · fuori asse ${Math.hypot(sim.info.port.x, sim.info.port.y).toFixed(1)} m` : '') },
      { text: 'Aggancia la porta zenitale', check: (sim) => !!sim.docked && sim.docked.portIndex === 1 },
    ],
    score: (sim, ctx) => ({ items: dockScore(sim, ctx) }),
  },
  {
    id: 'debris',
    category: 'addestramento',
    title: 'Campo di detriti',
    subtitle: 'Slalom tra i frammenti a 780 km di quota',
    ship: 'pod',
    difficulty: 3,
    duration: '8 min',
    briefing: 'Il campo di detriti Kessler-7 è ciò che resta di un satellite esploso. Ogni frammento si muove quasi alla tua stessa velocità orbitale: rispetto a te sono lenti, ma un urto oltre 5 m/s è fatale.\n\nAttraversa i quattro anelli e raggiungi il relitto al centro, fermandoti entro 30 m.',
    setup: { ship: 'pod', start: { type: 'offset', object: 'detriti', lvlh: [-900, 0, 0], attitude: 'target' }, target: 'detriti', objects: ['detriti'], assists: { fa: true } },
    objectives: [
      ...ringObjectives([ring('detriti', [-650, 40, 0], 5, [1, 0, 0]), ring('detriti', [-420, -30, 10], 5, [1, 0, 0]), ring('detriti', [-220, 20, -10], 5, [1, 0, 0]), ring('detriti', [-90, 0, 0], 5, [1, 0, 0])]),
      { text: 'Fermati entro 30 m dal relitto', check: (sim) => sim.info.target.distance < 30 && relSpeed(sim) < 0.2 },
    ],
    markers: ringMarkers([ring('detriti', [-650, 40, 0], 5, [1, 0, 0]), ring('detriti', [-420, -30, 10], 5, [1, 0, 0]), ring('detriti', [-220, 20, -10], 5, [1, 0, 0]), ring('detriti', [-90, 0, 0], 5, [1, 0, 0])]),
    score: (sim, ctx) => ({ items: [
      { label: 'Tempo', value: `${Math.round(ctx.elapsed)} s`, points: M.grade(ctx.elapsed, 200, 700, 250) },
      { label: 'Integrità', value: `${Math.round(sim.ship.integrity)}%`, points: M.grade(sim.ship.integrity, 100, 40, 200) },
      { label: 'Propellente', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.9, 0.3, 150) },
    ] }),
  },
  // ---------------------------------------------------------------- Earth orbit
  {
    id: 'raise-orbit',
    category: 'orbita',
    title: 'Orbita più alta',
    subtitle: 'Trasferimento di Hohmann da 300 a 500 km',
    ship: 'capsule',
    difficulty: 2,
    duration: '50 min (con il warp)',
    briefing: 'Due accensioni prograde: la prima alza l’apoasse a 500 km, la seconda, mezza orbita dopo, alza il periasse. Apri il computer di navigazione (O): «Alza l’apoasse» crea il nodo; modificalo con i pulsanti finché la nuova orbita arriva a 500 km, poi «Esegui» o accendi a mano quando il timer arriva a metà della durata della manovra.\n\nUsa il warp (.) per attendere: si ferma da solo prima della manovra.',
    setup: { ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 6 }, objects: ['aurora'] },
    objectives: [
      { text: 'Apoasse tra 480 e 520 km', check: (sim) => sim.info.ap > 480e3 && sim.info.ap < 520e3 && !sim.ship.engineOn, hint: (sim) => `Apoasse ${(sim.info.ap / 1000).toFixed(0)} km` },
      { text: 'Orbita circolare: periasse oltre 480 km', check: (sim) => sim.info.pe > 480e3 && sim.info.ap < 530e3 && !sim.ship.engineOn, hint: (sim) => `Periasse ${(sim.info.pe / 1000).toFixed(0)} km` },
    ],
    fail: (sim) => (sim.info.pe < 150e3 && sim.ship.ref === 'earth' ? 'Periasse troppo basso: la capsula rientrerebbe' : false),
    score: (sim) => ({ items: [
      { label: 'Eccentricità finale', value: sim.info.el.e.toFixed(4), points: M.grade(sim.info.el.e, 0.001, 0.004, 300) },
      { label: 'Propellente rimasto', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.83, 0.6, 300) },
    ] }),
  },
  {
    id: 'rendezvous',
    category: 'orbita',
    title: 'Appuntamento con Aurora',
    subtitle: 'Dall’orbita di 300 km fino alla stazione',
    ship: 'capsule',
    difficulty: 4,
    duration: '1 h 30 min (con il warp)',
    briefing: 'La stazione orbita a 410 km, 12° davanti a te. Un’orbita più bassa è più veloce: la raggiungerai. Nel computer di navigazione scegli «Rendezvous col bersaglio»: il calcolo trova il momento e il Δv del trasferimento.\n\nVicino alla stazione orientati retrograde rispetto al bersaglio (tasto 3: la sfera mostra la velocità relativa entro 50 km) e frena a più riprese. Chiudi entro 200 m e sotto 1 m/s, poi aggancia la porta di prua.',
    setup: { ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 6, lan: 40, argLat: -0.21 }, target: { id: 'aurora', port: 'prua' }, objects: ['aurora'] },
    objectives: [
      { text: 'Avvicinati entro 5 km', check: (sim) => sim.info.target.distance < 5000, hint: (sim) => `Distanza ${(sim.info.target.distance / 1000).toFixed(1)} km` },
      { text: 'Entro 200 m a meno di 1 m/s', check: (sim) => sim.info.target.distance < 200 && relSpeed(sim) < 1, hint: (sim) => `${sim.info.target.distance.toFixed(0)} m · ${relSpeed(sim).toFixed(2)} m/s` },
      { text: 'Aggancia la stazione', check: (sim) => !!sim.docked },
    ],
    score: (sim, ctx) => ({ items: [...dockScore(sim, ctx).slice(0, 2), { label: 'Propellente rimasto', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.85, 0.5, 220) }] }),
  },
  {
    id: 'reentry',
    category: 'terra',
    title: 'Rientro e ammaraggio',
    subtitle: 'Da 410 km all’Oceano Indiano',
    ship: 'capsule',
    difficulty: 3,
    duration: '45 min',
    briefing: 'Accensione retrograde per abbassare il periasse a circa 50 km (computer di navigazione: «Rientro»). Prima di entrare in atmosfera sgancia il modulo di servizio (Spazio) e orientati retrograde (tasto 3): lo scudo termico deve guardare avanti. A oltre 7 km/s l’aria compressa davanti alla capsula supera i 1.500 K.\n\nSotto i 7 km e i 250 m/s apri il paracadute (Spazio) e ammara a meno di 12 m/s.',
    setup: { ship: 'capsule', start: { type: 'orbit', body: 'earth', altitude: 410e3, inclination: 6, lan: 40, argLat: -2.2 }, objects: ['aurora'] },
    objectives: [
      { text: 'Periasse sotto 70 km', check: (sim) => sim.info.pe < 70e3, hint: (sim) => `Periasse ${(sim.info.pe / 1000).toFixed(0)} km · O → Rientro` },
      { text: 'Sgancia il modulo di servizio', check: (sim) => sim.ship.stageIndex >= 1 },
      { text: 'Supera il rientro (sotto 20 km)', check: (sim) => sim.ship.altitude < 20e3, hint: (sim) => `Temperatura ${Math.round(sim.ship.temperature)} K · ${sim.ship.shieldFacing ? 'scudo avanti' : 'SCUDO NON ALLINEATO'}` },
      { text: 'Paracadute aperto', check: (sim) => sim.ship.parachute > 0.5 },
      { text: 'Ammaraggio', check: (sim) => sim.ship.splashed && sim.ship.landed },
    ],
    score: (sim, ctx) => {
      const imp = ctx.events.find((e) => e.type === 'splashdown')?.speed ?? 12;
      return { items: [
        { label: 'Velocità di ammaraggio', value: `${imp.toFixed(1)} m/s`, points: M.grade(imp, 9, 14, 250) },
        { label: 'Accelerazione massima', value: `${(ctx.maxG || 0).toFixed(1)} g`, points: M.grade(ctx.maxG || 0, 5, 10, 200) },
        { label: 'Temperatura massima scudo', value: `${Math.round(ctx.maxT || 0)} K`, points: M.grade(ctx.maxT || 0, 1400, 2400, 150) },
      ] };
    },
    fail: (sim, ctx) => {
      ctx.maxT = Math.max(ctx.maxT || 0, sim.ship.temperature);
      return false;
    },
  },
  {
    id: 'launch',
    category: 'terra',
    title: 'Lancio da Malindi',
    subtitle: 'Dalla rampa all’orbita bassa',
    ship: 'rocket',
    difficulty: 3,
    duration: '10 min',
    briefing: 'Il Centro Spaziale Luigi Broglio è a 3° di latitudine sud: lanciando verso est la rotazione della Terra regala 464 m/s. Manetta al massimo (Z) e salita verticale; a 60 m/s inclina dolcemente verso est e segui il prograde rispetto all’aria. Dopo la separazione del primo stadio (Spazio) costruisci velocità orizzontale finché il periasse esce dall’atmosfera.\n\nL’autopilota di ascesa (Maiusc+A) esegue la virata gravitazionale per te.',
    setup: { ship: 'rocket', date: '2031-05-20T05:30:00Z', start: { type: 'surface', site: 'malindi' }, objects: ['aurora'] },
    objectives: [
      { text: 'Decollo', check: (sim) => sim.ship.altitude > 1000 },
      { text: 'Supera i 100 km (linea di Kármán)', check: (sim) => sim.ship.altitude > 100e3 },
      { text: 'Orbita stabile: periasse oltre 150 km', check: (sim) => sim.info.pe > 150e3 && !sim.ship.engineOn, hint: (sim) => `Apoasse ${(sim.info.ap / 1000).toFixed(0)} km · periasse ${(sim.info.pe / 1000).toFixed(0)} km` },
    ],
    score: (sim, ctx) => ({ items: [
      { label: 'Δv rimasto', value: `${Math.round(sim.info.deltaV)} m/s`, points: M.grade(sim.info.deltaV, 1500, 200, 300) },
      { label: 'Accelerazione massima', value: `${(ctx.maxG || 0).toFixed(1)} g`, points: M.grade(ctx.maxG || 0, 4, 7, 150) },
      { label: 'Eccentricità', value: sim.info.el.e.toFixed(3), points: M.grade(sim.info.el.e, 0.005, 0.05, 150) },
    ] }),
  },
  {
    id: 'grottaglie',
    category: 'terra',
    title: 'Atterraggio a Grottaglie',
    subtitle: 'Planata senza motore fino alla pista',
    ship: 'spaceplane',
    difficulty: 4,
    duration: '6 min',
    briefing: 'L’Albatro rientra dall’orbita e arriva in planata sopra lo Ionio: 9 km di quota, 30 km dalla pista 17 dello spazioporto di Taranto-Grottaglie, 210 m/s. Non hai motori per riprovare: gestisci l’energia con l’angolo d’attacco e le virate.\n\nAllinea la pista (rotta 172°), estrai il carrello (G) sotto i 1.000 m, tocca a meno di 3 m/s di discesa e frena con B.',
    setup: { ship: 'spaceplane', date: '2031-05-20T11:00:00Z', start: { type: 'approach', site: 'grottaglie', altitude: 9000, north: 30000, east: -4000, heading: 172, pitch: -6, vel: [10, -205, -12] }, objects: ['aurora'], legs: false },
    objectives: [
      { text: 'Carrello estratto', check: (sim) => sim.ship.legsDeployed },
      { text: 'Atterra in pista', check: (sim) => sim.ship.contacts >= 2 && onRunway(sim, SITES.grottaglie), hint: (sim) => `Pista a ${(siteDistance(sim, SITES.grottaglie) / 1000).toFixed(1)} km · quota ${Math.round(sim.ship.agl)} m` },
      { text: 'Fermati sulla pista', check: (sim) => sim.info.surfaceSpeed < 1 && onRunway(sim, SITES.grottaglie) },
    ],
    fail: (sim) => (sim.ship.contacts >= 2 && !onRunway(sim, SITES.grottaglie) && sim.info.surfaceSpeed > 5 ? 'Uscita di pista' : false),
    score: (sim, ctx) => {
      const td = ctx.events.find((e) => e.type === 'touchdown')?.speed ?? 3;
      return { items: [
        { label: 'Discesa al contatto', value: `${td.toFixed(2)} m/s`, points: M.grade(td, 0.6, 3, 400) },
        { label: 'Accelerazione massima', value: `${(ctx.maxG || 0).toFixed(1)} g`, points: M.grade(ctx.maxG || 0, 1.5, 4, 200) },
      ] };
    },
  },
  // ---------------------------------------------------------------- Moon
  {
    id: 'moon-landing',
    category: 'luna',
    title: 'Allunaggio a Tranquillitatis',
    subtitle: 'Discesa finale sulla base, accanto al sito dell’Apollo 11',
    ship: 'lander',
    difficulty: 3,
    duration: '5 min',
    briefing: 'Il Grillo è a 2.000 m di quota, 4 km a ovest della base, a 70 m/s in avvicinamento e in discesa. La gravità lunare è un sesto di quella terrestre: il motore di discesa regge il modulo a circa il 35% di spinta.\n\nOrienta il motore contro il moto (SAS retrograde, tasto 3) per frenare, poi passa in verticale (Maiusc+6). Il controllo della velocità verticale (V) trasforma la manetta in una richiesta di discesa: centro = volo stazionario. Tocca entro 300 m dalla base a meno di 2 m/s.',
    setup: { ship: 'lander', date: '2031-05-24T12:00:00Z', start: { type: 'approach', site: 'tranquillitatis', altitude: 2000, east: -4000, heading: 90, vel: [70, 0, -25], tilt: -35 }, objects: ['selene'], fuel: 0.3 },
    objectives: [
      { text: 'Sotto i 500 m e i 20 m/s', check: (sim) => sim.ship.agl < 500 && sim.info.surfaceSpeed < 20, hint: (sim) => `Quota ${Math.round(sim.ship.agl)} m · velocità ${sim.info.surfaceSpeed.toFixed(0)} m/s` },
      { text: 'Atterra entro 300 m dalla base', check: (sim) => landedNear(sim, SITES.tranquillitatis, 300) && upright(sim) > 0.9, hint: (sim) => `Base a ${Math.round(siteDistance(sim, SITES.tranquillitatis))} m` },
    ],
    fail: (sim) => (sim.ship.landed && !landedNear(sim, SITES.tranquillitatis, 300) ? 'Atterrato troppo lontano dalla base' : sim.ship.landed && upright(sim) < 0.7 ? 'Il modulo si è ribaltato' : false),
    score: (sim, ctx) => {
      const td = ctx.events.find((e) => e.type === 'touchdown')?.speed ?? 2;
      const d = siteDistance(sim, SITES.tranquillitatis);
      return { items: [
        { label: 'Velocità di contatto', value: `${td.toFixed(2)} m/s`, points: M.grade(td, 0.5, 2.5, 220) },
        { label: 'Distanza dalla base', value: `${Math.round(d)} m`, points: M.grade(d, 20, 300, 220) },
        { label: 'Propellente rimasto', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.5, 0.05, 160) },
      ] };
    },
  },
  {
    id: 'moon-pdi',
    category: 'luna',
    title: 'Discesa motorizzata',
    subtitle: 'Dall’orbita a 15 km fino al suolo',
    ship: 'lander',
    difficulty: 5,
    duration: '15 min',
    briefing: 'Come l’Apollo 11: sei a 15 km di quota, 450 km a ovest della base, a 1,68 km/s. Accendi retrograde rispetto alla superficie per annullare la velocità orizzontale lungo la discesa; quando la velocità scende sotto i 100 m/s portati in verticale e scegli il punto di contatto.\n\nIl margine di propellente è quello reale: poche decine di secondi di volo stazionario.',
    setup: { ship: 'lander', date: '2031-05-24T12:00:00Z', start: { type: 'approach', site: 'tranquillitatis', altitude: 15000, east: -450000, heading: 90, vel: [1675, 0, 0], tilt: -88 }, objects: ['selene'] },
    objectives: [
      { text: 'Velocità orizzontale sotto 100 m/s', check: (sim) => sim.info.hspeed < 100 && sim.ship.agl > 300, hint: (sim) => `Orizzontale ${sim.info.hspeed.toFixed(0)} m/s · quota ${(sim.ship.agl / 1000).toFixed(1)} km` },
      { text: 'Atterra a meno di 3 km dalla base', check: (sim) => landedNear(sim, SITES.tranquillitatis, 3000) && upright(sim) > 0.9, hint: (sim) => `Base a ${(siteDistance(sim, SITES.tranquillitatis) / 1000).toFixed(1)} km` },
    ],
    fail: (sim) => (sim.ship.landed && upright(sim) < 0.7 ? 'Il modulo si è ribaltato' : false),
    score: (sim, ctx) => {
      const td = ctx.events.find((e) => e.type === 'touchdown')?.speed ?? 2;
      const d = siteDistance(sim, SITES.tranquillitatis);
      return { items: [
        { label: 'Velocità di contatto', value: `${td.toFixed(2)} m/s`, points: M.grade(td, 0.5, 2.5, 200) },
        { label: 'Distanza dalla base', value: `${(d / 1000).toFixed(2)} km`, points: M.grade(d, 100, 3000, 220) },
        { label: 'Propellente rimasto', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.12, 0.01, 180) },
      ] };
    },
  },
  {
    id: 'moon-ascent',
    category: 'luna',
    title: 'Decollo lunare',
    subtitle: 'Lo stadio di salita torna in orbita',
    ship: 'lander',
    difficulty: 3,
    duration: '10 min',
    briefing: 'Il Grillo è posato alla Base Tranquillitatis. Separa lo stadio di salita (Spazio): la base resta sul suolo e fa da rampa. Sali in verticale per qualche secondo, poi inclinati verso est e costruisci velocità orizzontale: senza atmosfera puoi volare quasi radente.\n\nRaggiungi un’orbita con periasse oltre 15 km.',
    setup: { ship: 'lander', date: '2031-05-24T12:00:00Z', start: { type: 'surface', site: 'tranquillitatis', pad: 0, heading: 90 }, objects: ['selene'], target: 'selene' },
    objectives: [
      { text: 'Separa lo stadio di salita', check: (sim) => sim.ship.stageIndex >= 1 },
      { text: 'Orbita con periasse oltre 15 km', check: (sim) => sim.info.pe > 15e3 && !sim.ship.engineOn, hint: (sim) => `Apoasse ${(sim.info.ap / 1000).toFixed(0)} km · periasse ${(sim.info.pe / 1000).toFixed(0)} km` },
    ],
    score: (sim) => ({ items: [
      { label: 'Propellente rimasto', value: `${Math.round(fuelLeftFrac(sim) * 100)}%`, points: M.grade(fuelLeftFrac(sim), 0.25, 0, 350) },
      { label: 'Eccentricità', value: sim.info.el.e.toFixed(3), points: M.grade(sim.info.el.e, 0.01, 0.1, 250) },
    ] }),
  },
  {
    id: 'tli',
    category: 'luna',
    title: 'Verso la Luna',
    subtitle: 'Iniezione translunare e inserimento in orbita lunare',
    ship: 'translunar',
    difficulty: 4,
    duration: '3 giorni (con il warp)',
    briefing: 'In orbita di parcheggio a 300 km con lo stadio TLI. Con la Luna come bersaglio (già selezionata) il computer di navigazione calcola l’iniezione translunare (circa 3,1 km/s): l’orbita diventa un’ellisse lunghissima che incontra la sfera d’influenza della Luna dopo circa tre giorni.\n\nDopo l’ingresso nella sfera lunare pianifica «Circolarizza al periasse» per catturarti in orbita lunare.',
    setup: { ship: 'translunar', date: '2031-05-20T08:00:00Z', start: { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 28 }, target: 'moon', objects: ['selene'] },
    objectives: [
      { text: 'Traiettoria verso la Luna', check: (sim) => sim.prediction?.some((s) => s.ref === 'moon') && !sim.ship.engineOn, hint: () => 'O → «Trasferimento verso il bersaglio», poi «Esegui»' },
      { text: 'Ingresso nella sfera d’influenza lunare', check: (sim) => sim.ship.ref === 'moon', hint: () => 'Warp all’incontro (O) e correzione di rotta se il periasse è troppo basso' },
      { text: 'Orbita lunare: apoasse sotto 5.000 km, periasse oltre 20 km', check: (sim) => sim.ship.ref === 'moon' && sim.info.el.e < 1 && sim.info.ap < 5000e3 && sim.info.pe > 20e3 && !sim.ship.engineOn },
    ],
    score: (sim) => ({ items: [
      { label: 'Δv rimasto', value: `${Math.round(sim.info.deltaV)} m/s`, points: M.grade(sim.info.deltaV, 600, 0, 350) },
      { label: 'Periasse lunare', value: `${Math.round(sim.info.pe / 1000)} km`, points: M.grade(Math.abs(sim.info.pe - 100e3), 0, 400e3, 250) },
    ] }),
  },
  {
    id: 'tei',
    category: 'luna',
    title: 'Ritorno dalla Luna',
    subtitle: 'Iniezione trans-terrestre e rientro a 11 km/s',
    ship: 'capsule',
    difficulty: 5,
    duration: '3 giorni (con il warp)',
    briefing: 'In orbita lunare a 100 km. «Ritorno al pianeta madre» nel computer di navigazione calcola l’accensione che riporta la capsula sulla Terra con un periasse di circa 60 km: il corridoio di rientro. Troppo alto e rimbalzi nello spazio, troppo basso e la decelerazione supera i limiti dell’equipaggio.\n\nAll’arrivo sgancia il modulo di servizio, scudo avanti e paracadute sotto i 7 km.',
    setup: { ship: 'capsule', date: '2031-05-24T00:00:00Z', start: { type: 'orbit', body: 'moon', altitude: 100e3, inclination: 5 }, objects: ['selene'] },
    objectives: [
      { text: 'Traiettoria di ritorno: periasse terrestre tra 40 e 80 km', check: (sim) => { const s = sim.prediction?.find((x) => x.ref === 'earth'); return s && s.el.rp - BODIES.earth.radius > 40e3 && s.el.rp - BODIES.earth.radius < 80e3 && !sim.ship.engineOn; }, hint: () => 'O → «Ritorno al pianeta madre», poi correzione di rotta' },
      { text: 'Rientro in atmosfera', check: (sim) => sim.ship.ref === 'earth' && sim.ship.altitude < 100e3 },
      { text: 'Ammaraggio', check: (sim) => sim.ship.landed && sim.ship.splashed },
    ],
    score: (sim, ctx) => ({ items: [
      { label: 'Accelerazione massima', value: `${(ctx.maxG || 0).toFixed(1)} g`, points: M.grade(ctx.maxG || 0, 5, 12, 300) },
      { label: 'Velocità di ammaraggio', value: `${(ctx.events.find((e) => e.type === 'splashdown')?.speed ?? 12).toFixed(1)} m/s`, points: M.grade(ctx.events.find((e) => e.type === 'splashdown')?.speed ?? 12, 9, 14, 300) },
    ] }),
  },
  // ---------------------------------------------------------------- Mars
  {
    id: 'mars-transfer',
    category: 'marte',
    title: 'Verso Marte',
    subtitle: 'Finestra di lancio del 2033 con l’Ulisse NTR',
    ship: 'ntr',
    difficulty: 5,
    duration: '7 mesi (con il warp)',
    briefing: 'Primavera 2033: Terra e Marte sono nella posizione giusta per un trasferimento a basso costo. L’orbita di parcheggio è già orientata verso l’asintoto di partenza. Il computer di navigazione risolve il problema di Lambert per data e durata del viaggio e calcola l’accensione di fuga (circa 3,5 km/s).\n\nDurante la crociera usa il warp ×1.000.000 e una correzione di rotta; all’arrivo cattura l’Ulisse in un’orbita marziana con periasse oltre 150 km.',
    setup: { ship: 'ntr', date: '2033-02-01T00:00:00Z', start: { type: 'orbit', body: 'earth', altitude: 400e3, departureTo: 'mars' }, target: 'mars', objects: ['phobos', 'deimos'] },
    objectives: [
      { text: 'Traiettoria di fuga verso Marte', check: (sim) => sim.prediction?.some((s) => s.ref === 'mars') || sim.ship.ref === 'sun', hint: () => 'O → «Trasferimento verso il bersaglio» (calcolo di qualche secondo)' },
      { text: 'In rotta interplanetaria (orbita solare)', check: (sim) => sim.ship.ref === 'sun' },
      { text: 'Ingresso nella sfera d’influenza di Marte', check: (sim) => sim.ship.ref === 'mars', hint: () => 'Correzione di rotta (O) per un periasse di 300 km' },
      { text: 'Orbita marziana: periasse oltre 150 km', check: (sim) => sim.ship.ref === 'mars' && sim.info.el.e < 1 && sim.info.pe > 150e3 && !sim.ship.engineOn },
    ],
    score: (sim) => ({ items: [
      { label: 'Δv rimasto', value: `${Math.round(sim.info.deltaV)} m/s`, points: M.grade(sim.info.deltaV, 3000, 0, 400) },
      { label: 'Apoasse marziano', value: `${Math.round(sim.info.ap / 1000)} km`, points: M.grade(sim.info.ap, 5000e3, 50000e3, 200) },
    ] }),
  },
  {
    id: 'phobos',
    category: 'marte',
    title: 'Incontro con Phobos',
    subtitle: 'Rendezvous con la luna più vicina a Marte',
    ship: 'ntr',
    difficulty: 4,
    duration: '1 giorno (con il warp)',
    briefing: 'L’Ulisse è in orbita circolare a 500 km sopra Marte. Phobos, un sasso di 27 km, orbita a 6.000 km di quota e completa un giro in 7 ore e 39 minuti: più veloce della rotazione di Marte, sorge a ovest.\n\nPhobos è selezionato come bersaglio: «Allinea il piano», poi «Rendezvous col bersaglio». Arriva entro 3 km a meno di 5 m/s.',
    setup: { ship: 'ntr', date: '2033-11-01T00:00:00Z', start: { type: 'orbit', body: 'mars', altitude: 500e3, inclination: 3 }, target: 'phobos', objects: ['phobos', 'deimos'], fuel: 0.5 },
    objectives: [
      { text: 'Entro 50 km da Phobos', check: (sim) => sim.info.target.distance < 50e3, hint: (sim) => `Distanza ${(sim.info.target.distance / 1000).toFixed(0)} km` },
      { text: 'Entro 3 km a meno di 5 m/s', check: (sim) => sim.info.target.distance < 3000 && relSpeed(sim) < 5, hint: (sim) => `${(sim.info.target.distance / 1000).toFixed(1)} km · ${relSpeed(sim).toFixed(1)} m/s` },
    ],
    score: (sim) => ({ items: [
      { label: 'Δv rimasto', value: `${Math.round(sim.info.deltaV)} m/s`, points: M.grade(sim.info.deltaV, 3500, 1000, 400) },
      { label: 'Velocità relativa', value: `${relSpeed(sim).toFixed(1)} m/s`, points: M.grade(relSpeed(sim), 0.5, 5, 200) },
    ] }),
  },
];

function angleTo(sim, dir) {
  const f = sim.ship.forward(new V3());
  return (Math.acos(Math.max(-1, Math.min(1, f.dot(dir.clone().normalize())))) * 180) / Math.PI;
}

/** True once `cond` has held continuously for `seconds` of mission time. */
function hold(ctx, key, cond, seconds) {
  if (!cond) {
    ctx.data[key] = null;
    return false;
  }
  if (ctx.data[key] == null) ctx.data[key] = ctx.elapsed;
  return ctx.elapsed - ctx.data[key] >= seconds;
}

/** Is the ship on the runway rectangle of a site? */
function onRunway(sim, site) {
  const rw = site.runway;
  const f = siteFrame(site, sim.t, rw.east, rw.north);
  const d = sim.ship.pos.clone().sub(f.pos);
  const hdg = (rw.heading * Math.PI) / 180;
  const along = f.north.clone().scale(Math.cos(hdg)).addScaled(f.east, Math.sin(hdg));
  const a = d.dot(along), c = d.dot(new V3().crossVectors(f.up, along));
  return Math.abs(a) < rw.length / 2 + 30 && Math.abs(c) < rw.width / 2 + 5;
}

export const CATEGORIES = [
  { id: 'all', label: 'Tutte' },
  { id: 'addestramento', label: 'Addestramento' },
  { id: 'orbita', label: 'Orbita terrestre' },
  { id: 'terra', label: 'Terra' },
  { id: 'luna', label: 'Luna' },
  { id: 'marte', label: 'Marte' },
];

export { bodySpin };
