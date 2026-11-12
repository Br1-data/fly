// Real browser integration test. Uses a private ephemeral server and no external services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')];
const executablePath = candidates.find((p) => p && fs.existsSync(p));
assert.ok(executablePath, 'Install Chromium/Chrome or set CHROMIUM_PATH to its executable.');
const output = path.join(root, '.smoke');
fs.mkdirSync(output, { recursive: true });
const basePath = process.env.SMOKE_BASE_PATH || '/';
const server = await startServer(0, { directory: process.env.SMOKE_ROOT || root, basePath });
let browser;
let page;
const errors = [];
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log(`✓ ${name}`); };
try {
  browser = await chromium.launch({ executablePath, headless: true, args: [
    '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
  ] });
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${new URL(r.url()).pathname}`); });
  const ready = async (state) => {
    await page.waitForFunction((value) => window.__cieli?.state === value, state, { timeout: 90000 });
    await page.locator('.loading-screen').waitFor({ state: 'detached' });
  };
  const fatal = async () => check('Nessun errore nel browser', errors.length === 0 && await page.locator('#fatal-error').count() === 0);
  await page.goto(`http://127.0.0.1:${server.address().port}/${basePath.split('/').filter(Boolean).join('/')}${basePath === '/' ? '' : '/'}`);
  await ready('menu');
  check('Menu iniziale e scena 3D', await page.evaluate(() => window.__cieli.renderer.getStats().triangles > 0));
  await page.screenshot({ path: path.join(output, 'menu.png') });
  const sim = (fn) => page.evaluate(fn);

  // Free flight: capsule near the station (defaults).
  await page.getByRole('button', { name: /Volo libero/ }).click();
  await page.getByRole('button', { name: /Rondine CR-4/ }).click();
  await page.getByRole('button', { name: /Vicino alla Stazione Aurora/ }).click();
  await page.getByRole('button', { name: /Parti!/ }).click();
  await ready('flight');
  check('Volo libero avviato dal menu', await sim(() => window.__cieli.flightSim.def.id === 'capsule' && window.__cieli.flightSim.target?.object?.id === 'aurora'));
  check('Porta di prua a 150 m', await sim(() => Math.abs(window.__cieli.flightSim.info.port.range - 150) < 5));
  await page.keyboard.press('KeyZ');
  check('Tastiera: manetta massima', await sim(() => window.__cieli.flightSim.pilot.throttle === 1));
  await page.keyboard.press('KeyX');
  await page.keyboard.press('Digit3');
  check('Tastiera: SAS retrograde', await sim(() => window.__cieli.flightSim.sas.mode === 'retrograde'));
  await page.locator('.fu-sasbtn', { hasText: /^PRO$/ }).click();
  check('Pulsante SAS prograde', await sim(() => window.__cieli.flightSim.sas.mode === 'prograde'));
  await page.getByRole('button', { name: /Computer di navigazione/ }).click();
  await page.locator('.fu-nav.open').waitFor();
  await page.getByRole('button', { name: 'Circolarizza all’apoasse' }).click();
  await page.waitForFunction(() => !!window.__cieli.flightSim.node);
  check('Computer di navigazione: nodo di manovra', await sim(() => Number.isFinite(window.__cieli.flightSim.node.pro)));
  await page.getByRole('button', { name: 'Elimina nodo' }).click();
  check('Nodo eliminato', await sim(() => !window.__cieli.flightSim.node));
  await page.keyboard.press('KeyO');
  await page.keyboard.press('F8');
  check('Guida ai comandi (F8)', await page.locator('.fu-keys.open').count() === 1 && await page.locator('.fu-keys li').count() > 20);
  await page.keyboard.press('F8');
  check('Guida ai comandi chiusa', await page.locator('.fu-keys.open').count() === 0);
  await page.keyboard.press('KeyM');
  check('Mappa orbitale', await sim(() => window.__cieli.view === 'map'));
  await page.screenshot({ path: path.join(output, 'map.png') });
  await page.keyboard.press('KeyM');
  check('Ritorno dalla mappa', await sim(() => window.__cieli.view !== 'map'));
  await page.keyboard.press('Period');
  await page.keyboard.press('Period');
  check('Accelerazione del tempo', await sim(() => window.__cieli.flightSim.warpIndex > 0));
  await page.keyboard.press('Slash');
  check('Tempo reale', await sim(() => window.__cieli.flightSim.warpIndex === 0));

  // Pause menu and settings.
  await page.keyboard.press('Escape');
  await page.locator('.overlay.visible .dialog.pause').waitFor();
  await page.locator('.overlay.visible').getByRole('button', { name: /Impostazioni/ }).click();
  check('Pausa: input disattivato nelle impostazioni', await sim(() => window.__cieli.state === 'flight-settings' && window.__cieli.flightSim.paused));
  const before = await sim(() => window.__cieli.flightSim.pilot.throttle);
  await page.keyboard.press('KeyZ');
  check('I menu non modificano la manetta', await sim(() => window.__cieli.flightSim.pilot.throttle) === before);
  await page.getByRole('button', { name: /Indietro/ }).click();
  await page.locator('.overlay.visible').getByRole('button', { name: /Riprendi/ }).click();
  await ready('flight');
  check('Ripresa del volo', await sim(() => !window.__cieli.flightSim.paused && window.__cieli.input.enabled));

  // Help and glossary.
  await page.getByRole('button', { name: /Aiuto e glossario \(F12\)/ }).click();
  await page.getByRole('dialog', { name: 'Aiuto al volo' }).waitFor();
  check('Aiuto: mette in pausa e disabilita i comandi', await sim(() => window.__cieli.flightSim.paused && !window.__cieli.input.enabled));
  await page.getByRole('tab', { name: 'Glossario' }).click();
  await page.getByRole('searchbox').fill('periasse');
  check('Glossario: ricerca del periasse', await page.locator('.help-term').count() > 0);
  await page.screenshot({ path: path.join(output, 'help-glossary.png') });
  await page.keyboard.press('F12');
  check('F12 chiude l’aiuto e riprende il volo', await sim(() => !window.__cieli.overlay && !window.__cieli.flightSim.paused && window.__cieli.input.enabled));
  await page.screenshot({ path: path.join(output, 'capsule.png') });

  // Every vehicle in a suitable place.
  const flights = [
    ['pod', { type: 'near', object: 'aurora', port: 'prua', distance: 60 }, { id: 'aurora', port: 'prua' }],
    ['translunar', { type: 'orbit', body: 'earth', altitude: 300e3, inclination: 28 }, 'moon'],
    ['lander', { type: 'hover', site: 'tranquillitatis', altitude: 500 }, null],
    ['spaceplane', { type: 'approach', site: 'grottaglie', altitude: 9000, north: 30000, east: -4000, heading: 172, pitch: -6, vel: [10, -205, -12] }, null],
    ['rocket', { type: 'surface', site: 'malindi' }, null],
    ['ntr', { type: 'orbit', body: 'mars', altitude: 500e3, inclination: 3 }, 'phobos'],
  ];
  for (const [ship, start, target] of flights) {
    await page.evaluate(async ([s, st, tg]) => { await window.__cieli.startFlight({ ship: s, start: st, target: tg, date: '2033-11-01T00:00:00Z' }, null); }, [ship, start, target]);
    await ready('flight');
    await page.waitForTimeout(400);
    check(`Veicolo ${ship}: simulazione e vista`, await page.evaluate((id) => {
      const app = window.__cieli;
      return app.flightSim.def.id === id && Number.isFinite(app.flightSim.info.altitude) && !app.flightSim.crashed && app.renderer.getStats().triangles > 0;
    }, ship));
    await page.screenshot({ path: path.join(output, `${ship}.png`) });
  }
  await page.keyboard.press('F9');
  check('Vista cockpit', await sim(() => window.__cieli.view === 'cockpit'));
  await page.screenshot({ path: path.join(output, 'ntr-cockpit.png') });

  // Missions.
  await page.evaluate(() => window.__cieli.showMainMenu());
  await page.getByRole('button', { name: /Missioni/ }).click();
  const catalogue = await page.evaluate(async () => {
    const { MISSIONS } = await import(new URL('src/missions/missions.js', document.baseURI).href);
    return { all: MISSIONS.length, moon: MISSIONS.filter((m) => m.category === 'luna').length };
  });
  check(`Catalogo di ${catalogue.all} missioni`, catalogue.all >= 15 && await page.locator('.mission-card').count() === catalogue.all);
  await page.locator('.missions').getByRole('button', { name: 'Luna', exact: true }).click();
  check(`Filtro missioni lunari (${catalogue.moon})`, await page.locator('.mission-card').count() === catalogue.moon);
  await page.locator('.missions').getByRole('button', { name: 'Tutte', exact: true }).click();
  await page.getByRole('button', { name: /Inizia la missione/ }).click();
  await ready('flight');
  check('Missione attiva con obiettivi', await sim(() => window.__cieli.runner?.status === 'running' && window.__cieli.runner.objectives.length > 0));
  await page.keyboard.press('F12');
  const missionTime = await sim(() => window.__cieli.runner.elapsed);
  await page.waitForTimeout(300);
  check('Aiuto: il timer della missione resta fermo', await sim(() => window.__cieli.runner.elapsed) === missionTime);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(output, 'mission.png') });
  await page.evaluate(() => {
    const app = window.__cieli;
    app.flightSim.events.push({ type: 'crash', reason: 'Smoke test' });
    app._dispatchEvents();
  });
  await page.evaluate(async () => { await window.__cieli.restartFlight(); });
  await ready('flight');
  check('Riavvio: timer e overlay del volo precedente eliminati', await sim(() => !window.__cieli._crashTimer && !window.__cieli._debriefTimer && !window.__cieli.overlay && window.__cieli.runner?.status === 'running'));
  await fatal();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: true, checks, errors }, null, 2));
  console.log(`Smoke completato: ${checks.length} verifiche. Screenshot in .smoke/`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: false, checks, errors, failure: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
