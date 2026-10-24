// Conversions between the simulation frame (NED: x = north, y = east, z = down)
// and the three.js world frame (x = east, y = up, z = south).
// Aircraft models are built with the nose towards -Z, right wing towards +X, up +Y.
import * as THREE from 'three';

/** NED position/vector -> three.js vector. */
export function nedToThree(n, e, d, out = new THREE.Vector3()) {
  return out.set(e, -d, -n);
}

/** Sim V3 (NED) -> three.js vector. */
export function v3ToThree(v, out = new THREE.Vector3()) {
  return out.set(v.y, -v.z, -v.x);
}

/** Body-frame point (x fwd, y right, z down) -> model-local three.js coordinates. */
export function bodyToModel(bx, by, bz, out = new THREE.Vector3()) {
  return out.set(by, -bz, -bx);
}

/** Sim Quat (body -> NED) -> three.js quaternion (model -> world). */
export function quatToThree(q, out = new THREE.Quaternion()) {
  return out.set(q.y, -q.z, -q.x, q.w);
}

/** Ground point (n, e, height MSL) -> three.js vector. */
export function groundToThree(n, e, h, out = new THREE.Vector3()) {
  return out.set(e, h, -n);
}
