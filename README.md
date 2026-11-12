# 🚀 Cieli Aperti – Space Edition

Simulatore di volo spaziale con le leggi della fisica reali, nel **Sistema Solare vero e in scala reale**.
Applicazione desktop per **Windows** (Electron) che funziona anche in qualsiasi browser con WebGL2,
su smartphone, iPhone e iPad. Sette veicoli, diciassette missioni e un volo libero dalla Terra alla Luna
e a Marte.

## Caratteristiche

### Fisica
- **Dinamica newtoniana del corpo rigido a 6 gradi di libertà**: traslazione integrata con Runge-Kutta
  del quarto ordine, rotazione con le equazioni di Eulero e i momenti d’inerzia del veicolo, ricalcolati
  a ogni consumo di propellente e separazione.
  Motori con spinta e impulso specifico che variano con la pressione esterna, ugelli orientabili,
  propulsori RCS, ruote di reazione.
- **Equazione del razzo**: la massa cala con il propellente consumato; ogni stadio si separa e diventa
  un detrito che continua la sua orbita (o ricade).
- **Gravità a coniche raccordate** con le sfere d’influenza di Laplace: il veicolo passa dall’orbita
  terrestre a quella lunare, solare e marziana senza discontinuità. Propagazione kepleriana a variabile
  universale per orbite ellittiche, paraboliche e iperboliche.
- **Atmosfere**: Terra con la US Standard Atmosphere 1976, Marte e Venere con modelli esponenziali; l’aria
  ruota con il pianeta. Resistenza e portanza (spazioplano), pressione dinamica, onde d’urto, numero di Mach.
- **Rientro**: riscaldamento convettivo di Sutton-Graves, equilibrio radiativo dello scudo termico,
  sovraccarichi, paracadute che si strappano se aperti troppo veloci. Senza scudo il veicolo brucia.
- **Contatti**: gambe ammortizzate, carrello con attrito e freni, ammaraggio, terreno che ruota con il
  pianeta. Attracco con cattura morbida solo a contatto, sotto 0,5 m/s, entro 25 cm e 7°.
- **Accelerazione del tempo** fino a ×1.000.000 “sui binari” (orbita kepleriana esatta), con arresto
  automatico prima di un nodo di manovra, di un cambio di sfera d’influenza o dell’atmosfera.

### Sistema Solare reale
Sole, Mercurio, Venere, Terra, Luna, Marte con Phobos e Deimos, Giove, Saturno con gli anelli, Urano e
Nettuno. Posizioni dagli elementi orbitali medi J2000 del JPL, orientamenti e periodi di rotazione dai
modelli IAU, Luna in rotazione sincrona. La data di partenza si sceglie nel volo libero (2000–2050).

Superfici reali: la Terra con le immagini NASA Blue Marble e i rilievi NOAA ETOPO1, la Luna e Marte con
le mappe NASA e i rilievi dei grandi bacini e crateri, atmosfera con diffusione di Rayleigh e Mie,
nuvole, oceani, terreno a livelli di dettaglio (cubo-sfera a quadtree) fino ai pochi metri dal suolo.

Luoghi reali: **Centro Spaziale Luigi Broglio** (Malindi, Kenya, 3° sud), **spazioporto di
Taranto-Grottaglie** (pista 17), **Mare della Tranquillità** (accanto al sito dell’Apollo 11) e
**cratere Jezero** su Marte. La Stazione Aurora, la navetta Selene e il campo di detriti Kessler-7 sono
immaginari ma orbitano con la stessa fisica.

### Veicoli
Veicoli immaginari con masse, spinte e impulsi specifici di veicoli reali della stessa classe.

| Veicolo | Tipo | Prestazioni |
|---|---|---|
| **Colibrì MP-1** | modulo di manovra pilotato | Δv 560 m/s, assistenza al volo sulla velocità relativa |
| **Rondine CR-4** | capsula con modulo di servizio (classe Orion) | Δv 1.320 m/s, scudo termico, paracadute, porta di attracco |
| **Rondine con stadio TLI** | capsula con stadio criogenico | Δv 4.200 + 1.320 m/s: iniezione translunare e ritorno |
| **Grillo LM-3** | modulo lunare a due stadi (classe Apollo LM) | discesa 45 kN regolabile 10–100 %, salita 16 kN |
| **Albatro SP-1** | spazioplano a corpo portante (classe Dream Chaser) | rientro a 40° d’incidenza, planata fino alla pista |
| **Aquila V con Rondine** | lanciatore a due stadi (classe Falcon 9) | 528 t al decollo, Δv 10,8 km/s, autopilota di ascesa |
| **Ulisse NTR** | nave interplanetaria a propulsione nucleare termica | 3 motori da Isp 900 s, Δv 9.200 m/s |

### Strumenti e assistenza
- **Sfera di assetto** con i marcatori prograde, retrograde, normale, radiale, bersaglio e manovra.
- **SAS** con mantenimento dell’assetto e dei vettori orbitali, allineamento alla porta di attracco,
  controllo della velocità verticale per l’atterraggio, “stop” della velocità relativa.
- **Computer di navigazione**: circolarizzazione, Hohmann, deorbita, cambio di piano, rendezvous,
  trasferimento verso la Luna o un pianeta (Lambert e porkchop), ritorno, correzione di rotta; nodi di
  manovra modificabili, previsione dell’orbita risultante e del passaggio al periasse del corpo d’arrivo,
  accensione automatica.
- **Mappa orbitale** con le coniche, apoasse e periasse, sfere d’influenza e incontri.
- Indicatori di attracco: distanza, disallineamento, velocità di avvicinamento ed errore d’assetto.

### Missioni
Diciassette missioni in cinque categorie, con briefing, obiettivi in sequenza, punteggio e stelle:

- **Addestramento**: primi impulsi RCS, stabilizzazione, attracco alla porta di prua e a quella zenitale,
  slalom nel campo di detriti.
- **Orbita terrestre**: trasferimento di Hohmann, appuntamento con la Stazione Aurora.
- **Terra**: rientro e ammaraggio nell’Oceano Indiano, lancio da Malindi, atterraggio in planata a Grottaglie.
- **Luna**: allunaggio a Tranquillitatis, discesa motorizzata dall’orbita, decollo lunare, iniezione
  translunare, ritorno con rientro a 11 km/s.
- **Marte**: partenza nella finestra del 2033 con l’Ulisse, incontro con Phobos.

### Audio e voce
Motori, RCS, vento al rientro, impatti e separazioni sintetizzati in tempo reale; annunci vocali in
italiano dal controllo missione (sintesi vocale del browser, voce e velocità regolabili).

## Avvio dal codice sorgente

```bash
npm ci
npm start            # avvia l'app desktop (Electron)
npm run serve        # oppure: server locale, poi aprire http://localhost:8080 nel browser
npm test             # suite di test della fisica e delle missioni
npm run smoke        # prova integrata nel browser (richiede Chrome/Chromium)
npm run smoke:mobile # prova touch: smartphone, iPad, iPhone
```

`npm test` verifica tra l’altro le effemeridi (perielio e afelio della Terra, distanza della Luna,
giorno siderale), la propagazione kepleriana e il solutore di Lambert, l’equazione del razzo per ogni
veicolo, attracco, allunaggio, lancio fino all’orbita, rientro con ammaraggio e la distruzione senza
scudo termico, iniezione translunare (≈ 3,1 km/s) e trasferimento verso Marte, tutte le missioni e tutti
i punti di partenza. Se Chromium non è in un percorso standard: `CHROMIUM_PATH=/percorso/chrome npm run smoke`.

### Smartphone e tablet
Su schermi touch compaiono due levette (rotazione e traslazione RCS), la manetta e i pulsanti rapidi
(SAS, RCS, stop, azione, vista, mappa, navigazione, tempo). Ogni comando cattura il proprio dito, quindi
si usano insieme; trascinando sulla scena ci si guarda intorno. La qualità grafica si adatta al
dispositivo (iPad e iPhone recenti a 60 fps con antialiasing). L’app è installabile a schermo intero.

### Versione web
Pubblicata su **https://br1-data.github.io/fly/space/** (la versione aeronautica resta su
https://br1-data.github.io/fly/).

```bash
npm run build:web
SMOKE_ROOT=dist/web SMOKE_BASE_PATH=/fly/space/ npm run smoke
```
`dist/web/` contiene solo i file della versione browser, le mappe planetarie e la versione bloccata di
three.js: nessuna chiave API, CDN o server applicativo. I salvataggi restano nel browser e sono separati
da quelli della versione aeronautica.

Il repository ha un solo sito Pages, quindi il workflow **Publish GitHub Pages** del branch principale
costruisce e verifica entrambe le versioni a ogni pubblicazione. Un push su `claude/space-edition`
la riavvia da solo quando i test di **Build Windows** sono superati.

### Eseguibile per Windows
```bash
npm run dist:win     # installer NSIS + versione portable in release/
```
La GitHub Action `.github/workflows/build-windows.yml` esegue i test e crea il pacchetto a ogni push.

## Comandi principali

| Funzione | Tasti |
|---|---|
| Beccheggio · imbardata · rollio | W / S · A / D · Q / E (anche frecce) |
| Traslazione RCS avanti / indietro · destra / sinistra · su / giù | H / N · L / J · I / K |
| Manetta massima · spenta · regola | Z · X · + / − |
| Azione: separa lo stadio, paracadute, sgancio | Spazio |
| SAS · RCS · modi SAS | T · R · 1–0 |
| Stop della velocità relativa | tieni premuto F |
| Computer di navigazione · esegui la manovra | O · Invio |
| Mappa orbitale · bersaglio successivo | M · Tab |
| Accelera / rallenta il tempo · tempo reale | . / , · / |
| Viste · cockpit · esterna | C · F9 · F10 |
| Pausa · menu · aiuto | P · Esc · F12 |
| Guida ai comandi in volo (pulsante ⓘ COMANDI) | F8 |

L’elenco completo è nel gioco (menu **Comandi**) e in [`docs/CONTROLS.md`](docs/CONTROLS.md); gamepad e
joystick sono configurabili.

## Struttura del progetto

```
electron/        app desktop
src/core/        matematica, rumore procedurale, riconoscimento del dispositivo
src/sim/         Sistema Solare, terreni, orbite, veicoli, dinamica, assistenza, manovre, simulazione
src/render/      grafica three.js: pianeti a LOD, atmosfera, spazio, veicoli, stazioni, effetti
src/input/       tastiera, mouse, gamepad, joystick, controlli touch
src/audio/       suoni sintetizzati e voce
src/missions/    missioni, punteggi, progressi
src/ui/          menu, volo libero, strumenti di volo, aiuto e glossario
assets/planets/  mappe e rilievi di Terra, Luna, Marte e immagini dei pianeti
tools/           server locale, build web, prove nel browser, generazione dei dati planetari
tests/           test automatici
```

Dettagli tecnici in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Dati e licenza

Codice con licenza MIT. Posizioni dei pianeti: JPL “Keplerian Elements for Approximate Positions of the
Major Planets”; rotazioni: rapporto IAU WGCCRE. Terra: NASA Blue Marble Next Generation e NOAA ETOPO1
(dominio pubblico, dal pacchetto basemap-data); Luna, Marte e pianeti: NASA-3D-Resources (dominio
pubblico). Veicoli, Stazione Aurora, navetta Selene e campo di detriti sono immaginari.
