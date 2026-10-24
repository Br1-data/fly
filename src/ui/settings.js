// Settings: graphics, audio, realism, interface.
import { h, button, segmented, slider, checkbox } from './dom.js';

export class SettingsScreen {
  constructor(app, { back }) {
    const s = app.settings;
    const apply = () => app.applySettings();
    const R = s.realism;
    const real = (key, label, hint) =>
      checkbox({
        label,
        hint,
        checked: R[key],
        onChange: (v) => {
          R[key] = v;
          apply();
        },
      });
    this.el = h(
      'div.screen.settings',
      h(
        'div.panel.wide',
        h('header.panel-head', button('← Indietro', back, 'ghost'), h('h1', 'Impostazioni')),
        h(
          'div.panel-body.settings-grid',
          h(
            'section',
            h('h2', 'Grafica'),
            h(
              'div.field',
              h('span.field-label', 'Qualità'),
              segmented(
                [
                  { value: 'low', label: 'Bassa' },
                  { value: 'medium', label: 'Media' },
                  { value: 'high', label: 'Alta' },
                ],
                s.quality,
                (v) => {
                  s.quality = v;
                  apply();
                },
              ),
            ),
            h('p.muted', 'Bassa: PC portatili e grafica integrata. Alta: schede video dedicate (ombre e vegetazione più dense, terreno più dettagliato).'),
            h(
              'div.field',
              h('span.field-label', 'Vista iniziale'),
              segmented(
                [
                  { value: 'cockpit', label: 'Cockpit' },
                  { value: 'chase', label: 'Esterna' },
                ],
                s.defaultView,
                (v) => {
                  s.defaultView = v;
                  apply();
                },
              ),
            ),
            checkbox({
              label: 'Barra informazioni di volo nelle viste esterne',
              checked: s.showHud,
              onChange: (v) => {
                s.showHud = v;
                app.showHud = v;
                apply();
              },
            }),
          ),
          h(
            'section',
            h('h2', 'Audio'),
            slider({
              label: 'Volume generale',
              min: 0,
              max: 1,
              step: 0.05,
              value: s.volume,
              format: (v) => `${Math.round(v * 100)} %`,
              onInput: (v) => {
                s.volume = v;
                apply();
              },
            }),
            checkbox({
              label: 'Disattiva audio',
              checked: s.muted,
              onChange: (v) => {
                s.muted = v;
                app.audio?.setMuted(v || app.state !== 'flight');
                apply();
              },
            }),
          ),
          h(
            'section.span2',
            h('h2', 'Realismo'),
            h(
              'div.check-grid',
              real('crashes', 'Danni e incidenti', 'Atterraggi duri, impatti e sovraccarichi distruggono il velivolo'),
              real('gyroDrift', 'Deriva del giroscopio direzionale', 'Il DG va riallineato alla bussola (tasto D)'),
              real('icing', 'Formazione di ghiaccio', 'Pitot, carburatore e cellula in nube sotto zero'),
              real('carbIce', 'Ghiaccio al carburatore', 'Usa il riscaldamento carburatore (Shift+H)'),
              real('fbwNormalLaw', 'Fly-by-wire in legge normale (AX-320)', 'Protezioni di inviluppo, assetto mantenuto'),
              real('autoRudder', 'Pedaliera automatica', 'Coordina virate e sterzo a terra con gli alettoni (facilitato)'),
              real('unlimitedFuel', 'Carburante illimitato', ''),
            ),
          ),
        ),
      ),
    );
  }
}
