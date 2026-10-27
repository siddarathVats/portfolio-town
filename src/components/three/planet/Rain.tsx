"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { weather } from "@/lib/weather";
import { sfx } from "@/lib/sfx";
import { body } from "./drips";

/**
 * Rain (lib/weather.ts): thin streaks falling through a box of air around the camera, set a little
 * ahead of it, so wherever the walk goes it is raining around and in front of the courier. Each drop's
 * place is worked out on the GPU from its seed and the time (nothing per drop on the CPU); the heavier
 * the shower, the more of the drops are shown. Drawn behind buildings (depth tested), not lit.
 */
const DROPS = 1500;
/** The box of falling rain (m): across, up, along the view. */
const BOX = new THREE.Vector3(18, 9, 22);

const VERT = /* glsl */ `
attribute vec4 iSeed;
uniform float uTime; uniform float uRain; uniform float uSlant; uniform float uDrift;
uniform vec3 uBox; uniform vec3 uCentre; uniform vec3 uUp; uniform vec3 uRight; uniform vec3 uFwd;
uniform vec4 uShelter;
varying float vA; varying vec2 vQ;
void main(){
  // Only as many drops as the shower is heavy.
  float on = step(iSeed.w, uRain);
  float speed = 7. + 3. * fract(iSeed.w * 37.1);
  vec3 l = vec3(iSeed.x + uDrift, iSeed.y - uTime * speed / uBox.y, iSeed.z);
  vec3 f = fract(l);
  l = (f - .5) * uBox;
  vec3 p = uCentre + uRight * l.x + uUp * l.y + uFwd * l.z;
  // A fine streak along the way it falls (slanted by the wind, which carries the drops across), turned
  // to face the camera, some a little longer than others.
  vec3 dir = normalize(-uUp + uRight * uSlant);
  vec3 side = normalize(cross(dir, normalize(p - cameraPosition)));
  float len = .16 + .1 * fract(iSeed.w * 91.7);
  p += side * position.x * .008 + dir * position.y * len;
  vQ = position.xy;
  // Faded in and out at the edges of the box of rain (so no drop pops into being), right by the lens
  // (where a drop would be a thick bar across the picture) and off into the haze.
  float d = distance(p, cameraPosition);
  float edge = smoothstep(0., .12, f.y) * smoothstep(1., .88, f.y) * smoothstep(0., .1, f.x) * smoothstep(1., .9, f.x) * smoothstep(0., .1, f.z) * smoothstep(1., .9, f.z);
  vA = on * edge * smoothstep(2., 4.5, d) * (1. - .5 * smoothstep(9., 16., d));
  // None under the courier's umbrella.
  vec3 sd = p - uShelter.xyz;
  float below = dot(sd, uUp);
  if (below < 0. && length(sd - uUp * below) < uShelter.w) vA = 0.;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FRAG = /* glsl */ `
varying float vA; varying vec2 vQ;
void main(){
  // Soft across its width, brightest toward its leading end, fading off at the tail.
  // (its leading end is the lower one, y = 1, as it falls along dir)
  float a = vA * (1. - vQ.x * vQ.x) * (.25 + .75 * smoothstep(-1., .6, vQ.y)) * smoothstep(1., .85, vQ.y);
  if (a < .005) discard;
  gl_FragColor = vec4(.9, .94, .98, .34 * a);
}`;

export function Rain() {
  const { mesh, u } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = DROPS;
    const u = {
      uTime: { value: 0 },
      uRain: { value: 0 },
      uSlant: { value: 0.12 },
      uDrift: { value: 0 },
      uBox: { value: BOX },
      uCentre: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uShelter: { value: body.shelter },
    };
    // (double-sided: which way a streak's card winds depends on how it is turned to the camera)
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    return { mesh, u };
  }, []);

  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 1 / 20);
    weather.update(dt);
    sfx.rain(weather.rain);
    sfx.air(weather.wind, weather.snow);
    const r = weather.rain;
    mesh.visible = r > 0.02;
    if (!mesh.visible) return;
    u.uTime.value += dt;
    u.uSlant.value = 0.08 + 0.5 * weather.wind;
    u.uDrift.value = (u.uDrift.value + (dt * u.uSlant.value * 8) / BOX.x) % 1;
    // (drops come in only once the clouds have gathered)
    u.uRain.value = Math.max(0, (r - 0.25) / 0.75);
    u.uUp.value.copy(camera.up);
    camera.getWorldDirection(u.uFwd.value);
    u.uFwd.value.addScaledVector(camera.up, -u.uFwd.value.dot(camera.up)).normalize();
    u.uRight.value.crossVectors(u.uFwd.value, camera.up).normalize();
    u.uCentre.value.copy(camera.position).addScaledVector(u.uFwd.value, BOX.z * 0.4).addScaledVector(camera.up, 1);
  });

  return <primitive object={mesh} />;
}
