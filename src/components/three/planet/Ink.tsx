"use client";

import { forwardRef, useEffect, useMemo } from "react";
import { BlendFunction, Effect, EffectAttribute, FXAAEffect } from "postprocessing";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { daylight } from "@/lib/daylight";
import { weather } from "@/lib/weather";

/**
 * Hand-inked look: dark outlines wherever depth jumps (silhouettes) or the surface turns sharply
 * (creases, read from the normal pass), plus a soft pastel grade, like the line-and-wash style of
 * an illustrated game.
 */
const FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uThick;
uniform float uStrength;
// Time of day (lib/daylight.ts).
uniform float uNight;
uniform float uDusk;
uniform float uRain;
uniform float uSnow;
uniform float uFlash;

float viewDist(vec2 uv){ return -getViewZ(readDepth(uv)); }

float ih(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float in2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(ih(i), ih(i+vec2(1,0)), f.x), mix(ih(i+vec2(0,1)), ih(i+vec2(1,1)), f.x), f.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv0, const in float depth0, out vec4 outputColor){
  // Line hierarchy: bold silhouettes, thin interior creases. Lines swell and thin a little along
  // their length (a stable pattern, no wobble), like a brush pen.
  vec2 px = uv0 * resolution;
  vec2 uv = uv0;
  float depth = depth0;
  float weight = .85 + .3 * in2(px / 53. + 5.);
  // Heavier lines up close, finer ones in the distance.
  float dz = -getViewZ(depth);
  vec2 o = texelSize * uThick * weight * mix(1.35, .65, smoothstep(4., 35., dz));
  float d = dz;
  float dl = viewDist(uv - vec2(o.x, 0.)), dr = viewDist(uv + vec2(o.x, 0.));
  float du = viewDist(uv + vec2(0., o.y)), dd = viewDist(uv - vec2(0., o.y));
  // Silhouettes: this pixel lies behind an edge (the second difference of distance is strongly
  // negative), relative to distance so far lines stay thin. Smooth ground at grazing angles changes
  // distance quickly but steadily, so it does not ink.
  float lap = max(2. * d - dl - dr, 2. * d - du - dd);
  float sil = smoothstep(.03, .08, lap / max(d, 1.));
  // Creases, from the same four samples (no second scene render, no more reads): inverse depth is
  // linear across any flat surface, so its second difference is zero on walls and roads and jumps at
  // corners.
  float id = 1. / max(d, .01);
  float il = 1. / max(dl, .01), ir = 1. / max(dr, .01), iu = 1. / max(du, .01), idn = 1. / max(dd, .01);
  float bend = max(abs(2. * id - il - ir), abs(2. * id - iu - idn)) / id;
  float cr = smoothstep(.012, .04, bend) * (1. - smoothstep(10., 24., d));
  // Interior lines give way where a silhouette already draws the edge, so lines never double.
  float ink = clamp(max(sil, cr * .75 * (1. - sil)), 0., 1.) * uStrength;

  // A bright, richer grade, like an illustration printed on white: colours a little fuller.
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, 1.12) * 1.02;
  // Far away, colours converge on the haze and lines lighten, like an artist's background.
  float far = smoothstep(14., 60., d) * step(d, 120.);
  vec3 haze = mix(mix(vec3(.67, .8, .77), vec3(.95, .82, .78), uDusk), vec3(.3, .42, .55), uNight);
  c = mix(c, haze, far * .45);
  ink *= 1. - .5 * far;
  vec3 col = mix(c, uInk, ink);
  // Sunset warms everything on the ground, night turns it to moonlit blues (the sky, at the far plane,
  // has its own colours). Lamps and lit windows, warm and bright, keep their light at night.
  if (depth0 < .999995) {
    // Under a shower's cloud: greyer, flatter and a little darker, the colours washed out.
    float lr = dot(col, vec3(.299, .587, .114));
    col = mix(col, vec3(lr) * vec3(.94, .98, 1.02), .28 * uRain) * (1. - .1 * uRain);
    // (snow: brighter and cooler, the light thrown back off the white ground)
    col = mix(col, col * vec3(.97, 1., 1.05) + .05, uSnow) * (1. + .14 * uSnow);
    vec3 g = mix(mix(vec3(1.), vec3(1.05, .86, .74), uDusk * (1. - uRain)), vec3(.3, .38, .6), uNight);
    float glow = smoothstep(.28, .45, c.r - c.b) * smoothstep(.8, .95, c.r) * (1. - ink);
    col *= mix(g, vec3(1.), glow * uNight);
  }
  // Lightning: everything lit up cold and white for an instant.
  col = mix(col, col * 1.6 + vec3(.22, .25, .32), uFlash * .6);
  outputColor = vec4(col, inputColor.a);
}
`;

class InkEffect extends Effect {
  constructor() {
    super("InkEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      // Flagged as a convolution (it reads around each pixel, if only depth), so the anti-aliasing
      // after it is drawn in a pass of its own (see InkFXAA).
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["uInk", new THREE.Uniform(new THREE.Color("#26372f"))],
        ["uThick", new THREE.Uniform(1)],
        ["uStrength", new THREE.Uniform(1)],
        ["uNight", new THREE.Uniform(0)],
        ["uDusk", new THREE.Uniform(0)],
        ["uRain", new THREE.Uniform(0)],
        ["uSnow", new THREE.Uniform(0)],
        ["uFlash", new THREE.Uniform(0)],
      ]),
    });
  }
}

/** Reads only the depth buffer, so the scene renders once. thickness is in rendered pixels. */
export const Ink = forwardRef<InkEffect, { thickness?: number }>(function Ink({ thickness = 1 }, ref) {
  const effect = useMemo(() => new InkEffect(), []);
  useEffect(() => {
    effect.uniforms.get("uThick")!.value = thickness;
  }, [effect, thickness]);
  useEffect(() => () => effect.dispose(), [effect]);
  useFrame(() => {
    effect.uniforms.get("uNight")!.value = daylight.night;
    effect.uniforms.get("uDusk")!.value = daylight.dusk;
    effect.uniforms.get("uRain")!.value = weather.cloud;
    effect.uniforms.get("uSnow")!.value = weather.snow;
    effect.uniforms.get("uFlash")!.value = weather.flash;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

/**
 * FXAA in a pass of its own, after the ink. It rebuilds each pixel from the picture around it, so
 * merged into the ink's pass it painted the unlined picture over the lines; postprocessing doesn't
 * flag it as reading its neighbours, so it is flagged here and the composer keeps the two apart.
 */
export function InkFXAA() {
  const effect = useMemo(() => {
    const e = new FXAAEffect();
    (e as unknown as { setAttributes(a: number): void }).setAttributes(EffectAttribute.CONVOLUTION);
    return e;
  }, []);
  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
}
