#!/usr/bin/env python3
"""Builds the planetary maps in assets/planets/ from public-domain sources.

Sources (all public domain or "free and without copyright" NASA/NOAA products):
  * NASA Blue Marble Next Generation, 5400x2700 (bmng.jpg) and NOAA ETOPO1 colour relief
    (etopo1.jpg), both shipped in the `basemap-data` package on PyPI
    (mpl_toolkits/basemap_data/).
  * NASA-3D-Resources (github.com/nasa/NASA-3D-Resources), "Images and Textures":
    Mars, Venus, Jupiter, Saturn, Neptune maps and the full-Moon photograph.

Usage: python3 tools/make-planet-data.py <basemap_data dir> <NASA "Images and Textures" dir>

Outputs (equirectangular, longitude -180..180 from left to right, north up):
  earth_color.jpg / earth_color_small.jpg   Blue Marble
  earth_height.png                           elevation (m) recovered from the ETOPO1 palette
  moon_color.jpg, moon_height.png            near side re-projected from the photograph,
                                             far side and relief from the real basins/craters
  mars_color.jpg, mars_height.png            NASA map; relief from the major real features
  venus.jpg, jupiter.jpg, saturn.jpg, neptune.jpg
Heights are 16-bit, stored in the red (high byte) and green (low byte) channels:
  h = (R * 256 + G) / scale - offset (see planets.json).
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'planets')

# NOAA ETOPO1 colour table (elevation m, r, g, b).
ETOPO = [
    (-11000, 10, 0, 121), (-10500, 26, 0, 137), (-10000, 38, 0, 152), (-9500, 27, 3, 166), (-9000, 16, 6, 180),
    (-8500, 5, 9, 193), (-8000, 0, 14, 203), (-7500, 0, 22, 210), (-7000, 0, 30, 216), (-6500, 0, 39, 223),
    (-6000, 12, 68, 231), (-5500, 26, 102, 240), (-5000, 19, 117, 244), (-4500, 14, 133, 249), (-4000, 21, 158, 252),
    (-3500, 30, 178, 255), (-3000, 43, 186, 255), (-2500, 55, 193, 255), (-2000, 65, 200, 255), (-1500, 79, 210, 255),
    (-1000, 94, 223, 255), (-500, 138, 227, 255), (-100, 175, 236, 255), (0, 45, 100, 20), (50, 58, 150, 54), (100, 80, 185, 92),
    (250, 190, 205, 150), (450, 222, 186, 145), (650, 236, 200, 152), (900, 210, 165, 105), (1200, 180, 140, 72),
    (1500, 172, 141, 30), (1800, 145, 124, 21), (2200, 115, 97, 14), (2700, 108, 82, 16), (3300, 130, 86, 20),
    (3900, 148, 90, 22), (4500, 155, 120, 95), (5200, 158, 145, 142), (6200, 175, 170, 168), (7500, 215, 215, 215),
]


def lonlat_grid(w, h):
    lon = (np.arange(w) + 0.5) / w * 360 - 180
    lat = 90 - (np.arange(h) + 0.5) / h * 180
    return np.meshgrid(np.radians(lon), np.radians(lat))


def smooth(a, passes=1):
    """Cheap separable box blur with wrap-around in longitude."""
    for _ in range(passes):
        a = (np.roll(a, 1, 1) + a + np.roll(a, -1, 1)) / 3
        a = np.vstack([a[:1], a, a[-1:]])
        a = (a[:-2] + a[1:-1] + a[2:]) / 3
    return a


def fbm(w, h, seed, octaves=6, base=8):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    cells = base
    for _ in range(octaves):
        g = rng.random((cells // 2 + 2, cells + 1)).astype(np.float32)
        g[:, -1] = g[:, 0]
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 255 - 0.5)
        tot += amp
        amp *= 0.5
        cells *= 2
    return out / tot


def save_height(name, h, offset, scale):
    v = np.clip(np.round((h + offset) * scale), 0, 65535).astype(np.uint32)
    rgb = np.zeros(h.shape + (3,), np.uint8)
    rgb[..., 0] = (v >> 8) & 255
    rgb[..., 1] = v & 255
    Image.fromarray(rgb, 'RGB').save(os.path.join(OUT, name), optimize=True)
    return {'file': name, 'width': h.shape[1], 'height': h.shape[0], 'offset': offset, 'scale': scale, 'min': float(h.min()), 'max': float(h.max())}


def earth(basemap):
    color = Image.open(os.path.join(basemap, 'bmng.jpg')).convert('RGB')
    color.resize((4096, 2048), Image.LANCZOS).save(os.path.join(OUT, 'earth_color.jpg'), quality=86, optimize=True)
    color.resize((2048, 1024), Image.LANCZOS).save(os.path.join(OUT, 'earth_color_small.jpg'), quality=86, optimize=True)
    W, H = 2048, 1024
    et = np.asarray(Image.open(os.path.join(basemap, 'etopo1.jpg')).convert('RGB').resize((W, H), Image.BILINEAR), np.float32)
    pal_e = np.array([p[0] for p in ETOPO], np.float32)
    pal_c = np.array([p[1:] for p in ETOPO], np.float32)
    # Dense palette by interpolation, normalised to unit vectors (hillshade scales brightness).
    E = np.linspace(-11000, 7500, 740)
    C = np.stack([np.interp(E, pal_e, pal_c[:, k]) for k in range(3)], 1)
    Cn = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-6)
    flat = et.reshape(-1, 3)
    norm = np.linalg.norm(flat, axis=1, keepdims=True) + 1e-6
    fn = flat / norm
    water = (flat[:, 2] > flat[:, 0] + 25) & (flat[:, 2] > flat[:, 1] - 5)
    ice = (flat.min(1) > 196) & (flat.max(1) - flat.min(1) < 22)
    out = np.zeros(len(flat), np.float32)
    for i in range(0, len(flat), 200000):
        sl = slice(i, i + 200000)
        d = fn[sl] @ Cn.T
        # Restrict to the right half of the palette (water / land).
        wmask = water[sl][:, None]
        d = np.where(wmask == (E[None, :] < 0), d, -2)
        # Brightness agreement as a weak tie-breaker.
        b = norm[sl] / (np.linalg.norm(C, axis=1)[None, :] + 1e-6)
        d = d - 0.02 * np.abs(np.log(np.clip(b, 0.2, 5)))
        out[sl] = E[np.argmax(d, 1)]
    h = out.reshape(H, W)
    land = ~water.reshape(H, W)
    icem = ice.reshape(H, W)
    # Ice sheets: height grows with the distance from the coast.
    lon, lat = lonlat_grid(W, H)
    dist = np.zeros((H, W), np.float32)
    m = icem & land
    cur = m.copy()
    for k in range(1, 120):
        sh = cur & np.roll(cur, 1, 1) & np.roll(cur, -1, 1) & np.vstack([cur[:1], cur[:-1]]) & np.vstack([cur[1:], cur[-1:]])
        dist += sh
        cur = sh
        if not cur.any():
            break
    km = dist * 20 * np.cos(lat).clip(0.15, 1)
    ant = lat < math.radians(-60)
    h = np.where(m & ant, 300 + 3200 * (1 - np.exp(-km / 420)), h)
    h = np.where(m & ~ant, 200 + 2900 * (1 - np.exp(-km / 160)), h)
    h = smooth(h, 1)
    # Keep coastlines crisp: land at least +2 m, sea at most -5 m.
    h = np.where(land, np.maximum(h, 2), np.minimum(h, -5))
    return save_height('earth_height.png', h, 11500, 2)


# ---------------------------------------------------------------- Moon

MOON_BASINS = [  # lat, lon, diameter km, depth m (mare basins are flooded: shallower)
    (32.8, -15.6, 1145, 2600), (28.0, 17.5, 674, 2100), (17.0, 59.1, 556, 3500), (-15.2, 35.5, 333, 2500),
    (-24.4, -38.6, 389, 2200), (8.5, 31.4, 873, 1400), (-21.3, -16.6, 715, 1300), (-7.8, 51.3, 909, 1200),
    (18.4, -57.4, 2500, 1100), (-19.4, -92.8, 930, 4800), (-53.0, -169.0, 2500, 6500), (-36.1, -151.8, 524, 3000),
    (2.6, -128.7, 570, 3500), (-4.4, -157.4, 437, 3000), (-44.0, 62.0, 600, 2200), (56.0, 81.0, 600, 2000),
]
MOON_CRATERS = [  # lat, lon, diameter km
    (-43.3, -11.2, 85), (9.6, -20.1, 93), (8.1, -38.0, 31), (23.7, -47.4, 40), (51.6, -9.3, 101), (-58.4, -14.4, 225),
    (-9.3, -1.9, 154), (-11.4, 26.4, 100), (-8.9, 61.1, 132), (-25.1, 60.4, 177), (-5.2, -68.6, 173), (-89.67, 129.8, 21),
    (-21.2, 128.9, 185), (-11.4, 26.4, 100), (-16.0, 7.5, 115), (-13.4, -3.2, 118), (40.0, 30.0, 40), (26.0, 4.0, 59),
    (-25.0, -60.0, 120), (45.0, 13.0, 87), (-45.0, 17.0, 140), (-29.0, -49.0, 90), (5.4, 40.0, 60), (20.0, 43.0, 30),
]


def crater_profile(d):
    """Height (fraction of depth) at normalised distance d = r / R."""
    bowl = np.where(d < 1, np.maximum(d * d - 1, -0.85), 0)
    rim = 0.2 * np.exp(-((d - 1) / 0.25) ** 2)
    return bowl + rim


def great_circle(lat0, lon0, lat, lon):
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    c = np.sin(la0) * np.sin(lat) + np.cos(la0) * np.cos(lat) * np.cos(lon - lo0)
    return np.arccos(np.clip(c, -1, 1))


def moon(nasa):
    R = 1737.4
    W, H = 2048, 1024
    lon, lat = lonlat_grid(W, H)
    photo = np.asarray(Image.open(os.path.join(nasa, 'Moon', 'Moon.jpg')).convert('L'), np.float32) / 255
    ys, xs = np.nonzero(photo > 0.08)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    r = (xs.max() - xs.min() + ys.max() - ys.min()) / 4
    x = np.cos(lat) * np.sin(lon)
    y = np.sin(lat)
    facing = np.cos(lat) * np.cos(lon)
    px = np.clip((cx + x * r).astype(int), 0, photo.shape[1] - 1)
    py = np.clip((cy - y * r).astype(int), 0, photo.shape[0] - 1)
    near = photo[py, px]
    # Full-moon photo is close to an albedo map; correct the mild limb darkening.
    near = near / (0.75 + 0.25 * np.clip(facing, 0, 1))
    w = np.clip((facing - 0.18) / 0.3, 0, 1)
    far = 0.56 + 0.12 * fbm(W, H, 5, 7, 16)
    alb = far.copy()
    # Real far-side basins (darker floors).
    for la, lo, dkm, depth in MOON_BASINS:
        g = great_circle(la, lo, lat, lon) * R / (dkm / 2)
        alb -= 0.08 * np.exp(-g ** 4) * (depth > 2900)
    alb = alb * (1 - w) + near * w
    alb = np.clip(alb, 0, 1)
    Image.fromarray((alb * 255).astype(np.uint8), 'L').convert('RGB').save(os.path.join(OUT, 'moon_color.jpg'), quality=88, optimize=True)
    # Relief: maria (dark) are low, basins and large craters from the catalogue.
    mare = np.clip((0.42 - smooth(alb, 3)) / 0.14, 0, 1)
    hgt = 900 * fbm(W, H, 9, 6, 8) - 1800 * mare + 700
    for la, lo, dkm, depth in MOON_BASINS:
        g = great_circle(la, lo, lat, lon) * R / (dkm / 2)
        hgt += depth * crater_profile(g) * 0.9
    for la, lo, dkm in MOON_CRATERS:
        g = great_circle(la, lo, lat, lon) * R / (dkm / 2)
        hgt += min(4500, 140 * dkm ** 0.65) * crater_profile(g)
    hgt = smooth(hgt, 1)
    return save_height('moon_height.png', hgt.astype(np.float32), 11000, 2)


# ---------------------------------------------------------------- Mars

MARS_FEATURES = [  # lat, lon (east), diameter km, height m (negative = basin)
    (18.65, -133.8, 640, 21000), (11.8, -104.5, 460, 15000), (1.48, -112.96, 375, 11500), (-8.26, -120.09, 430, 14000),
    (40.5, -109.9, 1400, 5500), (24.8, 146.9, 650, 11000), (0.0, -100.0, 4200, 6000), (-42.4, 70.5, 2300, -7500),
    (-49.7, -43.4, 1800, -4500), (12.9, 87.0, 1500, -3500), (-5.4, 137.8, 154, -4500), (18.38, 77.58, 45, -1000),
    (-3.0, 170.0, 900, -2500),
]


def mars(nasa):
    R = 3389.5
    W, H = 1440, 720
    lon, lat = lonlat_grid(W, H)
    img = Image.open(os.path.join(nasa, 'Mars', 'Mars.jpg')).convert('RGB')
    img.save(os.path.join(OUT, 'mars_color.jpg'), quality=88, optimize=True)
    # Hemispheric dichotomy: northern lowlands ~5 km below the southern highlands.
    boundary = math.radians(28) + 0.12 * np.sin(lon * 2 + 0.6) + 0.08 * np.sin(lon * 3 - 1.2)
    dich = 1 / (1 + np.exp(-(lat - boundary) / 0.07))
    hgt = 1800 - 5800 * dich + 1500 * fbm(W, H, 3, 7, 8)
    for la, lo, dkm, hm in MARS_FEATURES:
        g = great_circle(la, lo, lat, lon) * R / (dkm / 2)
        if hm > 0:
            hgt += hm * np.exp(-(g ** 2) * 2.2)
        else:
            hgt += -hm * crater_profile(g)
    # Valles Marineris: a 4000 km chain of canyons.
    for k in range(60):
        t = k / 59
        la = -6 - 6 * t + 2 * math.sin(t * 7)
        lo = -95 + 55 * t
        g = great_circle(la, lo, lat, lon) * R / 90
        hgt -= 6500 * np.exp(-g ** 2) / 1.6
    hgt = smooth(hgt, 1)
    return save_height('mars_height.png', hgt.astype(np.float32), 9000, 2)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    basemap, nasa = sys.argv[1], sys.argv[2]
    os.makedirs(OUT, exist_ok=True)
    manifest = {'earth': earth(basemap), 'moon': moon(nasa), 'mars': mars(nasa)}
    for name, src in [('venus.jpg', 'Venus/Venus.jpg'), ('jupiter.jpg', 'Jupiter/Jupiter.jpg'), ('saturn.jpg', 'Saturn/Saturn.jpg'), ('neptune.jpg', 'Neptune/Neptune.jpg')]:
        Image.open(os.path.join(nasa, src)).convert('RGB').save(os.path.join(OUT, name), quality=88, optimize=True)
    with open(os.path.join(OUT, 'planets.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
