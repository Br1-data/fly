// Operational reminders, with live checks where the simulation exposes a switch or state.
const item = (text, value, check) => ({ text, value, check });
export function getChecklists(def) {
  const jet = def.engines[0].type !== 'piston';
  const retractable = def.controls.retractableGear;
  return [
    { id: 'prima-avviamento', title: 'Prima dell’avviamento', items: [
      item('Freno di parcheggio', 'INSERITO', (s) => s.fm.systems.parkingBrake),
      item('Batteria', 'ON', (s) => s.fm.systems.battery),
      item('Carburante', 'VERIFICATO', (s) => s.fm.systems.fuelTotal > 0),
      item('Luce anticollisione', 'ON', (s) => s.fm.systems.lights.beacon),
      item('Area dell’elica / motori', 'LIBERA'),
    ] },
    { id: 'avviamento', title: jet ? 'Avviamento turbine' : 'Avviamento motore', items: jet ? [
      item('Batteria', 'ON', (s) => s.fm.systems.battery),
      ...(def.id === 'airliner' ? [item('APU MASTER', 'ON', (s) => s.fm.systems.apuMaster), item('APU BLEED', 'ON', (s) => s.fm.systems.apuBleed)] : []),
      item('ENG MASTER', 'ON', (s) => s.engineMaster.every(Boolean)),
      item('Avviamento', 'IGN / START'),
      item('Motori', 'STABILIZZATI', (s) => s.fm.engines.every((e) => e.running)),
      item('Alternatore e avionica', 'ON', (s) => s.fm.systems.alternator && s.fm.systems.avionicsPowered),
      item('Avviamento automatico', 'Ctrl+E (facoltativo)'),
    ] : [
      item('Selettore carburante', 'ENTRAMBI', (s) => s.fm.systems.fuelSelector === 'both'),
      item('Miscela', 'RICCA', (s) => s.pilot.mixture > 0.95),
      item('Manetta', 'APPENA APERTA', (s) => s.pilot.throttle >= 0.05 && s.pilot.throttle <= 0.2),
      item('Magneti', 'START → BOTH', (s) => s.fm.engines[0].running && s.fm.engines[0].magnetos === 3),
      item('Pressione olio', 'VERIFICATA', (s) => s.fm.engines[0].oilPress > 20),
      item('Alternatore e avionica', 'ON', (s) => s.fm.systems.alternator && s.fm.systems.avionicsPowered),
      item('Avviamento automatico', 'Ctrl+E (facoltativo)'),
    ] },
    { id: 'prima-decollo', title: 'Prima del decollo', items: [
      item('Comandi di volo', 'LIBERI E CORRETTI'),
      item('Motori', 'OPERATIVI', (s) => s.fm.engines.every((e) => e.running)),
      item('Altimetro', 'QNH LOCALE', (s) => Math.abs(s.fm.kollsman - s.atm.qnh) < 100),
      item('Flap', 'CONFIGURAZIONE DECOLLO'),
      item('Trim', 'DECOLLO'),
      item('Luci di atterraggio', 'ON', (s) => s.fm.systems.lights.landing),
      item('Freno di parcheggio', 'RILASCIATO', (s) => !s.fm.systems.parkingBrake),
      item('Velocità di rotazione', `${def.speeds.vr} kt`),
    ] },
    { id: 'salita-crociera', title: 'Salita e crociera', items: [
      ...(retractable ? [item('Carrello', 'SU, SALITA POSITIVA', (s) => s.fm.systems.gearPos < 0.01)] : []),
      item('Flap', 'RETRATTI', (s) => s.fm.systems.flaps < 0.01),
      item('Potenza', 'REGOLATA'),
      item('Carburante', 'QUANTITÀ VERIFICATA'),
      item('Navigazione e rotta', 'VERIFICATE'),
      item('Autopilota', 'SE NECESSARIO'),
    ] },
    { id: 'atterraggio', title: 'Avvicinamento e atterraggio', items: [
      item('Aeroporto e pista', 'IDENTIFICATI'),
      item('Altimetro', 'QNH LOCALE', (s) => Math.abs(s.fm.kollsman - s.atm.qnh) < 100),
      ...(jet ? [item('Autobrake', 'SELEZIONATO', (s) => s.fm.systems.autobrake > 0), item('Spoiler', 'ARMATI', (s) => s.fm.systems.spoilersArmed)] : [item('Miscela', 'RICCA', (s) => s.pilot.mixture > 0.95)]),
      item('Carrello', retractable ? 'GIÙ, VERIFICATO' : 'FISSO', (s) => s.fm.systems.gearPos > 0.99),
      item('Flap', 'ATTERRAGGIO', (s) => s.fm.systems.flapsLever === def.controls.flapDetents.length - 1),
      item('Velocità di avvicinamento', `${def.speeds.vapp} kt`),
      item('Freno di parcheggio', 'RILASCIATO', (s) => !s.fm.systems.parkingBrake),
    ] },
    { id: 'dopo-volo', title: 'Dopo il volo', items: [
      item('Velivolo', 'FERMO', (s) => s.fm.onGround && s.fm.gsKt < 1),
      item('Flap', 'RETRATTI', (s) => s.fm.systems.flaps < 0.01),
      item('Freno di parcheggio', 'INSERITO', (s) => s.fm.systems.parkingBrake),
      item('Motori', 'SPENTI', (s) => s.fm.engines.every((e) => !e.running)),
      item('Avionica e batteria', 'OFF', (s) => !s.fm.systems.avionics && !s.fm.systems.battery),
    ] },
  ];
}
