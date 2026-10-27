"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLANET_RADIUS, makeFrame, routeFrame } from "@/lib/world";
import { journey } from "@/lib/journey";
import { daylight, timeOfDay } from "@/lib/daylight";
import { weather } from "@/lib/weather";
import { noiseGLSL, noiseTexture } from "./noise3";
import { nightUniform } from "./style";

/**
 * A painted sky: soft teal overhead fading to a pale horizon, with flat two-tone clouds drifting
 * past. "Up" is the walker's up, so the sky sits right wherever they are on the planet.
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position, 1.)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.);
  gl_Position = p.xyww; // always at the far plane
}`;

/** Hashed value noise: what the hills were drawn with, kept so the baked outlines stay the same. */
const HASHED = /* glsl */ `
float h(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * n3(p); p *= 2.03; a *= .5; } return s; }
`;

/**
 * The distant hills only depend on the direction looked in, so their outlines are worked out once,
 * into a cube map, instead of from twelve noise lookups on every sky pixel every frame. Each channel
 * holds one ridge's height above the horizon (far hills, near hills, woods), scaled to fit 8 bits.
 */
const HILLS = /* glsl */ `
varying vec3 vDir;
${HASHED}
void main(){
  vec3 d = normalize(vDir);
  float far = .055 + .07 * fbm(d * 2.6 + 3.) + .02 * n3(d * 18.);
  float near = .025 + .05 * fbm(d * 4.4 + 9.) + .012 * n3(d * 30.);
  float woods = .006 + .016 * n3(d * 60.) + .01 * n3(d * 13.);
  gl_FragColor = vec4((far - .05) / .1, (near - .02) / .07, woods / .035, 1.);
}`;

const FRAG = /* glsl */ `
uniform vec3 uUp; uniform float uTime; uniform float uDip;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uCloud;
uniform samplerCube tHills;
// Time of day (lib/daylight.ts): how dark, how golden; where the moon and the setting sun are; the
// hills' light.
uniform float uNight; uniform float uDusk; uniform vec3 uMoon; uniform vec3 uSun; uniform vec3 uHillTint;
// How hard it is raining (lib/weather.ts): the cloud closes over, hiding the sun, the moon and stars.
uniform float uRain;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
varying vec3 vDir;
// The clouds and grain take their noise from the shared texture (one read per octave, see noise3.ts).
${noiseGLSL("n3")}
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * n3(p); p *= 2.03; a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  // Elevation above the true horizon (the planet's edge sits below eye level).
  float e = dot(d, uUp) + uDip;
  vec3 col = mix(uHorizon, uTop, smoothstep(-.05, .55, e));
  // Clouds are fixed to the world's sky, so they pass overhead as the walker goes round the planet;
  // they only show in a band above the horizon. Sparse, hard-edged irregular shapes (domain-warped so
  // their edges are ragged, not ribbons), long and flat: stretched along the horizon, thin in height
  // (the horizon here, wherever on the ball the walker is).
  float band = mix(smoothstep(.1, .28, e) * smoothstep(.95, .55, e), smoothstep(.0, .2, e), uRain);
  // A cloud is where fbm reaches .69 / band - .12, and fbm stays under .9375: where the band is .65
  // or less no cloud can form, so those pixels skip the noise entirely. Inside it, the sum stops as
  // soon as the octaves left can no longer change the answer (the same shapes, fewer lookups).
  if (band > .65 - .5 * uRain) {
    vec3 q = (d + uUp * dot(d, uUp) * 5.6) * .9 + vec3(uTime * .005, 0., 0.);
    q += .35 * vec3(fbm(q * 1.7 + 4.), 0., fbm(q * 1.7 + 9.));
    float need = .69 / band - .12 - .42 * uRain;
    float s = 0., a = .5, rest = .9375;
    for (int i = 0; i < 4; i++){
      s += a * n3(q); rest -= a;
      if (s >= need || s + rest < need) break;
      q *= 2.03; a *= .5;
    }
    col = mix(col, uCloud, step(need, s) * .8);
  }
  // Distant mountains in two layers of haze, and a dark line of far woods at their feet (all of them
  // lower than .15).
  // The setting sun: a soft warm glow low ahead, and the disc going down behind the hills.
  float clear = 1. - uRain;
  if (uDusk * clear > .01) {
    float sd = 1. - dot(d, uSun);
    col += vec3(1., .62, .38) * (exp(-sd * 18.) * .55 + smoothstep(.0012, .0008, sd) * .9) * uDusk * clear;
  }
  // Night: stars (each in its own cell of a grid over the sky, twinkling) and the moon.
  if (uNight * clear > .01 && e > 0.) {
    vec3 sp = d * 110.;
    vec3 ci = floor(sp);
    float h = h3(ci);
    if (h > .945) {
      vec3 c = ci + .5 + (vec3(h3(ci + 1.7), h3(ci + 3.1), h3(ci + 5.3)) - .5) * .5;
      float tw = .55 + .45 * sin(uTime * (1. + 3. * h3(ci + 7.9)) + h * 60.);
      col += vec3(.92, .95, 1.) * smoothstep(.3, .05, length(sp - c)) * tw * uNight * clear * smoothstep(.03, .2, e);
    }
    float md = 1. - dot(d, uMoon);
    float disc = smoothstep(.0011, .0009, md);
    // (a little shading over its face, like the seas on the moon)
    vec3 moon = vec3(.96, .94, .86) * (.86 + .14 * n3(d * 70.));
    col = mix(col + vec3(.5, .6, .8) * exp(-md * 220.) * .35 * uNight * clear, moon, disc * uNight * clear);
  }
  if (e < .15) {
    vec3 hl = textureLod(tHills, d, 0.).rgb;
    col = mix(col, vec3(.6, .77, .75) * uHillTint, step(e, .05 + .1 * hl.r) * .8);
    col = mix(col, vec3(.5, .68, .64) * uHillTint, step(e, .02 + .07 * hl.g));
    col = mix(col, vec3(.38, .55, .48) * uHillTint, step(e, .035 * hl.b));
  }
  col *= .985 + .03 * n3(d * 160.);
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}`;

/**
 * The sky's colours by day, at sunset and at night (overhead, at the horizon, the clouds, the hills'
 * light, and the fog, which the ground's grade then darkens further: see Ink).
 */
const pal = (day: string, dusk: string, night: string) => [new THREE.Color(day), new THREE.Color(dusk), new THREE.Color(night)] as const;
const TOP = pal("#58bdb3", "#5f86a8", "#0a1532");
const HORIZON = pal("#9fd6cb", "#f4b38f", "#1c2f57");
const CLOUD = pal("#a7ded5", "#f2a99b", "#22355a");
const HILLS_LIGHT = pal("#ffffff", "#ffc7b8", "#3a4d7a");
const FOG = pal("#abd9d0", "#f3c4a8", "#4d6b94");
const _c = new THREE.Color();
const _g = new THREE.Color();
const _h = new THREE.Color();
function paint(out: THREE.Color, p: readonly [THREE.Color, THREE.Color, THREE.Color], dusk: number, night: number) {
  return out.copy(p[0]).lerp(_c.copy(p[1]), dusk).lerp(p[2], night);
}
const aim = { night: 0, dusk: 0 };
const v = new THREE.Vector3();
const t = new THREE.Vector3();

/** Draws the hills' outlines into a cube map, once. */
function bakeHills(gl: THREE.WebGLRenderer) {
  const target = new THREE.WebGLCubeRenderTarget(512, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: HILLS, side: THREE.BackSide, depthTest: false, depthWrite: false }));
  scene.add(box);
  new THREE.CubeCamera(0.1, 10, target).update(gl, scene);
  box.geometry.dispose();
  box.material.dispose();
  return target;
}

export function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        uniforms: {
          uUp: { value: new THREE.Vector3(0, 1, 0) },
          uDip: { value: 0 },
          uTime: { value: 0 },
          uTop: { value: TOP[0].clone() },
          uHorizon: { value: HORIZON[0].clone() },
          uCloud: { value: CLOUD[0].clone() },
          tHills: { value: null as THREE.CubeTexture | null },
          uNight: { value: 0 },
          uDusk: { value: 0 },
          uMoon: { value: new THREE.Vector3(0, 1, 0) },
          uSun: { value: new THREE.Vector3(0, 1, 0) },
          uHillTint: { value: new THREE.Color(1, 1, 1) },
          uRain: { value: 0 },
          tNoise3: { value: noiseTexture() },
        },
      }),
    [],
  );
  const hills = useMemo(() => ({ target: null as THREE.WebGLCubeRenderTarget | null }), []);
  useEffect(() => () => hills.target?.dispose(), [hills]);
  const sky = useMemo(() => ({ f: makeFrame(), moon: new THREE.Vector3(), sun: new THREE.Vector3(), init: false, glassNight: -1, dark: false, glassT: 0 }), []);
  useFrame(({ camera, gl, scene }, dt) => {
    if (!hills.target) mat.uniforms.tHills.value = (hills.target = bakeHills(gl)).texture;
    mat.uniforms.uTime.value += dt;
    // The time of day where the walker is (eased, so a jump across the planet fades rather than cuts).
    const want = timeOfDay(journey.s, aim);
    const k = sky.init ? 1 - Math.exp(-dt * 2.5) : 1;
    daylight.night += (want.night - daylight.night) * k;
    daylight.dusk += (want.dusk - daylight.dusk) * k;
    const { night, dusk } = daylight;
    // The page's glass follows the dark (globals.css --night): light glass and dark ink by day, dark
    // glass and light ink by night. It turns over once it is dark enough (a margin each way, so it
    // doesn't flicker back and forth at the edge) and quickly, in a quarter of a second: crossing over
    // as slowly as the dusk falls left the ink a middling grey on middling glass, hard to read, for
    // the whole stretch of the walk it took. (In four steps: each change restyles the whole page,
    // which on a slower laptop is a dropped frame or two.)
    sky.dark = sky.dark ? night > 0.35 : night > 0.5;
    sky.glassT = sky.init ? THREE.MathUtils.clamp(sky.glassT + (sky.dark ? 1 : -1) * dt * 4, 0, 1) : sky.dark ? 1 : 0;
    const glassNight = Math.round(sky.glassT * 4) / 4;
    if (glassNight !== sky.glassNight) {
      sky.glassNight = glassNight;
      document.documentElement.style.setProperty("--night", String(glassNight));
    }
    const u = mat.uniforms;
    u.uNight.value = night;
    nightUniform.value = night;
    u.uDusk.value = dusk;
    paint(u.uTop.value, TOP, dusk, night);
    paint(u.uHorizon.value, HORIZON, dusk, night);
    paint(u.uCloud.value, CLOUD, dusk, night);
    paint(u.uHillTint.value, HILLS_LIGHT, dusk, night);
    if (scene.fog) paint((scene.fog as THREE.Fog).color, FOG, dusk, night);
    // A shower greys it all over (the overcast's own colours, by day or by night).
    const cloud = weather.cloud;
    u.uRain.value = cloud;
    if (cloud > 0.001) {
      // (snow's overcast is paler and whiter than rain's)
      const sn = weather.snow / Math.max(cloud, 1e-3);
      const grey = (c: THREE.Color, day: string, snowDay: string, dark: string) => c.lerp(_c.set(day).lerp(_h.set(snowDay), sn).lerp(_g.set(dark), night), cloud);
      grey(u.uTop.value, "#8d9ea1", "#b9c4ca", "#151d29");
      grey(u.uHorizon.value, "#b3c0c0", "#dfe5e8", "#2b3746");
      grey(u.uCloud.value, "#9fadae", "#cfd7db", "#232d3a");
      grey(u.uHillTint.value, "#c9d1d2", "#eef2f4", "#3a4658");
      if (scene.fog) grey((scene.fog as THREE.Fog).color, "#aab8b8", "#d9e0e3", "#45566b");
    }
    // The moon up ahead and to the left; the sun going down ahead and to the right, low over the hills.
    // Both turn with the road, eased, so they drift across the sky through the bends.
    const f = routeFrame(journey.s, sky.f);
    const left = v.copy(f.right).negate();
    const mk = sky.init ? 1 - Math.exp(-dt * 1.5) : 1;
    sky.moon.lerp(t.copy(f.fwd).addScaledVector(left, 0.45).addScaledVector(f.up, 0.32).normalize(), mk).normalize();
    sky.sun.lerp(t.copy(f.fwd).addScaledVector(f.right, 0.55).addScaledVector(f.up, 0.1 - 0.06 * dusk).normalize(), mk).normalize();
    sky.init = true;
    u.uMoon.value.copy(sky.moon);
    u.uSun.value.copy(sky.sun);
    // The camera's up is the walker's up (set by the runner).
    mat.uniforms.uUp.value.copy(camera.up);
    // How far below eye level the planet's horizon is, from the camera's height above the centre.
    mat.uniforms.uDip.value = Math.sqrt(Math.max(0, 1 - (PLANET_RADIUS / camera.position.length()) ** 2));
    mesh.position.copy(camera.position);
  });
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
    m.frustumCulled = false;
    // Drawn after the town, at the far plane: wherever a building or the ground is already in front,
    // the depth test rejects the pixel before this shader runs. Drawn first, it painted the whole
    // screen every frame only to be covered.
    m.renderOrder = 10;
    return m;
  }, [mat]);
  return <primitive object={mesh} />;
}
