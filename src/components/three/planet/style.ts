import * as THREE from "three";
import { noiseGLSL, noiseTexture } from "./noise3";

/**
 * The look of the world: flat pastel colours with two bands of light (lit and shade), ink outlines
 * from the Ink effect, crisp cast shadows. Everything static is one vertex-coloured material.
 */
export const C = {
  grass: "#90bd84",
  grassDark: "#79aa74",
  dirt: "#cdb48c",
  asphalt: "#808b8d",
  line: "#f1efe6",
  curb: "#e2ddcf",
  water: "#6fbcc0",
  bank: "#cfc79a",
  // (the first few, plain concrete, also make the trims; the rest are pastel paint: peach, butter,
  // mint, sky, lilac, rose)
  concrete: ["#dcdfd5", "#d3d9d0", "#cdd6cf", "#dfdccf", "#c9d3cf", "#f2d5bd", "#f1e2ad", "#cbe6d1", "#cadff0", "#e2d3ec", "#f3cdc8"],
  window: "#477c84",
  windowLit: "#9fd0cf",
  frame: "#f6f3ea",
  door: "#5b6b72",
  roof: ["#b8715a", "#4c979b", "#5b7fb0", "#c79a55", "#b2554c", "#6d9d60"],
  awning: ["#e07a63", "#3fa292", "#e8bd4f", "#6a8fd0", "#d97aa2"],
  sign: ["#e2b84f", "#5a8fc0", "#d0604f", "#f2efe4", "#3fa08f", "#d97aa2"],
  metal: "#8d989e",
  metalDark: "#5d686e",
  yellow: "#e2bd4f",
  black: "#2c3336",
  red: "#a8665d",
  mint: "#9fcfc4",
  wood: "#a7774f",
  woodDark: "#7d573a",
  trunk: "#8a6a4f",
  bark: "#8b8172",
  blade: ["#5d8a59", "#a6c77a"],
  fern: ["#3f6f4f", "#76a66a"],
  stem: ["#4d7a4b", "#78a462"],
  // (greens, and now and then a tree in blossom or turned gold)
  leaf: ["#5e9a6c", "#4f8a62", "#74a97a", "#679f70", "#7fb35a", "#e9a4bd", "#e1b24e"],
  pine: ["#4a7d66", "#52805f", "#40705c"],
  rock: "#b8b6aa",
  // buttercup, poppy, daisy, bellflower, marigold, cosmos, cornflower, campion
  flower: ["#e2bd4f", "#d77a6a", "#f4f2ea", "#b993c4", "#ef9440", "#f1a9bd", "#6d8fdb", "#d4589a"],
  skin: "#f1c9a5",
  hair: ["#3b2f2f", "#5a3d2b", "#1f2326", "#8a5a3b"],
} as const;

let ramp: THREE.DataTexture | null = null;
/** Two bands, like cel paint: shade and lit. */
export function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([60, 60, 60, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * Painted grain: soft blotches and a fine paper tooth in world space, so flat colours read as
 * gouache on paper instead of plastic. Shade gets a cool teal cast.
 */
// ---------- hand-painted textures (public/planet/tex, generated for this site) ----------
const TEX = { wallA: "/planet/tex/wall-a.jpg", wallB: "/planet/tex/wall-b.jpg", asphalt: "/planet/tex/asphalt.jpg", paving: "/planet/tex/paving.jpg" };
/** Mean linear luminance of each texture, so it adds paint grain without shifting colours. */
const TEX_MEAN: Record<keyof typeof TEX, number> = { wallA: 0.526, wallB: 0.776, asphalt: 0.17, paving: 0.526 };
const texCache = new Map<string, THREE.Texture>();
function tex(name: keyof typeof TEX) {
  let t = texCache.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(TEX[name]);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    // Soft painted detail: light filtering is plenty, and it's sampled on nearly every pixel.
    t.anisotropy = 2;
    texCache.set(name, t);
  }
  return t;
}

type Detail = { a: keyof typeof TEX; b?: keyof typeof TEX; scale: number; strength: number };

/**
 * Paints a material: world-space mottling, touched-up patches, rain streaks, cool hatched shade,
 * and optionally hand-painted textures projected from three sides (no UVs needed), used as
 * relative detail so each object keeps its own colour.
 */
function painted(m: THREE.MeshToonMaterial, detail?: Detail) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tNoise3 = { value: noiseTexture() };
    sh.uniforms.uCover = coverUniform;
    if (detail) {
      sh.uniforms.tDetailA = { value: tex(detail.a) };
      sh.uniforms.tDetailB = { value: tex(detail.b ?? detail.a) };
      sh.uniforms.uDetail = { value: new THREE.Vector4(detail.scale, detail.strength, TEX_MEAN[detail.a], TEX_MEAN[detail.b ?? detail.a]) };
    }
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPaint;\nvarying vec3 vWN;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvPaint = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vPaint;
        varying vec3 vWN;
        ${detail ? "#define PAINT_DETAIL\nuniform sampler2D tDetailA; uniform sampler2D tDetailB; uniform vec4 uDetail;" : ""}
        uniform float uCover;
        const vec3 SNOW = vec3(.9, .93, .96);
        // Value noise from the shared noise texture: one read each (see noise3.ts).
        ${noiseGLSL("pn")}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float blot = pn(vPaint * .45) * .6 + pn(vPaint * 1.7) * .4;
        // Low-frequency mottling only: no speckle.
        diffuseColor.rgb *= .97 + .045 * blot;
        // Painted wear, in world space so it never swims. "Up" is away from the planet's centre.
        float alt = length(vPaint);
        vec3 flatP = vPaint / alt * 30.;
        // Touched-up paint: flat patches a shade lighter or darker, hard-edged like gouache.
        float patchN = pn(flatP * .55 + vec3(0., alt * .5, 0.));
        diffuseColor.rgb *= 1. + .025 * (step(.7, patchN) - step(patchN, .24));
        // Rain stains: long vertical streaks, stronger toward the top of each run.
        float streak = pn(vec3(flatP.x * 3.1, alt * .35, flatP.z * 3.1)) * pn(vec3(flatP.x * 7., alt * 1.3, flatP.z * 7.));
        diffuseColor.rgb *= 1. - .04 * smoothstep(.34, .5, streak);
        #ifdef PAINT_DETAIL
        {
          // Hand-painted texture (brushwork, hairline cracks, stains) projected along the surface's
          // main axis: one lookup per texture instead of three. Two textures, swapped in broad
          // patches so walls don't all repeat the same tile.
          vec3 an = abs(vWN);
          vec2 tp = (an.x > an.y && an.x > an.z ? vPaint.zy : an.y > an.z ? vPaint.xz : vPaint.xy) * uDetail.x;
          vec3 lw = vec3(.2126, .7152, .0722);
          vec3 da = texture2D(tDetailA, tp).rgb / uDetail.z;
          vec3 db = texture2D(tDetailB, tp + .37).rgb / uDetail.w;
          vec3 d = mix(da, db, smoothstep(.42, .58, pn(vPaint * .13)));
          // Mostly its light and dark, a little of its colour, so each surface keeps its own hue.
          d = mix(vec3(dot(d, lw)), d, .3);
          diffuseColor.rgb *= mix(vec3(1.), d, uDetail.y);
        }
        #endif
        // Snow lying (lib/weather.ts): on whatever faces up, roofs, the road, the grass, settling in
        // patches first and filling in as it keeps falling; never on the walls.
        if (uCover > .001) {
          float faceUp = dot(normalize(vWN), vPaint / alt);
          float lie = uCover * 1.25 - (1. - faceUp) * 1.6 - .35 * pn(vPaint * 1.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, SNOW, smoothstep(0., .12, lie));
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `// Cool, slightly teal shade where the light is low.
        float lum = dot(outgoingLight, vec3(.299, .587, .114));
        float base = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        float shade = smoothstep(.95, .7, lum / max(base, .01));
        // Shadow planes go a cool grey-teal.
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(.84, .98, 1.05), shade);
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `painted:${detail ? `${detail.a}/${detail.b ?? ""}/${detail.scale}/${detail.strength}` : "-"}`;
  return m;
}

let world: THREE.MeshToonMaterial | null = null;
/** The one material for every static prop: colours come from the vertices, plaster from the paint. */
export function worldMaterial() {
  return (world ??= painted(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }), { a: "wallA", b: "wallB", scale: 0.28, strength: 0.55 }));
}
let ground: THREE.MeshToonMaterial | null = null;
/** Grass and hills: vertex colours and painted mottling, no plaster. */
export function groundMaterial() {
  return (ground ??= painted(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() })));
}
/** A flat colour with a hand-painted surface (road, pavement). */
export function paintedSolid(color: THREE.ColorRepresentation, d: Detail) {
  return painted(new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() }), d);
}

const solids = new Map<string, THREE.MeshToonMaterial>();
/** A flat toon colour (cached). */
export function solid(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshToonMaterialParameters> = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${JSON.stringify(opts)}`;
  let m = solids.get(key);
  if (!m) solids.set(key, (m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...opts })));
  return m;
}

let panes: THREE.MeshToonMaterial | null = null;
/** The painted window sheet (generated for this site, see art/windows-atlas-codex.png). */
export function paneMaterial() {
  if (panes) return panes;
  const t = new THREE.TextureLoader().load("/planet/tex/windows.webp");
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  panes = new THREE.MeshToonMaterial({ map: t, gradientMap: toonRamp(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // At night about half the windows are lit, warm (picked by where they are, a few metres at a time,
  // so a window lights as a whole and the pattern stays put).
  panes.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nuniform float uNight;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        if (uNight > .01) {
          float lit = step(.5, fract(sin(dot(floor(vWp / 2.6), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
          vec3 warm = vec3(1., .78, .42) * (.8 + .4 * dot(diffuseColor.rgb, vec3(.299, .587, .114)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, warm, uNight * lit * .9);
        }`,
      );
  };
  panes.customProgramCacheKey = () => "panes-night";
  return panes;
}

/** How dark it is (lib/daylight.ts), for the materials that change at night; set by the Sky. */
export const nightUniform = { value: 0 };
/** How wet the ground is (lib/weather.ts); set by the Puddles. */
export const wetUniform = { value: 0 };
/** How much snow lies (lib/weather.ts); set by the Snow. */
export const coverUniform = { value: 0 };

/**
 * A material that whitens evenly as snow lies (the dirt path; a dusting on leaves and grass), by up to
 * `k` of the way to white.
 */
export function dusted<M extends THREE.Material>(m: M, k: number) {
  const before = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    before(sh, r);
    sh.uniforms.uCover = coverUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uCover;")
      .replace("#include <color_fragment>", `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .93, .96), ${k.toFixed(2)} * uCover);`);
  };
  m.customProgramCacheKey = () => key() + `-dust${k}`;
  return m;
}

/**
 * A ground surface that darkens as it gets wet in a shower (as asphalt, paving and earth do), and
 * lightens again as it dries. `dark`: how much darker when soaked.
 */
export function wettable<M extends THREE.Material>(m: M, dark: number) {
  const before = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    before(sh, r);
    sh.uniforms.uWet = wetUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uWet;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\ngl_FragColor.rgb *= 1. - ${dark.toFixed(2)} * uWet;`);
  };
  m.customProgramCacheKey = () => key() + `-wet${dark}`;
  return m;
}

let signs: THREE.MeshToonMaterial | null = null;
/** The painted shop-sign sheet (generated for this site, see art/signs-atlas-codex.png). */
export function signMaterial() {
  if (signs) return signs;
  const t = new THREE.TextureLoader().load("/planet/tex/signs.webp");
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  signs = new THREE.MeshToonMaterial({ map: t, gradientMap: toonRamp(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return signs;
}

let decals: THREE.MeshToonMaterial | null = null;
/** The painted decal sheet (stains, cracks, posters, puddles), drawn over walls and road. */
export function decalMaterial() {
  if (decals) return decals;
  const t = new THREE.TextureLoader().load("/planet/tex/decals.webp");
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  decals = new THREE.MeshToonMaterial({
    map: t,
    gradientMap: toonRamp(),
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return decals;
}

let stones: THREE.MeshToonMaterial | null = null;
/**
 * Dressed stone, drawn: each block a slightly different shade, the joints between them thin dark
 * lines of an even width on screen (fading out once the blocks get too small to draw). The walls
 * are laid in courses with the joints staggered, a ring of wedge stones runs round the arch, the
 * vault is laid in courses across, and the deck in slabs with kerb stones along both edges.
 * `arch`: the opening's half-span and height, and the wedge ring's outer half-span and height.
 */
export function stoneMaterial(arch: [number, number, number, number], halfWidth: number) {
  if (stones) return stones;
  const m = new THREE.MeshToonMaterial({ color: "#bdb7a6", gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uArch = { value: new THREE.Vector4(...arch) };
    sh.uniforms.uHalfW = { value: halfWidth };
    sh.uniforms.uCover = coverUniform;
    sh.uniforms.uWet = wetUniform;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 stone;\nvarying vec3 vStone;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStone = stone;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vStone;
        uniform vec4 uArch;
        uniform float uHalfW;
        uniform float uCover;
        uniform float uWet;
        // A joint where t crosses a whole number: a line about a pixel and a half wide wherever it is,
        // gone once the blocks are only a few pixels across.
        float sj(float t){ float w = fwidth(t); float d = abs(fract(t + .5) - .5); return (1. - smoothstep(.6 * w, 1.7 * w, d)) * (1. - smoothstep(.12, .3, w)); }
        float sh1(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 p = vStone.xy;
          float face = vStone.z;
          float line = 0.;
          vec2 cell = vec2(0.);
          float tone = 1.;
          if (face < .5) {
            // walls: the wedge stones round the arch, coursed blocks everywhere else
            vec2 e = vec2(p.x / uArch.z, p.y / uArch.w);
            float outer = length(e);
            float inner = length(vec2(p.x / uArch.x, p.y / uArch.y));
            if (inner > .995 && outer < 1.) {
              float k = atan(e.y, e.x) / 3.14159 * 13.;
              line = sj(k);
              cell = vec2(floor(k), 17.);
              tone = .95;
            } else {
              float row = p.y / .2;
              float ri = floor(row);
              float col = p.x / .46 + .5 * mod(ri, 2.) + .13 * sh1(vec2(ri, 3.));
              line = max(sj(row), sj(col));
              cell = vec2(floor(col), ri);
            }
            float w = fwidth(outer);
            line = max(line, (1. - smoothstep(.6 * w, 1.7 * w, abs(outer - 1.))) * step(0., p.y) * step(abs(p.x), uArch.z));
          } else if (face < 1.5) {
            // the vault, in courses across and stones staggered along them
            float row = p.x / .3;
            float ri = floor(row);
            float col = p.y / .5 + .5 * mod(ri, 2.);
            line = max(sj(row), sj(col));
            cell = vec2(floor(col), ri + 40.);
            tone = .82;
          } else {
            // the deck: slabs laid across, a kerb of longer stones along each edge
            float kerb = step(uHalfW - .17, abs(p.y));
            float k = p.x / mix(.52, .74, kerb) + kerb * .37;
            line = max(sj(k), sj(abs(p.y) / (uHalfW - .17)) * step(.5, abs(p.y)));
            cell = vec2(floor(k), kerb + 80.);
            tone = mix(1.04, .97, kerb);
          }
          diffuseColor.rgb *= tone * (.9 + .17 * sh1(cell));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.27, .29, .27), line * .78);
          // Darker for the rain, as stone is; and snow lies on the deck as on the path either side
          // (the joints just showing through), so the courier's prints on it are pressed into snow.
          diffuseColor.rgb *= 1. - .24 * uWet;
          if (face > 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .93, .96), uCover * (.97 - .3 * line));
        }`,
      );
  };
  m.customProgramCacheKey = () => "dressed-stone";
  return (stones = m);
}

/**
 * The drawn street props (art/pack-props.py: potted plants, bins, the post box): painted cut-outs
 * standing on the ground, each turned about its own up to face whoever looks (the camera; the sun,
 * for its shadow), lit like the world round them (so they sit in the shade of a wall, and dim at
 * night). In the pass that finds creases for the ink they draw as one flat face, so the ink traces
 * their outline.
 */
const PROP_DECL = /* glsl */ `
attribute vec3 iFoot; attribute vec3 iUp; attribute vec2 iSize; attribute vec4 iUv;
uniform float uNormalMode;`;
const PROP_VERTEX = /* glsl */ `
vec3 pUp = normalize(iUp);
vec3 pTo = cameraPosition - iFoot;
pTo -= pUp * dot(pTo, pUp);
pTo = length(pTo) > 1e-4 ? normalize(pTo) : vec3(0., 0., 1.);
vec3 pSide = normalize(cross(pUp, pTo));
vec3 pPos = iFoot + pSide * position.x * .5 * iSize.x + pUp * (position.y * .5 + .5) * iSize.y;
`;
let propTex: THREE.Texture | null = null;
function propSheet() {
  if (propTex) return propTex;
  propTex = new THREE.TextureLoader().load("/planet/tex/props.webp");
  propTex.colorSpace = THREE.SRGBColorSpace;
  propTex.anisotropy = 4;
  return propTex;
}
let props: THREE.MeshToonMaterial | null = null;
export function propMaterial() {
  if (props) return props;
  const m = new THREE.MeshToonMaterial({ map: propSheet(), gradientMap: toonRamp(), alphaTest: 0.5, side: THREE.DoubleSide });
  m.allowOverride = false;
  const uNormalMode = { value: 0 };
  m.onBeforeRender = (_r, scene) => void (uNormalMode.value = scene.overrideMaterial ? 1 : 0);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNormalMode = uNormalMode;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${PROP_DECL}`)
      // (lit as if it faced half toward the viewer and half up: a soft, even light over the drawing)
      .replace("#include <beginnormal_vertex>", `${PROP_VERTEX}\nvec3 objectNormal = normalize(pTo * .6 + pUp * .8);`)
      .replace("#include <begin_vertex>", "vec3 transformed = pPos;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = mix(iUv.xy, iUv.zw, uv);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNormalMode;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\nif (uNormalMode > .5) gl_FragColor = vec4(.5, .5, 1., 1.);");
  };
  m.customProgramCacheKey = () => "drawn-props";
  return (props = m);
}
let propDepth: THREE.MeshDepthMaterial | null = null;
/** The drawn props' shadow: the same cut-out, turned to the sun. */
export function propDepthMaterial() {
  if (propDepth) return propDepth;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: propSheet(), alphaTest: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${PROP_DECL}`)
      .replace("#include <begin_vertex>", `${PROP_VERTEX}\nvec3 transformed = pPos;`)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = mix(iUv.xy, iUv.zw, uv);");
  };
  m.customProgramCacheKey = () => "drawn-props-depth";
  return (propDepth = m);
}

let vending: THREE.MeshToonMaterial | null = null;
/** The painted vending machine panels (art/props-vending-codex.png): two fronts and a side. */
export function vendingMaterial() {
  if (vending) return vending;
  const t = new THREE.TextureLoader().load("/planet/tex/vending.webp");
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  vending = new THREE.MeshToonMaterial({ map: t, gradientMap: toonRamp(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // (its display glows a little at night)
  vending.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb * 1.1, uNight * .6);");
  };
  vending.customProgramCacheKey = () => "vending-night";
  return vending;
}

let roadSigns: THREE.MeshToonMaterial | null = null;
/** The painted road sign faces (art/props-signs-codex.png), cut out at their edges. */
export function roadSignMaterial() {
  if (roadSigns) return roadSigns;
  const t = new THREE.TextureLoader().load("/planet/tex/roadsigns.webp");
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  roadSigns = new THREE.MeshToonMaterial({ map: t, gradientMap: toonRamp(), alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return roadSigns;
}

let propContact: THREE.ShaderMaterial | null = null;
/** A soft patch of shade on the ground under each drawn prop, so it stands on the pavement. */
export function propContactMaterial() {
  if (propContact) return propContact;
  return (propContact = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 iFoot; attribute vec3 iUp; attribute vec2 iSize;
      varying vec2 vQ;
      void main(){
        vec3 up = normalize(iUp);
        vec3 a = normalize(cross(up, abs(up.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
        vec3 b = cross(up, a);
        vec3 p = iFoot + (a * position.x + b * position.y) * iSize.x * .55 + up * .012;
        vQ = position.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vQ;
      void main(){
        float r = length(vQ);
        float a = .26 * (1. - smoothstep(.3, 1., r));
        if (a < .005) discard;
        // (the cool grey-green of the town's shade, in linear light)
        gl_FragColor = vec4(.018, .03, .03, a);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}
