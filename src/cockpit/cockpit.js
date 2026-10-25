// Aircraft instruments, side consoles and pedestal operate on the real simulation state.
import { h } from '../ui/dom.js';
import { clamp } from '../core/math.js';
import { AIRPORTS } from '../world/world-data.js';
import { isTouchDevice } from '../core/device.js';

const num = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '—';
const heading = (v) => String(Math.round(v || 0) % 360 || 360).padStart(3, '0');
const time = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;

export class Cockpit {
  constructor(root, sim) {
    this.root = root; this.sim = sim;
    this.touch = isTouchDevice();
    this.mode = this.touch && (window.innerWidth <= 1100 || window.innerHeight <= 700) ? 'mini' : 'full';
    this.view = 'orbit'; this.night = 0; this.hudVisible = true;
    this._modeChosen = false; this._nextUI = 0; this._nextGauge = 0;
    this.switches = []; this.readouts = [];
    const openConsoles = this.mode === 'full' && window.innerWidth > 1000 && window.innerHeight > 640;
    this.consoles = { left: openConsoles, right: openConsoles };
    if (!document.getElementById('ca-cockpit-style')) document.head.appendChild(h('link#ca-cockpit-style', { rel: 'stylesheet', href: new URL('./cockpit.css', import.meta.url).href }));
    this.canvas = h('canvas.ca-instruments', { role: 'img', 'aria-label': 'Strumenti di volo: velocità, assetto, altitudine, prua, virata e variometro' });
    this.name = h('b'); this.status = h('span.ca-status');
    this.leftToggle = h('button', { type: 'button', 'aria-label': 'Mostra o nascondi console impianti', title: 'Console sinistra: impianti, motori, luci e comandi di volo', onclick: () => this.toggleConsole('left') }, '◀ Impianti');
    this.rightToggle = h('button', { type: 'button', 'aria-label': 'Mostra o nascondi console radio', title: 'Console destra: radio, navigazione, transponder e strumenti', onclick: () => this.toggleConsole('right') }, 'Radio ▶');
    this.apStrip = h('div.ca-ap-strip', { 'aria-label': 'Autopilota e selettori' });
    this.footer = h('div.ca-footer', { 'aria-label': 'Pedestallo: manetta e configurazione velivolo' });
    this.el = h('section.ca-panel', { 'aria-label': 'Pannello strumenti' },
      h('header.ca-header', this.leftToggle, this.name, this.status, this.rightToggle,
        h('button', { type: 'button', 'aria-label': 'Cambia dimensione pannello', title: 'Pannello completo, compatto o nascosto (W). Le console si riaprono dai pulsanti laterali.', onclick: () => this.cycleMode() }, this.touch ? 'Strumenti' : 'W · vista')),
      this.apStrip, h('div.ca-body', this.canvas), this.footer);
    this.leftContent = h('div.ca-console-scroll'); this.rightContent = h('div.ca-console-scroll');
    const consolePanel = (side, title, content) => h(`aside.ca-console.ca-${side}`, { 'aria-label': title },
      h('div.ca-console-head', h('b', title), h('button', { type: 'button', 'aria-label': `Chiudi ${title}`, onclick: () => this.toggleConsole(side) }, '×')), content);
    this.left = consolePanel('left', 'IMPIANTI / MOTORI', this.leftContent);
    this.right = consolePanel('right', 'RADIO / NAVIGAZIONE', this.rightContent);
    this.hud = h('canvas.ca-jet-hud', { width: 720, height: 460, 'aria-hidden': 'true' });
    this.shell = h('div.ca-shell', h('div.ca-canopy', { 'aria-hidden': 'true' }), h('div.ca-post.ca-post-left', { 'aria-hidden': 'true' }), h('div.ca-post.ca-post-right', { 'aria-hidden': 'true' }), this.left, this.right, this.el, this.hud);
    root.appendChild(this.shell);
    for (const panel of [this.el, this.left, this.right]) {
      for (const event of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) panel.addEventListener(event, (e) => e.stopPropagation());
    }
    this.canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.releaseHeld = () => {
      for (const key of ['pitch', 'roll', 'yaw', 'brakeL', 'brakeR', 'reverse']) if (this.sim.cockpitInput) delete this.sim.cockpitInput[key];
    };
    window.addEventListener('blur', this.releaseHeld);
    this.ctx = this.canvas.getContext('2d');
    this.resize(window.innerWidth, window.innerHeight);
    this.setAircraft(sim.def || { name: 'Cieli Aperti', panel: 'ga', controls: {} });
    this._visibility();
  }

  get panelFraction() { return this.view === 'cockpit' && this.mode !== 'hidden' ? this.el.getBoundingClientRect().height / Math.max(1, this.height) : 0; }
  click(kind = 'switch') { window.dispatchEvent(new CustomEvent('cieli:click', { detail: { kind } })); }
  command(name, value, kind = 'switch') {
    if (typeof name === 'function') name(); else this.sim.command(name, value);
    this.click(kind); this._nextUI = 0; this.update();
  }
  action(label, name, arg, description = label) {
    return h('button.ca-action', { type: 'button', title: description, 'aria-label': label, onclick: () => this.command(name, arg, 'button') }, label);
  }
  toggle(label, name, read, arg, description = label) {
    const b = h('button.ca-switch', { type: 'button', 'aria-label': label, title: description, onclick: () => this.command(name, arg) }, label);
    this.switches.push({ b, read }); return b;
  }
  knob(label, read, command, step, description = label) {
    const digits = document.createTextNode('');
    const value = h('span', h('small.ca-knob-label', label), digits);
    let previous;
    const adjust = (delta) => { if (typeof command === 'function') command(delta); else this.command(command, delta, 'knob'); };
    const el = h('div.ca-knob', { title: `${description}. Pulsanti o rotella per regolare.`, onwheel: (e) => { e.preventDefault(); adjust(e.deltaY < 0 ? step : -step); } },
      h('button', { type: 'button', 'aria-label': `Riduci ${label}`, onclick: () => adjust(-step) }, '−'), value,
      h('button', { type: 'button', 'aria-label': `Aumenta ${label}`, onclick: () => adjust(step) }, '+'));
    this.readouts.push(() => {
      const next = String(read());
      if (next !== previous) { digits.textContent = next; previous = next; }
    });
    return el;
  }
  lever(label, read, write, { min = 0, max = 1, step = 0.01, format = (v) => `${Math.round(v * 100)}%`, description = label, className = '' } = {}) {
    const output = h('output');
    const input = h('input', { type: 'range', min, max, step, 'aria-label': label, title: description, oninput: (e) => { write(Number(e.target.value)); output.textContent = format(Number(e.target.value)); this.click('lever'); } });
    this.readouts.push(() => {
      const v = read(), text = format(v);
      if (document.activeElement !== input && Number(input.value) !== v) input.value = v;
      if (output.textContent !== text) output.textContent = text;
    });
    return h(`label.ca-lever${className ? '.' + className : ''}`, { title: description }, h('span.ca-lever-label', label), input, output);
  }
  hold(label, key, value, description = label) {
    const keys = Array.isArray(key) ? key : [key];
    const start = () => { this.sim.cockpitInput ||= {}; for (const k of keys) this.sim.cockpitInput[k] = value; this.click('lever'); this.update(); };
    const end = () => { if (this.sim.cockpitInput) for (const k of keys) delete this.sim.cockpitInput[k]; this.update(); };
    const b = h('button.ca-switch', { type: 'button', 'aria-label': label, title: description,
      onpointerdown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start(); }, onpointerup: end, onpointercancel: end, onlostpointercapture: end,
      onkeydown: (e) => { if (['Enter', 'Space'].includes(e.code)) { e.preventDefault(); if (!e.repeat) start(); } },
      onkeyup: (e) => { if (['Enter', 'Space'].includes(e.code)) { e.preventDefault(); end(); } }, onblur: end }, label);
    this.switches.push({ b, read: () => keys.every((k) => this.sim.cockpitInput?.[k] === value) }); return b;
  }
  section(parent, title, ...children) {
    const el = h('details.ca-section', { open: true }, h('summary', title), children); parent.appendChild(el); return el;
  }
  row(...children) { return h('div.ca-row', ...children); }
  readout(read) {
    const output = h('div.ca-readout'); let previous;
    this.readouts.push(() => { const value = read(); if (value !== previous) { output.textContent = value; previous = value; } }); return output;
  }
  select(label, options, read, write) {
    const el = h('select.ca-select', { 'aria-label': label, title: label, onchange: (e) => { write(e.target.value); this.click('knob'); } }, options.map(({ value, label: text }) => h('option', { value }, text)));
    this.readouts.push(() => { if (document.activeElement !== el) el.value = read(); });
    return h('label', h('div.ca-caption', label), el);
  }

  setAircraft(def) {
    this.releaseHeld();
    if (this.sim.cockpitInput) delete this.sim.cockpitInput.throttle2;
    this.def = def; this.name.textContent = def.name; this.switches = []; this.readouts = []; this._nextUI = 0;
    this.leftContent.replaceChildren(); this.rightContent.replaceChildren(); this.apStrip.replaceChildren(); this.footer.replaceChildren();
    const s = this.sim, system = () => s.fm?.systems || {}, ap = () => s.ap || {}, engine = () => s.fm?.engines[0] || {};
    const row = (...items) => this.row(...items);
    const left = (title, ...items) => this.section(this.leftContent, title, ...items);
    const right = (title, ...items) => this.section(this.rightContent, title, ...items);
    left('01 · Alimentazione',
      row(this.toggle('Batteria', 'battery', () => system().battery, undefined, 'Collega o scollega la batteria al bus elettrico.'), this.toggle('Generatore', 'alternator', () => system().alternator, undefined, 'Alternatore o generatori: alimentano il bus e ricaricano la batteria.')),
      row(this.toggle('Master', 'master', () => system().battery && system().alternator, undefined, 'Comanda insieme batteria e generatore.'), this.toggle('Avionica', 'avionics', () => system().avionics, undefined, 'Alimenta radio e strumenti elettronici.')),
      this.readout(() => `${num(system().busVolts,1)} V  ·  ${num(system().ammeter,1)} A\nBatteria ${num(system().batteryCharge*100)}%${def.panel === 'ga' ? ` · Vuoto ${num(system().vacuum,1)} inHg` : ` · Idraulica ${num(system().hydraulics*100)}%`}`));
    const starts = [row(this.action('Avvio automatico', 'autostart', undefined, 'Esegue la sequenza completa di avviamento (Ctrl+E).'), this.action('Spegni motori', 'shutdown', undefined, 'Interrompe avviamento e alimentazione dei motori.'))];
    if (def.panel === 'ga') {
      starts.push(row(this.knob('MAG', () => ['OFF','R','L','BOTH','START'][engine().magnetos ?? 0], (delta) => this.command('magnetos', clamp((engine().magnetos ?? 0) + delta,0,3), 'knob'), 1, 'Magneti OFF, destro, sinistro o entrambi')),
        this.starter(), row(this.toggle('Pompa carburante', 'fuelPump', () => system().fuelPump, undefined, 'Pompa elettrica ausiliaria del carburante.'), this.toggle('Aria carburatore', 'carbHeat', () => engine().carbHeat, undefined, 'Aria calda al carburatore per prevenire o sciogliere il ghiaccio.')),
        this.select('Selettore carburante', [{value:'off',label:'OFF · chiuso'},{value:'left',label:'LEFT · sinistro'},{value:'both',label:'BOTH · entrambi'},{value:'right',label:'RIGHT · destro'}], () => system().fuelSelector, (v) => this.command('fuelSelector',v)),
        this.lever('Miscela', () => s.pilot.mixture, (v) => this.command('mixture',v,'lever'), {className:'ca-mixture',description:'Rapporto aria/carburante: 100% ricca, 0% taglio miscela.'}));
    } else {
      if (def.systems?.apu) starts.push(row(this.toggle('APU', 'apuMaster', () => system().apuMaster, undefined, 'Avvia il gruppo ausiliario di potenza.'), this.toggle('APU bleed', 'apuBleed', () => system().apuBleed, undefined, 'Aria compressa APU per l’avviamento dei motori.')),
        row(this.toggle('IGN / START', 'engineStartSel', () => system().engineStartSel === 'ign', undefined, 'Selettore motori fra NORM e IGN/START.')));
      starts.push(row(...(def.engines || [{}]).map((_, index) => this.toggle(`Motore ${index+1}`, 'engineMaster', () => s.engineMaster?.[index], {index}, `Leva carburante / ENG MASTER del motore ${index+1}.`))));
      if (!def.systems?.apu) starts.push(row(this.action('Starter turbina', 'starter', undefined, 'Aziona il motorino d’avviamento. Attivare prima batteria e leva carburante.')));
    }
    starts.push(this.readout(() => (s.fm?.engines || []).map((e,index) => e.type === 'piston' ? `RPM ${num(e.rpm)} · MAP ${num(e.map/3386.39,1)} inHg\nEGT ${num(e.egt)} °C · CHT ${num(e.cht)} °C\nOlio ${num(e.oilPress)} psi / ${num(e.oilTemp-273.15)} °C` : `ENG ${index+1} ${e.running?'RUN':e.startPhase.toUpperCase()} · N1 ${num(e.n1,1)}%\nN2 ${num(e.n2,1)}% · EGT ${num(e.egt-273.15)} °C\nFlusso ${num(e.fuelFlow*3600)} kg/h`).join('\n') + (def.systems?.apu ? `\nAPU ${num(system().apuN)}%` : '')));
    left('02 · Motori e carburante', starts, this.readout(() => `Carburante ${num(system().fuelTotal)} kg\n${(system().tanks || []).map(t => `${t.name} ${num(t.qty)} kg`).join(' · ')}`));
    left('03 · Protezione ghiaccio', row(this.toggle('Pitot caldo','pitotHeat',()=>system().pitotHeat,undefined,'Riscalda il tubo di Pitot; protegge l’indicazione di velocità.'), this.toggle('Antighiaccio','antiIce',()=>system().antiIce,undefined,'Protezione contro il ghiaccio sulla cellula.')),
      this.readout(()=>`Ghiaccio Pitot ${num(system().pitotIce*100)}%\nGhiaccio cellula ${num(system().airframeIce*100)}%`));
    const lights = [['nav','Navigazione','Luci rossa, verde e bianca di posizione.'],['beacon','Anticollisione','Faro rosso anticollisione.'],['strobe','Strobo','Luci bianche lampeggianti.'],['landing','Atterraggio','Fari per decollo e atterraggio.'],['taxi','Rullaggio','Illuminazione durante il rullaggio.'],['panel','Pannello','Illuminazione degli strumenti.'],['logo','Logo','Illuminazione esterna della deriva.']];
    left('04 · Illuminazione', lights.map(([which,label,description])=> row(this.toggle(label,'light',()=>system().lights?.[which],{which},description))), row(this.action('Tutte le luci','allLights',undefined,'Accende o spegne insieme tutte le luci.')));
    this.buildPhysicalControls(left);
    this.buildAutopilot();
    this.buildRadios(right);
    this.buildPedestal();
    this._visibility(); this.update();
  }

  starter() {
    const press = () => this.command('magnetos',4,'button'), release = () => this.command('magnetoRelease');
    return h('button.ca-action', { type:'button', 'aria-label':'Avviatore motore', title:'Tenere premuto per avviare il motore. Rilasciando ritorna su BOTH.',
      onpointerdown:e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);press();},onpointerup:release,onpointercancel:release,onlostpointercapture:release,
      onkeydown:e=>{if(['Enter','Space'].includes(e.code)){e.preventDefault();if(!e.repeat)press();}},onkeyup:e=>{if(['Enter','Space'].includes(e.code)){e.preventDefault();release();}},onblur:release }, 'START · tieni premuto');
  }

  buildPhysicalControls(left) {
    const s=this.sim, fm=()=>s.fm, controls=this.def.controls||{};
    const yokeIndicator=h('span');
    const release=()=>{if(s.cockpitInput){delete s.cockpitInput.pitch;delete s.cockpitInput.roll;}};
    const move=e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.getBoundingClientRect();s.cockpitInput||={};s.cockpitInput.roll=clamp((e.clientX-r.left-r.width/2)/(r.width/2),-1,1);s.cockpitInput.pitch=clamp((e.clientY-r.top-r.height/2)/(r.height/2),-1,1);};
    const yoke=h('div.ca-yoke',{role:'group','aria-label':'Cloche: trascina per beccheggio e rollio',title:'Trascina: destra/sinistra per rollare, verso il basso per cabrare. Rilascia per centrare.',onpointerdown:e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);move(e);},onpointermove:move,onpointerup:release,onpointercancel:release,onlostpointercapture:release},yokeIndicator);
    this.readouts.push(()=>{yokeIndicator.style.transform=`translate(${(s.cockpitInput?.roll||0)*50}px,${(s.cockpitInput?.pitch||0)*20}px)`;});
    left('05 · Cloche e pedaliera', yoke,h('div.ca-yoke-label','TRASCINA LA CLOCHE · RILASCIA PER CENTRARE'),
      this.row(this.hold('Cabra','pitch',1,'Cloche indietro: tieni premuto per cabrare.'),this.hold('Picchia','pitch',-1,'Cloche avanti: tieni premuto per picchiare.')),
      this.row(this.hold('Ala sinistra','roll',-1,'Tieni premuto per rollare a sinistra.'),this.hold('Ala destra','roll',1,'Tieni premuto per rollare a destra.')),
      this.row(this.hold('Pedale sx','yaw',-1,'Tieni premuto il pedale sinistro.'),this.hold('Pedale dx','yaw',1,'Tieni premuto il pedale destro.')),
      this.row(this.hold('Freno sx','brakeL',1,'Tieni premuto per frenare la ruota sinistra.'),this.hold('Freno dx','brakeR',1,'Tieni premuto per frenare la ruota destra.')),
      this.row(this.hold('Freni insieme',['brakeL','brakeR'],1,'Tieni premuto per frenare entrambe le ruote.')),
      ...(controls.reversers ? [this.row(this.hold('Inversori','reverse',true,'Tieni premuto per inserire gli inversori di spinta. Usare dopo il contatto a terra.'))] : []));
    left('06 · Compensatori',
      this.lever('Trim beccheggio',()=>fm()?.input.elevTrim||0,v=>{if(fm())fm().input.elevTrim=v;},{min:-1,max:1,format:v=>`${num(v*100)}%`,className:'ca-trim',description:'Compensatore longitudinale: positivo a cabrare. Nella legge normale Airbus il trim è automatico.'}),
      this.lever('Trim rollio',()=>fm()?.input.ailTrim||0,v=>{if(fm())fm().input.ailTrim=v;},{min:-1,max:1,format:v=>`${num(v*100)}%`,className:'ca-trim',description:'Compensa il rollio: positivo verso destra.'}),
      this.lever('Trim imbardata',()=>fm()?.input.rudTrim||0,v=>{if(fm())fm().input.rudTrim=v;},{min:-1,max:1,format:v=>`${num(v*100)}%`,className:'ca-trim',description:'Compensa la pedaliera: positivo verso destra.'}),
      this.row(this.action('Trim neutri',()=>{if(fm())for(const key of ['elevTrim','ailTrim','rudTrim'])fm().input[key]=0;},undefined,'Azzera i tre compensatori.')));
    const extra=[];
    if(controls.spoilers)extra.push(this.lever('Aerofreni',()=>fm()?.systems.spoilerLever||0,v=>this.command('spoilers',v,'lever'),{description:'Comando proporzionale degli aerofreni / spoiler.'}),this.row(this.toggle('Arma spoiler','spoilers',()=>fm()?.systems.spoilersArmed,'arm','Arma l’estensione automatica degli spoiler all’atterraggio.')));
    if(controls.autobrake)extra.push(this.select('Autobrake',[{value:'0',label:'OFF'},{value:'1',label:'LO'},{value:'2',label:'MED'},{value:'3',label:'MAX'}],()=>String(fm()?.systems.autobrake||0),v=>this.command('autobrake',Number(v))));
    if(controls.smoke)extra.push(this.row(this.toggle('Fumogeni tricolori','smoke',()=>fm()?.systems.smoke,undefined,'Accende o spegne i fumogeni del jet acrobatico.')));
    extra.push(this.readout(()=>`Flap ${num((fm()?.systems.flaps||0)*100)}% · Slat ${num((fm()?.systems.slats||0)*100)}%\nCarrello ${num((fm()?.systems.gearPos||0)*100)}%${controls.spoilers?` · Spoiler ${num((fm()?.systems.spoilers||0)*100)}%`:''}`));
    left('07 · Configurazione',extra,...(!controls.retractableGear?[h('p.ca-note','Carrello fisso su questo velivolo.')]:[]));
  }

  buildAutopilot() {
    const s=this.sim,a=()=>s.ap||{};
    const modes=[['AP','ap',()=>a().engaged,'Inserisce o disinserisce l’autopilota (Z).'],['HDG','apHdg',()=>a().lateral==='HDG','Segue la prua selezionata.'],['NAV','apNav',()=>a().lateral==='NAV'||a().armedNav,'Arma o segue la navigazione NAV1/GPS.'],['APR','apApr',()=>a().armedApr||a().lateral==='LOC','Arma l’avvicinamento ILS: localizzatore e glideslope.'],['ALT','apAlt',()=>a().vertical==='ALT','Mantiene o cattura la quota.'],['V/S','apVs',()=>a().vertical==='VS','Segue la velocità verticale selezionata.'],['FLC','apFlc',()=>a().vertical==='FLC','Varia la quota mantenendo la velocità selezionata.']];
    this.apStrip.append(...modes.map(([label,command,read,description])=>this.toggle(label,command,read,undefined,description)),
      this.knob('HDG',()=>heading(a().hdgBug),'hdgBug',1,'Prua selezionata in gradi'),this.knob('ALT',()=>num(a().altSel),'altSel',100,'Quota selezionata in piedi'),this.knob('V/S',()=>num(a().vsSel),'vsSel',100,'Velocità verticale selezionata in piedi/minuto'),this.knob('SPD',()=>num(a().spdSel),'spdSel',1,'Velocità selezionata in nodi per FLC e autothrottle'));
    const section=this.section(this.rightContent,'01 · Direttore di volo',
      this.row(this.toggle('FD',()=>{if(s.ap)s.ap.fd=!s.ap.fd;},()=>a().fd,undefined,'Direttore di volo: calcola le indicazioni di guida senza comandare l’aereo.'),this.action('AP DISCONNECT','apDisconnect',undefined,'Disinserisce immediatamente l’autopilota.')),
      this.row(this.toggle('NAV1 / GPS','apNavSource',()=>a().navSource==='GPS',undefined,'Sceglie la sorgente del modo NAV: radio NAV1 o piano GPS.'),this.action('HDG SYNC','hdgBug','sync','Copia la prua attuale nel selettore HDG.')),
      ...(this.def.autopilot?.autothrottle?[this.row(this.toggle('A/THR','apAthr',()=>a().athr,undefined,'Autothrottle: controlla la spinta per mantenere la velocità.'))]:[]),
      this.readout(()=>`Sorgente ${a().navSource||'NAV1'} · ${a().engaged?'AP ON':'AP OFF'}\n${a().lateral||'ROL'} / ${a().vertical||'PIT'}${a().armedNav?' · NAV ARM':''}${a().armedApr?' · APR ARM':''}${a().armedAlt?' · ALT ARM':''}\nA/THR ${a().athr?a().athrMode:'OFF'}${a().autoland&&a().autoland!=='OFF'?` · ${a().autoland}`:''}`));
    // Details outside the main strip keep every mode reachable even on narrow displays.
    section.appendChild(h('p.ca-note','I selettori HDG, ALT, V/S e SPD scorrono orizzontalmente sopra gli strumenti.'));
  }

  buildRadios(right) {
    const s=this.sim;
    for(const index of [1,2]) {
      const key=`nav${index}`,radio=()=>s[key];
      right(`0${index+1} · NAV ${index}`,
        this.readout(()=>`ATTIVA ${num(radio().active,2)} MHz\nSTBY ${num(radio().standby,2)} MHz\n${radio().valid?`${radio().ident} · DME ${num(radio().dme,1)} NM\nCDI ${num(radio().cdi,2)}${radio().gsValid?' · GS '+num(radio().gs,2):''}`:'NESSUN SEGNALE'}`),
        this.row(this.knob(`NAV${index}`,()=>num(radio().standby,2),`${key}Tune`,.05,`Frequenza standby NAV${index} in MHz`)),
        this.row(this.action(`Scambia NAV${index}`,`${key}Swap`,undefined,`Scambia frequenze attiva e standby NAV${index}.`),this.knob(`OBS${index}`,()=>heading(radio().obs),index===1?'obs':'obs2',1,'Rotta OBS del VOR in gradi')));
    }
    right('04 · COM 1',this.readout(()=>`ATTIVA ${num(s.com1.active,3)} MHz\nSTBY ${num(s.com1.standby,3)} MHz`),this.row(this.knob('COM1',()=>num(s.com1.standby,3),'com1Tune',.025,'Frequenza standby COM1'),this.action('Scambia COM1','com1Swap',undefined,'Attiva la frequenza standby. Sintonizza un ATIS per ricevere il meteo.')));
    right('05 · ADF / NDB',this.readout(()=>`ATTIVA ${num(s.adf.active)} kHz\nSTBY ${num(s.adf.standby)} kHz\n${s.adf.valid?`${s.adf.ident} · Ril. ${num(s.adf.relBearing)}°`:'NESSUN SEGNALE'}`),this.row(this.knob('ADF',()=>num(s.adf.standby),'adfTune',1,'Frequenza standby ADF in kHz'),this.action('Scambia ADF','adfSwap',undefined,'Scambia le frequenze ADF.')));
    const digits=h('div.ca-xpdr-digits');
    for(let index=0;index<4;index++) {
      const select=h('select',{'aria-label':`Cifra transponder ${index+1}`,title:`Cifra ${index+1} del codice transponder, da 0 a 7.`,onchange:e=>{const code=String(s.xpdr.code).padStart(4,'0').split('');code[index]=e.target.value;this.command('xpdr',Number(code.join('')));}},Array.from({length:8},(_,n)=>h('option',{value:String(n)},String(n))));
      this.readouts.push(()=>{if(document.activeElement!==select)select.value=String(s.xpdr.code).padStart(4,'0')[index];});digits.appendChild(select);
    }
    right('06 · Transponder',digits,this.row(this.action('Modo XPDR','xpdr','mode','Cicla OFF, STBY e ALT (trasmissione con quota).')),this.readout(()=>`XPDR ${String(s.xpdr.code).padStart(4,'0')} · ${s.xpdr.mode}`));
    let destination=AIRPORTS[0].icao;
    const gpsSelect=h('select.ca-select',{'aria-label':'Destinazione GPS',title:'Scegli l’aeroporto per il volo diretto.',onchange:e=>{destination=e.target.value;}},AIRPORTS.map(ap=>h('option',{value:ap.icao},`${ap.icao} · ${ap.name}`)));
    right('07 · Navigatore GPS',gpsSelect,this.row(this.action('Diretto GPS',()=>{const ap=AIRPORTS.find(ap=>ap.icao===destination);if(ap)this.sim.command('gpsDirect',{id:ap.icao,n:ap.n,e:ap.e});},undefined,'Attiva il diretto all’aeroporto selezionato; scegliere GPS come sorgente NAV.')),
      this.readout(()=>{const g=s.gps;return g.current?`DEST ${g.current.id}\nPRUA ${heading(g.brg)} · ${num(g.dist/1852,1)} NM\nXTK ${num(g.xtk)} m · ETE ${time(g.ete||0)}`:'GPS · nessuna destinazione';}));
    right('08 · Altimetro e girobussola',this.row(this.knob('QNH',()=>num((s.fm?.kollsman||101325)/100),'kollsman',1,'Pressione altimetrica in hPa')),
      this.row(this.action('QNH locale','kollsman','local','Imposta il QNH effettivo della regione.'),this.action('STD 1013','kollsman','std','Imposta la pressione standard 1013,25 hPa.')),
      this.row(this.knob('DG',()=>heading(s.instruments.dg),'dgAdjust',1,'Correzione manuale della girobussola'),this.action('DG SYNC','dgSync',undefined,'Allinea la girobussola alla bussola magnetica.')),
      this.readout(()=>`Bussola ${heading(s.instruments.compass)}°\nGiro ${num((s.fm?.systems.gyroSpin||0)*100)}% · OAT ${num(s.fm?.oatC)} °C`));
    right('09 · Cronometro',this.readout(()=>`TEMPO ${time(s.instruments.timer)} · ${s.instruments.timerRun?'IN CORSO':'FERMO'}`),this.row(this.toggle('Avvia / ferma','timer',()=>s.instruments.timerRun,undefined,'Avvia o arresta il cronometro.'),this.action('Azzera timer','timer','reset','Ferma e azzera il cronometro.')));
  }

  buildPedestal() {
    const s=this.sim,sys=()=>s.fm?.systems||{},def=this.def;
    this.footer.append(this.lever('MANETTA',()=>s.pilot.throttle,v=>{s.pilot.throttle=v;},{className:'ca-throttle',description:'Potenza del motore 1 (o di entrambi con manette sincronizzate).'}));
    if((def.engines?.length||1)>1)this.footer.append(this.lever('MANETTA 2',()=>s.cockpitInput?.throttle2??s.pilot.throttle2??s.pilot.throttle,v=>{s.cockpitInput||={};s.cockpitInput.throttle2=v;s.pilot.throttle2=v;},{className:'ca-throttle',description:'Comando indipendente del motore 2. La tastiera riporta le manette alla sincronizzazione.'}),this.toggle('Manette unite',()=>{if(s.cockpitInput?.throttle2!==undefined){delete s.cockpitInput.throttle2;delete s.pilot.throttle2;}else{s.cockpitInput||={};s.cockpitInput.throttle2=s.pilot.throttle;}},()=>s.cockpitInput?.throttle2===undefined,undefined,'Unisce le manette o abilita la regolazione indipendente del motore 2.'));
    if(def.panel==='ga')this.footer.append(this.lever('MISCELA',()=>s.pilot.mixture,v=>this.command('mixture',v,'lever'),{className:'ca-mixture',description:'Miscela motore: ricca 100%, taglio 0%.'}));
    this.footer.append(this.lever('FLAP',()=>sys().flapsLever||0,v=>this.command('flaps',v,'lever'),{min:0,max:Math.max(1,(def.controls?.flapDetents?.length||2)-1),step:1,format:v=>def.controls?.flapDetents?.[v]?.name||String(v),description:'Selettore delle posizioni flap del velivolo.'}),this.toggle('FRENO P','parkingBrake',()=>sys().parkingBrake,undefined,'Inserisce o rilascia il freno di parcheggio (Ctrl+.).'));
    if(def.controls?.retractableGear)this.footer.append(this.toggle('CARRELLO','gear',()=>sys().gearLever,undefined,'Estende o retrae il carrello (G). La retrazione è inibita a terra.'));
    if(def.controls?.spoilers)this.footer.append(this.toggle('AEROFRENI','spoilers',()=>sys().spoilerLever>0,undefined,'Estende o ritrae gli aerofreni. La regolazione e l’armamento sono sulla console sinistra.'));
  }

  setMode(mode) {
    if(!['full','mini','hidden'].includes(mode))return;
    this.mode=mode; this._modeChosen = true;
    if(mode==='mini')this.consoles={left:false,right:false};
    if(mode==='full'&&this.width>1000&&this.height>640)this.consoles={left:true,right:true};
    if(mode==='hidden')this.releaseHeld();
    this._visibility();
  }
  cycleMode() {
    // The separate touch PANNELLO button can always restore hidden instruments.
    // A full-height pedestal leaves no room for the flight pads in landscape.
    if (this.touch && this.height <= 500) this.setMode(this.mode === 'mini' ? 'hidden' : 'mini');
    else if (this.touch) this.setMode(this.mode === 'mini' ? 'full' : 'mini');
    else this.setMode(['full','mini','hidden'][(['full','mini','hidden'].indexOf(this.mode)+1)%3]);
  }
  setView(view){this.view=view;if(view!=='cockpit')this.releaseHeld();this._visibility();}
  setHudVisible(visible){this.hudVisible=!!visible;this._visibility();}
  toggleConsole(side){this.consoles[side]=!this.consoles[side];if(this.consoles[side]&&(this.touch||this.width<=1000||this.height<=640))this.consoles[side==='left'?'right':'left']=false;this._visibility();}
  setNight(night) {
    this.night = clamp(night, 0, 1);
    this.shell.style.filter = `brightness(${1 - this.night * (this.sim.fm?.systems.lights.panel ? 0.08 : 0.18)})`;
  }
  resize(width, height) {
    const wasCompact = this.width <= 1000 || this.height <= 640;
    this.width = width; this.height = height;
    const compact = width <= 1000 || height <= 640;
    if (this.touch && height <= 500 && this.mode === 'full') {
      this.mode = 'mini'; this.consoles = { left: false, right: false };
    }
    if (this.touch && !this._modeChosen && (width <= 1100 || height <= 700)) {
      this.mode = 'mini'; this.consoles = { left: false, right: false };
    } else if (this.shell && compact && !wasCompact) this.consoles = { left: false, right: false };
    this._nextUI = 0; this._nextGauge = 0;
    if (this.shell) this._visibility();
  }
  _visibility(){
    const visible=this.view==='cockpit'&&this.mode!=='hidden';
    this.shell.hidden=!visible;this.shell.classList.toggle('ca-mini',this.mode==='mini');
    this.left.hidden=!this.consoles.left;this.right.hidden=!this.consoles.right;
    this.leftToggle.setAttribute('aria-expanded',String(this.consoles.left));this.rightToggle.setAttribute('aria-expanded',String(this.consoles.right));
    this.hud.hidden=this.def?.panel!=='jet'||!this.hudVisible;
    this._nextUI = 0; this._nextGauge = 0;
    document.body.classList.toggle('cockpit-console-open', visible && this.touch && (this.consoles.left || this.consoles.right));
    this.updateLayoutVariables();
  }
  updateLayoutVariables(){
    const visible=!this.shell.hidden;
    document.documentElement.style.setProperty('--panel-h',`${visible?this.el.getBoundingClientRect().height:0}px`);
    const left=visible&&!this.left.hidden?this.left.getBoundingClientRect().width:0,right=visible&&!this.right.hidden?this.right.getBoundingClientRect().width:0;
    document.documentElement.style.setProperty('--console-w',`${Math.max(left,right)}px`);
    document.documentElement.style.setProperty('--console-left-w',`${left}px`);
    document.documentElement.style.setProperty('--console-right-w',`${right}px`);
  }
  update(){
    const{fm,instruments:i,ap}=this.sim;if(!fm||this.shell.hidden)return;
    const now = performance.now();
    if (now >= this._nextUI) {
      this._nextUI = now + 50; // Console DOM runs at 20 Hz; gauges remain independent.
      this.updateLayoutVariables();
      for (const { b, read } of this.switches) {
        const pressed = String(!!read());
        if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
      }
      for (const read of this.readouts) read();
      const sys = fm.systems;
      const status = `${num(sys.busVolts)} V · ${sys.parkingBrake ? 'FRENO P' : 'LIBERO'} · ${ap.engaged ? `AP ${ap.lateral}/${ap.vertical}` : 'MANUALE'}`;
      if (this.status.textContent !== status) this.status.textContent = status;
      this.status.style.color = sys.parkingBrake || sys.busVolts < 18 ? '#ffbd6a' : '#9bdba4';
    }
    if (this.touch && now < this._nextGauge) return;
    this._nextGauge = now + 1000 / 30;
    const rect=this.canvas.getBoundingClientRect();if(rect.width<100||rect.height<40)return;
    const dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,hh=rect.height;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(hh*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(hh*dpr);}
    const c=this.ctx;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,hh);
    if(this.mode==='mini')this.drawMini(c,w,hh,i,fm);else if(this.def.panel==='ga')this.drawAnalog(c,w,hh,i,fm,fm.engines[0]);else this.drawGlass(c,w,hh,i,fm);
    if(!this.hud.hidden)this.drawHud(i,fm);
  }

  text(c, text, x, y, size = 11, color = '#dce7eb', align = 'center') {
    c.font = `${size}px 'Consolas', monospace`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(text, x, y);
  }

  drawMini(c, w, hh, i, fm) {
    const cells = [['IAS', num(i.asi), 'kt'], ['ALT', num(i.alt), 'ft'], ['PRUA', heading(i.dg), '°'], ['V/S', num(i.vsi), 'ft/min'], ['POTENZA', num(this.sim.pilot.throttle * 100), '%'], ['CARBURANTE', num(fm.systems.fuelTotal), 'kg']];
    const visibleCells = this.touch && w < 480 ? cells.slice(0, 4) : cells;
    visibleCells.forEach(([label, value, unit], index) => {
      const x = w / visibleCells.length * (index + 0.5);
      this.text(c, label, x, 12, 9, '#91a5ae'); this.text(c, value, x, 32, 20, '#9bf0c0'); this.text(c, unit, x, 51, 9, '#91a5ae');
    });
  }

  dial(c, x, y, r, label, value, unit, needle, min, max, options = {}) {
    if (!Number.isFinite(r) || r <= 22) return;
    c.save(); c.translate(x, y);
    c.fillStyle = '#080e12'; c.strokeStyle = '#4b5b63'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
    const sweep = Math.PI * 1.5, start = Math.PI * 0.75;
    if (options.arc) {
      c.strokeStyle = options.arc; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, r - 7, start + sweep * 0.18, start + sweep * 0.72); c.stroke();
    }
    c.lineWidth = 1;
    for (let n = 0; n <= 10; n++) {
      const a = start + n / 10 * sweep;
      c.strokeStyle = '#b0c2ca'; c.beginPath(); c.moveTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5)); c.lineTo(Math.cos(a) * (r - (n % 2 ? 9 : 12)), Math.sin(a) * (r - (n % 2 ? 9 : 12))); c.stroke();
      if (n % 2 === 0) this.text(c, num(min + n / 10 * (max - min)), Math.cos(a) * (r - 21), Math.sin(a) * (r - 21), 8, '#aebdc4');
    }
    const a = start + clamp((needle - min) / (max - min), 0, 1) * sweep;
    c.strokeStyle = '#f8f6de'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-Math.cos(a) * 6, -Math.sin(a) * 6); c.lineTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12)); c.stroke();
    c.fillStyle = '#91a4ad'; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill();
    this.text(c, label, 0, -r * 0.3, 8, '#a5b6bf');
    c.fillStyle = '#132329'; c.fillRect(-26, r * .32 - 6, 52, 13);
    this.text(c, `${value}`, 0, r * .32, 11, '#e3f1ef'); this.text(c, unit, 0, r * .68, 7, '#8b9ca8');
    c.restore();
  }

  attitude(c, x, y, w, hh, i, round = false) {
    c.save(); c.translate(x, y);
    c.beginPath(); if (round) c.arc(0, 0, w / 2, 0, 7); else c.rect(-w/2, -hh/2, w, hh); c.clip();
    c.fillStyle = '#338cc6'; c.fillRect(-w, -hh, w * 2, hh * 2);
    c.save(); c.rotate(-i.aiRoll * Math.PI / 180); c.translate(0, i.aiPitch * hh / 50);
    c.fillStyle = '#98734a'; c.fillRect(-w * 4, 0, w * 8, hh * 10);
    c.strokeStyle = '#f2f1dc'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-w * 4, 0); c.lineTo(w * 4, 0); c.stroke();
    for (let pitch = -30; pitch <= 30; pitch += 5) {
      if (!pitch) continue;
      const yy = -pitch * hh / 50, size = pitch % 10 ? w * .12 : w * .25;
      c.beginPath(); c.moveTo(-size, yy); c.lineTo(size, yy); c.stroke();
      if (pitch % 10 === 0) this.text(c, String(Math.abs(pitch)), size + 10, yy, 8, '#fff');
    }
    c.restore();
    if (this.sim.ap?.fd && this.sim.fm?.systems.avionicsPowered) {
      const dx = clamp(this.sim.ap.phiCmd - i.aiRoll, -30, 30) * w / 100;
      const dy = -clamp(this.sim.ap.thetaCmd - i.aiPitch, -15, 15) * hh / 50;
      c.strokeStyle = '#ff83e3';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(dx, -hh * 0.25); c.lineTo(dx, hh * 0.25);
      c.moveTo(-w * 0.28, dy); c.lineTo(w * 0.28, dy);
      c.stroke();
    }
    c.strokeStyle = '#ffe876'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-w*.3, 0); c.lineTo(-w*.10, 0); c.lineTo(-w*.07, 5); c.lineTo(0,0); c.lineTo(w*.07,5); c.lineTo(w*.10,0); c.lineTo(w*.3,0); c.stroke();
    this.text(c, '▼', 0, -hh * .42, 11, '#ffdf6e');
    c.restore();
    c.strokeStyle = '#4b5b63'; c.lineWidth = 3; c.beginPath(); if (round) c.arc(x, y, w / 2, 0, 7); else c.rect(x-w/2, y-hh/2,w,hh); c.stroke();
  }

  drawAnalog(c, w, hh, i, fm, engine) {
    const pack = Math.min(w * .60, 430), radius = Math.min((hh - 16) / 4, (pack - 24) / 6);
    const centers = [pack/6, pack/2, pack*5/6], ys = [hh/4, hh*3/4];
    this.dial(c, centers[0], ys[0], radius, 'ANEMOMETRO', num(i.asi), 'KT', i.asi, 0, 200, { arc: '#70c28c' });
    this.attitude(c, centers[1], ys[0], radius*2, radius*2, i, true);
    this.dial(c, centers[2], ys[0], radius, 'ALTIMETRO', num(i.alt), 'FT', ((i.alt % 1000) + 1000) % 1000, 0, 1000);
    this.dial(c, centers[0], ys[1], radius, 'VIROMETRO', num(i.turnRate,1), '° / SEC', i.turnRate, -6, 6);
    this.dial(c, centers[1], ys[1], radius, 'DIREZIONALE', heading(i.dg), 'PRUA', i.dg, 0, 360);
    this.dial(c, centers[2], ys[1], radius, 'VARIOMETRO', num(i.vsi), 'FT / MIN', i.vsi, -2000, 2000);
    const x = pack + 12, ww = w - x - 12;
    c.fillStyle = '#071012'; c.fillRect(x, 10, ww, hh-20); c.strokeStyle = '#3b5159'; c.strokeRect(x, 10, ww, hh-20);
    this.text(c, 'NAV / COM', x + 12, 25, 10, '#72919c','left');
    if (fm.systems.avionicsPowered) {
      this.text(c, `${num(this.sim.nav1.active,2)}  NAV1  ${num(this.sim.nav1.standby,2)}`, x + 12, 45, 12, '#ffd28b','left');
      this.text(c, `${num(this.sim.com1.active,2)}  COM1 ${num(this.sim.com1.standby,2)}`, x + 12, 65, 12, '#ffd28b','left');
      this.text(c, `${this.sim.nav1.ident || '—'} · ${this.sim.nav1.valid ? num(this.sim.nav1.dme,1) + ' NM' : 'NESSUN SEGNALE'}`, x+12, 86, 10, '#a1d3c3','left');
    } else this.text(c, 'AVIONICA SPENTA', x + ww/2, 60, 12, '#866e54');
    c.strokeStyle = '#2b4148'; c.beginPath(); c.moveTo(x+10,98); c.lineTo(x+ww-10,98); c.stroke();
    const rows = [[`RPM  ${num(engine.rpm)}`, `MISCELA ${num(this.sim.pilot.mixture*100)}%`], [`CARB. ${num(fm.systems.fuelTotal)} kg`, `OLIO ${num(engine.oilPress)} psi`], [`QNH ${num(fm.kollsman/100)} hPa`, `${this.sim.nav1.valid ? 'CDI ' + num(this.sim.nav1.cdi, 2) : 'FLAP ' + this.def.controls.flapDetents[fm.systems.flapsLever].name}`]];
    rows.forEach(([a,b], index) => { this.text(c,a,x+12,116+index*24,10,'#b7c9c8','left'); if (ww > 235) this.text(c,b,x+ww*.52,116+index*24,10,'#b7c9c8','left'); });
  }

  drawGlass(c,w,hh,i,fm) {
    if (!fm.systems.avionicsPowered) { this.text(c, 'AVIONICA SPENTA', w/2,hh/2,14,'#a9845b'); return; }
    const x = w * .3, ww = Math.min(w * .40, 260), ah = hh - 38;
    this.attitude(c,x,hh/2,ww,ah,i);
    const tape = (xx,label,val,unit) => { c.fillStyle='#0b171c';c.fillRect(xx-37,12,74,hh-24);this.text(c,label,xx,26,9,'#8cb7cd');this.text(c,num(val),xx,hh/2,22,'#f3faf8');this.text(c,unit,xx,hh-22,9,'#88a3b5'); };
    tape(42,'IAS',i.asi,'KT'); tape(w*.58,'ALT',i.alt,'FT');
    this.text(c, `HDG ${heading(i.dg)}    V/S ${num(i.vsi)}`, x,hh-8,11,'#a1e4f2');
    const xx=w*.69, tx=w*.98;
    this.text(c, 'MOTORE / SISTEMI', xx,18,10,'#7ec6d4','left');
    fm.engines.forEach((engine,index) => {
      const y=45+index*32;
      this.text(c,`N1 ${index+1}`,xx,y,10,'#adbdc5','left');
      this.text(c,`${num(engine.n1,1)} %`,tx,y,17,'#8ef7ae','right');
      c.fillStyle='#20373b';c.fillRect(xx,y+11,tx-xx,3);c.fillStyle='#8ef7ae';c.fillRect(xx,y+11,(tx-xx)*clamp(engine.n1/100,0,1),3);
    });
    this.text(c,`CARB. ${num(fm.systems.fuelTotal)} KG`,xx,hh-62,11,'#d5e5e9','left');
    this.text(c,`CARRELLO ${fm.systems.gearPos>.98?'▼ ▼ ▼':fm.systems.gearPos<.02?'SU':'TRANSITO'}`,xx,hh-41,11,fm.systems.gearPos>.98?'#91eea8':'#ffd06d','left');
    this.text(c,`FLAP ${this.def.controls.flapDetents[fm.systems.flapsLever].name}`,xx,hh-21,11,'#d5e5e9','left');
  }

  drawHud(i, fm) {
    const c = this.hud.getContext('2d'); c.setTransform(2,0,0,2,0,0); c.clearRect(0,0,360,230);
    if (!fm.systems.avionicsPowered) return;
    c.strokeStyle='#9bff9e'; c.lineWidth=1; c.shadowColor='#43e85f';c.shadowBlur=3;
    this.text(c,`${heading(fm.heading)}`,180,18,15,'#a6ff9b');this.text(c,`${num(i.asi)} KT`,38,65,14,'#a6ff9b');this.text(c,`${num(i.alt)} FT`,316,65,14,'#a6ff9b');
    c.save();c.translate(180,115);c.rotate(-fm.roll*Math.PI/180);
    for(let p=-20;p<=20;p+=10){const yy=(fm.pitch-p)*3;if(Math.abs(yy)>90)continue;c.beginPath();c.moveTo(-50,yy);c.lineTo(-15,yy);c.moveTo(15,yy);c.lineTo(50,yy);c.stroke();this.text(c,String(p),-65,yy,10,'#a6ff9b');}c.restore();
    c.beginPath();c.moveTo(150,115);c.lineTo(170,115);c.moveTo(190,115);c.lineTo(210,115);c.moveTo(180,105);c.lineTo(180,115);c.stroke();
    this.text(c,`${num(fm.nz,1)} G`,40,203,12,'#a6ff9b');this.text(c,`RA ${num(fm.aglFt)}`,300,203,12,'#a6ff9b');
    c.shadowBlur=0;
  }
}
