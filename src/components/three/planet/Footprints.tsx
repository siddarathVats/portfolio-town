"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { weather } from "@/lib/weather";
import { prints } from "./prints";

/**
 * Footprints in the snow (lib/weather.ts cover): each time one of the courier's feet comes down while
 * snow is lying, a shoe print is pressed into it there, turned the way they are going (the Runner
 * queues them, see prints.ts). A print is a soft blue-grey hollow the shape of a sole, toe and heel,
 * with the tread showing; it fills in as the snow melts and fades away after half a minute or so.
 * Drawn over the snow as a blue-shaded hollow with a bright lip on its lit side.
 */
const PRINTS = 128;
/** Half the print's width and length (m): a child's shoe, as big as the courier is drawn (sprite.ts
 *  COURIER_SCALE), and a little more so it reads from the camera five metres back. (Life-size and pale,
 *  the trail hardly showed.) */
const HALF_W = 0.062;
const HALF_L = 0.118;
const LIFE = 60;

const VERT = /* glsl */ `
attribute vec3 iPos; attribute vec3 iFwd; attribute float iSide; attribute float iBorn;
uniform float uTime;
varying vec2 vQ; varying float vSide; varying float vAge; varying float vDist;
void main(){
  vec3 up = normalize(iPos);
  vec3 f0 = normalize(iFwd - up * dot(iFwd, up));
  vec3 r0 = cross(f0, up);
  // (each foot on its own track a hand's width apart, its toe turned out a little)
  float toe = .12 * iSide;
  vec3 f = normalize(f0 * cos(toe) + r0 * sin(toe));
  vec3 r = cross(f, up);
  vec3 at = iPos + r0 * iSide * .055;
  vec3 p = at + r * position.x * ${HALF_W} + f * position.y * ${HALF_L} + up * .012;
  vQ = position.xy; vSide = iSide; vAge = uTime - iBorn;
  vDist = distance(p, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FRAG = /* glsl */ `
uniform float uCover;
varying vec2 vQ; varying float vSide; varying float vAge; varying float vDist;
void main(){
  if (vAge < 0. || vAge > ${LIFE}.) discard;
  // The sole (m, toe ahead): a rounded heel and a broader ball joined by the waist, which curves in
  // on the inner side of the foot (mirrored for the other one).
  // (in the shape's own metres, as drawn for a 0.1 x 0.19 m sole: scaled up with the print)
  vec2 p = vec2(vQ.x * vSide * .05, vQ.y * .095);
  vec2 ha = vec2(0., -.05), ta = vec2(.0035, .04);
  vec2 ab = ta - ha;
  float t = clamp(dot(p - ha, ab) / dot(ab, ab), 0., 1.);
  float r = mix(.024, .035, smoothstep(0., 1., t)) - .011 * exp(-pow((t - .45) / .16, 2.)) * (.45 + .55 * smoothstep(.007, -.014, p.x));
  float d = length(p - (ha + t * ab)) / r;
  if (d > 1.25) discard;
  float fade = smoothstep(.12, .45, uCover) * (1. - smoothstep(${(LIFE * 0.55).toFixed(1)}, ${LIFE}., vAge)) * (1. - smoothstep(18., 30., vDist));
  // The hollow: in shade, deepest under the heel and the ball (where the weight came down), its tread
  // pressed in as faint ridges; its far wall catching the light a little; and a thin lip of snow
  // pushed up round it, brightest on the side toward the light.
  float inside = smoothstep(1., .9, d);
  float press = .55 + .45 * max(smoothstep(.3, 0., t), smoothstep(.6, .9, t));
  float tread = .95 + .05 * step(.5, fract(p.y * 75.));
  float wall = smoothstep(.55, .98, d) * smoothstep(-.014, .04, p.y + p.x * .3) * inside;
  vec3 hollow = mix(vec3(.38, .46, .6), vec3(.52, .6, .72), 1. - press) * tread;
  hollow = mix(hollow, vec3(.8, .85, .92), wall * .5);
  float lip = smoothstep(.98, 1.06, d) * smoothstep(1.25, 1.08, d) * smoothstep(-.02, .035, -p.y - p.x * .5);
  float a = fade * max(inside * (.5 + .2 * press), lip * .35);
  if (a < .01) discard;
  vec3 c = inside > .01 ? hollow : vec3(.98, .99, 1.);
  // (the colours above as they look on screen; the scene is drawn in linear light)
  gl_FragColor = vec4(pow(c, vec3(2.2)), a);
}`;

const _p = new THREE.Vector3();

export function Footprints() {
  const fx = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(PRINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const fwd = new THREE.InstancedBufferAttribute(new Float32Array(PRINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const side = new THREE.InstancedBufferAttribute(new Float32Array(PRINTS).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    // (born long ago: none showing until the first is pressed)
    const born = new THREE.InstancedBufferAttribute(new Float32Array(PRINTS).fill(-1e4), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", pos);
    g.setAttribute("iFwd", fwd);
    g.setAttribute("iSide", side);
    g.setAttribute("iBorn", born);
    g.instanceCount = PRINTS;
    const u = { uTime: { value: 0 }, uCover: { value: 0 } };
    // Laid over the snow: a shadowed hollow with a lit lip.
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: u,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return { mesh, u, pos, fwd, side, born, next: 0, last: -1e4 };
  }, []);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 1 / 20);
    fx.u.uTime.value += dt;
    fx.u.uCover.value = weather.cover;
    // Press in the steps taken since the last frame (only where there is snow enough to take them).
    let changed = false;
    for (const s of prints.queue) {
      if (weather.cover < 0.15) continue;
      const i = fx.next;
      fx.next = (fx.next + 1) % PRINTS;
      _p.copy(s.p);
      fx.pos.setXYZ(i, _p.x, _p.y, _p.z);
      fx.fwd.setXYZ(i, s.fwd.x, s.fwd.y, s.fwd.z);
      fx.side.setX(i, s.side);
      fx.born.setX(i, fx.u.uTime.value);
      fx.last = fx.u.uTime.value;
      changed = true;
    }
    prints.queue.length = 0;
    if (changed) fx.pos.needsUpdate = fx.fwd.needsUpdate = fx.side.needsUpdate = fx.born.needsUpdate = true;
    fx.mesh.visible = weather.cover > 0.1 && fx.u.uTime.value - fx.last < LIFE;
  });

  return <primitive object={fx.mesh} />;
}
