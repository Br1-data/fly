# ✈️ Cieli Aperti Flight Simulator

Simulatore di volo realistico per **Windows** (applicazione desktop Electron, funziona anche in qualsiasi browser
con WebGL2). Fisica di volo a 6 gradi di libertà, cockpit completi con strumenti funzionanti e comandi
cliccabili, sistemi di bordo, autopilota, radionavigazione, meteo dinamico, ciclo giorno/notte, **11 aerei e 3 elicotteri civili e militari** e **51 missioni**.

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
Undici aerei e tre elicotteri, civili e militari, ognuno con le sue prestazioni, il suo modello 3D e la sua livrea.

| Velivolo | Tipo | Caratteristiche |
|---|---|---|
| **Falco T-172** | monomotore a pistoni da addestramento (classe C172) | strumenti analogici "six-pack", radio, ADF, autopilota a 2 assi |
| **Allodola X-300** | monoplano acrobatico (classe Extra 300) | ala simmetrica, rollio 400°/s, ±10 g, ruotino di coda, fumogeni |
| **Gabbiano BT-44** | bimotore a pistoni (classe PA-44) | eliche controrotanti a giri costanti, carrello retrattile, coda a T, avaria di un motore |
| **Condor CJ-5** | business jet (classe Citation CJ4) | motori posteriori, coda a T, glass cockpit, tangenza 45.000 ft |
| **AX-320 Aquila** | bireattore di linea fly-by-wire (classe A320) | glass cockpit PFD/ND/ECAM, FCU, autothrottle, ILS, autoland |
| **Picchio T-21** | addestratore militare turboelica (classe PC-21) | turboelica da 1600 shp, elica pentapala, HUD |
| **Freccia JT-9** | jet da addestramento acrobatico (classe MB-339) | HUD, strumenti analogici, fumogeni tricolori |
| **Vespa V-51** | caccia storico a pistoni (classe P-51D) | V-12 sovralimentato, elica a giri costanti, coppia forte, ruotino di coda |
| **Bisonte C-30** | trasporto tattico quadrimotore (classe C-130J) | quattro turboeliche, ala alta, piste corte, inversione del passo |
| **Folgore FX-16** | caccia multiruolo (classe F-16) | postbruciatore, Mach 2, fly-by-wire da caccia con 9 g e limitatore di incidenza |
| **Grifone EF-2** | caccia bimotore canard-delta (classe Typhoon) | due motori con postbruciatore, supercrociera oltre Mach 1,2 |
| **Colibrì H-6** | elicottero leggero a turbina (classe Bell 206) | rotore bipala, pattini, hovering e autorotazione |
| **Orso UH-6** | elicottero da trasporto e soccorso (classe UH-60) | due turbine, rotore quadripala da 16 m, carrello a ruote |
| **Calabrone AH-9** | elicottero d'attacco (classe A129 / AH-64) | rotore rigido agile, ali corte, HUD, volo a bassissima quota |

Gli **elicotteri** hanno una fisica dedicata: rotore principale con teoria elemento-pala e flusso
indotto, effetto suolo, portanza traslazionale, stato di anello vorticoso, inclinazione del disco con
il ciclico, rotore di coda, regolatore dei giri della turbina e **autorotazione** quando manca la potenza.
Il collettivo è sulla manetta; la stabilizzazione **AFCS** mantiene assetto e prua quando lasci i
comandi e in hovering ferma l'elicottero sul punto. La barra in basso mostra collettivo, giri del
rotore (NR) e coppia (TQ).

Sui caccia la manetta oltre il 90% accende il **postbruciatore** (fiamma visibile e consumi
quadruplicati); i turboelica e i motori a pistoni con elica a giri costanti, i compressori dei motori
storici, la resistenza d'onda supersonica e la coppia delle eliche sono simulati.

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

### Grafica
Cielo dinamico con sole, luna e stelle, colori dell'alba e del tramonto e foschia che si dirada
con la quota e sfuma il paesaggio nell'orizzonte. Mare e laghi con onde animate, riflessi del cielo,
scintillio del sole e fondali visibili sotto costa. Terreno con campi coltivati e siepi, boschi,
rocce e nevai; cumuli morbidi illuminati dal sole e strati coperti; ombra del velivolo (visibile anche
dal cockpit). Di notte: luci di pista, avvicinamento con lampeggiatori sequenziali, PAPI, raccordi,
città illuminate e finestre accese. Velivoli con livree, pannellature, finestrini lucidi e riflessi
dell'ambiente; bagliore e riflessi dell'obiettivo controsole.

Da vicino il terreno usa texture di materiale (erba, chiome, roccia con proiezione triplanare e
rilievo, sabbia, neve, solchi dei campi, asfalto e cemento) miscelate per tipo di suolo. Sono generate
in modo deterministico e senza giunzioni da `tools/make-textures.py` (Python con numpy, scipy e
Pillow) e salvate in `assets/textures/`, quindi il gioco non richiede passaggi di build.

### Missioni
51 missioni per tutti gli aerei e gli elicotteri, filtrabili per civili, militari, velivolo e "da fare", con briefing,
obiettivi, punteggio, stelle e analisi dell'atterraggio:

- **Addestramento e civili**: primo decollo, circuito, touch and go, atterraggio di precisione, avaria
  motore, navigazione VOR, avviamento a freddo, montagna, ILS nella nebbia, voli di linea, vento al traverso,
  gita al lago, pista corta dell'Isola Serena, executive per Borgo, salita a 37.000 ft.
- **Acrobazia**: looping, volo rovescio, programma acrobatico con tonneau, looping e virata a 5 g,
  percorso ad anelli, looping con i fumogeni.
- **Bimotore**: avaria di un motore al decollo con circuito monomotore, VOR e ILS a Borgo.
- **Militari**: muro del suono (Mach 1,4), decollo su allarme a tempo, intercettazione di un traffico
  sconosciuto, virata a 7 g, supercrociera senza postbruciatore, intercettazione notturna, navigazione
  tattica a bassa quota tra le colline, scorta di un quadrimotore con il caccia storico, lancio di
  rifornimenti, pista corta e ponte aereo per l'isola con il quadrimotore.

- **Elicotteri**: primo hovering, volo per San Rocco con atterraggio su piazzola, autorotazione,
  piazzola in quota, soccorso in mare con hovering sopra un'imbarcazione, trasporto truppe,
  volo a bassissima quota tra le colline, atterraggio su un picco.

I bersagli da intercettare sono aerei veri che volano lungo la loro rotta: distanza, direzione e quota
compaiono in alto e sulla mappa.

## Installazione (Windows)

1. Scaricare l'installer o la versione portable dalla pagina **Releases** del repository, oppure dagli
   artifact dell'ultima esecuzione della GitHub Action **"Build Windows"** (`CieliAperti-Windows`).
2. Avviare `Cieli Aperti Flight Simulator Setup x.y.z.exe` (installazione) oppure
   `CieliAperti-Portable-x.y.z.exe` (nessuna installazione).

Requisiti consigliati: Windows 10/11 64 bit, scheda video con supporto WebGL2 (qualsiasi GPU degli ultimi
10 anni), 4 GB di RAM. Joystick, HOTAS e gamepad sono supportati e configurabili.

## Avvio dal codice sorgente

```bash
npm ci
npm start            # avvia l'app desktop (Electron)
npm run serve        # oppure: server locale, poi aprire http://localhost:8080 nel browser
npm test             # suite di test della fisica di volo
npm run smoke        # verifica integrata nel browser (richiede Chrome/Chromium)
```

La verifica `smoke` avvia e chiude un server di prova su una porta libera, esercita menu, volo libero,
comandi, pausa, tre velivoli e avvio missione, e salva risultati e screenshot in `.smoke/`.
Se Chrome/Chromium non viene trovato automaticamente, imposta `CHROMIUM_PATH` al suo eseguibile.
La suite `npm test` comprende anche missioni, input, audio e regressioni dei riavvii. Node.js 24 è
stato verificato in sviluppo; la CI usa Node.js 22. Non sono richiesti servizi esterni o chiavi API.

### Cockpit e aiuto

La vista cockpit dispone di console laterali: **Impianti** a sinistra per alimentazione, motori,
luci e comandi di volo; **Radio** a destra per autopilota, navigazione e strumenti. I pulsanti
nel pannello centrale aprono o richiudono le console. Puoi scorrere e richiudere le sezioni;
sugli schermi piccoli si apre una console alla volta. I comandi mostrati rispettano gli impianti
del velivolo selezionato.

Il pulsante **Aiuto** in alto o **F12** apre una guida rapida, tutti i comandi e un glossario
ricercabile di 80 termini. Il volo e il timer missione restano fermi durante la consultazione;
**Esc** o **F12** chiude la guida e ripristina la pausa precedente.

### Smartphone e tablet

La versione web dispone di controlli multitouch: cloche virtuale, manetta, pedaliera e freni
si usano anche contemporaneamente. Il neutro della cloche è il punto in cui appoggi il dito (nessuno
scatto) e la risposta (Precisa, Normale, Diretta) si sceglie in **Comandi**; **TRIM** trasforma
il comando tenuto in compensazione, così puoi rilasciare la cloche. Tutti i pulsanti rispondono
anche mentre un altro dito tiene la cloche; con la tastiera il trim è **T**, sul gamepad la croce
direzionale (stick destro premuto per compensare). I pulsanti FLAP, CARRELLO (quando previsto), VISTA e PANNELLO
consentono di volare senza tastiera. Trascina il panorama per guardarti intorno; nella mappa
allarga o avvicina due dita per lo zoom.

Sugli smartphone la prima configurazione usa qualità bassa, pannello compatto e un obiettivo di
30 fps; il framebuffer è limitato e il terreno usa 49 tasselli. Su **iPhone** (anche con «sito desktop»
attivo in Safari) parte in qualità media a 60 fps con risoluzione 2× e antialiasing; comandi, messaggi
e HUD rispettano Dynamic Island, angoli e indicatore Home, anche in orizzontale con le barre di Safari. Su **iPad** e tablet (riconosciuti anche
quando Safari si presenta come Mac) parte in qualità media a 60 fps, con antialiasing, risoluzione
1,5× e pannello strumenti completo anche in verticale, comandi touch più grandi e tasselli generati in
un Web Worker per un volo senza scatti. Su tutti i dispositivi touch la risoluzione si adatta da sola
se il frame rate scende. Le scelte salvate vengono rispettate.

Su iPad conviene aggiungere il gioco alla schermata Home (Safari → Condividi → «Aggiungi alla schermata
Home»): si apre a schermo intero senza barre del browser. Con una tastiera collegata, che non ha i tasti
F, la manetta è su `=` / `-` e i flap su `[` / `]`. Menu, missioni, aiuto e console si adattano a verticale e
orizzontale, con pulsanti di almeno 44 px e spazi per le aree sicure del dispositivo.
Quando il browser passa in secondo piano il volo viene messo in pausa; i comandi momentanei
si rilasciano anche in caso di gesto interrotto o rotazione dello schermo.

```bash
npm run smoke:mobile
# Oppure sul pacchetto pronto per Pages:
SMOKE_ROOT=dist/web SMOKE_BASE_PATH=/fly/ npm run smoke:mobile
```

La prova automatica usa Chromium con emulazione touch e tre dita simultanee; verifica layout
da 320 × 568 a 768 × 1024, incluso 844 × 390 orizzontale, e un iPad emulato (user agent iPadOS,
820 × 1180 e 1180 × 820) e un iPhone 16 con le sue zone sicure (393 × 852 e 852 × 340). Non sostituisce una misura delle
prestazioni su hardware Android/iOS reale. Il workflow Pages esegue sia la prova desktop sia
quella mobile prima del deploy. Il bundle web include solo i moduli three.js effettivamente usati.

### Versione web e GitHub Pages

```bash
npm run build:web
SMOKE_ROOT=dist/web SMOKE_BASE_PATH=/fly/ npm run smoke
```

`dist/web/` contiene solo i file della versione browser e la versione bloccata di three.js;
non richiede chiavi API, CDN o un server applicativo. I salvataggi rimangono nel browser utilizzato.
La seconda istruzione verifica il pacchetto sotto `/fly/`, lo stesso percorso previsto su Pages.

Il workflow **Publish GitHub Pages** esegue test, build e prova browser prima del deploy a ogni
push su `claude/epic-hypatia-ctxoo9`; si può avviare anche manualmente da Actions. Nel repository,
**Settings → Pages → Build and deployment → Source** deve essere **GitHub Actions**. L’abilitazione
iniziale di Pages richiede un amministratore del repository; il workflow usa solo i permessi
`pages: write` e `id-token: write` durante la pubblicazione.

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
