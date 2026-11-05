import test from 'node:test';
import assert from 'node:assert/strict';
import { V3 } from '../src/core/math.js';
import {
  AU, DAY, BODIES, BODY_LIST, SITES, OBJECTS, bodyState, relativeState, bodySpin, toFixed, fromFixed,
  atmosphereAt, siteFrame, j2000FromDate, dateFromJ2000, heightAt, childrenOf,
} from '../src/sim/system.js';
import { planetData } from './helpers.js';

const t = (iso) => j2000FromDate(new Date(iso));

test('the Solar System uses the real planets with Italian names', () => {
  const names = Object.fromEntries(BODY_LIST.map((b) => [b.id, b.name]));
  assert.deepEqual(
    ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].map((id) => names[id]),
    ['Sole', 'Mercurio', 'Venere', 'Terra', 'Luna', 'Marte', 'Giove', 'Saturno', 'Urano', 'Nettuno'],
  );
  assert.equal(BODIES.earth.radius, 6.371e6);
  assert.equal(BODIES.moon.parent, 'earth');
  assert.deepEqual(childrenOf('earth').map((b) => b.id), ['moon']);
  // Phobos and Deimos: small irregular moons, flown as objects in orbit around Mars.
  assert.equal(OBJECTS.phobos.ref, 'mars');
  assert.equal(OBJECTS.deimos.ref, 'mars');
});

test('ephemeris: Earth at perihelion in January and aphelion in July', () => {
  const peri = bodyState('earth', t('2031-01-04T00:00:00Z')).pos.len() / AU;
  const aph = bodyState('earth', t('2031-07-04T00:00:00Z')).pos.len() / AU;
  assert.ok(Math.abs(peri - 0.9833) < 0.001, `perihelion ${peri}`);
  assert.ok(Math.abs(aph - 1.0167) < 0.001, `aphelion ${aph}`);
  const v = bodyState('earth', t('2031-04-01T00:00:00Z')).vel.len();
  assert.ok(Math.abs(v - 29780) < 600, `orbital speed ${v}`);
});

test('ephemeris: the Moon stays between perigee and apogee; Mars and Jupiter at their distances', () => {
  for (let d = 0; d < 60; d += 1.5) {
    const r = relativeState('moon', 'earth', t('2031-05-01T00:00:00Z') + d * DAY).pos.len();
    assert.ok(r > 356e6 && r < 407e6, `Moon at ${r / 1e3} km`);
  }
  const mars = bodyState('mars', t('2033-01-01T00:00:00Z')).pos.len() / AU;
  assert.ok(mars > 1.38 && mars < 1.67, `Mars ${mars} AU`);
  const jup = bodyState('jupiter', t('2033-01-01T00:00:00Z')).pos.len() / AU;
  assert.ok(jup > 4.9 && jup < 5.5, `Jupiter ${jup} AU`);
  // Laplace sphere of influence of the Moon ≈ 66 000 km, of Earth ≈ 925 000 km.
  assert.ok(Math.abs(BODIES.moon.soi / 1e3 - 66100) < 1500, `Moon SOI ${BODIES.moon.soi / 1e3}`);
  assert.ok(Math.abs(BODIES.earth.soi / 1e3 - 924600) < 15000, `Earth SOI ${BODIES.earth.soi / 1e3}`);
});

test('rotation: sidereal day, tidally locked Moon, Martian sol', () => {
  const t0 = t('2031-05-20T00:00:00Z');
  const spin = bodySpin('earth', t0).len();
  assert.ok(Math.abs((2 * Math.PI) / spin - 86164.1) < 0.5, `sidereal day ${(2 * Math.PI) / spin}`);
  const mars = bodySpin('mars', t0).len();
  assert.ok(Math.abs((2 * Math.PI) / mars - 88642.7) < 5, `sidereal sol ${(2 * Math.PI) / mars}`);
  // The Moon keeps the same face towards the Earth.
  for (const d of [0, 7, 14, 21]) {
    const tt = t0 + d * DAY;
    const toEarth = relativeState('earth', 'moon', tt).pos.normalize();
    const f = toFixed('moon', tt, toEarth);
    assert.ok(f.x > 0.99, `day ${d}: sub-Earth point drifts (${f.x})`);
  }
  const v = new V3(0.3, -0.5, 0.8);
  const back = fromFixed('earth', t0, toFixed('earth', t0, v));
  assert.ok(back.clone().sub(v).len() < 1e-12);
});

test('UTC dates convert to J2000 seconds and back', () => {
  assert.equal(j2000FromDate(new Date('2000-01-01T12:00:00Z')), 0);
  const d = new Date('2031-05-20T08:30:00Z');
  assert.equal(dateFromJ2000(j2000FromDate(d)).toISOString(), d.toISOString());
});

test('US Standard Atmosphere and the thin Martian air', () => {
  const sl = atmosphereAt(BODIES.earth, 0);
  assert.ok(Math.abs(sl.rho - 1.225) < 0.01 && Math.abs(sl.p - 101325) < 500);
  const h11 = atmosphereAt(BODIES.earth, 11000).rho;
  assert.ok(Math.abs(h11 - 0.3639) < 0.02, `rho(11 km) ${h11}`);
  const h50 = atmosphereAt(BODIES.earth, 50000).rho;
  assert.ok(h50 > 7e-4 && h50 < 1.3e-3, `rho(50 km) ${h50}`);
  assert.equal(atmosphereAt(BODIES.moon, 0).rho, 0);
  const mars = atmosphereAt(BODIES.mars, 0);
  assert.ok(mars.rho > 0.01 && mars.rho < 0.03 && mars.p > 500 && mars.p < 800, `Mars ${mars.rho} kg/m³ ${mars.p} Pa`);
});

test('real launch and landing sites on the real terrain', async () => {
  await planetData;
  const t0 = t('2031-05-20T08:00:00Z');
  const mal = siteFrame(SITES.malindi, t0);
  const lat = (Math.asin(mal.fixed.up.z) * 180) / Math.PI;
  assert.ok(Math.abs(lat + 2.996) < 0.01, `Malindi latitude ${lat}`);
  // Launching east from the equator: the ground moves at ≈ 464 m/s.
  assert.ok(Math.abs(mal.vel.len() - 463.4) < 2, `ground speed ${mal.vel.len()}`);
  const gr = siteFrame(SITES.grottaglie, t0);
  assert.ok(Math.abs(gr.height - 65) < 3, `Grottaglie elevation ${gr.height}`);
  // The Alps and the Himalaya stand out of the ETOPO1 heightmap; the Moon's mare is low.
  const alps = heightAt('earth', 0, fromFixed('earth', 0, latLonDir(45.83, 6.86)));
  assert.ok(alps > 1500, `Mont Blanc region ${alps} m`);
  const everest = heightAt('earth', 0, fromFixed('earth', 0, latLonDir(27.99, 86.93)));
  assert.ok(everest > 4500, `Himalaya ${everest} m`);
  const tq = siteFrame(SITES.tranquillitatis, t0);
  assert.ok(Math.abs(tq.height + 1900) < 50, `Tranquillitatis ${tq.height} m`);
});

function latLonDir(lat, lon) {
  const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
  return new V3(Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a));
}
