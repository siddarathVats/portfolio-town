import * as THREE from "three";

/**
 * Value noise read from a texture. A 64³ grid of random values, sampled by the hardware's trilinear
 * filter at a smoothstepped position, is the same smooth value noise as hashing a cell's eight
 * corners and blending them in the shader, for one texture read instead of eight hashes. (The paint
 * grain on every wall, road and field, and the clouds, use it on nearly every pixel.) It repeats
 * every 64 cells, far wider than any pattern drawn with it.
 */
const N = 64;

let tex: THREE.Data3DTexture | null = null;
export function noiseTexture() {
  if (tex) return tex;
  const data = new Uint8Array(N * N * N);
  // A small seeded generator (mulberry32), so the pattern is the same on every visit.
  let s = 0x2f6b9e3d;
  for (let i = 0; i < data.length; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    // (0..254: the noise stays under 1, as hashed noise does)
    data[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 255;
  }
  tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL: `name(p)`, smooth value noise in [0, 1), from the texture bound to `tNoise3`. */
export const noiseGLSL = (name: string) => /* glsl */ `
#ifndef NOISE3_SAMPLER
#define NOISE3_SAMPLER
uniform highp sampler3D tNoise3;
#endif
float ${name}(vec3 p){
  vec3 i = floor(p), f = fract(p);
  return texture(tNoise3, (i + f * f * (3. - 2. * f) + .5) * ${(1 / N).toFixed(8)}).r;
}`;
