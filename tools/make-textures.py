#!/usr/bin/env python3
"""Synthesises the seamless ground material textures in assets/textures/.

Every texture is periodic by construction (spectral noise through the FFT, Worley cells on a
torus, wrapped domain warping), so it tiles without seams. Run from the repository root:

    pip install numpy scipy pillow
    python3 tools/make-textures.py

The output is deterministic (fixed seeds); the generated JPEG/PNG files are committed so the
game itself needs no build step.
"""
import os
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter
from scipy.spatial import cKDTree

N = 512
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'textures')


def normalize(a, lo=1.0, hi=99.0):
    p0, p1 = np.percentile(a, [lo, hi])
    return np.clip((a - p0) / max(p1 - p0, 1e-9), 0, 1)


def spectral(seed, beta=2.0, fmin=1, fmax=None, aniso=1.0, angle=0.0, n=N):
    """Periodic fractal noise with power spectrum ~ f^-beta between fmin and fmax cycles/tile."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    kx, ky = np.meshgrid(f, f, indexing='xy')
    c, s = np.cos(angle), np.sin(angle)
    u = c * kx + s * ky
    v = (-s * kx + c * ky) * aniso
    k = np.hypot(u, v)
    k[0, 0] = 1
    amp = k ** (-beta / 2)
    amp[k < fmin] = 0
    if fmax:
        amp *= np.exp(-(k / fmax) ** 4)
    amp[0, 0] = 0
    spectrum = amp * np.exp(2j * np.pi * rng.random((n, n)))
    return normalize(np.real(np.fft.ifft2(spectrum)))


def worley(seed, count, n=N):
    """Distances F1, F2 to the nearest feature points on a torus, plus the nearest point id."""
    rng = np.random.default_rng(seed)
    points = rng.random((count, 2))
    tree = cKDTree(points, boxsize=1.0)
    g = (np.arange(n) + 0.5) / n
    xx, yy = np.meshgrid(g, g, indexing='xy')
    d, idx = tree.query(np.stack([xx.ravel(), yy.ravel()], 1), k=2)
    scale = np.sqrt(count)
    return (d[:, 0].reshape(n, n) * scale, d[:, 1].reshape(n, n) * scale, idx[:, 0].reshape(n, n))


def warp(field, dx, dy, amount):
    n = field.shape[0]
    yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    return map_coordinates(field, [yy + (dy - 0.5) * amount, xx + (dx - 0.5) * amount], order=1, mode='grid-wrap')


def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')


def lerp(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a + (np.asarray(b, float) - a) * t


def rgb(hexcode):
    return np.array([int(hexcode[i:i + 2], 16) for i in (1, 3, 5)], float) / 255


def solid(color, n=N):
    return np.ones((n, n, 3)) * rgb(color)


def normal_map(height, strength):
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    nz = np.ones_like(height)
    l = np.sqrt(gx * gx + gy * gy + nz * nz)
    return np.stack([(-gx / l) * 0.5 + 0.5, (gy / l) * 0.5 + 0.5, nz / l * 0.5 + 0.5], -1)


def save(name, img, quality=88):
    img = np.clip(img, 0, 1)
    path = os.path.join(OUT, name)
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8))
    if name.endswith('.png'):
        im.save(path, optimize=True)
    else:
        im.save(path, quality=quality, subsampling=0)
    print(f'{name}: {os.path.getsize(path) // 1024} KB, mean {np.round(img.reshape(-1, 3).mean(0), 3)}')


def grass():
    """Meadow seen from above: mixed greens, dry tufts, soil showing through, blades."""
    base = spectral(1, beta=2.6, fmin=1)
    dry = spectral(2, beta=2.4, fmin=1)
    img = lerp(solid('#4c6a2c'), rgb('#6f8a3a'), base)
    img = lerp(img, rgb('#9c9450'), np.clip((dry - 0.58) * 3.5, 0, 1) * 0.75)
    blades = np.zeros((N, N))
    for k, angle in enumerate(np.linspace(0, np.pi, 7, endpoint=False)):
        blades += spectral(10 + k, beta=0.9, fmin=40, fmax=180, aniso=7, angle=angle)
    blades = normalize(blades)
    img *= (0.72 + 0.56 * blades)[..., None]
    f1, _, _ = worley(3, 900)
    soil = np.clip((0.22 - f1) * 6, 0, 1) * np.clip((spectral(4, beta=2.0) - 0.45) * 3, 0, 1)
    img = lerp(img, rgb('#5a4630'), soil * 0.8)
    f1b, _, _ = worley(5, 2500)
    flowers = np.clip((0.06 - f1b) * 30, 0, 1) * (spectral(6, beta=1.5) > 0.7)
    img = lerp(img, rgb('#e8dc8a'), flowers * 0.7)
    return img, blades


def forest():
    """Canopy from above: overlapping rounded crowns of varied size and colour, dark gaps."""
    rng = np.random.default_rng(22)
    count = 170
    points = rng.random((count, 2))
    radius = 0.05 + rng.random(count) * 0.05
    hue = rng.random(count)
    tree = cKDTree(points, boxsize=1.0)
    g = (np.arange(N) + 0.5) / N
    xx, yy = np.meshgrid(g, g, indexing='xy')
    # Warp the lookup so crowns get lobed, irregular outlines.
    wx, wy = spectral(24, beta=2.2, fmin=6), spectral(25, beta=2.2, fmin=6)
    qx = (xx + (wx - 0.5) * 0.03) % 1
    qy = (yy + (wy - 0.5) * 0.03) % 1
    d, idx = tree.query(np.stack([qx.ravel(), qy.ravel()], 1), k=4)
    crown = np.zeros(N * N)
    colour = np.zeros((N * N, 3))
    weight = np.zeros(N * N)
    dark, light = rgb('#2a4222'), rgb('#55703a')
    for k in range(4):
        r = radius[idx[:, k]]
        dome = np.clip(1 - (d[:, k] / r) ** 2, 0, 1)
        top = dome > crown
        crown = np.maximum(crown, dome)
        c = lerp(dark, light, hue[idx[:, k]])
        colour[top] = c[top]
        weight = np.maximum(weight, dome)
    crown = crown.reshape(N, N)
    leaves = spectral(23, beta=1.0, fmin=40, fmax=220)
    img = colour.reshape(N, N, 3)
    img[crown <= 0] = rgb('#2b3b20')
    shade = (0.5 + 0.6 * np.sqrt(crown)) * (0.78 + 0.44 * leaves)
    img = img * shade[..., None]
    return img, np.sqrt(crown) * 0.8 + leaves * 0.2


def rock():
    """Weathered limestone: eroded ridges, strata, sparse fractures, colour and lichen."""
    wx, wy = spectral(34, beta=2.5), spectral(35, beta=2.5)
    strata = warp(spectral(31, beta=2.2, fmin=2, aniso=8, angle=0.25), wx, wy, 70)
    ridges = warp(1 - np.abs(spectral(32, beta=2.0, fmin=2) * 2 - 1), wx, wy, 50)
    fine = spectral(36, beta=1.3, fmin=16)
    f1, f2, _ = worley(33, 26)
    fractures = warp(np.clip(1 - (f2 - f1) * 14, 0, 1), spectral(39, beta=2.2), spectral(40, beta=2.2), 120)
    fractures *= spectral(37, beta=2.0) > 0.4
    height = normalize(0.45 * ridges + 0.35 * strata + 0.2 * fine) - fractures * 0.35
    img = lerp(solid('#77716a'), rgb('#aba393'), normalize(height))
    img = lerp(img, rgb('#8f8069'), spectral(38, beta=2.6) * 0.45)
    img *= (0.82 + 0.3 * (strata - 0.5))[..., None]
    lichen = np.clip((spectral(41, beta=1.8, fmin=8) - 0.72) * 5, 0, 1) * (height > 0.55)
    img = lerp(img, rgb('#9a9658'), lichen * 0.5)
    return img, height


def sand():
    """Beach sand: wind ripples, fine grain and a few shell fragments."""
    wx, wy = spectral(41, beta=2.6), spectral(42, beta=2.6)
    yy, xx = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    ripples = 0.5 + 0.5 * np.sin(2 * np.pi * (xx * 14 / N + yy * 3 / N))
    ripples = warp(ripples, wx, wy, 60)
    grain = spectral(43, beta=0.6, fmin=80)
    img = solid('#d6c79c') * (0.86 + 0.14 * ripples + 0.12 * (grain - 0.5))[..., None]
    img = lerp(img, rgb('#b9a77d'), spectral(44, beta=2.4) * 0.35)
    f1, _, _ = worley(45, 400)
    img = lerp(img, rgb('#efe8d8'), np.clip((0.12 - f1) * 12, 0, 1) * 0.6)
    return img, ripples * 0.7 + grain * 0.3


def snow():
    drifts = spectral(51, beta=2.8, fmin=1)
    grain = spectral(52, beta=0.8, fmin=60)
    img = lerp(solid('#d9e2ec'), rgb('#f6f8fa'), drifts)
    img *= (0.96 + 0.08 * grain)[..., None]
    return img, drifts


def soil():
    """Neutral crop-field detail: furrows along the texture's v axis and clods."""
    yy, xx = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    wx = spectral(61, beta=2.8)
    rows = 0.5 + 0.5 * np.sin(2 * np.pi * (xx * 16 / N + (wx - 0.5) * 0.6))
    clods = spectral(62, beta=1.0, fmin=30)
    patches = spectral(63, beta=2.4)
    value = 0.62 + 0.28 * rows ** 1.5 + 0.18 * (clods - 0.5) + 0.12 * (patches - 0.5)
    img = solid('#8f8778') * value[..., None]
    return img, rows * 0.6 + clods * 0.4


def asphalt():
    """Runway asphalt: dark binder, light aggregate, sealed cracks and patch repairs."""
    f1, _, idx = worley(71, 7000)
    rng = np.random.default_rng(72)
    stone = rng.random(7000)[idx]
    pebbles = np.clip((0.45 - f1) * 4, 0, 1)
    img = solid('#3b3d3f') * (0.85 + 0.3 * spectral(73, beta=1.2, fmin=20))[..., None]
    img = lerp(img, lerp(solid('#47494b'), rgb('#626464'), stone), pebbles * (stone > 0.5) * 0.6)
    g1, g2, _ = worley(74, 18)
    wx, wy = spectral(75, beta=2.4), spectral(76, beta=2.4)
    cracks = warp(np.clip(1 - (g2 - g1) * 25, 0, 1), wx, wy, 50) * (spectral(77, beta=2.0) > 0.55)
    img = lerp(img, rgb('#1d1e1f'), cracks * 0.8)
    patch = np.clip((spectral(78, beta=2.8) - 0.72) * 8, 0, 1)
    img = lerp(img, rgb('#2e3031'), patch * 0.6)
    return img, pebbles * 0.7 - cracks * 0.5


def concrete():
    """Apron concrete: fine aggregate, curing blotches and oil stains."""
    fine = spectral(81, beta=0.9, fmin=60)
    blotch = spectral(82, beta=2.6)
    img = solid('#a4a39d') * (0.9 + 0.12 * (fine - 0.5) + 0.14 * (blotch - 0.5))[..., None]
    f1, _, _ = worley(83, 9000)
    img = lerp(img, rgb('#7a7976'), np.clip((0.3 - f1) * 4, 0, 1) * 0.25)
    stains = np.clip((spectral(84, beta=2.6) - 0.78) * 5, 0, 1)
    img = lerp(img, rgb('#7a7975'), stains * 0.3)
    return img, fine


def main():
    os.makedirs(OUT, exist_ok=True)
    rock_img, rock_h = rock()
    grass_img, grass_h = grass()
    for name, (img, _) in {
        'grass': (grass_img, None), 'forest': forest(), 'rock': (rock_img, None), 'sand': sand(),
        'snow': snow(), 'soil': soil(), 'asphalt': asphalt(), 'concrete': concrete(),
    }.items():
        save(f'{name}.jpg', img)
    # Relief normals: rock for slopes and mountains, a softer one for open ground.
    save('rock_normal.jpg', normal_map(blur(rock_h, 1.3), 7), 92)
    save('ground_normal.jpg', normal_map(blur(grass_h * 0.5 + spectral(91, beta=2.0) * 0.5, 1.0), 4), 92)


if __name__ == '__main__':
    main()
