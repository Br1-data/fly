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

  // iPad (iPadOS Safari reports a Mac user agent): richer defaults and the full panel.
  const ipadUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ipadUA });
  const ipad = await tablet.newPage();
  ipad.setDefaultTimeout(30000);
  ipad.on('pageerror', (e) => errors.push(`iPad: ${e.message}`));
  ipad.on('response', (r) => { if (r.status() >= 400) errors.push(`iPad HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  await ipad.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  await ipad.goto(`http://127.0.0.1:${server.address().port}${basePath}`);
  await ipad.waitForFunction(() => window.__cieli?.state === 'menu', null, { timeout: 90000 });
  check('iPad: riconosciuto come tablet, qualità media, 60 fps e antialiasing', await ipad.evaluate(() => {
    const r = window.__cieli.renderer;
    return document.documentElement.classList.contains('tablet-device') && window.__cieli.settings.quality === 'medium' && r.profile.maxFps === 60 && r.profile.antialias && r.webgl.getPixelRatio() > 1;
  }));
  check('iPad: app installabile a schermo intero', await ipad.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    const manifest = await (await fetch(link.href)).json();
    const icon = await fetch(document.querySelector('link[rel=apple-touch-icon]').href);
    return manifest.display === 'fullscreen' && icon.ok && document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content === 'yes';
  }));
  await ipad.evaluate(async () => { await window.__cieli.startFlight({ aircraft: 'trainer', start: { type: 'runway', airport: 'XAQU', runway: '07' }, time: 11 }, null); });
  await ipad.waitForFunction(() => window.__cieli.state === 'flight', null, { timeout: 120000 });
  await ipad.locator('.touch-controls:not([hidden])').waitFor();
  check('iPad verticale: pannello strumenti completo e terreno ricco', await ipad.evaluate(() => {
    const a = window.__cieli;
    return a.cockpit.mode === 'full' && document.querySelector('.ca-body').getBoundingClientRect().height >= 240 && a.renderer.terrain.tiles.size === 121;
  }));
  const tabletRects = await ipad.locator('.touch-stick, .touch-throttle, .touch-controls button:not([hidden])').evaluateAll((els) => els.filter((el) => el.getClientRects().length).map((el) => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, panel: document.querySelector('.ca-panel').getBoundingClientRect().top };
  }));
  check('iPad: comandi touch grandi, sopra il pannello e dentro lo schermo', tabletRects.length > 0 && tabletRects.every((r) => r.x >= 0 && r.x + r.w <= 821 && r.y + r.h <= r.panel + 1 && r.w >= 56 && r.h >= 56));
  await ipad.screenshot({ path: path.join(output, 'ipad-portrait.png') });
  await ipad.setViewportSize({ width: 1180, height: 820 });
  await ipad.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await ipad.waitForFunction(() => window.__cieli.cockpit.width === 1180);
  check('iPad orizzontale: pannello completo e nessun overflow', await ipad.evaluate(() => window.__cieli.cockpit.mode === 'full' && document.documentElement.scrollWidth <= innerWidth + 1));
  await ipad.screenshot({ path: path.join(output, 'ipad-landscape.png') });
  await tablet.close();
  check('iPad: nessun errore', errors.length === 0);
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
