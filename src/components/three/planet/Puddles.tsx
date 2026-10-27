"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { journey, zoneAt } from "@/lib/journey";
import { weather } from "@/lib/weather";
import { PLANET_RADIUS, ROUTE_LENGTH, beside, rng, routeFrame } from "@/lib/world";
import { PAVE_HALF, ROAD_HALF, deckLift, walkLift } from "./plan";
import { wetUniform } from "./style";
import { soakUniform, splashUniform } from "./sprite";
import { body } from "./drips";
import { prints } from "./prints";

const _up = new THREE.Vector3();
const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * What the rain leaves (lib/weather.ts): puddles that gather in the dips of the road and the forest
 * path while it rains, rippling under the drops and holding a pale reflection of the sky, then shrink
 * and dry up a while after the shower has passed; and splashes, little rings where drops hit the
 * ground round the courier (a few still dripping down from the trees and the eaves while everything
 * is wet); and drips falling off the courier's soaked clothes.
 */

// ---------- puddles ----------
/** One puddle every so often along the road, at set places (the same on every visit). */
type Spot = { p: THREE.Vector3; right: THREE.Vector3; fwd: THREE.Vector3; w: number; d: number; seed: number };
/** How far a puddle has spread, 0..1 of its full size (as PUDDLE_FRAG draws it). */
const puddleSize = (wet: number, seed: number) => THREE.MathUtils.clamp(wet * (1.25 + 0.5 * seed) - 0.25 - 0.2 * seed, 0, 1);

/** How far past a puddle's own size its quad reaches. */
const QUAD = 1.35;

function puddleGeometry(spots: Spot[]) {
  const r = rng(53);
  const pos: number[] = [];
  const uv: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const f = routeFrame(0);
  for (let s = 0; s < ROUTE_LENGTH; s += 1.6 + r() * 2.6) {
    const keep = r() < 0.62;
    const lat = (r() - 0.5) * 2 * (ROAD_HALF - 0.35);
    const w = 0.35 + r() * 0.55;
    const d = w * (0.55 + r() * 0.5);
    const sd = r();
    // (none on the bridge, or by the water)
    if (!keep || deckLift(s) > 0 || zoneAt(s) === "river") continue;
    routeFrame(s, f);
    beside(s, lat, p);
    p.setLength(PLANET_RADIUS + walkLift(s) + 0.01);
    spots.push({ p: p.clone(), right: f.right.clone(), fwd: f.fwd.clone(), w, d, seed: sd });
    const n = pos.length / 3;
    // (the quad reaches on past the puddle at its fullest, a blob about as wide as w by d with its
    // edge wandering a fifth either way: drawn on a quad just that size, a full puddle ran out to the
    // quad's sides and was cut off square, like a slab laid on the road)
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const v = p.clone().addScaledVector(f.right, a * w * QUAD).addScaledVector(f.fwd, b * d * QUAD);
      v.setLength(p.length());
      pos.push(v.x, v.y, v.z);
      uv.push(a * QUAD, b * QUAD);
      seed.push(sd);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aQ", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const PUDDLE_VERT = /* glsl */ `
attribute vec2 aQ; attribute float aSeed;
varying vec2 vQ; varying float vSeed; varying vec3 vView; varying vec3 vUp; varying vec3 vWp;
#include <fog_pars_vertex>
void main(){
  vQ = aQ; vSeed = aSeed;
  vec4 wp = modelMatrix * vec4(position, 1.);
  vWp = wp.xyz;
  vUp = normalize(wp.xyz);
  vView = cameraPosition - wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PUDDLE_FRAG = /* glsl */ `
uniform float uWet; uniform float uRain; uniform float uTime; uniform vec3 uSky; uniform vec3 uDark;
varying vec2 vQ; varying float vSeed; varying vec3 vView; varying vec3 vUp; varying vec3 vWp;
#include <fog_pars_fragment>
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  // An irregular blob that grows as the road gets wetter and shrinks back as it dries: each puddle
  // fills at its own pace (the deeper dips first) and is gone at its own moment.
  float r = length(vQ) + .32 * (n2(vQ * 2.3 + vSeed * 40.) - .5) + .12 * (n2(vQ * 6. + vSeed * 9.) - .5);
  float size = clamp(uWet * (1.25 + .5 * vSeed) - .25 - .2 * vSeed, 0., 1.);
  if (r > size) discard;
  // The sky in the water, brighter at a glancing look; the wet ground at its edge.
  // Dark water with the sky in it, the sky showing more the more glancing the look (like a mirror
  // laid on the road), a soft streak of brighter sky across it, and its edge darker and soft.
  float glance = 1. - abs(dot(normalize(vView), vUp));
  vec3 col = mix(uDark, uSky * vec3(.96, 1., 1.04), .1 + .55 * pow(glance, 3.));
  col += uSky * .18 * smoothstep(.35, .0, abs(vQ.x * .6 + vQ.y * .8 + .1 * sin(vQ.y * 5. + vSeed * 20.)));
  float edge = smoothstep(size, size - .12, r);
  // Rings spreading where drops land, while it rains: small and quick, several at once (big slow
  // ones read as white circles painted on the road).
  float rip = 0.;
  for (int i = 0; i < 6; i++) {
    float t = uTime * (1.6 + .25 * float(i)) + vSeed * 7. + float(i) * .37;
    float k = floor(t);
    vec2 c = (vec2(h(vec2(k, vSeed + float(i))), h(vec2(vSeed * 3. + float(i), k))) - .5) * 1.3;
    float a = fract(t);
    float d = length(vQ - c);
    rip += smoothstep(.025, .0, abs(d - .03 - a * .17)) * (1. - a);
  }
  col += vec3(.9, .95, 1.) * min(rip, 1.) * .28 * uRain;
  gl_FragColor = vec4(col, .92 * edge);
  #include <fog_fragment>
}`;

// ---------- splashes ----------
const SPLASHES = 90;
type Splash = { p: THREE.Vector3; up: THREE.Vector3; t: number; life: number; size: number };

const SPLASH_VERT = /* glsl */ `
attribute vec3 iPos; attribute vec3 iUp; attribute float iAge; attribute float iSize;
varying vec2 vQ; varying float vAge; varying float vRing;
void main(){
  // A flat ring lying on the ground, opening out as it fades (and slowing as it goes: a wave's ring).
  vec3 a = normalize(cross(iUp, abs(iUp.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
  vec3 b = cross(iUp, a);
  // (a raindrop's ring is a hand's width across at most: drawn half a metre wide, a shower's worth
  // of them lay about the road like pale tiles. A foot's splash in a puddle spreads wider.)
  vRing = iSize < 0. ? 1. : 0.;
  float grow = 1. - (1. - iAge) * (1. - iAge);
  float r = (vRing > .5 ? .05 + .2 * grow : .025 + .085 * grow) * abs(iSize);
  vec3 p = iPos + (a * position.x + b * position.y) * r + iUp * .012;
  vQ = position.xy; vAge = iAge;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const SPLASH_FRAG = /* glsl */ `
varying vec2 vQ; varying float vAge; varying float vRing;
float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
void main(){
  if (vAge <= 0. || vAge >= 1.) discard;
  float d = length(vQ);
  float ring = smoothstep(.14, .0, abs(d - .8)) * (1. - vAge);
  // (and a bright dot as it first hits)
  float hit = smoothstep(.35, .0, d) * smoothstep(.25, .0, vAge);
  float a = max(ring * .38, hit * .45);
  // A foot's splash in a puddle: only a thin broken ring of pushed-out water, its middle clear.
  if (vRing > .5) {
    float ang = atan(vQ.y, vQ.x);
    float broken = step(.3, h(floor(ang * 2.2 + 7.)));
    a = smoothstep(.1, .0, abs(d - .82)) * (1. - vAge) * .34 * broken;
  }
  if (a < .01) discard;
  gl_FragColor = vec4(.88, .93, .97, a);
}`;

// ---------- drips off the umbrella and the courier's clothes ----------
const DRIPS = 140;
/** How much slower each rib tip drips (umbrella.ts TIPS): most runs off the lowest ones at the back. */
const RIM_SLOW = [3, 1.6, 1, 1, 1.6, 3];
/** A drop: hanging from a point while `hang` > 0 (swelling till it lets go), then falling. */
type Drip = { p: THREE.Vector3; v: THREE.Vector3; on: boolean; hang: number; grow: number; from: THREE.Vector3 | null; tip: number };
const DRIP_VERT = /* glsl */ `
attribute vec3 iPos; attribute vec3 iVel; attribute float iOn;
uniform vec3 uFrame;
varying float vA; varying vec2 vQ; varying float vFall;
void main(){
  // A drop (iOn: how big, 0 = none). Hanging, it is a small bead swelling under the point it hangs
  // from; falling, it draws out into a short streak along its fall as it speeds up (as seen from the
  // camera, which runs along with the courier: so by its speed against them, not against the ground).
  vec3 rel = iVel - uFrame;
  float sp = length(rel);
  vec3 dir = sp > .05 ? rel / sp : -normalize(iPos);
  vec3 side = normalize(cross(dir, normalize(iPos - cameraPosition)));
  // (a touch larger than life far off, so a drop never shrinks to nothing on screen)
  float d = distance(iPos, cameraPosition);
  float wid = max(.0038, d * .0014) * iOn;
  float len = max(.009 + .018 * min(sp, 6.), d * .0034) * iOn;
  vec3 p = iPos + side * position.x * wid + dir * (position.y + 1.) * len;
  vA = iOn; vQ = position.xy; vFall = smoothstep(.5, 2.5, sp);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const DRIP_FRAG = /* glsl */ `
varying float vA; varying vec2 vQ; varying float vFall;
void main(){
  if (vA < .01) discard;
  // Clear water: a bead round at its leading (lower) end, tapering behind it into a thin streak when
  // it falls fast; mostly see-through, a soft blue-grey edge and one small glint.
  float y = vQ.y * .5 + .5;
  float w = mix(mix(.25, .06, vFall), 1., smoothstep(0., mix(.6, .3, vFall), y)) * (1. - smoothstep(.85, 1., y) * .5);
  float r = abs(vQ.x) / max(w, .01);
  if (r > 1. || y > .99) discard;
  float rim = smoothstep(.45, .95, r);
  float glint = smoothstep(.5, .1, length(vec2(vQ.x + .3, (y - .8) * 2.5)));
  vec3 c = mix(vec3(.74, .8, .86), vec3(.46, .54, .62), rim);
  c = mix(c, vec3(1.), glint * .8);
  float a = (.3 + .28 * rim + .22 * glint) * mix(1., smoothstep(0., .6, y), vFall) * clamp(vA, .8, 1.3);
  gl_FragColor = vec4(c, a);
}`;
function makeDrips() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(DRIPS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const vel = new THREE.InstancedBufferAttribute(new Float32Array(DRIPS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const on = new THREE.InstancedBufferAttribute(new Float32Array(DRIPS), 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("iPos", pos);
  g.setAttribute("iVel", vel);
  g.setAttribute("iOn", on);
  g.instanceCount = DRIPS;
  const uFrame = { value: body.vel };
  const mat = new THREE.ShaderMaterial({ vertexShader: DRIP_VERT, fragmentShader: DRIP_FRAG, uniforms: { uFrame }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 17;
  const list: Drip[] = Array.from({ length: DRIPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), on: false, hang: 0, grow: 1, from: null, tip: -1 }));
  /** Drips owed off the clothes, carried over from frame to frame (so the rate holds at any frame rate). */
  const due = { cloth: 0 };
  return { mesh, list, pos, vel, on, due };
}

export function Puddles() {
  const puddles = useMemo(() => {
    const spots: Spot[] = [];
    const u = {
      uWet: { value: 0 },
      uRain: { value: 0 },
      uTime: { value: 0 },
      uSky: { value: new THREE.Color("#b3c0c0") },
      uDark: { value: new THREE.Color("#4a5658") },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 100 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: PUDDLE_VERT,
      fragmentShader: PUDDLE_FRAG,
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(puddleGeometry(spots), mat);
    mesh.renderOrder = 3;
    return { mesh, u, spots };
  }, []);

  const splashes = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const up = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const age = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES), 1).setUsage(THREE.DynamicDrawUsage);
    const size = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", pos);
    g.setAttribute("iUp", up);
    g.setAttribute("iAge", age);
    g.setAttribute("iSize", size);
    g.instanceCount = SPLASHES;
    const mat = new THREE.ShaderMaterial({ vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 16;
    const list: Splash[] = Array.from({ length: SPLASHES }, () => ({ p: new THREE.Vector3(), up: new THREE.Vector3(), t: 1, life: 0.4, size: 1 }));
    return { mesh, list, pos, up, age, size };
  }, []);

  const drips = useMemo(makeDrips, []);
  /** A splash where something lands (a drop off the courier): the next free ring. */
  const splashAt = (p: THREE.Vector3, up: THREE.Vector3, size = 1, life = 0.25, delay = 0) => {
    const L = splashes.list.find((x) => x.t >= 1);
    if (!L) return;
    L.p.copy(p);
    L.up.copy(up);
    L.t = -delay / life;
    L.life = life;
    L.size = size;
  };

  useFrame(({ scene }, raw) => {
    const dt = Math.min(raw, 1 / 20);
    soakUniform.value = weather.soak;
    splashUniform.value = weather.splash;
    // Drips. Off the umbrella's rib tips while it is up in the rain: at each tip a drop gathers,
    // swells, and lets go, and the next starts gathering (quicker the harder it rains). Off the
    // courier's soaked clothes and hair: drops gather at the hem, the cuffs, the satchel, the ends of
    // the hair, now and then (less as they dry). A drop that lets go falls with the courier's own
    // speed, faster and faster, and makes a tiny splash where it lands.
    const soak = weather.soak;
    const pour = Math.max(0, (weather.rain - 0.25) / 0.75);
    const D = drips;
    const rimOn = body.ready && body.rimOn > 0.95 && pour > 0.05;
    if (body.ready) D.due.cloth = Math.min(2, D.due.cloth + dt * 4 * soak * Math.sqrt(soak));
    const start = (from: THREE.Vector3, tip: number, grow: number) => {
      const d = D.list.find((x) => !x.on);
      if (!d) return;
      d.on = true;
      d.from = from;
      d.tip = tip;
      d.grow = d.hang = grow;
      d.p.copy(from);
      d.v.copy(body.vel);
    };
    // (a heavy shower runs off each rib tip in a quick string of drops; a light one now and then)
    if (rimOn)
      for (let k = 0; k < body.rim.length; k++)
        if (!D.list.some((x) => x.on && x.tip === k && x.hang > 0)) start(body.rim[k], k, ((0.15 + Math.random() * 0.25) * (RIM_SLOW[k] ?? 1)) / (0.3 + 0.7 * pour));
    // Shaken out as it is furled: a few drops flung off the rim with each twist, out and away.
    if (body.ready && body.fling > 0) {
      _c.set(0, 0, 0);
      body.rim.forEach((q) => _c.add(q));
      _c.multiplyScalar(1 / body.rim.length);
      for (let j = 0; j < body.fling; j++) {
        const d = D.list.find((x) => !x.on);
        if (!d) break;
        const q = body.rim[Math.floor(Math.random() * body.rim.length)];
        _side.subVectors(q, _c);
        _side.addScaledVector(body.up, -_side.dot(body.up)).normalize();
        d.on = true;
        d.from = null;
        d.tip = -3;
        d.hang = 0;
        d.p.copy(q);
        d.v.copy(body.vel).addScaledVector(_side, 1.6 + Math.random() * 1.2).addScaledVector(body.up, 0.5 + Math.random() * 0.7);
      }
    }
    // Stepping in a puddle: a splash ring or two spreading from the foot, and a spray of drops kicked
    // up and out from it (back off the heel, more the faster the step).
    for (const st of prints.steps) {
      if (weather.wet < 0.05 || !body.ready) break;
      const spot = puddles.spots.find((q) => {
        _d.subVectors(st.p, q.p);
        const x = _d.dot(q.right) / q.w;
        const y = _d.dot(q.fwd) / q.d;
        return x * x + y * y < (puddleSize(weather.wet, q.seed) * 0.85) ** 2;
      });
      if (!spot) continue;
      _up.copy(st.p).normalize();
      // (rings some 0.3 m across at most, fading over 0.4 s; a few small drops thrown a hand's height)
      splashAt(st.p, _up, -0.62, 0.42);
      splashAt(st.p, _up, -0.4, 0.36, 0.1);
      const n = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const d = D.list.find((x) => !x.on);
        if (!d) break;
        const a = Math.random() * Math.PI * 2;
        _side.crossVectors(st.fwd, _up).normalize();
        d.on = true;
        d.from = null;
        d.tip = -2;
        d.hang = 0;
        d.p.copy(st.p).addScaledVector(_up, 0.03);
        d.v.copy(body.vel).multiplyScalar(0.55)
          .addScaledVector(_up, 0.7 + Math.random() * 0.4)
          .addScaledVector(_side, Math.cos(a) * (0.25 + Math.random() * 0.35))
          .addScaledVector(st.fwd, Math.sin(a) * (0.25 + Math.random() * 0.3) - 0.3 * Math.min(1, journey.speed));
      }
    }
    prints.steps.length = 0;
    while (D.due.cloth >= 1) {
      D.due.cloth -= 1;
      start(body.cloth[Math.floor(Math.random() * body.cloth.length)], -1, 0.3 + Math.random() * 0.5);
    }
    D.mesh.visible = D.list.some((x) => x.on);
    // (the ground under the courier: the road may be raised a little over the planet's surface)
    const floor = PLANET_RADIUS + walkLift(journey.s) + 0.02;
    if (D.mesh.visible) {
      for (let i = 0; i < DRIPS; i++) {
        const d = D.list[i];
        let size = 0;
        if (d.on && d.hang > 0) {
          // Hanging: held to its point, swelling; let go once full (or if the umbrella went down).
          d.hang -= dt;
          if (d.tip >= 0 && !rimOn) d.hang = 0;
          d.p.copy(d.from!);
          d.v.copy(body.vel);
          size = 0.3 + 0.7 * (1 - Math.max(0, d.hang) / d.grow);
        } else if (d.on) {
          d.v.addScaledVector(body.up, -9.8 * dt);
          d.p.addScaledVector(d.v, dt);
          // (the drops off the lowest rib tips, where most of the water runs, a little fuller)
          size = d.tip === 2 || d.tip === 3 ? 1.3 : 1;
          if (d.p.length() < floor) {
            d.on = false;
            size = 0;
            // (a puddle's spray falls back into it unseen: only drops off him leave a ring)
            if (d.tip !== -2) splashAt(d.p, _up.copy(d.p).normalize());
          }
        }
        D.pos.setXYZ(i, d.p.x, d.p.y, d.p.z);
        D.vel.setXYZ(i, d.v.x, d.v.y, d.v.z);
        D.on.setX(i, size);
      }
      D.pos.needsUpdate = D.vel.needsUpdate = D.on.needsUpdate = true;
    }
    const wet = weather.wet;
    const rain = Math.max(0, (weather.rain - 0.25) / 0.75);
    const u = puddles.u;
    wetUniform.value = wet;
    puddles.mesh.visible = wet > 0.01;
    if (puddles.mesh.visible) {
      u.uTime.value += dt;
      u.uWet.value = wet;
      u.uRain.value = rain;
      const fog = scene.fog as THREE.Fog | null;
      if (fog) {
        // (the sky the puddles reflect: the haze's colour, which follows the time of day and the cloud)
        u.uSky.value.copy(fog.color).multiplyScalar(1.05);
        u.uDark.value.copy(fog.color).multiplyScalar(0.3);
        u.fogColor.value.copy(fog.color);
        u.fogNear.value = fog.near;
        u.fogFar.value = fog.far;
      }
    }

    // Splashes: thick and fast in a shower, the odd drip still falling while it is wet after.
    const rate = rain * 1 + (weather.raining ? 0 : 0.06 * wet);
    const S = splashes;
    splashes.mesh.visible = rate > 0.005 || S.list.some((x) => x.t < 1);
    if (!splashes.mesh.visible) return;
    const s0 = journey.s;
    const ahead = journey.dir >= 0 ? 1 : -1;
    for (let i = 0; i < SPLASHES; i++) {
      const L = S.list[i];
      L.t += dt / L.life;
      if (L.t >= 1 && Math.random() < rate * dt * 9) {
        const s = s0 + ahead * (0.5 + Math.random() * 13);
        const lat = (Math.random() - 0.5) * 2 * (PAVE_HALF + 2);
        beside(s, lat, L.p);
        L.up.copy(L.p).normalize();
        L.p.setLength(PLANET_RADIUS + (Math.abs(lat) < PAVE_HALF ? walkLift(s) : 0.02));
        L.t = 0;
        L.life = 0.3 + Math.random() * 0.25;
        L.size = 1;
      }
      S.pos.setXYZ(i, L.p.x, L.p.y, L.p.z);
      S.up.setXYZ(i, L.up.x, L.up.y, L.up.z);
      S.age.setX(i, Math.min(L.t, 1));
      S.size.setX(i, L.size);
    }
    S.pos.needsUpdate = S.up.needsUpdate = S.age.needsUpdate = S.size.needsUpdate = true;
  });

  return (
    <>
      <primitive object={puddles.mesh} />
      <primitive object={splashes.mesh} />
      <primitive object={drips.mesh} />
    </>
  );
}
