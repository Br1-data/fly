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
  await page.getByRole('button', { name: /Volo libero/ }).click();
  await page.getByRole('button', { name: /Vola!/ }).click();
  await ready('flight');
  check('Volo libero avviato dal menu', await page.evaluate(() => window.__cieli.flightSim.def.id === 'trainer'));
  await page.getByRole('button', { name: 'FRENO P', exact: true }).click();
  check('Cockpit: freno di parcheggio cliccabile', await page.evaluate(() => window.__cieli.flightSim.fm.systems.parkingBrake));
  const headingBefore = await page.evaluate(() => window.__cieli.flightSim.ap.hdgBug);
  await page.getByRole('button', { name: 'Aumenta HDG', exact: true }).click();
  check('Cockpit: manopola di prua', await page.evaluate(() => window.__cieli.flightSim.ap.hdgBug) === (headingBefore + 1) % 360);
  await page.keyboard.press('F4');
  check('Tastiera: manetta massima', await page.evaluate(() => window.__cieli.flightSim.pilot.throttle === 1));
  await page.keyboard.press('F1');
  await page.keyboard.press('F7');
  check('Tastiera: flap', await page.evaluate(() => window.__cieli.flightSim.fm.systems.flapsLever > 0));
  await page.keyboard.press('KeyK');
  await page.locator('.checklist-overlay.visible').waitFor();
  check('Checklist del velivolo', await page.locator('.cl-items li').count() > 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyM');
  await page.locator('.map-overlay.visible').waitFor();
  check('Mappa navigabile', await page.locator('.map-canvas').isVisible());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Impostazioni/ }).click();
  check('Pausa: input disattivato nelle impostazioni', await page.evaluate(() => window.__cieli.state === 'flight-settings' && window.__cieli.flightSim.paused));
  const before = await page.evaluate(() => window.__cieli.flightSim.pilot.throttle);
  await page.keyboard.press('F4');
  check('I menu non modificano la manetta', await page.evaluate(() => window.__cieli.flightSim.pilot.throttle) === before);
  await page.getByRole('button', { name: /Indietro/ }).click();
  await page.getByRole('button', { name: /Riprendi/ }).click();
  await ready('flight');
  check('Ripresa del volo', await page.evaluate(() => !window.__cieli.flightSim.paused));
  await page.getByRole('button', { name: /Aiuto.*F12/ }).click();
  await page.getByRole('dialog', { name: 'Aiuto al volo' }).waitFor();
  check('Aiuto: mette in pausa e disabilita i comandi', await page.evaluate(() => window.__cieli.flightSim.paused && !window.__cieli.input.enabled && document.getElementById('cockpit-root').inert));
  await page.getByRole('tab', { name: 'Glossario' }).click();
  await page.getByRole('searchbox').fill('QNH');
  check('Glossario: ricerca e spiegazione del QNH', await page.locator('.help-term').count() > 0 && (await page.locator('.help-term').first().textContent()).toLowerCase().includes('pressione'));
  await page.screenshot({ path: path.join(output, 'help-glossary.png') });
  await page.getByRole('tab', { name: 'Comandi', exact: true }).click();
  await page.getByRole('searchbox').fill('NAV2');
  check('Aiuto: include comandi del cockpit senza scorciatoia', await page.locator('.help-cockpit-item').count() > 0);
  await page.keyboard.press('F12');
  check('F12 funziona nei campi e ripristina il volo', await page.evaluate(() => !window.__cieli.overlay && !window.__cieli.flightSim.paused && window.__cieli.input.enabled));
  await page.keyboard.press('KeyP');
  await page.keyboard.press('F12');
  await page.keyboard.press('Escape');
  check('Aiuto: conserva la pausa precedente', await page.evaluate(() => window.__cieli.flightSim.paused && window.__cieli.input.enabled));
  await page.keyboard.press('KeyP');
  await page.keyboard.press('Escape');
  await page.locator('.overlay.visible .dialog.pause').waitFor();
  await page.locator('.overlay.visible').getByRole('button', { name: /Aiuto e glossario/ }).click();
  await page.getByRole('dialog', { name: 'Aiuto al volo' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.overlay.visible .dialog.pause').waitFor();
  check('Aiuto: torna al menu di pausa', await page.locator('.overlay.visible .dialog.pause').count() === 1 && await page.evaluate(() => window.__cieli.flightSim.paused && !window.__cieli.input.enabled));
  await page.locator('.overlay.visible').getByRole('button', { name: /Riprendi/ }).click();
  await page.screenshot({ path: path.join(output, 'trainer.png') });
  await page.setViewportSize({ width: 800, height: 640 });
  await page.getByRole('button', { name: 'Mostra o nascondi console impianti' }).click();
  await page.getByRole('button', { name: 'Antighiaccio', exact: true }).click();
  check('Console sinistra accessibile su schermi piccoli', await page.evaluate(() => window.__cieli.flightSim.fm.systems.antiIce));
  await page.getByRole('button', { name: 'Mostra o nascondi console radio' }).click();
  check('Console compatte: alternanza senza perdere comandi', await page.locator('.ca-right').isVisible() && !await page.locator('.ca-left').isVisible());
  const navStandby = await page.evaluate(() => window.__cieli.flightSim.nav2.standby);
  await page.getByRole('button', { name: 'Aumenta NAV2', exact: true }).click();
  await page.getByRole('button', { name: 'Scambia NAV2', exact: true }).click();
  check('Console radio: sintonia e scambio NAV2', Math.abs(await page.evaluate(() => window.__cieli.flightSim.nav2.active) - navStandby - 0.05) < 0.001);
  await page.getByRole('combobox', { name: 'Cifra transponder 1' }).selectOption('4');
  check('Console radio: transponder utilizzabile', await page.evaluate(() => window.__cieli.flightSim.xpdr.code === 4000));
  await page.screenshot({ path: path.join(output, 'cockpit-compact.png') });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForFunction(() => window.__cieli.cockpit.width === 1366);
  for (const name of ['Mostra o nascondi console impianti', 'Mostra o nascondi console radio']) {
    const toggle = page.getByRole('button', { name });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }

  for (const aircraft of ['airliner', 'jet']) {
    await page.evaluate(async (id) => {
      const app = window.__cieli;
      await app.startFlight({ aircraft: id, start: { type: 'air', airport: 'XAQU', altitudeFt: 5000, speedKt: id === 'jet' ? 300 : 240 }, time: 14 }, null);
    }, aircraft);
    await ready('flight');
    await page.screenshot({ path: path.join(output, `${aircraft}-cockpit.png`) });
    await page.keyboard.press('KeyS');
    await page.waitForFunction(() => window.__cieli.renderer.getStats().triangles > 0);
    check(`Velivolo ${aircraft}: simulazione e vista esterna`, await page.evaluate((id) => window.__cieli.flightSim.def.id === id && window.__cieli.view === 'chase' && Number.isFinite(window.__cieli.flightSim.fm.altFt), aircraft));
    await page.screenshot({ path: path.join(output, `${aircraft}.png`) });
  }
  await page.evaluate(() => window.__cieli.showMainMenu());
  await page.getByRole('button', { name: /Missioni/ }).click();
  check('Catalogo di 13 missioni', await page.locator('.mission-card').count() === 13);
  await page.getByRole('button', { name: /Inizia la missione/ }).click();
  await ready('flight');
  check('Missione attiva con obiettivi', await page.evaluate(() => window.__cieli.runner?.status === 'running' && window.__cieli.runner.objectives.length > 0));
  await page.keyboard.press('F12');
  const missionTime = await page.evaluate(() => window.__cieli.runner.elapsed);
  await page.waitForTimeout(300);
  check('Aiuto: il timer della missione resta fermo', await page.evaluate(() => window.__cieli.runner.elapsed) === missionTime);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(output, 'mission.png') });
  await page.evaluate(() => {
    const app = window.__cieli;
    app.flightSim.events.push({ type: 'crash', reason: 'Smoke test' });
    app._dispatchEvents();
  });
  await page.evaluate(async () => { await window.__cieli.restartFlight(); });
  // restartFlight starts an asynchronous transition; wait until that transition finishes.
  await ready('flight');
  check('Riavvio: timer e overlay del volo precedente eliminati', await page.evaluate(() => !window.__cieli._crashTimer && !window.__cieli._debriefTimer && !window.__cieli.map.visible && !window.__cieli.checklist.visible && !window.__cieli.overlay));
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
