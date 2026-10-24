# ✈️ Cieli Aperti Flight Simulator

Simulatore di volo realistico per **Windows** (applicazione desktop Electron, funziona anche in qualsiasi browser
con WebGL2). Fisica di volo a 6 gradi di libertà, cockpit completi con strumenti funzionanti e comandi
cliccabili, sistemi di bordo, autopilota, radionavigazione, meteo dinamico, ciclo giorno/notte e **13 missioni**.

## Caratteristiche

### Fisica di volo
- Modello **6-DOF a componenti**: ogni semiala (divisa in pannelli interni/esterni), i piani di coda e la
  fusoliera calcolano il proprio angolo d'attacco locale. Smorzamenti, effetto diedro, imbardata inversa,
  stallo progressivo con caduta d'ala, effetto suolo, downwash sul piano orizzontale, scia dell'elica,
  coppia motrice, fattore P, effetti della comprimibilità (numero di Mach) emergono dalla fisica.
- **Atmosfera ISA** con QNH e temperatura non standard (l'altimetro sbaglia se non viene regolato e quando fa
  freddo), vento con gradiente e rotazione con la quota, raffiche, turbolenza, formazione di ghiaccio
  (tubo di Pitot, carburatore, cellula).
- **Motore a pistoni** con elica a passo fisso (coppia, giri, miscela, magneti, ghiaccio al carburatore, EGT,
  temperature e pressione olio, consumo), **turbofan/turbogetto** con dinamica N1/N2, sequenza di avviamento,
  APU e inversori di spinta.
- **Carrello** con ammortizzatori, attrito, freni differenziali, sterzo del ruotino, superfici diverse
  (asfalto, erba, terra, acqua), rilevamento di atterraggi duri, strisciate di coda e incidenti.
- Prestazioni verificate da una suite di test automatici contro dati reali (velocità di stallo, crociera,
  rateo di salita, corsa di decollo, consumi, autoland).

### Velivoli
| Velivolo | Tipo | Cockpit |
|---|---|---|
| **Falco T-172** | monomotore a pistoni da addestramento (classe C172) | strumenti analogici "six-pack", radio, ADF, autopilota a 2 assi |
| **AX-320 Aquila** | bireattore di linea fly-by-wire (classe A320) | glass cockpit PFD/ND/ECAM, FCU, autothrottle, ILS, autoland |
| **Freccia JT-9** | jet da addestramento acrobatico (classe MB-339) | HUD, strumenti analogici, fumogeni tricolori |

### Sistemi e comandi
Impianto elettrico (batteria, alternatore, avionica), carburante con selettore e serbatoi, flap e slat,
carrello retrattile, spoiler e aerofreni (anche automatici in atterraggio), autobrake, freno di parcheggio,
luci (navigazione, anticollisione, strobo, atterraggio, rullaggio, pannello), riscaldamento Pitot,
anti-ghiaccio, APU, avviamento a freddo completo oppure automatico (**Ctrl+E**).

Autopilota con modi **HDG, NAV (VOR/GPS), APR (LOC + GS), ALT, VS, FLC**, autothrottle e **autoland**
per l'aereo di linea. Radio NAV1/NAV2 con VOR/DME e ILS (con marker), ADF/NDB, COM con **ATIS** parlato,
transponder, GPS con piano di volo e "diretto a".

### Mondo
Regione mediterranea immaginaria di 180 × 180 km generata proceduralmente: costa, isole, pianure coltivate,
foreste, laghi, catene montuose fino a 2.400 m con valli percorribili, città, **6 aeroporti** (da una pista
internazionale di 3.200 m con ILS a una pista di montagna di 800 m e una pista in erba), luci di pista,
sentieri di avvicinamento luminosi e **PAPI** funzionanti.

### Missioni
Primo decollo, circuito di traffico, atterraggio di precisione, avaria motore, navigazione VOR, avviamento a
freddo, atterraggio in montagna, ILS nella nebbia, volo di linea, vento al traverso, percorso ad anelli,
acrobazia, volo notturno — con briefing, obiettivi, punteggio, stelle e analisi dell'atterraggio.

## Installazione (Windows)

1. Scaricare l'installer o la versione portable dalla pagina **Releases** del repository, oppure dagli
   artifact dell'ultima esecuzione della GitHub Action **"Build Windows"** (`CieliAperti-Windows`).
2. Avviare `Cieli Aperti Flight Simulator Setup x.y.z.exe` (installazione) oppure
   `CieliAperti-Portable-x.y.z.exe` (nessuna installazione).

Requisiti consigliati: Windows 10/11 64 bit, scheda video con supporto WebGL2 (qualsiasi GPU degli ultimi
10 anni), 4 GB di RAM. Joystick, HOTAS e gamepad sono supportati e configurabili.

## Avvio dal codice sorgente

```bash
npm install
npm start            # avvia l'app desktop (Electron)
npm run serve        # oppure: server locale, poi aprire http://localhost:8080 nel browser
npm test             # suite di test della fisica di volo
```

### Creare l'eseguibile per Windows

```bash
npm run dist:win     # installer NSIS + versione portable in release/
```

La build può essere generata anche da Linux/macOS; la GitHub Action `.github/workflows/build-windows.yml`
la esegue automaticamente su `windows-latest` a ogni push e pubblica una Release per i tag `v*`.

## Comandi principali

| Funzione | Tasti |
|---|---|
| Barra (beccheggio / rollio) | Frecce o tastierino numerico 8/2/4/6 |
| Pedaliera | Q / E oppure Num0 / NumInvio |
| Manetta | F1 (minimo) · F2 / F3 (−/+) · F4 (massimo) |
| Flap | F5 · F6 · F7 · F8 |
| Carrello · Freni · Freno di parcheggio | G · `.` (o Spazio) · Ctrl + `.` |
| Trim | Num7 / Num1 oppure Home / Fine |
| Autopilota | Z (HDG Ctrl+H, ALT Ctrl+Z, NAV Ctrl+N, APR Ctrl+A) |
| Avviamento automatico | Ctrl + E |
| Viste · Pannello · Mappa · Checklist | S · W · M · K |
| Pausa · Menu | P · Esc |

L'elenco completo è nel gioco (menu **Comandi**) e in [`docs/CONTROLS.md`](docs/CONTROLS.md).
Tutti gli interruttori, le manopole e le leve del cockpit si possono usare anche con il mouse
(clic, rotella, trascinamento).

## Struttura del progetto

```
electron/        app desktop (finestra, schermo intero, preload)
src/core/        matematica, unità, rumore procedurale
src/sim/         fisica di volo, motori, carrello, sistemi, autopilota, radionavigazione, velivoli
src/world/       dati del mondo (aeroporti, radioassistenze, città) e modello del terreno
src/render/      grafica 3D three.js (terreno LOD, acqua, cielo, nuvole, aeroporti, aerei, telecamere)
src/cockpit/     pannelli strumenti 2D interattivi e HUD
src/input/       tastiera, joystick, gamepad, mouse
src/audio/       suoni sintetizzati (motori, vento, avvisi, callout)
src/missions/    missioni, punteggi, checklist
src/ui/          menu e interfacce
tests/           test automatici della fisica
docs/            architettura e comandi
```

Dettagli tecnici in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Licenza

MIT. Velivoli, aeroporti e luoghi sono immaginari; le somiglianze con aeromobili reali riguardano solo le
prestazioni.
