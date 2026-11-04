// Settings: graphics, audio, realism, interface.
import { h, button, segmented, slider, checkbox, select } from './dom.js';

export class SettingsScreen {
  constructor(app, { back }) {
    this.app = app;
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
            h('p.muted', 'Bassa: smartphone, portatili e grafica integrata (senza ombre, meno nubi e alberi). Media e Alta: ombra del velivolo, faro di atterraggio, nubi e boschi più densi; Alta aggiunge orizzonte più lontano e ombre più nitide.'),
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
            this.voiceField(s, apply),
            slider({
              label: 'Velocità della voce',
              min: 0.75,
              max: 1.35,
              step: 0.05,
              value: s.voiceRate ?? 1,
              format: (v) => `${Math.round(v * 100)} %`,
              onInput: (v) => {
                s.voiceRate = v;
                apply();
              },
            }),
            button('Prova la voce', () => this.testVoice(), 'ghost'),
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

  /** Voice list: the best Italian voice by default, any installed Italian voice, or none. */
  voiceField(s, apply) {
    const speech = this.app.audio?.speech;
    const voices = speech?.italianVoices?.() || [];
    const options = [{ value: '', label: voices.length ? `Automatica (${voices[0].name})` : 'Automatica' },
      ...voices.map((v) => ({ value: v.name, label: `${v.name}${/natural|neural|online|google|premium|enhanced/i.test(v.name) ? ' ★' : ''}` })),
      { value: 'off', label: 'Nessuna voce (solo testo)' }];
    const field = select({ label: 'Voce ATIS e callout', options, value: s.voice || '', onChange: (v) => {
      s.voice = v;
      apply();
    } });
    if (!voices.length) field.appendChild(h('small.muted', speech?.available ? 'Nessuna voce italiana installata: il sistema userà quella predefinita. Su Windows aggiungi «Italiano» in Impostazioni › Ora e lingua › Voce.' : 'Questo browser non supporta la sintesi vocale.'));
    // Voices load asynchronously in Chrome and Safari: refresh the list once they arrive.
    if (!voices.length && speech?.synth?.addEventListener && !this._voiceRetry) {
      this._voiceRetry = true;
      speech.synth.addEventListener('voiceschanged', () => field.replaceWith(this.voiceField(s, apply)), { once: true });
    }
    return field;
  }

  testVoice() {
    const audio = this.app.audio;
    audio?.resume?.();
    audio?.speech?.stop();
    audio?.speech?.radio('Aquila Internazionale informazioni Bravo. Pista in uso 25. Vento 250 gradi 8 nodi. QNH 1018. Informate di aver ricevuto Bravo.');
  }
}
