import * as THREE from "three";
import { toonRamp, dusted } from "./style";

/**
 * Drawn foliage. A canopy is a few round leafy masses, and each mass is a cloud of leaf clumps
 * painted on small cards that always turn to face the camera (and, for its shadow, the sun), so the
 * tree keeps a ragged, hand-drawn outline from every side instead of showing polygons. Each clump
 * takes its light from the round mass it belongs to, nudged leaf by leaf, so the cel-shade boundary
 * runs along the leaves; the ink pass outlines each mass. Everything that grows sways in one wind.
 */

/** Wind and time, shared by everything that sways. */
export const wind = {
  uTime: { value: 0 },
  // (any fixed direction: on a ball the breeze turns with the ground under it, which reads fine)
  uWind: { value: new THREE.Vector3(0.62, 0.21, 0.76).normalize() },
};

let sheet: THREE.Texture | null = null;
/** The leaf-clump sheet (art/leaves.py): coverage, leaf strokes and light bias, 2 × 2 clumps. */
function leafSheet() {
  if (sheet) return sheet;
  sheet = new THREE.TextureLoader().load("/planet/tex/leaves.png");
  // Data, not colour: no sRGB decoding.
  sheet.colorSpace = THREE.NoColorSpace;
  sheet.anisotropy = 2;
  return sheet;
}

/** A card's centre swayed by the wind, its corner turned to face the viewer, and its sheet cell. */
const CARD_VERTEX = /* glsl */ `
#ifdef LEAF_SHADOW
// The sun's map takes a third of the clumps, half again as big: the same soft shade at a third of
// the cost (a canopy's clumps overlap many deep, from the sun as from the camera).
if (mod(float(gl_InstanceID), 3.) > .5) { gl_Position = vec4(0., 0., 2., 1.); vLeafUv = vec2(0.); return; }
float lfSize = iLeaf.x * 1.45;
#else
float lfSize = iLeaf.x;
#endif
vec3 lfUp = normalize(iCentre);
vec3 lfWind = uWind - lfUp * dot(uWind, lfUp);
// The whole tree leans with the gusts and comes back; each clump flutters on its own.
float lfSway = sin(uTime * 1.3 + iPhase) * .65 + sin(uTime * 2.3 + iPhase * 1.7) * .35;
float lfFlut = sin(uTime * 3.7 + iPhase * 2.9 + iLeaf.y * 9.);
float lfH = iLeaf.w * iLeaf.w;
vec3 lfC = iCentre + lfWind * (lfSway * .08 * lfH) + lfUp * (lfFlut * .012 * iLeaf.w);
float lfA = iLeaf.y + lfFlut * .07 * iLeaf.w;
vec2 lfO = mat2(cos(lfA), sin(lfA), -sin(lfA), cos(lfA)) * position.xy * (lfSize * .5);
// Square to whoever is looking: the camera, or the sun when drawing its shadow map.
vec3 lfRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 lfCamUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 transformed = lfC + lfRight * lfO.x + lfCamUp * lfO.y;
vLeafUv = (position.xy * .5 + .5) * .5 + vec2(mod(iLeaf.z, 2.), 1. - floor(iLeaf.z / 2.)) * .5;
`;

const CARD_DECL = /* glsl */ `
attribute vec3 iCentre;
attribute vec3 iLobe;
attribute vec4 iLeaf;
attribute float iPhase;
uniform float uTime;
uniform vec3 uWind;
varying vec2 vLeafUv;
`;

/** The clump's coverage: cut out at its outline. Far off, the sheet's blurrier mip levels thin the
 *  clumps, so coverage is lifted with distance and far canopies keep their body. */
const CUT = /* glsl */ `
vec3 lf = texture2D(tLeaf, vLeafUv).rgb;
vec2 lfPx = vLeafUv * 512.;
float lfLod = max(0., .5 * log2(max(dot(dFdx(lfPx), dFdx(lfPx)), dot(dFdy(lfPx), dFdy(lfPx)))));
if (lf.r * (1. + .22 * lfLod) < .5) discard;
`;

let leaves: THREE.MeshToonMaterial | null = null;
/** Cel-shaded leaf clumps, coloured per clump (its mass's green, darker underneath). */
export function leafMaterial() {
  if (leaves) return leaves;
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  // (three draws shadow casters' back faces; a card turned to face the sun has none toward it)
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.uniforms.tLeaf = { value: leafSheet() };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${CARD_DECL}`)
      .replace("#include <begin_vertex>", CARD_VERTEX)
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        // A mass's clumps sit at nearly the mass's own depth, so the ink outlines each leafy mass
        // instead of every clump in it.
        mvPosition.z = mix(mvPosition.z, (modelViewMatrix * vec4(iLobe, 1.)).z, .6);
        gl_Position = projectionMatrix * mvPosition;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tLeaf;\nvarying vec2 vLeafUv;\nfloat leafBias = 0.;")
      // (the chunk is expanded here so its light test can take the leaf's lean)
      .replace(
        "#include <gradientmap_pars_fragment>",
        THREE.ShaderChunk.gradientmap_pars_fragment.replace("float dotNL = dot( normal, lightDirection );", "float dotNL = dot( normal, lightDirection ) + leafBias;"),
      )
      .replace(
        "#include <map_fragment>",
        `${CUT}
        // The drawn strokes where one leaf lies over another, and each leaf's own lean into the light.
        diffuseColor.rgb *= mix(.7, 1., lf.g);
        leafBias = (lf.b - .5) * .8;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `// Shade goes a cool blue-green, like the rest of the world's shadow planes.
        float lfLum = dot(outgoingLight, vec3(.299, .587, .114));
        float lfBase = dot(diffuseColor.rgb, vec3(.299, .587, .114));
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(.82, .97, 1.06), smoothstep(.95, .7, lfLum / max(lfBase, .01)));
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "leaf-cards";
  // (a dusting of snow on the leaves when it lies: see style.ts dusted)
  return (leaves = dusted(m, 0.45));
}

let leafDepth: THREE.MeshDepthMaterial | null = null;
/** The clumps' shadow: the same cards, turned to the sun and cut out the same way. */
export function leafDepthMaterial() {
  if (leafDepth) return leafDepth;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.defines = { LEAF_SHADOW: "" };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.uniforms.tLeaf = { value: leafSheet() };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${CARD_DECL}`).replace("#include <begin_vertex>", CARD_VERTEX);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tLeaf;\nvarying vec2 vLeafUv;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT}`);
  };
  m.customProgramCacheKey = () => "leaf-cards-depth";
  return (leafDepth = m);
}

let blades: THREE.MeshToonMaterial | null = null;
/** Grass blades: thin, two-sided, lit like the ground under them, bending at the tips in the wind. */
export function bladeMaterial() {
  if (blades) return blades;
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float sway;\nuniform float uTime;\nuniform vec3 uWind;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vec3 bUp = normalize(position);
      vec3 bW = uWind - bUp * dot(uWind, bUp);
      float bPh = dot(position, vec3(.7, 1.3, .9));
      transformed += bW * ((sin(uTime * 2.1 + bPh) * .6 + sin(uTime * 3.4 + bPh * 1.6) * .4) * .05 * sway * sway);`,
    );
    // Both faces lit as the front: a blade's normal is the ground's, whichever side shows.
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;", "float faceDirection = 1.0;"),
    );
  };
  m.customProgramCacheKey = () => "grass-blades";
  return (blades = dusted(m, 0.6));
}

let blooms: THREE.MeshToonMaterial | null = null;
/**
 * Flower heads: small cards turned to the camera, the flower drawn on them in the shader (petals as
 * lobes round the middle, lines between them, a centre with a ring round it), lit like the ground.
 * Each head takes the same wind as its stem's tip (bladeMaterial), so the two sway as one.
 */
export function flowerMaterial() {
  if (blooms) return blooms;
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 iCentre;\nattribute vec4 iEye;\nattribute vec4 iFlower;\nuniform float uTime;\nuniform vec3 uWind;\nvarying vec2 vQ;\nvarying vec4 vEye;\nvarying vec4 vFl;",
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 bUp = normalize(iCentre);
        vec3 bW = uWind - bUp * dot(uWind, bUp);
        float bPh = dot(iCentre, vec3(.7, 1.3, .9));
        vec3 head = iCentre + bW * ((sin(uTime * 2.1 + bPh) * .6 + sin(uTime * 3.4 + bPh * 1.6) * .4) * .05);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 transformed = head + (camRight * position.x + camUp * position.y) * iFlower.x;
        vQ = position.xy;
        vEye = iEye;
        vFl = iFlower;`,
      );
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vQ;\nvarying vec4 vEye;\nvarying vec4 vFl;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        float r = length(vQ);
        float a = atan(vQ.y, vQ.x) + vFl.w;
        // 1 down the middle of each petal, 0 between two
        float k = abs(cos(a * vFl.y * .5));
        float reach = mix(.42, 1., pow(k, vFl.z));
        if (r > reach * .96) discard;
        float eyeR = vEye.w;
        float eye = smoothstep(eyeR + .025, eyeR - .025, r);
        float gap = smoothstep(.18, .02, k) * smoothstep(eyeR, eyeR + .12, r);
        vec3 col = mix(diffuseColor.rgb, vEye.rgb, eye);
        // drawn lines between the petals and round the centre, light from above
        col *= 1. - .38 * gap;
        col *= 1. - .3 * smoothstep(.07, 0., abs(r - eyeR)) * (1. - eye * .5);
        col *= .88 + .14 * clamp(vQ.y * .5 + .5, 0., 1.);
        diffuseColor.rgb = col;
      }`,
    );
  };
  m.customProgramCacheKey = () => "flower-heads";
  return (blooms = m);
}
