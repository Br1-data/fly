// Phone/tablet integration checks with real Chromium multi-touch pointer dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find((p) => p && fs.existsSync(p));
assert.ok(executablePath, 'Install Chromium/Chrome or set CHROMIUM_PATH.');
const prefix = '/' + (process.env.SMOKE_BASE_PATH || '/').split('/').filter(Boolean).join('/');
const basePath = prefix === '/' ? '/' : prefix + '/';
const server = await startServer(0, { directory: process.env.SMOKE_ROOT || root, basePath });
const output = path.join(root, '.smoke/mobile');
fs.mkdirSync(output, { recursive: true });
let browser, page;
const errors = [], checks = [];
const check = (label, value) => { assert.ok(value, label); checks.push(label); console.log(`✓ ${label}`); };
const point = (id, x, y) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 });
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  const client = await context.newCDPSession(page);
  const touch = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  const ready = async (state) => {
    await page.waitForFunction((s) => window.__cieli?.state === s, state, { timeout: 90000 });
    await page.locator('.loading-screen').waitFor({ state: 'detached' });
  };
  const bounds = async (locator) => { const b = await locator.boundingBox(); assert.ok(b); return b; };
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await page.goto(`http://127.0.0.1:${server.address().port}${basePath}`);
  await ready('menu');
  check('Smartphone: qualità leggera automatica e menu senza overflow', await noOverflow() && await page.evaluate(() => window.__cieli.settings.quality === 'low' && window.__cieli.renderer.webgl.getPixelRatio() <= 1));
  await page.screenshot({ path: path.join(output, 'phone-menu.png') });
  await page.getByRole('button', { name: /Aiuto e glossario/ }).tap();
  await page.getByRole('tab', { name: 'Glossario' }).tap();
  await page.getByRole('searchbox').fill('ILS');
  check('Smartphone: glossario ricercabile con tocco', await page.locator('.help-term').count() > 0 && await noOverflow());
  await page.getByRole('button', { name: /Chiudi l’aiuto/ }).tap();
  await page.getByRole('button', { name: /Impostazioni/ }).tap();
  check('Smartphone: impostazioni accessibili senza overflow', await page.locator('.settings-grid').isVisible() && await noOverflow());
  await page.getByRole('button', { name: /Indietro/ }).tap();
  await page.getByRole('button', { name: /Missioni/ }).tap();
  const missionStart = page.getByRole('button', { name: /Inizia la missione/ });
  await missionStart.scrollIntoViewIfNeeded();
  const mb = await bounds(missionStart);
  check('Smartphone: missioni e pulsante avvio raggiungibili', await noOverflow() && mb.y >= 0 && mb.y + mb.height <= 844 && mb.height >= 44);
  await page.screenshot({ path: path.join(output, 'phone-missions.png') });
  await page.getByRole('button', { name: /Menu/ }).tap();
  await page.getByRole('button', { name: /Volo libero/ }).tap();
  check('Smartphone: configurazione di volo scorrevole', await noOverflow());
  await page.getByRole('button', { name: /Vola!/ }).tap();
  await ready('flight');
  await page.locator('.touch-controls:not([hidden])').waitFor();
  check('Smartphone: terreno e framebuffer entro i limiti mobili', await page.evaluate(() => {
    const app = window.__cieli, canvas = app.renderer.webgl.domElement;
    return app.cockpit.mode === 'mini' && app.renderer.terrain.tiles.size === 49 && canvas.width * canvas.height <= 1_000_000;
  }));
  const stick = await bounds(page.locator('.touch-stick'));
  const brake = await bounds(page.locator('.touch-brake'));
  const power = await bounds(page.locator('.touch-throttle'));
  const fingers = [point(1, stick.x + stick.width * .7, stick.y + stick.height * .6), point(2, brake.x + brake.width / 2, brake.y + brake.height / 2), point(3, power.x + power.width / 2, power.y + power.height * .25)];
  await touch('touchStart', fingers);
  await page.waitForFunction(() => {
    const p = window.__cieli.flightSim.pilot;
    return p.pitch > .1 && p.roll > .2 && p.brakeL === 1 && p.brakeR === 1 && Math.abs(p.throttle - .75) < .03;
  });
  check('Tre dita: cloche, freni e manetta comandano insieme il velivolo', true);
  await touch('touchEnd', []);
  await page.waitForFunction(() => {
    const p = window.__cieli.flightSim.pilot;
    return Math.abs(p.pitch) < .01 && Math.abs(p.roll) < .01 && p.brakeL === 0 && p.brakeR === 0;
  });
  check('Rilascio touch: comandi centrati e potenza conservata', await page.evaluate(() => Math.abs(window.__cieli.flightSim.pilot.throttle - .75) < .03));
  // Exercise cancellation while the finger is still deflecting the stick.
  await touch('touchStart', [fingers[0]]);
  await touch('touchCancel', []);
  await page.waitForFunction(() => !window.__cieli.touchControls.pointers.size && Math.abs(window.__cieli.flightSim.pilot.roll) < .01);
  check('Gesto interrotto: nessun comando bloccato', true);
  await page.locator('.flight-help').tap();
  check('Aiuto touch: pausa e rilascio dei controlli', await page.evaluate(() => window.__cieli.flightSim.paused && !window.__cieli.touchControls.enabled));
  await page.waitForFunction(() => !window.__cieli._needsRender);
  const pausedFrame = await page.evaluate(() => window.__cieli.renderer.webgl.info.render.frame);
  await page.waitForTimeout(120);
  check('In pausa: nessun rendering 3D mobile superfluo', await page.evaluate(() => window.__cieli.renderer.webgl.info.render.frame) === pausedFrame);
  await page.getByRole('button', { name: /Chiudi l’aiuto/ }).tap();
  await page.locator('.touch-controls:not([hidden])').waitFor();
  const atisClose = page.locator('.hud-atis.visible .atis-close');
  if (await atisClose.isVisible()) await atisClose.tap();
  await page.evaluate(() => {
    window.__touchTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, (e) => {
      window.__touchTrace.push([type, e.target.getAttribute?.('aria-label') || e.target.tagName, e.pointerId]);
      if (window.__touchTrace.length > 20) window.__touchTrace.shift();
    }, true);
  });
  const yaw = await page.evaluate(() => window.__cieli.renderer.yaw);
  await touch('touchStart', [point(1, 195, 250)]);
  await touch('touchMove', [point(1, 235, 255)]);
  await page.waitForTimeout(80);
  await touch('touchEnd', []);
  check('Panorama: guardarsi intorno trascinando un dito', await page.evaluate(() => window.__cieli.renderer.yaw) < yaw - .1);
  await page.getByRole('button', { name: 'Mostra o nascondi console impianti' }).tap();
  await page.locator('.touch-controls').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Antighiaccio', exact: true }).tap();
  check('Console touch: comandi raggiungibili senza interferire con la cloche', await page.evaluate(() => window.__cieli.flightSim.fm.systems.antiIce));
  await page.locator('.ca-left .ca-console-head button').tap();
  await page.locator('.touch-controls:not([hidden])').waitFor();
  await page.locator('.flight-toolbar').getByRole('button', { name: 'Mappa', exact: true }).tap();
  await page.locator('.map-overlay.visible').waitFor();
  const map = await bounds(page.locator('.map-canvas'));
  const scale = await page.evaluate(() => window.__cieli.map.scale);
  const mx = map.x + map.width / 2, my = map.y + map.height / 2;
  await touch('touchStart', [point(1, mx - 30, my), point(2, mx + 30, my)]);
  await touch('touchMove', [point(1, mx - 65, my), point(2, mx + 65, my)]);
  await touch('touchEnd', []);
  check('Mappa: zoom con due dita e controlli di volo sospesi', await page.evaluate(() => window.__cieli.map.scale) > scale * 1.5 && await page.locator('.touch-controls').isHidden());
  await page.locator('.map-toolbar').getByRole('button', { name: '✕', exact: true }).tap();
  await page.locator('.flight-toolbar').getByRole('button', { name: 'Checklist', exact: true }).tap();
  await page.locator('.checklist-overlay.visible').waitFor();
  check('Checklist entro la larghezza dello smartphone', (await bounds(page.locator('.checklist-overlay'))).width <= 390);
  await page.locator('.checklist-overlay .cl-head button').last().tap();
  await page.locator('.flight-toolbar').getByRole('button', { name: 'Pausa', exact: true }).tap();
  await page.locator('.overlay.visible').getByRole('button', { name: /Riprendi/ }).tap();
  await page.locator('.touch-controls:not([hidden])').waitFor();
  await page.screenshot({ path: path.join(output, 'phone-flight.png') });

  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 568 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await page.waitForFunction((width) => window.__cieli.cockpit.width === width, viewport.width);
    await page.locator('.touch-controls:not([hidden])').waitFor();
    const rects = await page.locator('.touch-stick, .touch-throttle, .touch-controls button:not([hidden]), .flight-toolbar button').evaluateAll((els) => els.filter((el) => el.getClientRects().length).map((el) => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    check(`${viewport.width}×${viewport.height}: controlli visibili, grandi e senza overflow`, await noOverflow() && rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= viewport.width + 1 && r.y + r.h <= viewport.height + 1 && r.w >= 44 && r.h >= 44));
    if (viewport.height === 390) {
      await page.locator('.touch-actions').getByRole('button', { name: 'Mostra o riduci il pannello strumenti' }).tap();
      await page.locator('.ca-shell').waitFor({ state: 'hidden' });
      check('Orizzontale: pannello richiamabile dal touch', await page.locator('.touch-controls').isVisible());
      await page.locator('.touch-actions').getByRole('button', { name: 'Mostra o riduci il pannello strumenti' }).tap();
      await page.locator('.ca-shell').waitFor({ state: 'visible' });
    }
    await page.screenshot({ path: path.join(output, `flight-${viewport.width}x${viewport.height}.png`) });
  }
  await page.locator('.touch-actions').getByRole('button', { name: 'Cambia vista', exact: true }).tap();
  await page.waitForFunction(() => window.__cieli.view === 'chase');
  check('Touch: cambio vista senza tastiera', await page.evaluate(() => window.__cieli.renderer.view === 'chase'));
  await page.locator('.flight-help').tap();
  await page.getByRole('tab', { name: 'Comandi', exact: true }).tap();
  await page.getByRole('searchbox').fill('touch');
  check('Guida: i gesti touch sono documentati', await page.locator('.help-command-row').count() > 0);
  await page.getByRole('button', { name: /Chiudi l’aiuto/ }).tap();
  check('Nessun errore browser o risorsa mancante', errors.length === 0 && await page.locator('#fatal-error').count() === 0);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: true, checks, errors }, null, 2));
  console.log(`Mobile smoke completato: ${checks.length} verifiche.`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  const diagnostic = await page?.evaluate(() => ({ state: window.__cieli?.state, consoles: window.__cieli?.cockpit.consoles, bodyClass: document.body.className, inert: document.getElementById('cockpit-root').inert, trace: window.__touchTrace })).catch(() => null);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: false, checks, errors, failure: error.message, diagnostic }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
