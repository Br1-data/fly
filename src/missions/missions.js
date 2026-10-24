// Declarative lessons use the same simulation state and runway geometry as free flight.
import { WEATHER_PRESETS, cloneWeather } from '../sim/atmosphere.js';
import { findRunwayEnd, NAVAIDS } from '../world/world-data.js';
import { FT } from '../core/units.js';

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

export const MISSIONS = [
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
