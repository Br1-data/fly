// Shared, aircraft-aware help for the physical cockpit controls.
// Keep this module independent of the DOM so help screens and tests can use it.
import { AIRCRAFT_LIST } from '../sim/aircraft/index.js';

export function getCockpitGuide(def = {}) {
  if (def === null) {
    const unique = new Map();
    for (const aircraft of AIRCRAFT_LIST) {
      for (const entry of getCockpitGuide(aircraft)) unique.set(`${entry.group}:${entry.label}`, entry);
    }
    return [...unique.values()];
  }
  const controls = def.controls || {};
  const engines = def.engines || [];
  const piston = def.panel === 'ga' || engines.some((engine) => engine.type === 'piston');
  const entries = [];
  const add = (group, label, description) => entries.push({ group, label, description });
  const left = 'Sinistra · impianti';
  const lights = 'Sinistra · illuminazione';
  const engine = 'Sinistra · motore e carburante';
  const pedestal = 'Centro · comandi di volo';
  const ap = 'Centro · autopilota';
  const right = 'Destra · radio e navigazione';
  const instruments = 'Destra · strumenti';

  add(left, 'Master generale', 'Inserisce o disinserisce insieme batteria e generatore.');
  add(left, 'Batteria', 'Alimenta la rete elettrica anche a motore spento. Il valore in volt indica lo stato della rete.');
  add(left, 'Generatore', 'Collega alternatore o generatori alla rete per alimentare gli impianti e ricaricare la batteria.');
  add(left, 'Avionica', 'Alimenta radio, navigazione e schermi elettronici.');
  add(left, 'Pompa carburante', 'Inserisce la pompa elettrica del carburante.');
  add(left, 'Riscaldamento Pitot', 'Previene o scioglie il ghiaccio sul tubo di Pitot per mantenere attendibile la velocità indicata.');
  add(left, 'Antighiaccio', 'Inserisce la protezione contro la formazione di ghiaccio sulla cellula.');

  add(lights, 'Tutte le luci', 'Accende o spegne insieme navigazione, anticollisione, strobo, atterraggio, rullaggio, pannello e logo.');
  for (const [label, description] of [
    ['Navigazione', 'Luci rosse, verdi e di coda per rendere riconoscibile il velivolo.'],
    ['Anticollisione', 'Faro lampeggiante di segnalazione, normalmente acceso prima dell’avviamento.'],
    ['Strobo', 'Luci lampeggianti ad alta intensità per la visibilità in volo.'],
    ['Atterraggio', 'Illuminazione della pista durante decollo e atterraggio.'],
    ['Rullaggio', 'Illuminazione davanti al velivolo durante gli spostamenti a terra.'],
    ['Pannello', 'Illuminazione degli strumenti e delle consolle per il volo notturno.'],
    ['Logo', 'Interruttore delle luci del logo sulla coda.'],
  ]) add(lights, label, description);

  add(engine, 'Avviamento automatico', 'Esegue in sequenza le operazioni previste per avviare il velivolo da spento; lascia completare la procedura.');
  add(engine, 'Spegnimento motori', 'Porta la potenza al minimo e interrompe l’alimentazione dei motori.');
  if (piston) {
    add(engine, 'Magneti OFF / R / L / BOTH', 'Seleziona il circuito di accensione del motore a pistoni; BOTH è la posizione normale di funzionamento.');
    add(engine, 'Avviatore a ritorno', 'Tieni premuto START per azionare il motorino di avviamento; al rilascio i magneti tornano su BOTH.');
    add(engine, 'Aria calda carburatore', 'Riscalda l’aria aspirata per contrastare il ghiaccio al carburatore, con una possibile riduzione della potenza.');
    add(engine, 'Selettore carburante', 'Sceglie serbatoio sinistro, entrambi, destro oppure OFF; OFF interrompe il flusso al motore.');
    add(engine, 'Miscela', 'Regola il rapporto carburante/aria: ricca per l’avviamento, impoverita quando richiesto in quota, zero per il taglio carburante.');
  } else {
    for (let i = 0; i < Math.max(engines.length, 1); i++) {
      add(engine, `Master motore ${i + 1}`, `Apre o chiude l’alimentazione del motore ${i + 1}; con l’avviamento disponibile permette l’accensione.`);
    }
    if (def.systems?.apu) {
      add(engine, 'APU master', 'Avvia l’unità ausiliaria di potenza; attendi che raggiunga il regime prima di richiedere aria di avviamento.');
      add(engine, 'APU bleed', 'Abilita l’aria compressa dell’APU per avviare i motori.');
      add(engine, 'Modalità motore IGN / NORM', 'IGN abilita l’avviamento dei motori con il rispettivo master inserito; riporta su NORM a procedura conclusa.');
    } else {
      add(engine, 'Avviatore turbina', 'Aziona l’avviatore elettrico con batteria inserita e master motore aperto.');
    }
  }

  add(pedestal, engines.length > 1 ? 'Manetta motore 1' : 'Manetta', 'Regola la potenza dal minimo al massimo. L’automanetta, quando inserita, può comandare la potenza al suo posto.');
  if (engines.length > 1) {
    add(pedestal, 'Manetta motore 2', 'Regola separatamente la potenza del secondo motore.');
    add(pedestal, 'Sincronizza manette', 'Riporta il secondo motore alla potenza della manetta principale.');
  }
  add(pedestal, 'Beccheggio', 'Comanda l’equilibratore: tira per cabrare, spingi per picchiare. Al rilascio il comando torna al centro.');
  add(pedestal, 'Rollio', 'Comanda gli alettoni per inclinare il velivolo a sinistra o a destra. Al rilascio il comando torna al centro.');
  add(pedestal, 'Pedaliera', 'Comanda il timone direzionale e, a terra, lo sterzo del ruotino. Al rilascio il comando torna al centro.');
  add(pedestal, 'Trim di beccheggio', 'Compensa lo sforzo longitudinale per mantenere l’assetto; positivo significa muso in alto. Sul liner in legge normale interviene anche l’autotrim.');
  add(pedestal, 'Trim di rollio', 'Compensa una tendenza persistente a inclinarsi; positivo significa ala destra in basso.');
  add(pedestal, 'Trim di imbardata', 'Compensa una tendenza persistente a imbardare; positivo significa muso a destra.');
  add(pedestal, 'Flap', 'Seleziona una delle posizioni previste per il velivolo. L’indicazione segue la leva, mentre le superfici impiegano tempo a muoversi.');
  add(pedestal, 'Freno di parcheggio', 'Il pulsante FRENO P mantiene frenate entrambe le ruote anche dopo il rilascio dei comandi.');
  add(pedestal, 'Freno sinistro', 'Applica progressivamente il freno della ruota sinistra; al rilascio torna a zero.');
  add(pedestal, 'Freno destro', 'Applica progressivamente il freno della ruota destra; al rilascio torna a zero.');
  add(pedestal, 'Freni insieme', 'Applica contemporaneamente entrambi i freni di servizio finché il comando resta premuto.');
  if (controls.retractableGear) add(pedestal, 'Carrello', 'Estende o ritrae il carrello. La retrazione è inibita a terra; le spie distinguono esteso, retratto e movimento.');
  if (controls.spoilers) {
    add(pedestal, 'Aerofreni', 'Regola l’estensione degli aerofreni o spoiler per aumentare la resistenza e ridurre la portanza.');
    add(pedestal, 'Armamento spoiler', 'Arma gli spoiler per l’estensione automatica all’atterraggio; il movimento manuale li disarma.');
  }
  if (controls.autobrake) add(pedestal, 'Autobrake OFF / LO / MED / MAX', 'Seleziona il livello della frenata automatica di atterraggio.');
  if (controls.reversers) add(pedestal, 'Inversori di spinta', 'Richiede l’inversione della spinta dei motori per rallentare dopo l’atterraggio.');
  if (controls.smoke) add(pedestal, 'Fumogeni', 'Attiva o disattiva i fumogeni del jet acrobatico.');

  add(ap, 'Autopilota AP', 'Inserisce o disinserisce il pilota automatico; gli indicatori mostrano i modi laterale e verticale attivi.');
  add(ap, 'Disconnessione AP', 'Disinserisce esplicitamente l’autopilota per riprendere il controllo manuale.');
  add(ap, 'Direttore di volo FD', 'Mostra i comandi di assetto calcolati dal sistema senza necessariamente inserire l’autopilota.');
  add(ap, 'Modo HDG', 'Segue la prua selezionata con la manopola HDG.');
  add(ap, 'Prua selezionata HDG', 'Pulsanti o rotella modificano la prua bersaglio in gradi.');
  add(ap, 'Sincronizza HDG', 'Copia la prua attuale nella prua selezionata.');
  add(ap, 'Modo NAV', 'Segue la sorgente NAV1 o GPS selezionata; può rimanere armato fino all’intercettazione.');
  add(ap, 'Sorgente NAV1 / GPS', 'Sceglie il ricevitore radio NAV1 oppure il piano di volo GPS come guida del modo NAV.');
  add(ap, 'Modo APR', 'Arma l’avvicinamento: intercetta localizzatore e sentiero di discesa ILS quando il segnale è disponibile.');
  add(ap, 'Modo ALT', 'Attiva il mantenimento della quota secondo il funzionamento dell’autopilota.');
  add(ap, 'Quota selezionata ALT', 'Regola la quota bersaglio in piedi per salita, discesa e cattura della quota.');
  add(ap, 'Modo V/S', 'Comanda la velocità verticale selezionata, espressa in piedi al minuto.');
  add(ap, 'Velocità verticale V/S', 'Valori positivi richiedono salita, negativi discesa. Adegua la potenza per mantenere una velocità sicura.');
  add(ap, 'Modo FLC', 'Regola il beccheggio per mantenere la velocità selezionata durante salita o discesa verso la quota bersaglio.');
  add(ap, 'Velocità selezionata SPD', 'Imposta la velocità in nodi usata da FLC e, quando disponibile, dall’automanetta.');
  if (def.autopilot?.autothrottle) add(ap, 'Automanetta A/THR', 'Inserisce o disinserisce il controllo automatico della potenza per mantenere la velocità selezionata.');

  for (const i of [1, 2]) {
    add(right, `Frequenza NAV${i}`, `Regola la frequenza standby del ricevitore NAV${i}; il display distingue frequenza attiva e in attesa.`);
    add(right, `Scambio NAV${i}`, `Scambia frequenza attiva e standby del ricevitore NAV${i}.`);
    add(right, `Corso OBS${i}`, `Seleziona il corso VOR del ricevitore NAV${i}; con ILS il corso del localizzatore è fisso.`);
  }
  add(right, 'Frequenza COM1', 'Regola la frequenza radio in attesa per comunicazioni e ascolto ATIS.');
  add(right, 'Scambio COM1', 'Attiva la frequenza in attesa; se corrisponde a un ATIS disponibile viene prodotto il bollettino.');
  add(right, 'Frequenza ADF', 'Regola la frequenza standby del radiogoniometro, in kHz, per ricevere i radiofari NDB.');
  add(right, 'Scambio ADF', 'Scambia frequenza attiva e standby del radiogoniometro.');
  add(right, 'Codice transponder', 'Imposta quattro cifre da 0 a 7 per il codice del transponder, per esempio 7000.');
  add(right, 'Modo transponder', 'Seleziona OFF, STBY oppure ALT; ALT include la quota nella trasmissione simulata.');
  add(right, 'GPS diretto', 'Sceglie un aeroporto del mondo simulato e lo imposta come destinazione diretta; seleziona GPS per seguirlo in modo NAV.');

  add(instruments, 'QNH', 'Regola la pressione dell’altimetro in hPa; cambia l’altitudine indicata senza spostare il velivolo.');
  add(instruments, 'Pressione standard STD', 'Imposta 1013,25 hPa come riferimento standard dell’altimetro.');
  add(instruments, 'Pressione locale', 'Imposta sull’altimetro il QNH del meteo corrente.');
  add(instruments, 'Correzione direzionale DG', 'Corregge manualmente la lettura del girodirezionale.');
  add(instruments, 'Sincronizza DG', 'Allinea il girodirezionale alla bussola magnetica.');
  add(instruments, 'Cronometro', 'Avvia o ferma il cronometro di bordo; la lettura indica il tempo misurato.');
  add(instruments, 'Azzera cronometro', 'Ferma il cronometro e lo riporta a zero.');

  add('Vista del cockpit', 'Consolle sinistra e destra', 'I pulsanti della cabina aprono o richiudono le consolle. Sugli schermi piccoli si usa una consolle alla volta e si scorre per raggiungere tutti i comandi.');
  add('Vista del cockpit', 'Dimensione pannello W', 'Alterna pannello completo, strumenti compatti e pannello nascosto per lasciare più visuale all’esterno.');
  if (def.panel === 'jet') add('Vista del cockpit', 'HUD', 'Mostra o nasconde la simbologia di volo trasparente del jet.');
  return entries;
}
