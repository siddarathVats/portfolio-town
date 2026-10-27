"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { C, toonRamp } from "./style";
import { wind } from "./foliage";
import { FALL_DROP, FALL_LIP, fallFrame } from "./plan";
import { daylight } from "@/lib/daylight";
import { weather } from "@/lib/weather";

/**
 * Moving water, drawn flat like the rest of the world: the stream's light runs downstream in broken
 * streaks with foam along its banks, and at its head a waterfall pours off a ledge of boulders into a
 * churning pool, throwing up spray. All of it runs on the scene's clock (wind.uTime).
 */

const NOISE = /* glsl */ `
float wh(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y);
}
`;
const FOAM = "vec3(.93, .98, .96)";

/**
 * What the stream reflects and how it is out there, set each frame (WaterWeather, below): the sky's
 * colour, the night, the rain, how muddy the run-off has made it, the cold (snow lying), the wind and
 * the overcast; and `uFlow`, how far the current has run (s at a calm pace), quicker in the rain.
 */
const streamU = {
  uSky: { value: new THREE.Color("#abd9d0") },
  uNight: { value: 0 },
  uRain: { value: 0 },
  uMurk: { value: 0 },
  uCold: { value: 0 },
  uWind: { value: 0 },
  uCloud: { value: 0 },
  uFlow: { value: 0 },
};

let stream: THREE.MeshToonMaterial | null = null;
/**
 * The stream, painted: clear over the sandy shallows at its banks, the bed showing through and fading
 * as it deepens in bands to a blue-teal mid-stream and in the pool under the fall; the sky in it where
 * it is looked at slantwise; long soft streaks of light drawn out along the current, quicker
 * mid-stream; a wavering line of foam at the banks; and the weather in it: a slow sheen of sun on a
 * fine day, quicker, greyer and muddied in the rain with rings spreading where the drops land, darker
 * and edged with slush in the snow.
 *
 * Nothing in it is finer than the screen can show: the small detail fades out with distance (seen low
 * across the stream from the bridge, a pixel covers ten centimetres of it), and the current moves each
 * layer as one. (It used to run quicker mid-stream by shearing one pattern, finer every second the page
 * was open, until after a few minutes the whole stream glittered.)
 */
export function streamMaterial() {
  if (stream) return stream;
  const m = new THREE.MeshToonMaterial({ color: C.water, gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    Object.assign(sh.uniforms, streamU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 flow;\nvarying vec2 vFlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlow = flow;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float uTime, uNight, uRain, uMurk, uCold, uWind, uCloud, uFlow;\nuniform vec3 uSky;\nvarying vec2 vFlow;\n${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
      float across = vFlow.x, run = vFlow.y;
      float mid = 1. - abs(across - .5) * 2.;
      // How much of the stream a pixel covers here (m; it is some 2 m wide): the detail goes, softly,
      // before it gets small enough to shimmer.
      float px = max(fwidth(across) * 2., fwidth(run));
      float fine = 1. - smoothstep(.025, .07, px);
      float soft = 1. - smoothstep(.08, .3, px);
      // The current, in two layers each moving as one: slow by the banks, quick mid-stream.
      float slow = run - uFlow * .55, fast = run - uFlow * 1.1;
      float quick = smoothstep(.1, .8, mid);
      // How deep: nothing at the banks (which lap in and out, higher in the rain), most mid-stream and
      // in the fall's pool.
      float lap = (.06 * sin(uTime * 1.4 + run * 1.9) + .05 * (wn(vec2(run * 1.7, uTime * .45)) - .5)) * (1. + .6 * uRain);
      float deep = clamp(smoothstep(0., .85, mid + lap) + .4 * smoothstep(3.2, .4, run), 0., 1.);
      // ... in three painted bands, their edges wavering
      float dd = deep + .1 * (wn(vec2(across * 7., run * .8 - uTime * .25)) - .5) * soft;
      float aaB = fwidth(dd) + .004;
      float band = .5 * smoothstep(.26 - aaB, .26 + aaB, dd) + .5 * smoothstep(.74 - aaB, .74 + aaB, dd);
      // (linear colours: a clear turquoise, the stream's own teal, a deep blue-teal; in the rain a
      // greyer green, the run-off clouding it; in the snow a cold, dark slate)
      vec3 shallow = mix(vec3(.2, .62, .54), vec3(.3, .4, .3), .7 * uMurk);
      vec3 midCol = mix(diffuseColor.rgb, vec3(.24, .33, .29), .65 * uMurk);
      vec3 deepCol = mix(vec3(.07, .3, .36), vec3(.13, .2, .2), .6 * uMurk);
      vec3 col = mix(shallow, mix(midCol, deepCol, smoothstep(.5, 1., band)), smoothstep(0., .5, band));
      col = mix(col, vec3(dot(col, vec3(.3, .5, .2))) * vec3(.8, .92, 1.05), .5 * uCold);
      // (the sandy bed showing through the shallows, fading out as the water deepens, less as it muddies)
      col = mix(col, vec3(.5, .6, .38), .55 * (1. - smoothstep(.02, .32, dd)) * (1. - .6 * uMurk));
      // The sky in it, more the flatter the look across it (and the less the rain roughens it).
      float glance = 1. - abs(dot(normalize(vViewPosition), normalize(vNormal)));
      col = mix(col, uSky * vec3(.8, 1., 1.), .3 * pow(glance, 5.) * (1. - .5 * uNight) * (1. - .4 * uRain) * (1. - .3 * uWind));
      // Long soft streaks of paler water drawn out along the current, meandering (more in the wind).
      float mea = .8 + .6 * uWind;
      float sSlow = wn(vec2(across * 5. + mea * wn(vec2(slow * .25, 1.)), slow * .3));
      float sFast = wn(vec2(across * 5. + mea * wn(vec2(fast * .25, 3.)) + 7., fast * .3 + 4.));
      float streak = smoothstep(.55, .8, mix(sSlow, sFast, quick)) * smoothstep(.1, .45, deep);
      col = mix(col, mix(col, vec3(.62, .86, .82), .55), streak * (.55 - .25 * uMurk) * soft);
      // Foam at the banks, a wavering line where the lapping edge meets them (wider in the rain), and
      // in the snow a rim of slush along them.
      float rim = .17 + .05 * uRain + .1 * uCold;
      float bank = smoothstep(rim, .02, across + .5 * lap) + smoothstep(1. - rim, .98, across - .5 * lap);
      float fb = bank + .3 * (wn(vec2(across * 6., slow * 1.2)) - .5) * soft;
      float aaF = fwidth(fb) + .01;
      float foam = smoothstep(.6 - aaF, .6 + aaF, fb);
      vec3 foamCol = mix(${FOAM}, vec3(.86, .9, .93), uCold);
      diffuseColor.rgb = mix(col, foamCol, foam * .9);
      // The sun on it, on a fine day: a slow, soft sheen drifting down the quick water.
      float sheen = smoothstep(.62, .82, wn(vec2(across * 2.6 + 11., fast * .22)));
      sheen *= quick * soft * (1. - foam) * (1. - uCloud) * (1. - .85 * uNight) * (.4 + .6 * glance);
      // Rings spreading where drops land, while it rains: a few at a time, each in a cell about
      // three quarters of a metre square, soft-edged and fading as they spread, and only close enough
      // to see. (Thin rings in small cells read from any distance as glitter.)
      vec2 rp = vec2(across * 2.6, run * 1.3);
      vec2 ri = floor(rp), rf = fract(rp);
      float rt = uTime * .9 + wh(ri) * 5.;
      float ra = fract(rt);
      vec2 rc = .3 + .4 * vec2(wh(ri + floor(rt)), wh(ri + floor(rt) + 7.));
      float rd = length(rf - rc);
      float rw = max(fwidth(rd) * 2., .05);
      float ring = (1. - smoothstep(0., rw, abs(rd - ra * .3))) * (1. - ra) * (1. - ra) * uRain;
      ring *= step(.62, wh(ri + floor(rt) * 1.7)) * fine * (1. - foam);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1., .97, .88) * sheen * .22 + vec3(.85, .92, .95) * ring * .2;`,
      );
  };
  m.customProgramCacheKey = () => "stream";
  return (stream = m);
}

/** A basic (unlit, fogged) material with its own vertex and colour code. */
function painted(name: string, decl: string, vertex: string | null, colour: string, opts: THREE.MeshBasicMaterialParameters = {}) {
  const m = new THREE.MeshBasicMaterial({ color: "#ffffff", ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uFlow = streamU.uFlow;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\nuniform float uTime, uFlow;\n${decl}`);
    if (vertex) sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", vertex);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime, uFlow;\n${decl.replace(/attribute [^;]+;/g, "")}\n${NOISE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${colour}`);
  };
  m.customProgramCacheKey = () => name;
  return m;
}

/** The falling sheet: streaks pouring down, a bright lip, white water where it lands, frayed edges. */
const sheetMaterial = () =>
  painted(
    "fall-sheet",
    "attribute vec2 sheet;\nvarying vec2 vSheet;",
    "#include <begin_vertex>\nvSheet = sheet;",
    `float u = vSheet.x, a = vSheet.y;
    float fray = .5 - .07 * wn(vec2(a * 6. - uTime * 3., u * 3.)) - .05 * a;
    if (abs(u - .5) > fray) discard;
    float fall = a * 2.4 - uFlow * 2.9;
    float s1 = wn(vec2(u * 10., fall));
    float s2 = wn(vec2(u * 23. + 4., fall * 1.7));
    vec3 col = mix(vec3(.31, .63, .65), vec3(.55, .83, .82), smoothstep(.2, 0., a) * .8 + .3 * step(.55, s2));
    col = mix(col, ${FOAM}, step(.6, s1 * .6 + s2 * .4) * .85);
    col = mix(col, ${FOAM}, smoothstep(.72, .95, a) * step(.32, wn(vec2(u * 8., a * 5. - uFlow * 4.))));
    col *= 1. - .16 * smoothstep(.25, .5, abs(u - .5));
    diffuseColor.rgb = col;`,
    { side: THREE.DoubleSide },
  );

/** The pool's churn: rings of foam spreading from where the water lands, thinning out; their edges
 *  soft (cut hard, from across the stream they broke up into flickering specks). */
const poolMaterial = () =>
  painted(
    "fall-pool",
    "attribute vec2 disc;\nvarying vec2 vDisc;",
    "#include <begin_vertex>\nvDisc = disc;",
    `float r = length(vDisc * vec2(1., .8));
    float ang = atan(vDisc.y, vDisc.x);
    float n = wn(vec2(ang * 3.2 + 9., r * 3.4 - uFlow * 1.4)) * .7 + .3 * wn(vec2(ang * 7., r * 7. - uFlow * 2.));
    float th = mix(.25, .78, smoothstep(.35, 1.4, r));
    float aa = fwidth(n) + .03;
    float churn = smoothstep(th - aa, th + aa, n) * (1. - smoothstep(1.3, 1.45, r));
    if (churn < .02) discard;
    diffuseColor.rgb = ${FOAM};
    diffuseColor.a *= churn;`,
    { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
  );

/** Spray: drops thrown up where the water lands, arcing out and falling back. */
const sprayMaterial = (f: ReturnType<typeof fallFrame>, at: THREE.Vector3) => {
  const m = painted(
    "fall-spray",
    "attribute vec4 iDrop;\nvarying vec2 vDrop;\nuniform vec3 uAt, uUp, uDown, uAcross;",
    `float age = fract(uTime * .85 + iDrop.w);
    vec3 dir = uDown * cos(iDrop.x) + uAcross * sin(iDrop.x);
    float hgt = iDrop.z * age - 2.4 * age * age;
    vec3 c = uAt + dir * (iDrop.y * age) + uUp * hgt;
    // (squashed to nothing once back under the surface)
    float size = .1 * (1. - .45 * age) * step(0., hgt);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 transformed = c + (right * position.x + camUp * position.y) * size;
    vDrop = position.xy;`,
    `if (dot(vDrop, vDrop) > 1.) discard;
    diffuseColor.rgb = mix(${FOAM}, vec3(.7, .9, .9), smoothstep(.4, 1., length(vDrop)));`,
  );
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, gl) => {
    sh.uniforms.uAt = { value: at };
    sh.uniforms.uUp = { value: f.up };
    sh.uniforms.uDown = { value: f.down };
    sh.uniforms.uAcross = { value: f.across };
    base.call(m, sh, gl);
  };
  return m;
};

function build() {
  const f = fallFrame();
  const lift = 0.035;
  const at = (out: THREE.Vector3, x: number, y: number, z: number) => out.copy(f.base).addScaledVector(f.across, x).addScaledVector(f.up, y + lift).addScaledVector(f.down, z);

  // The sheet: rows from the lip (a = 0) to the pool (a = 1), arcing out as it falls, bowed a little.
  const ROWS = 18;
  const COLS = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= ROWS; j++) {
    const a = j / ROWS;
    const w = 1.05 + 0.3 * a;
    const out = -FALL_LIP + (FALL_LIP + 0.2) * (1 - (1 - a) * (1 - a));
    for (let i = 0; i <= COLS; i++) {
      const u = i / COLS;
      at(v, (u - 0.5) * w, FALL_DROP * (1 - a), out + 0.07 * (1 - (2 * u - 1) ** 2));
      pos.push(v.x, v.y, v.z);
      uv.push(u, a);
    }
    if (j)
      for (let i = 0; i < COLS; i++) {
        const p = (j - 1) * (COLS + 1) + i;
        const q = j * (COLS + 1) + i;
        idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  sheet.setAttribute("sheet", new THREE.Float32BufferAttribute(uv, 2));
  sheet.setIndex(idx);
  sheet.computeBoundingSphere();

  // The pool's churn: a disc on the water round the landing, in rings.
  const land = at(new THREE.Vector3(), 0, 0.012, 0.25);
  const dpos: number[] = [];
  const disc: number[] = [];
  const didx: number[] = [];
  const RINGS = 7;
  const SEG = 36;
  for (let ring = 0; ring <= RINGS; ring++) {
    const rr = (1.5 * ring) / RINGS;
    for (let k = 0; k < SEG; k++) {
      const ang = (k / SEG) * Math.PI * 2;
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr * 1.25;
      v.copy(land).addScaledVector(f.across, x).addScaledVector(f.down, z);
      dpos.push(v.x, v.y, v.z);
      disc.push(x, z);
      if (ring) {
        const p = (ring - 1) * SEG + k;
        const q = ring * SEG + k;
        const p1 = (ring - 1) * SEG + ((k + 1) % SEG);
        const q1 = ring * SEG + ((k + 1) % SEG);
        didx.push(p, q, p1, p1, q, q1);
      }
    }
  }
  const pool = new THREE.BufferGeometry();
  pool.setAttribute("position", new THREE.Float32BufferAttribute(dpos, 3));
  pool.setAttribute("disc", new THREE.Float32BufferAttribute(disc, 2));
  pool.setIndex(didx);
  pool.computeBoundingSphere();

  // Spray: one small card per drop, each with its own direction, throw and moment.
  const DROPS = 22;
  const spray = new THREE.InstancedBufferGeometry();
  spray.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  spray.setIndex([0, 1, 2, 0, 2, 3]);
  const drops: number[] = [];
  for (let i = 0; i < DROPS; i++) {
    const h = (n: number) => Math.abs(Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
    drops.push((h(1) - 0.5) * 2.6, 0.4 + h(2) * 0.9, 1.3 + h(3) * 1.2, i / DROPS + h(4) * 0.04);
  }
  spray.setAttribute("iDrop", new THREE.InstancedBufferAttribute(new Float32Array(drops), 4));
  spray.instanceCount = DROPS;
  spray.boundingSphere = new THREE.Sphere(land.clone(), 2.5);
  return { f, sheet, pool, spray, land };
}

/** The waterfall at the stream's head (its ledge of boulders is part of the plan). */
export function Waterfall() {
  const parts = useMemo(() => {
    const b = build();
    return { ...b, mats: { sheet: sheetMaterial(), pool: poolMaterial(), spray: sprayMaterial(b.f, b.land) } };
  }, []);
  // The stream's sky (the haze's colour, which follows the time of day and the cloud), its night, its
  // weather; and its current, a third quicker again in a downpour (the fall with it), and as the
  // run-off muddies it, which clears as the ground dries; a little quicker in the wind, slower in the cold.
  useFrame(({ scene }, dt) => {
    if (scene.fog) streamU.uSky.value.copy((scene.fog as THREE.Fog).color).multiplyScalar(1.08);
    const u = streamU;
    u.uNight.value = daylight.night;
    u.uRain.value = Math.max(0, (weather.rain - 0.25) / 0.75);
    u.uMurk.value = Math.max(0.6 * u.uRain.value, 0.75 * weather.wet);
    u.uCold.value = Math.max(weather.cover, 0.5 * weather.snow);
    u.uWind.value = weather.wind;
    u.uCloud.value = weather.cloud;
    u.uFlow.value += Math.min(dt, 0.1) * (1 + 0.45 * u.uRain.value + 0.2 * u.uMurk.value + 0.2 * weather.wind - 0.3 * u.uCold.value);
  });
  return (
    <group>
      <mesh geometry={parts.sheet} material={parts.mats.sheet} />
      <mesh geometry={parts.pool} material={parts.mats.pool} renderOrder={1} />
      <mesh geometry={parts.spray} material={parts.mats.spray} />
    </group>
  );
}
