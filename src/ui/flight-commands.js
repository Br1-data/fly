// Instructions for the commands of the flight screen: what every on-screen button and
// instrument does, with its key. Shared by the button tooltips and the in-flight
// "Comandi" panel (F8), which also lists the commands of the current mission.

/** Top bar buttons. */
export const TOP_BUTTONS = {
  menu: { label: '☰', keys: 'Esc', text: 'Menu e pausa: riprendi, riavvia, impostazioni, comandi ed esci dal volo.' },
  nav: { label: 'NAV', keys: 'O', text: 'Computer di navigazione: calcola le manovre (circolarizzare, rendezvous, trasferimenti, rientro), crea il nodo e con «Esegui» l’autopilota accende al momento giusto.' },
  map: { label: 'MAPPA', keys: 'M', text: 'Mappa orbitale: mostra l’orbita attuale, apoasse (Ap) e periasse (Pe), il bersaglio e i pianeti. Trascina per ruotarla, rotella per lo zoom.' },
  view: { label: 'VISTA', keys: 'C', text: 'Cambia vista: esterna, cockpit e le altre telecamere del veicolo. Maiusc+C torna indietro.' },
  keys: { label: 'COMANDI', keys: 'F8', text: 'Apre e chiude questa guida ai comandi senza fermare il volo.' },
  help: { label: '?', keys: 'F12', text: 'Aiuto completo: guida rapida, elenco di tutti i tasti e glossario.' },
};

/** SAS / RCS toggles and the SAS modes, by id (see SAS_MODES in sim/assist.js). */
export const SAS_HELP = {
  sas: { label: 'SAS', keys: 'T', text: 'Accende o spegne il sistema di stabilizzazione: smorza le rotazioni e tiene l’assetto scelto con i pulsanti accanto. Verde = acceso.' },
  rcs: { label: 'RCS', keys: 'R', text: 'Accende o spegne i propulsori di manovra a monopropellente: servono per traslare (I/K, J/L, H/N) e aiutano il SAS a ruotare. Verde = acceso.' },
  stab: { keys: '1', text: 'Stabilizza: ferma la rotazione e mantiene l’assetto attuale.' },
  prograde: { keys: '2', text: 'Prograde (simbolo giallo): punta nella direzione del moto. Accendere qui accelera e alza il lato opposto dell’orbita.' },
  retrograde: { keys: '3', text: 'Retrograde: punta contro il moto. Per frenare, abbassare l’orbita e rientrare con lo scudo termico avanti.' },
  normal: { keys: '4', text: 'Normale (viola): perpendicolare al piano dell’orbita. Accendere qui cambia l’inclinazione.' },
  antinormal: { keys: '5', text: 'Antinormale: opposto al normale, cambia l’inclinazione nell’altro verso.' },
  radialOut: { keys: '6', text: 'Radiale esterno (azzurro): punta lontano dal pianeta. Ruota l’orbita attorno al veicolo.' },
  radialIn: { keys: '7', text: 'Radiale interno: punta verso il pianeta.' },
  target: { keys: '8', text: 'Verso il bersaglio (rosa): punta l’oggetto selezionato con Tab.' },
  antiTarget: { keys: '9', text: 'Opposto al bersaglio: per allontanarti o frenare con il motore in avvicinamento.' },
  maneuver: { keys: '0', text: 'Vettore di manovra (blu): punta il nodo creato con il computer di navigazione, pronto per l’accensione.' },
  port: { keys: 'Maiusc+8', text: 'Allinea alla porta: mette il veicolo in asse con la porta di attracco del bersaglio (Maiusc+T cambia porta).' },
  up: { keys: 'Maiusc+6', text: 'Verticale locale: motore verso il suolo, per atterrare e decollare.' },
};

/** Instruments of the flight screen. */
export const INSTRUMENTS = [
  { label: 'Sfera di assetto', text: 'Blu il cielo locale, marrone il suolo; la «V» arancione è il muso. Sotto c’è il riferimento della velocità: ORBITA, SUPERFICIE o BERSAGLIO (entro 50 km da un oggetto).' },
  { label: 'Pannello orbita (sinistra)', text: 'Quota, velocità, apoasse e periasse, periodo e inclinazione dell’orbita attuale.' },
  { label: 'Pannello bersaglio (destra)', text: 'Distanza e velocità relativa al bersaglio; vicino alla porta, il riquadro di attracco: croce = scostamento laterale, triangolo = errore di assetto.' },
  { label: 'Manetta e propellente', text: 'Spinta del motore principale, propellente dello stadio e monopropellente RCS. Δv è la variazione di velocità ancora disponibile.' },
  { label: 'Azione (Spazio)', text: 'Indica cosa fa il tasto Spazio in questo momento: separare lo stadio, aprire il paracadute o sganciarsi.' },
  { label: 'Strumenti (U)', text: 'U alterna strumenti completi, essenziali e nascosti; Maiusc+U nasconde i simboli sulla vista 3D.' },
];

/** Piloting keys, with the touch equivalent. */
export const PILOTING = [
  { keys: 'W/S · A/D · Q/E', touch: 'Leva ROTAZIONE · ⟲ ⟳', text: 'Ruotano il veicolo (beccheggio, imbardata, rollio). Ruotare non cambia la traiettoria.' },
  { keys: 'I/K · J/L · H/N', touch: 'Leva RCS · AVANTI/INDIETRO', text: 'Traslano con l’RCS: su/giù, sinistra/destra, avanti/indietro. Ogni impulso dura finché non lo annulli.' },
  { keys: 'F (tieni premuto)', touch: 'STOP (tieni premuto)', text: 'Annulla la velocità relativa al bersaglio con l’RCS.' },
  { keys: 'Z · X · = / -', touch: 'Cursore MANETTA', text: 'Manetta al massimo, motore spento, più o meno spinta.' },
  { keys: 'Spazio', touch: 'AZIONE', text: 'Separa lo stadio, apre il paracadute o sgancia il veicolo.' },
  { keys: 'Tab · Maiusc+Tab', touch: '', text: 'Bersaglio successivo o precedente.' },
  { keys: '. · , · /', touch: '⏩ · ⏪', text: 'Accelera o rallenta il tempo, torna al tempo reale. Oltre ×4 il motore non si accende.' },
  { keys: 'P', touch: '☰', text: 'Pausa.' },
];

/** Short tooltip text: "Description (key)". */
export const tip = (entry) => (entry ? `${entry.text}${entry.keys ? ` · Tasto: ${entry.keys}` : ''}` : '');
