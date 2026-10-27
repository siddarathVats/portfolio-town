import * as THREE from "three";

/**
 * The world: a tiny round planet with one road wandering all the way round it, so the walk never
 * ends; it just comes back to the front door. Everything is placed along the road in metres (s,
 * 0..ROUTE_LENGTH, wrapping) and to its side (lateral, + is the walker's right), standing on the
 * surface with its up along the planet's normal.
 */
/** (sized to the walk: about 9 m of road for each unit of a stop's weight, see BLOCKS in journey.ts) */
export const PLANET_RADIUS = 22.3;

/** The road's latitude as it goes round: a wander with sweeping bends (radius ~12 m or more), so it
 *  never reads as a straight belt and the camera can always see round the next curve. */
const lat = (lon: number) =>
  0.2 * Math.sin(2 * lon + 0.3) + 0.11 * Math.sin(3 * lon + 1.7) - 0.06 * Math.sin(5 * lon) + 0.028 * Math.sin(9 * lon + 0.7);
const onSphere = (lon: number, out: THREE.Vector3) => {
  const la = lat(lon);
  return out.set(Math.cos(la) * Math.sin(lon), Math.sin(la), Math.cos(la) * Math.cos(lon)).multiplyScalar(PLANET_RADIUS);
};

// Arc-length table: N samples round the loop, evenly spaced in metres.
const N = 2048;
const RAW = 8192;
const PTS = new Float32Array(N * 3);
export const ROUTE_LENGTH = (() => {
  const raw: THREE.Vector3[] = [];
  const acc = new Float64Array(RAW + 1);
  for (let i = 0; i <= RAW; i++) {
    raw.push(onSphere((i / RAW) * Math.PI * 2, new THREE.Vector3()));
    if (i) acc[i] = acc[i - 1] + raw[i].distanceTo(raw[i - 1]);
  }
  const total = acc[RAW];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * total;
    while (j < RAW - 1 && acc[j + 1] < target) j++;
    const k = (target - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]);
    const p = raw[j].clone().lerp(raw[j + 1], k).setLength(PLANET_RADIUS);
    PTS.set([p.x, p.y, p.z], i * 3);
  }
  return total;
})();

/** Wrap any distance onto the loop, 0..ROUTE_LENGTH. */
export const wrapS = (s: number) => ((s % ROUTE_LENGTH) + ROUTE_LENGTH) % ROUTE_LENGTH;
/** Shortest signed distance from a to b round the loop. */
export const loopDelta = (a: number, b: number) => {
  const d = wrapS(b - a);
  return d > ROUTE_LENGTH / 2 ? d - ROUTE_LENGTH : d;
};

const sample = (s: number, out: THREE.Vector3) => {
  const f = (wrapS(s) / ROUTE_LENGTH) * N;
  const i = Math.floor(f) % N;
  const j = (i + 1) % N;
  const t = f - Math.floor(f);
  return out
    .set(PTS[i * 3] + (PTS[j * 3] - PTS[i * 3]) * t, PTS[i * 3 + 1] + (PTS[j * 3 + 1] - PTS[i * 3 + 1]) * t, PTS[i * 3 + 2] + (PTS[j * 3 + 2] - PTS[i * 3 + 2]) * t)
    .setLength(PLANET_RADIUS);
};

/** Point on the road at s, on the surface. */
export function routePoint(s: number, out = new THREE.Vector3()) {
  return sample(s, out);
}

export type Frame = { pos: THREE.Vector3; up: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3 };
export const makeFrame = (): Frame => ({ pos: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3() });

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** Where the road is at s and which way it runs: up is the planet normal, fwd the direction of travel. */
export function routeFrame(s: number, out: Frame = makeFrame()) {
  sample(s, out.pos);
  out.up.copy(out.pos).normalize();
  sample(s + 0.35, _a);
  sample(s - 0.35, _b);
  out.fwd.subVectors(_a, _b);
  out.fwd.addScaledVector(out.up, -out.fwd.dot(out.up)).normalize();
  out.right.crossVectors(out.fwd, out.up).normalize();
  return out;
}

const _f = makeFrame();
/** Surface point beside the road: `lateral` metres to the right of travel (negative = left). */
export function beside(s: number, lateral: number, out = new THREE.Vector3()) {
  routeFrame(s, _f);
  const a = lateral / PLANET_RADIUS;
  return out.copy(_f.up).multiplyScalar(Math.cos(a)).addScaledVector(_f.right, Math.sin(a)).multiplyScalar(PLANET_RADIUS);
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
/**
 * Transform that stands an object on the surface at `pos` (its up along the normal), with its front
 * (+z, the way Kenney models face) turned toward `look`, then scaled.
 */
export function standAt(pos: THREE.Vector3, look: THREE.Vector3, scale: number, out = new THREE.Matrix4(), lift = 0, up?: THREE.Vector3) {
  // `up` stands the object to a given vertical (e.g. the lane's), instead of the planet normal here.
  if (up) _y.copy(up).normalize();
  else _y.copy(pos).normalize();
  _z.subVectors(look, pos);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  out.copy(_m).scale(_a.setScalar(scale));
  out.setPosition(_b.copy(pos).addScaledVector(_y, lift));
  return out;
}

/** Angular distance (as surface metres) from a direction to the nearest point of the road. */
export function distanceToRoute(p: THREE.Vector3) {
  const d = _a.copy(p).normalize();
  let best = -1;
  for (let i = 0; i < N; i += 4) {
    const dot = (PTS[i * 3] * d.x + PTS[i * 3 + 1] * d.y + PTS[i * 3 + 2] * d.z) / PLANET_RADIUS;
    if (dot > best) best = dot;
  }
  return Math.acos(Math.min(1, best)) * PLANET_RADIUS;
}

/** Small deterministic random generator, so the world is the same on every visit. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random direction on the sphere, as a surface point. */
export function randomSurface(r: () => number, out = new THREE.Vector3()) {
  const z = r() * 2 - 1;
  const t = r() * Math.PI * 2;
  const q = Math.sqrt(1 - z * z);
  return out.set(q * Math.cos(t), z, q * Math.sin(t)).multiplyScalar(PLANET_RADIUS);
}
