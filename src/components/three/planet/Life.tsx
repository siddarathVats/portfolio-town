"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { journey, zoneAt } from "@/lib/journey";
import { PLANET_RADIUS, beside, routeFrame } from "@/lib/world";
import { wind } from "./foliage";
import { heightAt } from "./plan";
import { daylight } from "@/lib/daylight";
import { weather } from "@/lib/weather";

/**
 * Small life about the walk: leaves drifting down in the woods, butterflies over the verges, fireflies
 * in the forest at night, and now and then a flock of birds crossing the sky. Each one is set down in
 * the world near the walker and lives out its moment there (it doesn't ride along with the camera),
 * then starts again ahead.
 */

const wild = (s: number) => ["river", "forest"].includes(zoneAt(s));
const _f = routeFrame(0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** A camera-facing card's corner (shared by the leaves and the spray of the falls). */
const FACE = /* glsl */ `
vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
`;

function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
const dyn = (n: number, k: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);

/** An unlit, fogged material with its own vertex and fragment code. */
function drawn(name: string, decl: string, vertex: string, fragment: string, opts: THREE.MeshBasicMaterialParameters = {}) {
  const m = new THREE.MeshBasicMaterial({ color: "#ffffff", ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\nuniform float uTime;\n${decl}`).replace("#include <begin_vertex>", vertex);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\n${decl.replace(/attribute [^;]+;/g, "")}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${fragment}`);
  };
  m.customProgramCacheKey = () => name;
  return m;
}

// ---------- leaves ----------
const LEAVES = 36;
const LEAF_COLS = ["#79a85a", "#93b65c", "#b8b45a", "#c99a4e", "#6f9a5c"].map((c) => new THREE.Color(c));

type Leaf = { p: THREE.Vector3; ground: number; t: number; spin: number; rate: number; flip: number; flipRate: number; size: number; col: THREE.Color; rest: number; on: boolean };

function makeLeaves() {
  const g = quad();
  const pos = dyn(LEAVES, 3);
  const spin = dyn(LEAVES, 4);
  const col = dyn(LEAVES, 3);
  g.setAttribute("iPos", pos);
  g.setAttribute("iSpin", spin);
  g.setAttribute("iCol", col);
  g.instanceCount = LEAVES;
  const mat = drawn(
    "drift-leaves",
    "attribute vec3 iPos;\nattribute vec4 iSpin;\nattribute vec3 iCol;\nvarying vec2 vQ;\nvarying vec3 vCol;",
    `${FACE}
    // Turning over as it falls: the card narrows as the leaf goes edge-on, and shows its paler back.
    float flip = cos(iSpin.y);
    vec2 q = vec2(position.x * (.15 + .85 * abs(flip)), position.y);
    float c = cos(iSpin.x), s = sin(iSpin.x);
    vec2 r = mat2(c, s, -s, c) * q * iSpin.z;
    vec3 transformed = iPos + camRight * r.x + camUp * r.y;
    vQ = position.xy;
    vCol = iCol * (flip > 0. ? 1. : .8);`,
    `float w = .5 * sin(3.1416 * clamp(vQ.y * .5 + .5, 0., 1.));
    if (abs(vQ.x) > w) discard;
    diffuseColor.rgb = vCol * (1. - .22 * step(abs(vQ.x), .07) * step(-.8, vQ.y));`,
    { side: THREE.DoubleSide },
  );
  const leaves: Leaf[] = Array.from({ length: LEAVES }, () => ({ p: new THREE.Vector3(), ground: 0, t: 0, spin: 0, rate: 0, flip: 0, flipRate: 0, size: 0, col: LEAF_COLS[0], rest: 0, on: false }));
  return { g, mat, leaves, pos, spin, col };
}

// ---------- butterflies ----------
const FLUTTERS = 4;
const WING_COLS = ["#f3efe2", "#f0d36a", "#a9c7e8", "#f2b48a"].map((c) => new THREE.Color(c));
type Flutter = { home: THREE.Vector3; up: THREE.Vector3; ground: number; t: number; life: number; seed: number; on: boolean };

function makeFlutters() {
  // Two wings hinged along the body (z): x from the body out to the wing's edge, z along the body.
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -1, 1, 0, -1, 1, 0, 1, 0, 0, 1, 0, 0, -1, -1, 0, -1, -1, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const pos = dyn(FLUTTERS, 3);
  const dir = dyn(FLUTTERS, 4);
  const col = dyn(FLUTTERS, 3);
  g.setAttribute("iPos", pos);
  g.setAttribute("iDir", dir);
  g.setAttribute("iCol", col);
  g.instanceCount = FLUTTERS;
  const mat = drawn(
    "butterflies",
    "attribute vec3 iPos;\nattribute vec4 iDir;\nattribute vec3 iCol;\nvarying vec2 vW;\nvarying vec3 vCol;",
    `// Wings clap up and open again, quickly, now and then held for a glide.
    float beat = .5 + .5 * sin(uTime * 15. + iDir.w * 9.);
    float a = mix(.15, 1.25, beat);
    vec3 up = normalize(iPos);
    vec3 fw = normalize(iDir.xyz - up * dot(iDir.xyz, up));
    vec3 side = cross(up, fw);
    float x = position.x;
    vec3 lp = side * (x * cos(a)) + up * (abs(x) * sin(a)) + fw * position.z;
    vec3 transformed = iPos + lp * .11;
    vW = vec2(abs(x), position.z);
    vCol = iCol;`,
    `// fore wing and hind wing
    float fore = length((vW - vec2(.55, .35)) / vec2(.5, .62));
    float hind = length((vW - vec2(.45, -.45)) / vec2(.38, .5));
    if (min(fore, hind) > 1. || vW.x < .04) discard;
    diffuseColor.rgb = mix(vCol, vCol * .55, smoothstep(.72, .95, min(fore, hind)));`,
    { side: THREE.DoubleSide },
  );
  const list: Flutter[] = Array.from({ length: FLUTTERS }, (_, i) => ({ home: new THREE.Vector3(), up: new THREE.Vector3(), ground: 0, t: 0, life: 0, seed: i * 1.7 + 0.3, on: false }));
  return { g, mat, list, pos, dir, col };
}

// ---------- fireflies ----------
const FIREFLIES = 60;
type Firefly = { home: THREE.Vector3; up: THREE.Vector3; t: number; life: number; seed: number; blink: number; on: boolean };

function makeFireflies() {
  const g = quad();
  const pos = dyn(FIREFLIES, 3);
  const glow = dyn(FIREFLIES, 1);
  g.setAttribute("iPos", pos);
  g.setAttribute("iGlow", glow);
  g.instanceCount = FIREFLIES;
  const mat = drawn(
    "fireflies",
    "attribute vec3 iPos;\nattribute float iGlow;\nvarying vec2 vQ;\nvarying float vGlow;",
    `${FACE}
    vec3 transformed = iPos + (camRight * position.x + camUp * position.y) * .17;
    vQ = position.xy;
    vGlow = iGlow;`,
    `// a bright warm point in a soft halo (painted in its own warm colour rather than added as light,
    // so it stays warm over pale walls, and the night grade leaves it bright: see Ink)
    float r = length(vQ);
    float light = smoothstep(.22, .0, r) + exp(-r * r * 9.) * .75;
    diffuseColor = vec4(mix(vec3(.95, .82, .3), vec3(1., .97, .7), smoothstep(.15, .0, r)), min(1., light) * vGlow);`,
    { transparent: true, depthWrite: false, fog: false },
  );
  const list: Firefly[] = Array.from({ length: FIREFLIES }, () => ({ home: new THREE.Vector3(), up: new THREE.Vector3(), t: 0, life: 0, seed: 0, blink: 0, on: false }));
  return { g, mat, list, pos, glow };
}

// ---------- birds ----------
const BIRDS = 5;
function makeBirds() {
  // A bird from above: body along z (forward), wings out along x; wing tips flap (|x| = 1).
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0.45, 0.09, 0, 0, 0, 0, -0.35, -0.09, 0, 0,
        0.08, 0, 0.12, 0.55, 0, 0.0, 1, 0, -0.18, 0.08, 0, -0.1,
        -0.08, 0, 0.12, -0.55, 0, 0.0, -1, 0, -0.18, -0.08, 0, -0.1,
      ],
      3,
    ),
  );
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 7, 5, 6, 7, 8, 11, 9, 9, 11, 10]);
  const pos = dyn(BIRDS, 3);
  const dir = dyn(BIRDS, 4);
  g.setAttribute("iPos", pos);
  g.setAttribute("iDir", dir);
  g.instanceCount = BIRDS;
  const mat = drawn(
    "birds",
    "attribute vec3 iPos;\nattribute vec4 iDir;",
    `vec3 up = normalize(iPos);
    vec3 fw = normalize(iDir.xyz - up * dot(iDir.xyz, up));
    vec3 side = cross(up, fw);
    // Wingbeats in bursts, then a glide with the wings held a little up.
    float burst = smoothstep(-.3, .4, sin(uTime * .9 + iDir.w * 2.7));
    float flap = mix(.25, sin(uTime * 10. + iDir.w * 5.), burst);
    float x = position.x;
    vec3 lp = side * x + up * (pow(abs(x), 1.4) * flap * .55) + fw * position.z;
    vec3 transformed = iPos + lp * .32;`,
    `diffuseColor.rgb = vec3(.23, .29, .3);`,
    { side: THREE.DoubleSide },
  );
  return { g, mat, pos, dir };
}

export function Life() {
  const leaves = useMemo(makeLeaves, []);
  const flutters = useMemo(makeFlutters, []);
  const birds = useMemo(makeBirds, []);
  const fireflies = useMemo(makeFireflies, []);
  const flock = useMemo(() => ({ t: -8, dur: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), alt: 0, wait: 6 }), []);

  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 1 / 20);
    const now = clock.elapsedTime;
    const s0 = journey.s;
    const ahead = journey.dir >= 0 ? 1 : -1;
    const windDir = wind.uWind.value;

    // Leaves: drop from the canopies ahead, swing and turn on the way down, lie a moment, go.
    for (let i = 0; i < LEAVES; i++) {
      const L = leaves.leaves[i];
      if (!L.on) {
        const s = s0 + ahead * (1 + Math.random() * 11);
        if (Math.random() < dt * 1.6 && wild(s)) {
          beside(s, (Math.random() - 0.5) * 9, L.p);
          L.ground = PLANET_RADIUS + heightAt(L.p);
          L.p.setLength(L.ground + 1.8 + Math.random() * 2.6);
          L.t = Math.random() * 10;
          L.spin = Math.random() * 6.28;
          L.rate = (Math.random() - 0.5) * 3;
          L.flip = Math.random() * 6.28;
          L.flipRate = 2 + Math.random() * 4;
          L.size = 0.05 + Math.random() * 0.035;
          L.col = LEAF_COLS[Math.floor(Math.random() * LEAF_COLS.length)];
          L.rest = 0;
          L.on = true;
        }
      } else {
        const up = _a.copy(L.p).normalize();
        const h = L.p.length() - L.ground;
        if (h > 0.03) {
          L.t += dt;
          // falling, carried on the wind and swinging side to side
          const side = _b.copy(windDir).cross(up).normalize();
          L.p.addScaledVector(up, -dt * (0.38 + 0.12 * Math.sin(L.t * 3.1)));
          L.p.addScaledVector(windDir, dt * 0.22).addScaledVector(side, dt * 0.45 * Math.sin(L.t * 1.9 + L.flip));
          L.spin += L.rate * dt;
          L.flip += L.flipRate * dt;
        } else {
          // landed: it lies a moment, then is gone
          L.rest += dt;
          if (L.rest > 2) L.on = false;
        }
        // A leaf drifting far behind the walker is let go.
        if (L.p.distanceTo(beside(s0, 0, _b)) > 16) L.on = false;
      }
      const shrink = L.on ? Math.min(1, Math.max(0, (2 - L.rest) / 0.6)) : 0;
      leaves.pos.setXYZ(i, L.p.x, L.p.y, L.p.z);
      leaves.spin.setXYZW(i, L.spin, L.flip, L.size * shrink, 0);
      leaves.col.setXYZ(i, L.col.r, L.col.g, L.col.b);
    }
    leaves.pos.needsUpdate = leaves.spin.needsUpdate = leaves.col.needsUpdate = true;

    // Butterflies: each wanders round a spot on the verge ahead for a while, then moves on. Only in the
    // daylight, and while it is fair: none at night, in the rain or in the snow. (As night falls, the
    // ones about see out their while; a shower sends them off at once.)
    const fair = daylight.night < 0.3 && weather.cloud < 0.3;
    for (let i = 0; i < FLUTTERS; i++) {
      const B = flutters.list[i];
      if (!B.on || weather.cloud >= 0.3 || B.t > B.life || B.home.distanceTo(beside(s0, 0, _b)) > 18) {
        const s = s0 + ahead * (1.5 + Math.random() * 5);
        B.on = fair && wild(s);
        if (B.on) {
          const lat = (Math.random() < 0.5 ? -1 : 1) * (1.1 + Math.random() * 1.6);
          beside(s, lat, B.home);
          B.up.copy(B.home).normalize();
          B.ground = PLANET_RADIUS + heightAt(B.home);
          B.home.setLength(B.ground);
          B.t = 0;
          B.life = 7 + Math.random() * 6;
          B.seed = Math.random() * 100;
        }
      }
      B.t += dt;
      const k = B.seed;
      routeFrame(s0, _f);
      // a looping, unsteady path: slow drift plus quick jinks
      const x = Math.sin(B.t * 0.7 + k) * 0.7 + Math.sin(B.t * 2.3 + k * 2) * 0.18;
      const z = Math.cos(B.t * 0.55 + k * 1.3) * 0.7 + Math.cos(B.t * 2.9 + k) * 0.15;
      const y = 0.45 + 0.3 * Math.sin(B.t * 1.3 + k) + 0.08 * Math.sin(B.t * 6.1 + k);
      const p = _a.copy(B.home).addScaledVector(_f.right, x).addScaledVector(_f.fwd, z).addScaledVector(B.up, y);
      const vx = Math.cos(B.t * 0.7 + k) * 0.49 + Math.cos(B.t * 2.3 + k * 2) * 0.41;
      const vz = -Math.sin(B.t * 0.55 + k * 1.3) * 0.385 - Math.sin(B.t * 2.9 + k) * 0.43;
      const heading = _b.copy(_f.right).multiplyScalar(vx).addScaledVector(_f.fwd, vz);
      // (one not out yet waits at the planet's centre, out of sight)
      if (B.on) flutters.pos.setXYZ(i, p.x, p.y, p.z);
      else flutters.pos.setXYZ(i, 0, 0, 0);
      flutters.dir.setXYZW(i, heading.x, heading.y, heading.z, k);
      const c = WING_COLS[i % WING_COLS.length];
      flutters.col.setXYZ(i, c.r, c.g, c.b);
    }
    flutters.pos.needsUpdate = flutters.dir.needsUpdate = flutters.col.needsUpdate = true;

    // Fireflies: in the forest at night, drifting slowly among the trees either side of the path and
    // a little over it, each glowing and fading in its own slow rhythm.
    // (they keep in out of the rain and the snow)
    const night = daylight.night * (1 - weather.cloud);
    fireflies.g.instanceCount = night > 0.02 ? FIREFLIES : 0;
    if (night > 0.02) {
      for (let i = 0; i < FIREFLIES; i++) {
        const F = fireflies.list[i];
        if (!F.on || F.t > F.life || F.home.distanceTo(beside(s0, 0, _b)) > 20) {
          const s = s0 + ahead * (-3 + Math.random() * 17);
          F.on = zoneAt(s) === "forest";
          if (F.on) {
            const lat = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 4);
            beside(s, lat, F.home);
            F.up.copy(F.home).normalize();
            F.home.setLength(PLANET_RADIUS + heightAt(F.home) + 0.25 + Math.random() * 1.6);
            F.t = 0;
            F.life = 8 + Math.random() * 10;
            F.seed = Math.random() * 100;
            F.blink = 1.6 + Math.random() * 2.6;
          }
        }
        F.t += dt;
        const k = F.seed;
        routeFrame(s0, _f);
        const p = _a
          .copy(F.home)
          .addScaledVector(_f.right, Math.sin(F.t * 0.31 + k) * 0.6 + Math.sin(F.t * 1.3 + k * 3) * 0.08)
          .addScaledVector(_f.fwd, Math.cos(F.t * 0.27 + k * 1.7) * 0.6)
          .addScaledVector(F.up, Math.sin(F.t * 0.45 + k * 2.3) * 0.25);
        // glow: a slow swell and fade, dark between; faded in and out over its life
        const pulse = Math.max(0, Math.sin((F.t / F.blink) * Math.PI * 2 + k));
        const life = Math.min(1, F.t / 1.5, (F.life - F.t) / 1.5);
        if (F.on) fireflies.pos.setXYZ(i, p.x, p.y, p.z);
        else fireflies.pos.setXYZ(i, 0, 0, 0);
        fireflies.glow.setX(i, F.on ? night * Math.max(0, life) * (0.15 + 0.85 * pulse * pulse) : 0);
      }
      fireflies.pos.needsUpdate = fireflies.glow.needsUpdate = true;
    }

    // Birds: a small flock crosses the sky ahead every so often, side to side, in a loose vee.
    const ft = now - flock.t;
    if (ft > flock.dur + flock.wait) {
      routeFrame(s0 + ahead * (6 + Math.random() * 4), _f);
      const across = Math.random() < 0.5 ? 1 : -1;
      flock.from.copy(_f.pos).addScaledVector(_f.right, -across * 16).addScaledVector(_f.fwd, ahead * (Math.random() - 0.5) * 6);
      flock.dir.copy(_f.right).multiplyScalar(across).addScaledVector(_f.fwd, ahead * (Math.random() - 0.3) * 0.5).normalize();
      flock.alt = 6 + Math.random() * 2;
      flock.t = now;
      flock.dur = 32 / 3.4;
      flock.wait = 10 + Math.random() * 14;
    }
    const fly = Math.min(ft, flock.dur);
    for (let i = 0; i < BIRDS; i++) {
      // a vee: the leader, then pairs further back and out to each side
      const row = Math.ceil(i / 2);
      const wing = i === 0 ? 0 : i % 2 ? 1 : -1;
      const up = _b.copy(flock.from).normalize();
      const side = _a.copy(flock.dir).cross(up).normalize();
      const p = new THREE.Vector3()
        .copy(flock.from)
        .addScaledVector(flock.dir, 3.4 * fly - row * 0.9)
        .addScaledVector(side, wing * row * 0.85 + 0.12 * Math.sin(now * 0.8 + i))
        .setLength(PLANET_RADIUS + flock.alt + 0.25 * Math.sin(now * 1.1 + i * 1.7));
      const shown = ft < flock.dur;
      birds.pos.setXYZ(i, shown ? p.x : 0, shown ? p.y : 0, shown ? p.z : 0);
      birds.dir.setXYZW(i, flock.dir.x, flock.dir.y, flock.dir.z, i * 1.3);
    }
    birds.pos.needsUpdate = birds.dir.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={leaves.g} material={leaves.mat} frustumCulled={false} />
      <mesh geometry={flutters.g} material={flutters.mat} frustumCulled={false} />
      <mesh geometry={birds.g} material={birds.mat} frustumCulled={false} />
      {/* (after everything else: light added on top) */}
      <mesh geometry={fireflies.g} material={fireflies.mat} frustumCulled={false} renderOrder={20} />
    </group>
  );
}
