// Bootstrap: load modules, check WebGL2, start the application, show fatal errors in Italian.
import { App } from './app.js';

function showError(err) {
  if (document.getElementById('fatal-error')) return;
  const msg = (err && (err.stack || err.message)) || String(err);
  const el = document.createElement('div');
  el.id = 'fatal-error';
  el.innerHTML = `<div class="dialog"><h1>Si è verificato un errore</h1>
    <p>Il simulatore ha incontrato un problema imprevisto. Prova a riavviarlo; se il problema persiste
    aggiorna i driver della scheda video.</p><pre></pre>
    <div class="dialog-actions"><button type="button" class="primary">Ricarica</button>
    <button type="button" class="ghost">Chiudi</button></div></div>`;
  el.querySelector('pre').textContent = msg.slice(0, 4000);
  el.querySelector('.primary').onclick = () => location.reload();
  el.querySelector('.ghost').onclick = () => el.remove();
  document.body.appendChild(el);
}

window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));
window.addEventListener('cieli:error', (e) => showError(e.detail));

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  if (!hasWebGL2()) {
    showError(new Error('WebGL2 non disponibile: la scheda video o il browser non supportano la grafica 3D richiesta.'));
    return;
  }
  const [{ SceneRenderer }, { Cockpit }, { InputManager }, { AudioEngine }, { MISSIONS }, { MissionRunner }, progress, { getChecklists }] = await Promise.all([
    import('./render/renderer.js'),
    import('./cockpit/cockpit.js'),
    import('./input/input.js'),
    import('./audio/audio.js'),
    import('./missions/missions.js'),
    import('./missions/runner.js'),
    import('./missions/progress.js'),
    import('./missions/checklists.js'),
  ]);
  const app = new App({
    canvas: document.getElementById('view3d'),
    roots: {
      cockpit: document.getElementById('cockpit-root'),
      hud: document.getElementById('hud-root'),
      screens: document.getElementById('screen-root'),
      overlay: document.getElementById('overlay-root'),
    },
    deps: { SceneRenderer, Cockpit, InputManager, AudioEngine, MISSIONS, MissionRunner, loadResults: progress.loadResults, saveResult: progress.saveResult, getChecklists },
  });
  window.__cieli = app; // handy for debugging and automated tests
  await app.start();
}

boot().catch(showError);
