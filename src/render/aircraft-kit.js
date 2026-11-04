// Geometry and livery building blocks shared by every procedural aircraft model.
// Models are built with the nose towards -Z, the right wing towards +X and up +Y.
import * as THREE from 'three';

export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ geometry builders

/** Lofted body from stations [z, rx, ry, yCentre]; u runs nose→tail, v around (0 = right side). */
export function loftGeometry(stations, segments = 32) {
  const positions = [], uvs = [], indices = [];
  const z0 = stations[0][0], z1 = stations[stations.length - 1][0];
  for (const [z, rx, ry, yc] of stations) {
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * TAU;
      positions.push(Math.cos(a) * rx, yc + Math.sin(a) * ry, z);
      uvs.push((z - z0) / (z1 - z0), k / segments);
    }
  }
  const ring = segments + 1;
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < segments; k++) {
      const a = i * ring + k, b = a + ring;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Weld the normals across the texture seam so it does not show as a shading line.
  const n = geometry.attributes.normal;
  for (let i = 0; i < stations.length; i++) {
    const a = i * ring, b = a + segments;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return geometry;
}

// Symmetric NACA 00xx section, closed loop: upper surface LE→TE, then lower TE→LE.
const AIRFOIL = (() => {
  const steps = 10, upper = [];
  for (let i = 0; i <= steps; i++) {
    const x = (1 - Math.cos(Math.PI * i / steps)) / 2;
    const t = 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    upper.push([x, t]);
  }
  const lower = upper.slice(1, -1).reverse().map(([x, t]) => [x, -t]);
  return [...upper, ...lower];
})();

/**
 * Lifting surface lofted through stations { x, y, z (leading edge), chord, thick }.
 * Horizontal surfaces spread along +x with thickness in y; vertical ones spread along +y.
 */
export function surfaceGeometry(stations, vertical = false) {
  const positions = [], indices = [];
  const m = AIRFOIL.length;
  for (const s of stations) {
    for (const [u, w] of AIRFOIL) {
      const t = w * s.thick * s.chord;
      if (vertical) positions.push(s.x - t, s.y, s.z + u * s.chord);
      else positions.push(s.x, s.y + t, s.z + u * s.chord);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < m; k++) {
      const a = i * m + k, a1 = i * m + ((k + 1) % m), b = a + m, b1 = a1 + m;
      indices.push(a, a1, b, b, a1, b1);
    }
  }
  // Cap at the tip, oriented outwards along the span.
  const last = (stations.length - 1) * m;
  const tip = stations[stations.length - 1], prev = stations[stations.length - 2];
  const span = vertical ? tip.y - prev.y : tip.x - prev.x;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < m; k++) {
    cx += positions[(last + k) * 3];
    cy += positions[(last + k) * 3 + 1];
    cz += positions[(last + k) * 3 + 2];
  }
  const centre = positions.length / 3;
  positions.push(cx / m, cy / m, cz / m);
  const p = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const n = new THREE.Vector3().crossVectors(p(last).sub(p(centre)), p(last + 1).sub(p(centre)));
  const outward = (vertical ? n.y : n.x) * span > 0;
  for (let k = 0; k < m; k++) {
    const a = last + k, b = last + ((k + 1) % m);
    if (outward) indices.push(centre, a, b);
    else indices.push(centre, b, a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Simple tapered wing description shared by the mesh and the control-surface placement. */
export function wingShape({ halfSpan, rootChord, tipChord, centreZ, sweep, y, rise = 0, thick = 0.12 }) {
  const at = (x) => {
    const s = Math.min(1, Math.abs(x) / halfSpan);
    const chord = rootChord + (tipChord - rootChord) * s;
    const centre = centreZ + sweep * s;
    return { y: y + rise * s, le: centre - chord / 2, te: centre + chord / 2, chord };
  };
  const stations = [0, 0.5, 1].map((s) => {
    const a = at(s * halfSpan);
    return { x: s * halfSpan, y: a.y, z: a.le, chord: a.chord, thick: thick * (1 - 0.25 * s) };
  });
  return { at, geometry: surfaceGeometry(stations), halfSpan };
}

export function addMirrored(parent, geometry, material) {
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.x = side;
    parent.add(mesh);
  }
}

export function mesh(parent, geometry, material, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  parent.add(m);
  return m;
}

export function ellipsoid(parent, size, pos, material, segments = 20) {
  const m = mesh(parent, new THREE.SphereGeometry(1, segments, Math.round(segments * 0.6)), material, pos);
  m.scale.set(...size);
  return m;
}

/** Cylinder between two points. */
export function rod(parent, a, b, radius, material, sides = 6) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), sides), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  parent.add(m);
  return m;
}

/** Engine nacelle (turbofan) as a lathe along z, with a dark fan face and exhaust cone. */
export function nacelle(parent, x, y, mats) {
  const profile = [[-4.36, 0.86], [-4.42, 0.97], [-4.3, 1.08], [-3.7, 1.13], [-2.4, 1.1], [-1.4, 0.98], [-0.9, 0.78], [-0.7, 0.7]];
  // The lathe revolves around y; rotating it maps the profile coordinate onto +z.
  const outer = new THREE.LatheGeometry(profile.map(([z, r]) => new THREE.Vector2(r, z)), 28);
  outer.rotateX(Math.PI / 2);
  mesh(parent, outer, mats.nacelle, [x, y, 0]);
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.5, 28, 1, true), mats.inlet);
  inlet.rotation.x = Math.PI / 2;
  inlet.position.set(x, y, -4.15);
  parent.add(inlet);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.86, 28), mats.fan);
  fan.position.set(x, y, -3.95);
  fan.rotation.y = Math.PI;
  parent.add(fan);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 16), mats.metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(x, y, -4.2);
  parent.add(spinner);
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 16), mats.metal);
  plug.rotation.x = Math.PI / 2;
  plug.position.set(x, y, -0.25);
  parent.add(plug);
}

// ------------------------------------------------------------------ liveries

/**
 * Paints a livery for a lofted fuselage. Returns { map, orm } textures or null without a DOM.
 * The painter receives helpers working in fuselage coordinates (z, height ratio h = sin(angle)).
 */
export function paintLivery({ width, height, z0, z1, radius, base, painter }) {
  if (typeof document === 'undefined') return null;
  const color = document.createElement('canvas');
  const orm = document.createElement('canvas');
  color.width = orm.width = width;
  color.height = orm.height = height;
  const c = color.getContext('2d'), o = orm.getContext('2d');
  c.fillStyle = base;
  c.fillRect(0, 0, width, height);
  // ORM texture: G = roughness, B = metalness.
  const PAINT = 'rgb(0,92,20)', GLASS = 'rgb(0,18,90)';
  o.fillStyle = PAINT;
  o.fillRect(0, 0, width, height);
  const X = (z) => (z - z0) / (z1 - z0) * width;
  const Y = (a) => (a / TAU) * height;
  const rect = (zA, zB, aA, aB, fill, glass = false) => {
    // Angles may wrap through 0 (right side): split into two rectangles.
    const parts = aA < 0 ? [[aA + TAU, TAU], [0, aB]] : [[aA, aB]];
    for (const [p, q] of parts) {
      c.fillStyle = fill;
      c.fillRect(X(zA), Y(p), X(zB) - X(zA), Y(q) - Y(p));
      if (glass) {
        o.fillStyle = GLASS;
        o.fillRect(X(zA), Y(p), X(zB) - X(zA), Y(q) - Y(p));
      }
    }
  };
  const helpers = {
    c, X, Y,
    /** Band on both sides between height ratios h0 < h1. */
    sides(zA, zB, h0, h1, fill, glass = false) {
      rect(zA, zB, Math.asin(h0), Math.asin(h1), fill, glass);
      rect(zA, zB, Math.PI - Math.asin(h1), Math.PI - Math.asin(h0), fill, glass);
    },
    /** Everything above height ratio h (crown). */
    top(zA, zB, h, fill, glass = false) { rect(zA, zB, Math.asin(h), Math.PI - Math.asin(h), fill, glass); },
    /** Everything below height ratio h (belly). */
    belly(zA, zB, h, fill) { rect(zA, zB, Math.PI - Math.asin(h), TAU + Math.asin(h), fill); },
    /** Skin panel joints: frames around the fuselage and longitudinal seams. */
    panels(frames, seams, colour = 'rgba(25,35,45,0.2)') {
      c.fillStyle = colour;
      for (const z of frames) c.fillRect(X(z), 0, 1, height);
      for (const h of seams) {
        for (const a of [Math.asin(h), Math.PI - Math.asin(h)]) c.fillRect(0, Y(a < 0 ? a + TAU : a), width, 1);
      }
    },
    /** Rectangular outline (doors) on both sides between height ratios h0 < h1. */
    outline(zA, zB, h0, h1, stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 2;
      for (const [p, q] of [[Math.asin(h0), Math.asin(h1)], [Math.PI - Math.asin(h1), Math.PI - Math.asin(h0)]]) {
        const parts = p < 0 ? [[p + TAU, TAU], [0, q]] : [[p, q]];
        for (const [a, b] of parts) c.strokeRect(X(zA), Y(a), X(zB) - X(zA), Y(b) - Y(a));
      }
    },
    /** Text on both sides, upright when seen from outside. */
    text(str, z, h, size, fill, font = 'bold') {
      // Compensate the different pixel densities along and around the fuselage.
      const squash = (height / (TAU * radius)) / (width / (z1 - z0));
      c.fillStyle = fill;
      c.font = `${font} ${size}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const [a, flip] of [[Math.PI - Math.asin(h), false], [Math.asin(h) < 0 ? TAU + Math.asin(h) : Math.asin(h), true]]) {
        c.save();
        c.translate(X(z), Y(a));
        if (flip) c.rotate(Math.PI);
        c.scale(1, squash);
        c.fillText(str, 0, 0);
        c.restore();
      }
    },
  };
  painter(helpers);
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  const ormTexture = new THREE.CanvasTexture(orm);
  ormTexture.flipY = false;
  return { map, orm: ormTexture };
}

export function paintMaterial(livery, fallback) {
  if (!livery) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.38, metalness: 0.08 });
  return new THREE.MeshStandardMaterial({ map: livery.map, roughnessMap: livery.orm, metalnessMap: livery.orm, roughness: 1, metalness: 1 });
}

