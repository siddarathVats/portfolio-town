"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { weather } from "@/lib/weather";
import { coverUniform } from "./style";

/**
 * Snow (lib/weather.ts): soft round flakes drifting down through a box of air around the camera, set
 * a little ahead of it, each swaying on its own as it falls, slowly, so it reads as snow and not rain.
 * Placed on the GPU from each flake's seed and the time; the heavier the fall, the more flakes show.
 * It also tells the ground how much snow lies (see style.ts: painted, dusted).
 */
const FLAKES = 1400;
const BOX = new THREE.Vector3(16, 8, 20);

const VERT = /* glsl */ `
attribute vec4 iSeed;
uniform float uTime; uniform float uSnow; uniform float uDrift;
uniform vec3 uBox; uniform vec3 uCentre; uniform vec3 uUp; uniform vec3 uRight; uniform vec3 uFwd;
varying vec2 vQ; varying float vA;
void main(){
  float on = step(iSeed.w, uSnow);
  float speed = .7 + .5 * fract(iSeed.w * 23.7);
  float ph = iSeed.w * 40.;
  vec3 l = vec3(iSeed.x + uDrift * (.8 + .4 * fract(iSeed.w * 13.1)), iSeed.y - uTime * speed / uBox.y, iSeed.z);
  vec3 f = fract(l);
  l = (f - .5) * uBox;
  // swaying side to side and to and fro as it falls
  l.x += .35 * sin(uTime * (.8 + iSeed.x) + ph);
  l.z += .25 * sin(uTime * (.6 + iSeed.z) + ph * 1.7);
  vec3 p = uCentre + uRight * l.x + uUp * l.y + uFwd * l.z;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 r = normalize(cross(uUp, toCam));
  vec3 u = cross(toCam, r);
  float size = .022 + .02 * fract(iSeed.w * 71.3);
  p += (r * position.x + u * position.y) * size;
  vQ = position.xy;
  // (fading right by the lens, and far off into the haze)
  float d = distance(p, cameraPosition);
  // (and in and out at the edges of the box of falling snow, so no flake pops into being)
  float edge = smoothstep(0., .12, f.y) * smoothstep(1., .88, f.y) * smoothstep(0., .1, f.x) * smoothstep(1., .9, f.x) * smoothstep(0., .1, f.z) * smoothstep(1., .9, f.z);
  vA = on * edge * smoothstep(1.2, 3., d) * (1. - smoothstep(12., 16., d));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FRAG = /* glsl */ `
varying vec2 vQ; varying float vA;
void main(){
  float a = smoothstep(1., .35, length(vQ)) * vA;
  if (a < .01) discard;
  gl_FragColor = vec4(.97, .98, 1., a * .9);
}`;

export function Snow() {
  const { mesh, u } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(FLAKES * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = FLAKES;
    const u = {
      uTime: { value: 0 },
      uSnow: { value: 0 },
      uDrift: { value: 0 },
      uBox: { value: BOX },
      uCentre: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
    };
    // (double-sided: which way a flake's card winds depends on how it is turned to the camera)
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    return { mesh, u };
  }, []);

  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 1 / 20);
    coverUniform.value = weather.cover;
    const s = weather.snow;
    mesh.visible = s > 0.02;
    if (!mesh.visible) return;
    u.uTime.value += dt;
    // (carried across by the wind)
    u.uDrift.value = (u.uDrift.value + (dt * (0.15 + 2.4 * weather.wind)) / BOX.x) % 1000;
    // (flakes come only once the clouds have gathered)
    u.uSnow.value = Math.max(0, (s - 0.25) / 0.75);
    u.uUp.value.copy(camera.up);
    camera.getWorldDirection(u.uFwd.value);
    u.uFwd.value.addScaledVector(camera.up, -u.uFwd.value.dot(camera.up)).normalize();
    u.uRight.value.crossVectors(u.uFwd.value, camera.up).normalize();
    u.uCentre.value.copy(camera.position).addScaledVector(u.uFwd.value, BOX.z * 0.4).addScaledVector(camera.up, 0.5);
  });

  return <primitive object={mesh} />;
}
