// Declarative lessons use the same simulation state and runway geometry as free flight.
import { WEATHER_PRESETS, cloneWeather } from '../sim/atmosphere.js';
import { findRunwayEnd, NAVAIDS } from '../world/world-data.js';
import { FT, NM } from '../core/units.js';
import { getTerrain } from '../world/terrain-height.js';

const calm = { ...cloneWeather(WEATHER_PRESETS.sereno), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
const start = (type = 'runway', airport = 'XAQU', runway = '07') => ({ type, airport, runway });
const setup = (aircraft, position, extra = {}) => ({ aircraft, start: position, weather: cloneWeather(calm), time: 11, fuel: 0.8, ...extra });
const climb = (feet) => ({ type: 'climb', text: `Sali ad almeno ${feet} ft dal suolo`, aglFt: feet });
const land = (airport = 'XAQU', runway = '07', extra = {}) => ({ type: 'land', text: `Atterra sulla pista ${runway} di ${airport}`, airport, runway, ...extra });
const stop = { type: 'stop', text: 'Rallenta sotto 5 kt e fermati in sicurezza', duration: 3 };
const point = (text, n, e, altFt, radius = 450) => ({ type: 'waypoint', text, n, e, alt: altFt * FT, radius });
const end = findRunwayEnd('XAQU', '07');
const along = (d, side = 0) => ({ n: end.thrN + end.dirN * d - end.dirE * side, e: end.thrE + end.dirE * d + end.dirN * side });
const pattern = [along(5000, 1800), along(-4000, 1800), along(-4000)];
const ringStart = { n: 2000, e: -10000 };
const ringCourse = Array.from({ length: 6 }, (_, i) => {
  const d = (i + 1) * 1800;
  const p = along(d);
  return point(`Attraversa l'anello ${i + 1} a 2500 ft`, ringStart.n + p.n - end.thrN, ringStart.e + p.e - end.thrE, 2500, 260);
});
const vor = NAVAIDS.find((v) => v.id === 'BRG');

function mission(id, title, subtitle, aircraft, difficulty, duration, briefing, options, objectives, extra = {}) {
  return { id, title, subtitle, aircraft, difficulty, duration, briefing, setup: options, objectives,
    objectivesPreview: objectives.map((o) => o.text), timeLimit: 2400, ...extra };
}

const CLASSIC = [
  mission('primo-decollo', 'Primo decollo', 'Impara a staccare e salire', 'trainer', 1, '4–6 min',
    'Sei allineato sulla pista 07 di Aquila. Rilascia il freno di parcheggio (Ctrl+.), porta la manetta al massimo (F4) e mantieni l’asse con Q/E.\n\nA circa 55 kt tira dolcemente la barra. Sali a 1000 ft dal suolo, poi mantieni un volo stabile a 1500 ft MSL per 15 secondi. La missione termina in volo; non è richiesto atterrare.',
    setup('trainer', start()), [climb(1000), { type: 'hold', text: 'Mantieni 1500 ft MSL (±200 ft) per 15 s', altFt: 1500, toleranceFt: 200, duration: 15 }]),
  mission('circuito', 'Circuito di traffico', 'Decollo, sottovento, base e finale', 'trainer', 2, '10–15 min',
    'Decolla dalla pista 07 e sali a 1500 ft MSL. Segui in ordine i tre punti del circuito a destra: ingresso in sottovento, fine sottovento, base e finale.\n\nGli indicatori e la mappa (M) aiutano a trovare i punti. Atterra sulla stessa pista e fermati.',
    setup('trainer', start()), [climb(700), ...pattern.map((p, i) => point(['Ingresso sottovento', 'Fine sottovento', 'Virata in finale'][i], p.n, p.e, 1500, 700)), land(), stop]),
  mission('atterraggio-precisione', 'Atterraggio di precisione', 'Finale stabilizzato e contatto morbido', 'trainer', 2, '4–6 min',
    'Sei sul finale della pista 07, a 4 NM dalla soglia, con flap e carrello già configurati. Mantieni circa 65 kt e regola la discesa con la potenza.\n\nAtterra entro i primi 800 m e a meno di 10 m dall’asse. Il punteggio premia un contatto sotto 250 ft/min. Riduci la potenza sul raccordo e frena dopo il contatto.',
    setup('trainer', { ...start('final'), distanceNm: 4 }), [land('XAQU', '07', { maxAlong: 800, maxOffset: 10 }), stop]),
  mission('avaria-motore', 'Avaria motore', 'Planata di emergenza verso Aquila', 'trainer', 4, '3–5 min',
    'Sei sul finale a 2 NM dalla pista 07, a 1700 ft MSL. Dopo 8 secondi il motore si arresta. Mantieni circa 65 kt: non inseguire la quota tirando la barra.\n\nRaggiungi la pista in planata, usa i flap solo quando sei certo di arrivare e atterra. La missione richiede che l’avaria sia effettivamente avvenuta.',
    setup('trainer', { ...start('final'), distanceNm: 2, altitudeOffsetFt: 600, speedKt: 65, flaps: 0 }, { failures: [{ system: 'engine', atTime: 8 }] }),
    [{ type: 'failure', text: 'Gestisci l’avaria motore mantenendo 60–75 kt', system: 'engine', minSpeed: 60, maxSpeed: 75, duration: 3 }, land(), stop]),
  mission('navigazione-vor', 'Navigazione VOR', 'Raggiungi il VOR di Borgo', 'trainer', 3, '8–12 min',
    'Sei in volo a 3500 ft a est di Aquila. Sintonizza NAV1 su BRG 115.20 MHz e raggiungi la stazione di Borgo mantenendo 3500 ft (±400 ft).\n\nLa barra OBS e il DME del cockpit permettono di navigare senza riferimenti visivi. Attraversa la zona entro 0,7 NM dal VOR con NAV1 sintonizzato: la missione termina in volo.',
    setup('trainer', { ...start('air'), n: 3000, e: 6000, heading: 50, altitudeFt: 3500, speedKt: 105 }),
    [{ ...point('Raggiungi BRG 115.20 a 3500 ft', vor.n, vor.e, 3500, 1250), frequency: 115.2, toleranceFt: 400 }]),
  mission('avviamento-freddo', 'Avviamento a freddo', 'Dalla batteria al decollo', 'trainer', 2, '6–10 min',
    'Il Falco è parcheggiato con motore e impianti spenti. Apri la checklist (K): inserisci batteria e alternatore, seleziona il carburante e la miscela ricca, poi avvia con i magneti. Ctrl+E esegue la sequenza automatica.\n\nQuando motore e avionica sono operativi, rilascia il freno, raggiungi la pista e decolla. Sali a 500 ft dal suolo.',
    setup('trainer', start('parking'), { coldDark: true }),
    [{ type: 'systems', text: 'Avvia il motore e alimenta l’avionica', duration: 5 }, climb(500)]),
  mission('atterraggio-montagna', 'Atterraggio in montagna', 'La pista corta di Montecervo', 'trainer', 4, '4–6 min',
    'Sei allineato sul finale 02 di Montecervo, a 3 NM dalla soglia. L’elevazione è 3839 ft: controlla la quota sul livello del mare e la velocità.\n\nLa pista è lunga solo 800 m. Atterra entro i primi 450 m e frena con decisione, mantenendo l’asse.',
    setup('trainer', { ...start('final', 'XMNT', '02'), distanceNm: 3 }), [land('XMNT', '02', { maxAlong: 450 }), stop]),
  mission('ils-nebbia', 'ILS nella nebbia', 'Avvicinamento strumentale con l’Aquila', 'airliner', 4, '6–9 min',
    'L’AX-320 è sul finale 07 ad Aquila. NAV1 è già su 110.30 MHz: segui localizzatore e glideslope, oppure inserisci AP, APR e autothrottle per usare l’autoland.\n\nMantieni la configurazione di atterraggio. Atterra sulla pista e rallenta sotto 5 kt. La nebbia richiede di fidarsi degli strumenti.',
    setup('airliner', { ...start('final'), distanceNm: 8 }, { weather: cloneWeather(WEATHER_PRESETS.nebbia) }), [land(), stop]),
  mission('volo-linea', 'Volo di linea', 'Da Aquila a Costa Verde', 'airliner', 3, '15–22 min',
    'Decolla dalla pista 07 di Aquila e sali ad almeno 2000 ft dal suolo. Segui il piano GPS verso Costa Verde a 6000 ft.\n\nRaggiungi il punto di ingresso a nord di Costa Verde, poi scendi per atterrare sulla pista 18 (ILS 108.70). Configura flap e carrello prima del finale e completa il volo fermandoti in pista.',
    setup('airliner', start(), { route: [{ id: 'CST-ARR', n: 37000, e: -30770 }, { id: 'XCST', n: 26000, e: -30000 }] }),
    [climb(2000), point('Ingresso Costa Verde a 6000 ft', 37000, -30770, 6000, 2000), land('XCST', '18'), stop]),
  mission('vento-traverso', 'Vento al traverso', 'Correzione di deriva e asse pista', 'trainer', 4, '4–6 min',
    'Il vento da 160° a 14 kt soffia quasi al traverso della pista 07. Sei già sul finale: usa una correzione di deriva e allinea il muso alla pista prima del contatto.\n\nAtterra entro 12 m dall’asse e mantieni il controllo durante la frenata.',
    setup('trainer', { ...start('final'), distanceNm: 4 }, { weather: { ...cloneWeather(calm), windDir: 160, windSpeedKt: 14, gustKt: 3 } }), [land('XAQU', '07', { maxOffset: 12 }), stop]),
  mission('percorso-anelli', 'Percorso ad anelli', 'Precisione in tre dimensioni', 'jet', 3, '3–5 min',
    'Vola con il Freccia JT-9 attraverso sei anelli in ordine, mantenendo circa 2500 ft MSL. Il prossimo anello è evidenziato.\n\nPuoi ridurre la manetta per avere più tempo nelle correzioni. Attraversa il centro di ogni anello: passare sopra o sotto non conta.',
    setup('jet', { ...start('air'), ...ringStart, heading: 72, altitudeFt: 2500, speedKt: 220 }), ringCourse),
  mission('acrobazia', 'Acrobazia', 'Tonneau completo e recupero', 'jet', 4, '3–5 min',
    'Sei a 6500 ft sul Freccia JT-9, con spazio per manovrare. Esegui un tonneau completo in un verso mantenendo almeno 1500 ft dal suolo.\n\nDopo il tonneau recupera un volo stabile tra 5500 e 7500 ft per 10 secondi. Il tonneau richiede una rotazione continua di 360°: oscillare da un’ala all’altra non completa l’obiettivo.',
    setup('jet', { ...start('air'), n: -4000, e: 4000, heading: 72, altitudeFt: 6500, speedKt: 300 }),
    [{ type: 'roll', text: 'Completa un tonneau di 360° sopra 1500 ft AGL', minAglFt: 1500 }, { type: 'hold', text: 'Recupera a 6500 ft (±1000 ft), ali livellate, per 10 s', altFt: 6500, toleranceFt: 1000, duration: 10 }]),
  mission('volo-notturno', 'Volo notturno', 'Luci e strumenti verso Aquila', 'trainer', 3, '4–6 min',
    'Sei sul finale 07 dopo il tramonto. Le luci pista e gli strumenti sono i tuoi riferimenti. Controlla luci di atterraggio e pannello, e mantieni il sentiero di discesa.\n\nAtterra sulla pista 07 e rallenta fino a fermarti. La missione termina con l’analisi del contatto.',
    setup('trainer', { ...start('final'), distanceNm: 4 }, { time: 22, weather: cloneWeather(calm) }), [land(), stop]),
];

// ------------------------------------------------------------------ extended fleet

const RAD = 180 / Math.PI;
const air = (airport, n, e, heading, altitudeFt, speedKt) => ({ type: 'air', airport, n, e, heading, altitudeFt, ...(speedKt ? { speedKt } : {}) });
const final = (airport, runway, distanceNm, extra = {}) => ({ type: 'final', airport, runway, distanceNm, ...extra });
const hold = (text, altFt, toleranceFt, duration) => ({ type: 'hold', text, altFt, toleranceFt, duration });
const loop = (minAglFt) => ({ type: 'loop', text: `Esegui un looping completo sopra ${minAglFt} ft dal suolo`, minAglFt });
const roll = (minAglFt) => ({ type: 'roll', text: `Completa un tonneau di 360° sopra ${minAglFt} ft AGL`, minAglFt });
/** Point on the extended centreline of a runway, `nm` miles before its threshold. */
function onFinal(airport, runway, nm) {
  const end = findRunwayEnd(airport, runway);
  return { n: end.thrN - end.dirN * nm * NM, e: end.thrE - end.dirE * nm * NM };
}
/** Low-level gates: each sits `aglFt` above the terrain and faces the next one. */
function lowLevel(points, aglFt, maxAglFt) {
  const terrain = getTerrain();
  return points.map(([n, e, name], i) => {
    const [n2, e2] = points[Math.min(i + 1, points.length - 1)];
    const [n1, e1] = i + 1 < points.length ? [n, e] : points[i - 1];
    const heading = (Math.atan2(e2 - e1, n2 - n1) * RAD + 360) % 360;
    const alt = terrain.height(n, e) + aglFt * FT;
    return { type: 'waypoint', text: `${name}: sotto ${maxAglFt} ft dal suolo`, n, e, alt, radius: 650, horizontal: true, maxAglFt, ring: true, heading };
  });
}
const bisonteIp = { n: 15000, e: -24000 };
const dropZone = { n: 12000, e: -16000 };
const borgoIf = onFinal('XBRG', '33', 6);
const aquilaIf25 = onFinal('XAQU', '25', 10);
const serenaIf = onFinal('XSRN', '30', 7);

const FLEET_MISSIONS = [
  // ---- Allodola X-300 (aerobatic) ----
  mission('acro-looping', 'Il primo looping', 'Una rotazione completa in verticale', 'aerobatic', 2, '3–5 min',
    'L’Allodola X-300 è a 4000 ft con 150 kt. Dai tutta manetta, picchia leggermente fino a 160 kt, poi tira la cloche con decisione e tienila: il muso sale sulla verticale, passa rovescio in cima e torna giù.\n\nTieni le ali livellate per tutto il looping e resta sopra 1500 ft dal suolo. Quando il muso torna sull’orizzonte, livella e mantieni 4000 ft per 10 secondi.',
    setup('aerobatic', air('XAQU', -6000, 6000, 72, 4000, 150)), [loop(1500), hold('Livella a 4000 ft (±400 ft) per 10 s', 4000, 400, 10)]),
  mission('acro-rovescio', 'Volo rovescio', 'Testa in giù con l’ala simmetrica', 'aerobatic', 3, '3–5 min',
    'L’ala simmetrica dell’Allodola vola bene anche capovolta. Rolla di 180° con gli alettoni e, una volta rovescio, spingi la cloche in avanti per tenere il muso sopra l’orizzonte: in volo rovescio i comandi di profondità sono invertiti rispetto all’orizzonte.\n\nResta rovescio per 15 secondi a 4000 ft (±500 ft), poi raddrizzati e mantieni la quota per 10 secondi.',
    setup('aerobatic', air('XAQU', -6000, 6000, 72, 4000, 150)),
    [{ type: 'inverted', text: 'Vola rovescio per 15 s a 4000 ft (±500 ft)', duration: 15, altFt: 4000, toleranceFt: 500, minAglFt: 1500 }, hold('Raddrizzati e mantieni 4000 ft (±400 ft) per 10 s', 4000, 400, 10)]),
  mission('acro-programma', 'Programma acrobatico', 'Tonneau, looping, rovescio e virata a 5 g', 'aerobatic', 5, '5–8 min',
    'Il programma di gara dell’Allodola: un tonneau completo, un looping, 8 secondi in volo rovescio e una virata stretta tenendo almeno 5 g per 3 secondi. Gli elementi vanno eseguiti in quest’ordine, sempre sopra 1500 ft dal suolo.\n\nTra una figura e l’altra recupera quota e velocità: l’energia è tutto. Il programma termina in volo livellato a 4500 ft.',
    setup('aerobatic', air('XAQU', -6000, 6000, 72, 4500, 160)),
    [roll(1500), loop(1500), { type: 'inverted', text: 'Vola rovescio per 8 s sopra 1500 ft AGL', duration: 8, minAglFt: 1500 },
      { type: 'gload', text: 'Tira almeno 5 g per 3 s', minG: 5, duration: 3, minAglFt: 1500 }, hold('Livella a 4500 ft (±600 ft) per 8 s', 4500, 600, 8)]),
  mission('acro-lago', 'Pista corta al Lago', 'Atterraggio a tre punti su 900 m', 'aerobatic', 3, '3–5 min',
    'Sei sul finale 22 di Lago Azzurro, una pista di soli 900 m. L’Allodola ha il ruotino di coda: in finale tieni 75–80 kt, poi richiama dolcemente fino all’assetto a tre punti e lascia che l’aereo si posi.\n\nAl suolo tieni l’asse con il timone: con il muso alto la visibilità in avanti è scarsa. Tocca entro i primi 300 m e fermati.',
    setup('aerobatic', final('XLGO', '22', 3, { speedKt: 80 })), [land('XLGO', '22', { maxAlong: 300 }), stop]),

  // ---- Gabbiano BT-44 (twin) ----
  mission('bimotore-avaria', 'Avaria al decollo', 'Un motore si spegne dopo il distacco', 'twin', 5, '6–10 min',
    'Decolla dalla pista 07 di Aquila con il Gabbiano. Poco dopo il distacco il motore sinistro si arresta: l’aereo imbarda e rolla verso il motore in avaria. Contrasta con il pedale destro («piede morto, motore morto»), tieni le ali quasi livellate e mantieni 85–100 kt.\n\nNon scendere sotto la VMC di 56 kt. Fai un circuito con un motore solo e atterra sulla pista 25.',
    setup('twin', start(), { failures: [{ system: 'engine1', atAltitudeFt: 1000 }] }),
    [climb(400), { type: 'failure', text: 'Controlla l’avaria mantenendo 80–105 kt per 8 s', system: 'engine1', minSpeed: 80, maxSpeed: 105, duration: 8 }, land('XAQU', '25'), stop]),
  mission('bimotore-borgo', 'VOR e ILS a Borgo', 'Navigazione strumentale con il bimotore', 'twin', 3, '10–14 min',
    'Sei in volo a 4000 ft vicino ad Aquila. Sintonizza NAV1 su BRG 115.20 e raggiungi il VOR di Borgo a 4000 ft (±500 ft).\n\nDal VOR prosegui per l’ILS della pista 33 di Borgo (111.10 MHz, rotta 332°): sintonizza la nuova frequenza, intercetta il localizzatore, abbassa carrello e flap e atterra. La pista è lunga 1900 m.',
    setup('twin', air('XAQU', 3000, 4000, 45, 4000, 140)),
    [{ ...point('Raggiungi BRG 115.20 a 4000 ft', NAVAIDS.find((v) => v.id === 'BRG').n, NAVAIDS.find((v) => v.id === 'BRG').e, 4000, 1500), frequency: 115.2, toleranceFt: 500 }, land('XBRG', '33'), stop]),

  // ---- Condor CJ-5 (business jet) ----
  mission('bizjet-borgo', 'Executive per Borgo', 'Un jet sulla pista corta di valle', 'bizjet', 4, '10–14 min',
    'Porta i passeggeri del Condor da Aquila a Borgo Valle. Decolla dalla 07, sali ad almeno 3000 ft dal suolo e dirigiti al fisso di avvicinamento a 6 NM dalla pista 33 di Borgo, a 4000 ft.\n\nDal fisso segui l’ILS 111.10 (rotta 332°). La pista di Borgo è lunga solo 1900 m: flap 35, Vref 112 kt, tocca entro 600 m dalla soglia e frena con decisione.',
    setup('bizjet', start()), [climb(3000), point('Fisso di avvicinamento di Borgo a 4000 ft', borgoIf.n, borgoIf.e, 4000, 1800), land('XBRG', '33', { maxAlong: 600 }), stop]),
  mission('bizjet-quota', 'Sopra il meteo', 'Salita a 37.000 ft e crociera a Mach 0,72', 'bizjet', 3, '8–12 min',
    'Il Condor è in salita a 10.000 ft. Sali fino a 37.000 ft entro 12 minuti: usa l’autopilota in modalità VS o pilota a mano tenendo 250 kt e poi Mach 0,65.\n\nIn quota accelera ad almeno Mach 0,72 e mantienilo per 20 secondi sopra 36.000 ft.',
    setup('bizjet', air('XAQU', 6000, 6000, 72, 10000, 250)),
    [{ type: 'climb', text: 'Sali ad almeno 37.000 ft', altFt: 37000, within: 720 }, { type: 'speed', text: 'Crociera a Mach 0,72 sopra 36.000 ft per 20 s', minMach: 0.72, minAltFt: 36000, duration: 20 }]),

  // ---- AX-320 Aquila ----
  mission('linea-serena', 'Isola Serena', 'Un aereo di linea su 1600 m di pista', 'airliner', 5, '5–8 min',
    'L’AX-320 è sul finale della pista 30 dell’Isola Serena, a 7 NM. Non c’è ILS: vola a vista con il sentiero di 3°, Vapp 137 kt, configurazione FULL.\n\nLa pista è lunga solo 1600 m e finisce in mare. Tocca entro i primi 450 m, usa inversori e autobrake e fermati prima della fine.',
    setup('airliner', final('XSRN', '30', 7)), [point('Sentiero a 6 NM: 2000 ft', serenaIf.n, serenaIf.e, 2000, 1500), land('XSRN', '30', { maxAlong: 450 }), stop]),
  mission('linea-costa-aquila', 'Ritorno ad Aquila', 'Da Costa Verde all’ILS 25', 'airliner', 3, '15–20 min',
    'Decolla dalla pista 18 di Costa Verde e sali ad almeno 3000 ft dal suolo. Raggiungi il fisso a 10 NM dalla pista 25 di Aquila a 4000 ft, a est dell’aeroporto.\n\nDal fisso segui l’ILS 109.50 (rotta 252°) con autopilota e autothrottle o a mano. Atterra e fermati.',
    setup('airliner', start('runway', 'XCST', '18'), { route: [{ id: 'AQ25-IF', n: aquilaIf25.n, e: aquilaIf25.e }, { id: 'XAQU', n: 0, e: 0 }] }),
    [climb(3000), point('Fisso ILS 25 di Aquila a 4000 ft', aquilaIf25.n, aquilaIf25.e, 4000, 2200), land('XAQU', '25'), stop]),

  // ---- Falco T-172 ----
  mission('falco-touch-go', 'Touch and go', 'Due atterraggi di fila', 'trainer', 3, '8–12 min',
    'Sei sul finale 07 di Aquila. Atterra, poi senza fermarti riporta i flap a 10°, dai tutta manetta e decolla di nuovo («touch and go»).\n\nSali a 700 ft dal suolo, fai il circuito a destra passando per i tre punti e atterra una seconda volta, questa volta fermandoti.',
    setup('trainer', final('XAQU', '07', 3)),
    [land('XAQU', '07', { maxAlong: 1400 }), climb(700), ...pattern.map((p, i) => point(['Ingresso sottovento', 'Fine sottovento', 'Virata in finale'][i], p.n, p.e, 1500, 750)), land(), stop]),
  mission('falco-lago', 'Gita al Lago Azzurro', 'Navigazione a vista e pista corta', 'trainer', 2, '12–16 min',
    'Decolla dalla 07 di Aquila e vola verso est fino al paese di San Rocco, a 2500 ft. Da lì prosegui verso il Lago Azzurro: l’aeroporto è a sud-ovest del lago.\n\nLa pista 22 è lunga 900 m: entra in finale con flap 30° e 62 kt, atterra e fermati.',
    setup('trainer', start()), [climb(500), point('Sorvola San Rocco a 2500 ft', -3000, 15000, 2500, 900), land('XLGO', '22'), stop]),

  // ---- Freccia JT-9 ----
  mission('jet-looping', 'Looping con i fumogeni', 'Disegna un cerchio nel cielo', 'jet', 3, '3–5 min',
    'Il Freccia JT-9 è a 5000 ft con 300 kt. Accendi i fumogeni (Ctrl+Maiusc+S) e tira: 4 g costanti disegnano un looping rotondo. In cima rilascia un po’ di trazione per non perdere troppa velocità.\n\nResta sopra 2000 ft dal suolo, poi esegui un tonneau e livella a 5000 ft.',
    setup('jet', air('XAQU', -4000, 4000, 72, 5000, 300)), [loop(2000), roll(2000), hold('Livella a 5000 ft (±800 ft) per 8 s', 5000, 800, 8)]),
  mission('jet-montecervo', 'Jet in montagna', 'Gli 800 m di Montecervo con un jet', 'jet', 5, '4–6 min',
    'Sei sul finale 02 di Montecervo, 3839 ft di elevazione, con il Freccia. In quota la velocità vera è più alta di quella indicata: vola a 115 kt indicati e mantieni il sentiero.\n\nLa pista è lunga 800 m: tocca entro i primi 250 m, aerofreno fuori e freni a fondo.',
    setup('jet', final('XMNT', '02', 4)), [land('XMNT', '02', { maxAlong: 250 }), stop]),

  // ---- Picchio T-21 (turboprop trainer) ----
  mission('tp-salita', 'Salita a tempo', 'Da terra a 10.000 ft in 5 minuti', 'turboprop', 3, '4–6 min',
    'Sei allineato sulla 07 di Aquila con il Picchio T-21. Rilascia i freni, dai tutta potenza e decolla a 85 kt; retrai carrello e flap.\n\nSali a 170 kt, l’assetto migliore per il rateo: devi raggiungere 10.000 ft entro 5 minuti dall’inizio della prova.',
    setup('turboprop', start()), [{ type: 'climb', text: 'Raggiungi 10.000 ft in meno di 5 minuti', altFt: 10000, within: 300 }]),
  mission('tp-bassa-quota', 'Navigazione a bassa quota', 'Cinque porte sotto 1000 ft', 'turboprop', 4, '5–8 min',
    'Volo tattico a bassa quota verso il Lago Azzurro: attraversa le cinque porte in ordine restando sotto 1000 ft dal suolo. Le porte sono a circa 500 ft dal terreno e seguono le colline.\n\nTieni 220–250 kt, guarda il terreno davanti a te e usa la mappa (M). Dopo l’ultima porta sali a 3000 ft.',
    setup('turboprop', air('XAQU', 1500, 1500, 100, 1000, 230)),
    [...lowLevel([[-1000, 6000, 'Porta 1'], [-2500, 10500, 'Porta 2'], [-3000, 15000, 'Porta 3 – San Rocco'], [-6000, 19000, 'Porta 4'], [-8500, 23500, 'Porta 5 – Lago']], 500, 1000),
      { type: 'climb', text: 'Sali ad almeno 3000 ft', altFt: 3000 }]),
  mission('tp-acrobazia', 'Acrobazia con l’elica', 'Looping e tonneau con 1600 shp', 'turboprop', 3, '3–5 min',
    'Il Picchio è a 6000 ft con 250 kt. Esegui un looping tenendo 4 g, poi un tonneau completo e livella. La coppia dell’elica è forte: in salita verticale serve un po’ di pedale.\n\nResta sopra 2000 ft dal suolo.',
    setup('turboprop', air('XAQU', -4000, 4000, 72, 6000, 250)), [loop(2000), roll(2000), hold('Livella a 6000 ft (±800 ft) per 8 s', 6000, 800, 8)]),

  // ---- Vespa V-51 (warbird) ----
  mission('vespa-decollo', 'Decollo con il ruotino', 'Domare la coppia del V-12', 'warbird', 3, '3–5 min',
    'Il Vespa V-51 è allineato sulla 07. Il muso alto copre la pista: guarda lungo i lati. Porta la manetta in avanti gradualmente e anticipa con il pedale destro la deriva a sinistra dovuta alla coppia e al flusso dell’elica.\n\nA 100 kt circa l’aereo si stacca. Sali a 1500 ft dal suolo e passa sul punto di uscita, 5 km davanti alla pista, a 2500 ft.',
    setup('warbird', start()), [climb(1500), point('Punto di uscita a 2500 ft', along(5500).n, along(5500).e, 2500, 900)]),
  mission('vespa-intercetta', 'Scorta e intercettazione', 'Raggiungi il quadrimotore', 'warbird', 3, '4–7 min',
    'Un quadrimotore Bisonte vola a 9000 ft verso ovest a 200 kt, alcuni chilometri davanti a te. Spingi il Vespa, sali alla sua quota e portati in coda entro 400 m.\n\nRimani in posizione per 8 secondi. L’indicazione in alto mostra distanza e direzione del bersaglio; sulla mappa (M) è il rombo giallo.',
    setup('warbird', air('XAQU', 2000, 9000, 260, 8000, 280)),
    [{ type: 'intercept', text: 'Portati in coda al Bisonte entro 400 m per 8 s', target: { n: 3500, e: 1500, altFt: 9000, heading: 260, speedKt: 200, model: 'transport' }, range: 400, behind: true, duration: 8 }]),
  mission('vespa-atterraggio', 'Atterraggio a tre punti', 'Il V-51 sulla pista 25', 'warbird', 4, '4–6 min',
    'Sei sul finale 25 di Aquila con il Vespa: carrello giù, flap pieni, 115 kt. Riduci la potenza sopra la soglia e richiama fino all’assetto a tre punti.\n\nAl contatto tieni la cloche indietro e l’asse con il timone: con il ruotino di coda l’aereo tende a girarsi. Tocca entro i primi 900 m e fermati.',
    setup('warbird', final('XAQU', '25', 4)), [land('XAQU', '25', { maxAlong: 900 }), stop]),

  // ---- Folgore FX-16 (fighter) ----
  mission('folgore-supersonico', 'Muro del suono', 'Oltre Mach 1,4 in quota', 'fighter', 2, '2–4 min',
    'Il Folgore è a 30.000 ft. Porta la manetta oltre il 90% per accendere il postbruciatore (la fiamma diventa visibile dall’esterno) e tieni il muso leggermente sotto l’orizzonte per accelerare.\n\nSupera Mach 1,4 restando sopra 25.000 ft. Attenzione al carburante: con il postbruciatore il consumo si quadruplica.',
    setup('fighter', air('XAQU', 0, 0, 72, 30000, 330)), [{ type: 'speed', text: 'Supera Mach 1,4 sopra 25.000 ft', minMach: 1.4, minAltFt: 25000, duration: 2 }]),
  mission('folgore-scramble', 'Decollo su allarme', 'A 20.000 ft in due minuti e mezzo', 'fighter', 3, '3–4 min',
    'Allarme! Il Folgore è sulla 07 di Aquila. Postbruciatore, rotazione a 150 kt, carrello su e salita ripida: devi raggiungere 20.000 ft entro due minuti e mezzo.\n\nPoi livella e accelera ad almeno 450 kt indicati per 5 secondi.',
    setup('fighter', start()), [{ type: 'climb', text: 'Raggiungi 20.000 ft in 150 s', altFt: 20000, within: 150 }, { type: 'speed', text: 'Accelera ad almeno 450 kt indicati per 5 s', minKt: 450, minAltFt: 15000, duration: 5 }]),
  mission('folgore-intercetta', 'Intercettazione', 'Un traffico sconosciuto a 25.000 ft', 'fighter', 4, '4–7 min',
    'Un jet executive che non risponde alla radio vola verso nord a 25.000 ft e 380 kt. Sei a 20.000 ft, a sud del traffico. Accelera, sali e portati in coda entro 600 m.\n\nMantieni la posizione per 6 secondi: devi riuscirci entro 6 minuti. Distanza e direzione del bersaglio sono indicate in alto.',
    setup('fighter', air('XAQU', -8000, 0, 10, 20000, 380)),
    [{ type: 'intercept', text: 'Portati in coda al bersaglio entro 600 m per 6 s', target: { n: 12000, e: 4000, altFt: 25000, heading: 10, speedKt: 380, model: 'bizjet' }, range: 600, behind: true, duration: 6, within: 360 }]),
  mission('folgore-virata', 'Virata a 7 g', 'La forza dei comandi fly-by-wire', 'fighter', 3, '2–4 min',
    'Il fly-by-wire del Folgore limita il fattore di carico a 9 g e l’incidenza a 25°: puoi tirare tutta la cloche senza rischiare lo stallo. Inclina a 80° e tira fino a tenere almeno 7 g per 4 secondi sopra 5000 ft dal suolo.\n\nSotto carico la velocità cala in fretta: dai postbruciatore prima di tirare.',
    setup('fighter', air('XAQU', 0, 6000, 72, 15000, 450)), [{ type: 'gload', text: 'Tieni almeno 7 g per 4 s', minG: 7, duration: 4, minAglFt: 5000 }, hold('Livella a 15.000 ft (±2000 ft) per 8 s', 15000, 2000, 8)]),
  mission('folgore-atterraggio', 'Rientro alla base', 'Avvicinamento di un caccia', 'fighter', 3, '4–6 min',
    'Sei sul finale 25 di Aquila a 6 NM con carrello e flap estesi. I caccia atterrano veloci e con il muso alto: tieni 150 kt e circa 11° di assetto, regolando la discesa con la manetta.\n\nTocca entro i primi 900 m, apri l’aerofreno (/) e frena fino a fermarti.',
    setup('fighter', final('XAQU', '25', 6)), [land('XAQU', '25', { maxAlong: 900 }), stop]),

  // ---- Grifone EF-2 ----
  mission('grifone-supercrociera', 'Supercrociera', 'Supersonico senza postbruciatore', 'eurofighter', 4, '4–7 min',
    'Il Grifone è a 35.000 ft. Accendi il postbruciatore e supera Mach 1,2. Poi riporta la manetta sotto il 90% (spinta massima a secco): il Grifone è capace di «supercrociera».\n\nMantieni almeno Mach 1,15 per 30 secondi senza postbruciatore, sopra 30.000 ft.',
    setup('eurofighter', air('XAQU', 0, 0, 72, 35000, 330)),
    [{ type: 'speed', text: 'Supera Mach 1,2', minMach: 1.2, minAltFt: 30000, duration: 1 }, { type: 'speed', text: 'Mach 1,15 per 30 s senza postbruciatore', minMach: 1.15, minAltFt: 30000, noAfterburner: true, duration: 30 }]),
  mission('grifone-notte', 'Intercettazione notturna', 'Un trasporto da identificare nel buio', 'eurofighter', 4, '4–7 min',
    'È notte. Un quadrimotore vola a 15.000 ft verso est a 250 kt, circa 10 km davanti a te. Le sue luci sono l’unico riferimento: usa la mappa (M) e le indicazioni in alto.\n\nPortati in coda entro 500 m e restaci per 6 secondi. Riduci la velocità per non superarlo.',
    setup('eurofighter', air('XAQU', -3000, -6000, 72, 12000, 330), { time: 22 }),
    [{ type: 'intercept', text: 'Portati in coda al trasporto entro 500 m per 6 s', target: { n: 0, e: 4000, altFt: 15000, heading: 72, speedKt: 250, model: 'transport' }, range: 500, behind: true, duration: 6 }]),

  // ---- Bisonte C-30 (transport) ----
  mission('bisonte-lancio', 'Lancio di rifornimenti', 'Sorvola la zona di lancio a 1000 ft', 'transport', 3, '6–9 min',
    'Il Bisonte deve lanciare rifornimenti su un campo vicino a Valfonda. Passa sul punto iniziale a 2000 ft, poi scendi a circa 1000 ft dal suolo e rallenta a 130–150 kt con flap 50%.\n\nAttraversa la zona di lancio restando tra 700 e 1300 ft dal suolo e dentro la finestra di velocità. Poi riprendi quota fino a 3000 ft.',
    setup('transport', air('XAQU', 20000, -30000, 120, 3000, 200)),
    [point('Punto iniziale a 2000 ft', bisonteIp.n, bisonteIp.e, 2000, 1200),
      { type: 'waypoint', text: 'Zona di lancio: 700–1300 ft AGL, 130–150 kt', n: dropZone.n, e: dropZone.e, alt: getTerrain().height(dropZone.n, dropZone.e) + 1000 * FT, toleranceFt: 300, radius: 600, horizontal: true, minKt: 128, maxKt: 152, ring: true, heading: 110 },
      { type: 'climb', text: 'Riprendi quota fino a 3000 ft', altFt: 3000 }]),
  mission('bisonte-pista-corta', 'Pista corta', 'Un quadrimotore su 900 m', 'transport', 5, '4–6 min',
    'Il Bisonte è fatto per le piste corte. Sei sul finale 22 di Lago Azzurro, 900 m di pista: flap 100%, 118 kt, sentiero ripido e potenza fino al contatto.\n\nTocca entro i primi 250 m, poi inversione del passo delle eliche (R) e freni a fondo. Fermati prima della fine della pista.',
    setup('transport', final('XLGO', '22', 4, { speedKt: 120 }), { fuel: 0.3 }), [land('XLGO', '22', { maxAlong: 250 }), stop]),
  mission('bisonte-isola', 'Ponte aereo per l’isola', 'Da Costa Verde all’Isola Serena', 'transport', 3, '10–14 min',
    'Rifornimenti per l’Isola Serena. Sei in volo a 6000 ft a sud di Costa Verde, sopra il mare. Dirigiti a sud verso l’isola e passa sul fisso a 7 NM dalla pista 30 a 2500 ft.\n\nAtterra sulla 30 (1600 m) e fermati. Il Bisonte è lento: pianifica la discesa per tempo.',
    setup('transport', air('XCST', 18000, -30000, 185, 6000, 220)),
    [point('Fisso di avvicinamento della 30 a 2500 ft', serenaIf.n, serenaIf.e, 2500, 2000), land('XSRN', '30'), stop]),
];

export const MISSIONS = [...CLASSIC, ...FLEET_MISSIONS];
