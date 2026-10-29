import * as THREE from "three";
import { WALK_SPEED } from "@/lib/journey";
import { PLANET_RADIUS } from "@/lib/world";
import { LEFT_DOWN, PLANT, RIGHT_DOWN, STANCE, advanceStride, footBack, frameAt, isDown, strideAt } from "./gait";
import { CLIPS } from "./clips";
import type { Umbrella } from "./umbrella";

/**
 * Drawn characters. The courier and the townspeople are hand-drawn anime-style sprites (original
 * art generated for this site, see /art), shown on cards that always turn to face the camera, like
 * the cut-out figures of an illustrated game. The courier's run is a 32-frame cycle stepped by
 * distance travelled, so the feet keep pace with the ground.
 */

const RUN_URL = "/planet/tex/courier-run.webp";
/** The same jog holding an umbrella up in the raised left fist (art/umbrella-run.py): same legs. */
const UMBRELLA_RUN_URL = "/planet/tex/courier-run-umbrella.webp";
/** Which pixels of each run frame are the left leg (red) and the right leg (green): art/legmask32.py. */
const LEGS_URL = "/planet/tex/courier-legs.png";
const FOLK_URL = "/planet/tex/townsfolk.webp";
/** The townsfolk atlas: four people standing, then the schoolgirl again holding the bouquet, and
 *  happily surprised (art/pack-gift.py); then her three drawings again holding her umbrella
 *  (art/pack-girl-umbrella.py); then the moments between her moods, dry and with the umbrella
 *  (art/girl-moves.py). */
const FOLK_CELLS = 15;
/** ...in two rows: the second, the townspeople at the stops (content/townsfolk.ts), cells 15 on; the
 *  rows 320 px tall with a clear 64 px between them (2880 x 704), so far away, where the sheet is
 *  sampled coarsely, the first row's feet don't smudge onto the tops of the second's cards. */
const FOLK_ROWS = 2;
const FOLK_ROW_V = 320 / 704;
const FOLK_GAP_V = 64 / 704;
/** The bouquet on its own (art/pack-gift.py). (The courier's actions are clips: see clipPose.) */
const BOUQUET_URL = "/planet/tex/bouquet.webp";
/** Atlas cells are 192 × 320 px; figures fill 312 px of the height, feet on the cell's bottom. */
const CELL_ASPECT = 192 / 320;

type Sheet = { tex: THREE.Texture; loaded: boolean; waiting: THREE.Texture[]; fetch: () => void };
const textures = new Map<string, Sheet>();
/**
 * The drawings only the rain needs (the umbrellas, and the courier's jog and actions holding one):
 * some 3 MB, near half of all the art, so a visitor's phone doesn't wait on them to see the town.
 * They are sent for by loadRainArt (see Runner: as a shower comes on), and nothing shows them until
 * they are all in (rainArtReady).
 */
const RAIN_ONLY = /umbrella|-rain\./;
let rainWanted = false;
export function loadRainArt() {
  if (rainWanted) return;
  rainWanted = true;
  textures.forEach((e, url) => RAIN_ONLY.test(url) && e.fetch());
}
export const rainArtReady = () => rainWanted && [...textures].every(([url, e]) => e.loaded || !RAIN_ONLY.test(url));
/**
 * A copy of a sheet's texture, for one card (each shows its own cell). The copies share the image; a
 * copy asks to be uploaded once that has arrived (asking before, three warns it has no image yet).
 */
function sheet(url: string) {
  let e = textures.get(url);
  if (!e) {
    const entry: Sheet = { tex: new THREE.Texture(), loaded: false, waiting: [], fetch: () => {} };
    let sent = false;
    // (as TextureLoader does it, into a texture made ahead, so a rain drawing can be sent for later)
    entry.fetch = () => {
      if (sent) return;
      sent = true;
      new THREE.ImageLoader().load(url, (image) => {
        entry.tex.image = image;
        entry.tex.needsUpdate = true;
        entry.loaded = true;
        entry.waiting.forEach((t) => (t.needsUpdate = true));
        entry.waiting.length = 0;
      });
    };
    if (!RAIN_ONLY.test(url) || rainWanted) entry.fetch();
    entry.tex.colorSpace = THREE.SRGBColorSpace;
    entry.tex.anisotropy = 4;
    textures.set(url, (e = entry));
  }
  // (clone() marks the copy for upload: undone until there is an image to upload)
  const copy = e.tex.clone();
  if (!e.loaded) {
    copy.version = 0;
    e.waiting.push(copy);
  }
  return copy;
}

let legMask: THREE.Texture | null = null;
function legsTexture() {
  if (!legMask) {
    legMask = new THREE.TextureLoader().load(LEGS_URL);
    legMask.colorSpace = THREE.NoColorSpace;
    // Each texel is one leg or the other: no blending between them.
    legMask.magFilter = THREE.NearestFilter;
    legMask.minFilter = THREE.NearestFilter;
    legMask.generateMipmaps = false;
  }
  return legMask;
}

/** How soaked the drawn people are (lib/weather.ts); set by the Puddles. */
export const soakUniform = { value: 0 };
/** How wet the courier's legs are from the road's splashes (lib/weather.ts splash). */
export const splashUniform = { value: 0 };

/**
 * The bouquet, a different one each time he picks it: its flowers as drawn are pink cosmos, small
 * yellow blooms and lavender among white daisies, in kraft paper. Each bunch recolours those three
 * (hue turned, saturation and lightness scaled), wherever the bouquet is drawn: in his hand as he
 * picks and holds it out, flying to her, and in hers. The daisies, the stems and the paper stay.
 * Each palette: [pink, yellow, lavender] as [hue turn (degrees), saturation x, lightness x].
 */
const BOUQUETS: [number, number, number][][] = [
  // the meadow, as drawn
  [[0, 1, 1], [0, 1, 1], [0, 1, 1]],
  // sunset: coral, marigold, magenta
  [[32, 1.25, 0.97], [-20, 1.1, 1], [47, 1.1, 1]],
  // bluebells: periwinkle and deep blue, the yellow kept
  [[-115, 1.15, 0.94], [0, 1, 1], [-33, 1.25, 0.95]],
  // red roses, with cream and lilac
  [[17, 1.9, 0.8], [0, 0.35, 1.06], [32, 0.9, 1.05]],
  // sunny: peach and gold, violet
  [[45, 1.4, 1], [-6, 1.15, 1], [12, 1.1, 0.95]],
  // lilac and lemon, with white sprigs
  [[-55, 1.05, 1], [8, 1.05, 1.03], [0, 0.3, 1.2]],
];
/** The bouquet's colours this time (shared by every drawing of it): per flower, hue turn (turns),
 *  saturation and lightness scales. */
export const bouquetUniforms = {
  uBqHue: { value: new THREE.Vector3() },
  uBqSat: { value: new THREE.Vector3(1, 1, 1) },
  uBqVal: { value: new THREE.Vector3(1, 1, 1) },
};
let bouquetNow = 0;
/** A new bouquet: one of the palettes, never the same as the last. */
export function pickBouquet(i = (bouquetNow + 1 + Math.floor(Math.random() * (BOUQUETS.length - 1))) % BOUQUETS.length) {
  bouquetNow = i;
  const b = BOUQUETS[i];
  bouquetUniforms.uBqHue.value.set(b[0][0] / 360, b[1][0] / 360, b[2][0] / 360);
  bouquetUniforms.uBqSat.value.set(b[0][1], b[1][1], b[2][1]);
  bouquetUniforms.uBqVal.value.set(b[0][2], b[1][2], b[2][2]);
  return i;
}
pickBouquet(Math.floor(Math.random() * BOUQUETS.length));
// ?debug: tests pick a bouquet to look at.
if (typeof window !== "undefined" && location.search.includes("debug")) (window as unknown as { __bouquet: typeof pickBouquet }).__bouquet = pickBouquet;
/** The flowers' colours as drawn are told apart by hue (and the pink by being pale, so the girl's red
 *  bow beside them stays red), then turned to this bouquet's. Within uBqAt (card metres: centre, and
 *  radius; 0 for none, anything over 9 the whole card). */
const BOUQUET_FRAG = /* glsl */ `
if (uBqAt.z > 0.) {
  float inside = uBqAt.z > 9. ? 1. : 1. - smoothstep(uBqAt.z * .8, uBqAt.z, distance(vBqLocal, uBqAt.xy));
  if (inside > 0.) {
    vec3 c = pow(max(diffuseColor.rgb, vec3(0.)), vec3(1. / 2.2));
    vec4 K = vec4(0., -1. / 3., 2. / 3., -1.);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    vec3 hsv = vec3(abs(q.z + (q.w - q.y) / (6. * d + 1e-10)), d / (q.x + 1e-10), q.x);
    #define HUE_GAP(h0) abs(fract(hsv.x - (h0) + .5) - .5)
    float pink = (1. - smoothstep(.055, .08, HUE_GAP(.96))) * smoothstep(.1, .16, hsv.y) * (1. - smoothstep(.62, .75, hsv.y)) * smoothstep(.62, .72, hsv.z);
    float yel = (1. - smoothstep(.035, .06, HUE_GAP(.146))) * smoothstep(.42, .52, hsv.y) * smoothstep(.55, .65, hsv.z);
    float lav = (1. - smoothstep(.06, .09, HUE_GAP(.745))) * smoothstep(.16, .24, hsv.y) * smoothstep(.4, .5, hsv.z);
    vec3 w = vec3(pink, yel, lav) * inside;
    float sum = w.x + w.y + w.z;
    if (sum > .001) {
      w /= max(sum, 1.);
      vec3 n = hsv;
      n.x = fract(hsv.x + dot(w, uBqHue));
      n.y = clamp(hsv.y * (1. + dot(w, uBqSat - 1.)), 0., 1.);
      n.z = clamp(hsv.z * (1. + dot(w, uBqVal - 1.)), 0., 1.);
      vec3 rgb = n.z * mix(vec3(1.), clamp(abs(fract(n.x + vec3(1., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.), n.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, pow(rgb, vec3(2.2)), min(sum, 1.));
    }
  }
}
`;

/** The courier's hoodie colour in the drawing; other players get it recoloured to their own. */
const HOODIE = new THREE.Color("#6f8c88");

/**
 * Uniforms for the legs, set each frame by the courier (see Courier.legs):
 * - uLegs: how far the left (x) and right (y) foot is from under the body toward the camera (m;
 *   negative = ahead), and the heights (m) up to which a foot moves in full (w) and where the leg
 *   joins the shorts and stops moving (z).
 * - uLegShift: where a point moves on the card, per metre it moves toward the camera, at the ground
 *   (xy) and at the top of the legs (zw): mostly down, as the camera looks down on the road.
 * - uLegDepth: how much of that metre is along the line of sight (for the depth buffer).
 * - uLegLat: how far the left (x) and right (y) leg is moved across the card (m), at the foot (less up
 *   the leg, none at the knee): the planted foot is held at one place across while it is down,
 *   where the drawings, changing under it, have it hop a few centimetres from side to side.
 * - uBody: how far the body (everything above the knees) moves on the card (m), at the hips (xy) and
 *   the chest (zw); uHead, the head (xy). Each part moves a moment after the one under it, so the body
 *   flows over the legs instead of riding along as one block; the feet stay where they stand.
 */
type LegUniforms = {
  uLegs: { value: THREE.Vector4 };
  uBody: { value: THREE.Vector4 };
  uHead: { value: THREE.Vector2 };
  uRoll: { value: THREE.Vector2 };
  uLegShift: { value: THREE.Vector4 };
  uLegDepth: { value: number };
  uLegLat: { value: THREE.Vector2 };
  uFootTop: { value: THREE.Vector2 };
  uBag: { value: THREE.Vector2 };
  uLegProj: { value: THREE.Matrix4 };
  uCard: { value: THREE.Vector2 };
  legMask: { value: THREE.Texture };
};

/**
 * The legs as two layers. A drawing is flat, so its planted foot rides along with the body and slides
 * over the road. Here each leg is drawn from its own layer, moved toward or away from the camera by
 * where that foot really is: the planted foot stays where it landed (coming down the screen and
 * growing a touch as the body runs on over it), the swinging foot travels forward. The nearer layer
 * draws on top, and its depth is written where it really is, so a foot behind the body's line still
 * stands on the road instead of sinking into it.
 */
/** Heights on the courier's card (m) of the parts of the body that move on their own (see bodyShift):
 *  the hips, the chest and shoulders, the head. */
const HIPS_Y = "0.55";
const CHEST_Y = "0.98";
const HEAD_Y = "1.22";
/** Where the knees are on the card (m). The body's rise and fall is taken up above them, in the thighs
 *  (seen from behind, a knee bending tips the thigh toward the camera and shortens it while the shin
 *  stays as it is), rather than spread down the whole leg, which read as a straight leg shrinking. */
const KNEE_Y = "0.24";
/** Where a point on the card at height y moves to with the body (as LEGS_PARS's bodyShift). */
function bodyShift(legs: LegUniforms, y: number, out: THREE.Vector2, px = 0) {
  const b = legs.uBody.value;
  const h = legs.uHead.value;
  const r = legs.uRoll.value;
  const c = THREE.MathUtils.smoothstep(y, +HIPS_Y, +CHEST_Y);
  const d = THREE.MathUtils.smoothstep(y, +CHEST_Y, +HEAD_Y);
  const x = (b.x + (b.z - b.x) * c) * (1 - d) + h.x * d;
  const v = (b.y + (b.w - b.y) * c) * (1 - d) + h.y * d + px * (r.x + (r.y - r.x) * c) * (1 - d);
  return out.set(x * THREE.MathUtils.smoothstep(y, 0.08, 0.5), v * THREE.MathUtils.smoothstep(y, +KNEE_Y, 0.45));
}
/** Heights on the card (m): a foot moves in full up to FOOT_TOP; the leg not at all from LEG_TOP up,
 *  just under the shorts, so the legs stay joined to the body. A foot lifting off the road moves in
 *  full up to FOOT_LIFTED, about the knee (a kicked shoe spans about 0.12 to 0.34 m of the card): kicked up behind, the shoe sits well above the road, and
 *  with the full move ending at the ankle its toe moved more than its heel and the sole was drawn out
 *  long, as if stuck to the road. (Not for the planted foot: its shin and sock were drawn out instead.) */
const FOOT_TOP = 0.07;
const FOOT_LIFTED = 0.3;
/** About the middle of a lifted shoe (m up the card). */
const FOOT_MID = 0.2;

const LEGS_PARS = /* glsl */ `
uniform sampler2D legMask;
uniform vec4 uLegs;
uniform vec4 uLegShift;
uniform float uLegDepth;
uniform vec2 uLegLat;
uniform mat4 uLegProj;
uniform vec2 uCard;
varying vec2 vLegLocal;
varying vec3 vLegView;
varying vec4 vCellXf;
vec2 atlas(vec2 c) { return vCellXf.xy + c * vCellXf.zw; }
uniform vec2 uFootTop;
float legW(float y, float top) { return clamp((uLegs.z - y) / (uLegs.z - top), 0., 1.); }
vec2 legShift(float y) { return mix(uLegShift.xy, uLegShift.zw, clamp(y / uLegs.z, 0., 1.)); }
// How far the point of a leg at height y moves on the card, its foot P m toward the camera. A foot
// ahead (P < 0) is higher up the card: the whole leg goes up with it, as drawn, its top passing under
// the shorts, as a knee coming forward does seen from behind. (Squeezed instead, between the foot and
// the shorts, the leg read as paper folded at the knee, not a knee bending.) A foot behind comes down
// the card, the leg drawn out above it toward the shorts so it stays joined to them.
vec2 legMove(float y, float P, vec2 lat, float top, float lift) {
  vec2 v = legShift(mix(y, ${FOOT_MID.toFixed(3)}, lift)) * P;
  float w = legW(y, top);
  return vec2((v.x + lat.x) * w, v.y * (P < 0. ? 1. : w));
}
vec2 legCell(vec2 p) { return vec2(p.x / uCard.x + .5, p.y / uCard.y); }
uniform vec4 uBody;
uniform vec2 uHead;
uniform vec2 uRoll;
vec2 bodyShift(vec2 p) {
  float y = p.y;
  vec2 v = mix(mix(uBody.xy, uBody.zw, smoothstep(${HIPS_Y}, ${CHEST_Y}, y)), uHead, smoothstep(${CHEST_Y}, ${HEAD_Y}, y));
  // (tilted: the hips (x) and the shoulders (y) each turn a little about the body's middle, the head
  // staying level)
  v.y += p.x * mix(uRoll.x, uRoll.y, smoothstep(${HIPS_Y}, ${CHEST_Y}, y)) * (1. - smoothstep(${CHEST_Y}, ${HEAD_Y}, y));
  return vec2(v.x * smoothstep(.08, .5, y), v.y * smoothstep(${KNEE_Y}, .45, y));
}
bool inCell(vec2 c) { return c.x >= 0. && c.x <= 1. && c.y >= 0. && c.y <= 1.; }
uniform vec2 uBag;
bool isBag(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  return c.r > c.g + .047 && c.g >= c.b - .016 && mx < .75 && mx > .2 && mx - mn > .12;
}
`;
const LEGS_FRAG = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = vec4(0.);
  float legNear = -1.;
  {
    vec2 gdx = dFdx(vMapUv), gdy = dFdy(vMapUv);
    // The body (everything but the legs), moved as a whole above the knees (a fixed point, as the
    // move depends on the height it starts from).
    vec2 b = vLegLocal - bodyShift(vLegLocal);
    b = vLegLocal - bodyShift(b);
    vec2 c0 = legCell(b);
    if (inCell(c0)) {
      vec2 uv = atlas(c0);
      vec4 m = textureGrad(legMask, uv, gdx, gdy);
      if (m.r < .5 && m.g < .5) {
        vec4 col = textureGrad(map, uv, gdx, gdy);
        if (col.a >= .5) { sampledDiffuseColor = col; legNear = .004; }
        // The satchel swinging on its own (uBag): drawn here if the bag, moved, lands here; where it
        // has moved away from, what is beside it shows instead. (Picked out by its brown, about the
        // hip; the strap less and less up to the shoulder, where it stays put.)
        // (its bottom trailing more than its top, as a bag swings from its strap)
        float bw = smoothstep(.42, .5, b.y) * (1. - smoothstep(.82, 1.02, b.y)) * mix(1.35, .6, smoothstep(.5, .82, b.y));
        if (bw > .01) {
          vec2 cb = legCell(b - uBag * bw);
          if (inCell(cb)) {
            vec4 cbag = textureGrad(map, atlas(cb), gdx, gdy);
            if (cbag.a >= .5 && isBag(cbag.rgb)) { sampledDiffuseColor = cbag; legNear = .004; }
            else if (col.a >= .5 && isBag(col.rgb)) {
              vec2 cs = legCell(b + uBag * bw * 1.5);
              vec4 side = inCell(cs) ? textureGrad(map, atlas(cs), gdx, gdy) : col;
              if (side.a >= .5 && !isBag(side.rgb)) sampledDiffuseColor = side;
            }
          }
        }
      }
    }
    // Each leg where it has moved to: find the drawn pixel that lands here (two steps of a fixed
    // point, as the move depends on the height it starts from); the nearest layer wins.
    for (int k = 0; k < 2; k++) {
      float P = k == 0 ? uLegs.x : uLegs.y;
      vec2 lat = vec2(k == 0 ? uLegLat.x : uLegLat.y, 0.);
      float top = k == 0 ? uFootTop.x : uFootTop.y;
      // (a lifted foot is moved as one thing, as the point at its middle moves: worked out height by
      // height, a raised shoe's toe and heel moved by different amounts and its sole was drawn out)
      float lift = clamp((top - ${FOOT_TOP.toFixed(3)}) / ${(FOOT_LIFTED - FOOT_TOP).toFixed(3)}, 0., 1.);
      vec2 s = vLegLocal - legMove(vLegLocal.y, P, lat, top, lift) - bodyShift(vLegLocal);
      s = vLegLocal - legMove(s.y, P, lat, top, lift) - bodyShift(s);
      s = vLegLocal - legMove(s.y, P, lat, top, lift) - bodyShift(s);
      float near = P < 0. ? P : P * legW(s.y, top);
      if (near <= legNear) continue;
      vec2 c = legCell(s);
      if (!inCell(c)) continue;
      vec2 uv = atlas(c);
      vec4 m = textureGrad(legMask, uv, gdx, gdy);
      if ((k == 0 ? m.r : m.g) < .5) continue;
      vec4 col = textureGrad(map, uv, gdx, gdy);
      if (col.a < .5) continue;
      sampledDiffuseColor = col;
      legNear = near;
    }
  }
  diffuseColor *= sampledDiffuseColor;
#endif
`;
const LEGS_DEPTH = /* glsl */ `
  {
    // A leg layer sits nearer (or further) than the card by legNear metres along the ground; a hair
    // nearer still, so a planted sole wins over the road it stands on.
    float fd = gl_FragCoord.z;
    if (legNear > .005 || legNear < -.0001) {
      float dist = length(vLegView);
      vec4 cp = uLegProj * vec4(vLegView * ((dist - legNear * uLegDepth - .03) / dist), 1.);
      fd = clamp(cp.z / cp.w * .5 + .5, 0., 1.);
    }
    gl_FragDepth = fd;
  }
`;

function cardMaterial(url: string, cols: number, rows: number, tint?: string, legs?: LegUniforms) {
  const map = sheet(url);
  map.repeat.set(1 / cols, 1 / rows);
  const m = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  // In the normal pass (used to find creases for the ink) the card draws itself, not the override:
  // its cut-out shape as one flat surface facing the camera. So the ink outlines the figure but
  // never traces the walls and road behind it through the body.
  m.allowOverride = false;
  const uNormalMode = { value: 0 };
  m.userData.normalMode = uNormalMode;
  const uTint = { value: new THREE.Color(tint ?? "#000000") };
  const uKey = { value: HOODIE.clone() };
  const uBqAt = { value: new THREE.Vector3() };
  m.userData.bouquetAt = uBqAt;
  // (how much of the figure shows, 0..1: a player arriving or leaving dissolves in and out, pixel by
  // pixel, the card being a cut-out that can't simply be made see-through)
  const uFade = { value: 1 };
  m.userData.fade = uFade;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, bouquetUniforms, { uBqAt });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vBqLocal;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvBqLocal = position.xy;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vBqLocal;\nuniform vec3 uBqAt; uniform vec3 uBqHue; uniform vec3 uBqSat; uniform vec3 uBqVal;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + BOUQUET_FRAG);
    sh.uniforms.uNormalMode = uNormalMode;
    sh.uniforms.uSoak = soakUniform;
    sh.uniforms.uSplash = splashUniform;
    sh.uniforms.uTint = uTint;
    sh.uniforms.uKey = uKey;
    sh.uniforms.uFade = uFade;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uFade;")
      .replace(
        "#include <alphatest_fragment>",
        "#include <alphatest_fragment>\nif (uFade < .999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= uFade) discard;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNormalMode; uniform vec3 uTint; uniform vec3 uKey; uniform float uSoak; uniform float uSplash;\n#define WET_Y ${legs ? "vLegLocal.y" : "1."}`)
      // Clothes and hair soaked in the rain go darker and a touch cooler (lib/weather.ts); the
      // courier's shins and shoes also from the road's splashes, even under the umbrella.
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor.rgb *= mix(vec3(1.), vec3(.8, .84, .9), max(uSoak, uSplash * (1. - smoothstep(.22, .42, WET_Y))));\nif (uNormalMode > .5) gl_FragColor = vec4(.5, .5, 1., 1.);",
      );
    if (legs) {
      Object.assign(sh.uniforms, legs);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vLegLocal;\nvarying vec3 vLegView;\nvarying vec4 vCellXf;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvLegLocal = position.xy;\nvLegView = mvPosition.xyz;\nvCellXf = vec4((mapTransform * vec3(0., 0., 1.)).xy, mapTransform[0][0], mapTransform[1][1]);",
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + LEGS_PARS)
        .replace("#include <map_fragment>", LEGS_FRAG)
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n" + LEGS_DEPTH);
    }
    if (tint)
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
          {
            // Recolour pixels close in hue to the drawn hoodie, keeping their light and shade.
            vec3 c = diffuseColor.rgb;
            float l = dot(c, vec3(.299, .587, .114));
            vec3 nk = uKey / max(dot(uKey, vec3(.299, .587, .114)), .01);
            vec3 nc = c / max(l, .01);
            float near = 1. - smoothstep(.12, .28, distance(nc, nk));
            float tl = dot(uTint, vec3(.299, .587, .114));
            diffuseColor.rgb = mix(c, uTint * (l / max(tl, .01)) * .95, near * step(.12, l));
          }`,
      );
  };
  m.customProgramCacheKey = () => (tint ? "card-tint" : "card") + (legs ? "-legs" : "");
  return m;
}

/** Tell a card's material whether this draw is the normal pass. */
function normalModeHook(mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial) {
  const u = mat.userData.normalMode as { value: number };
  mesh.onBeforeRender = (_r, scene) => {
    u.value = scene.overrideMaterial ? 1 : 0;
  };
}

/** Leave cards out of the normal pass (it ignores alpha), so the ink never draws their rectangle. */
function hideFromOverride(mesh: THREE.Mesh) {
  const saved = new THREE.Matrix4();
  mesh.onBeforeRender = (_r, scene) => {
    if (!scene.overrideMaterial) return;
    saved.copy(mesh.matrixWorld);
    mesh.matrixWorld.makeScale(0, 0, 0);
  };
  mesh.onAfterRender = (_r, scene) => {
    if (scene.overrideMaterial) mesh.matrixWorld.copy(saved);
  };
}

/** A soft dark patch under the feet, so the figure always reads as standing on the ground. */
function contactShadow() {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshBasicMaterial({ color: "#1d2b2e", transparent: true, opacity: 0.5, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  m.scale.set(1, 0.6, 1);
  m.renderOrder = 1;
  hideFromOverride(m);
  return m;
}

/**
 * Where the sun (or the moon) is, for the figures' shadows: its direction (world, toward it) and how
 * strong a shadow it throws (none to speak of under rain clouds). Set by the Runner as it moves it.
 */
export const sunlight = { dir: new THREE.Vector3(0.5, 0.75, 0.4).normalize(), strength: 1 };

type Silhouette = { map: THREE.Texture | null; w: number; h: number; turn: number; mirror: number };

const SHADE_VERT = /* glsl */ `
uniform vec2 uDir; uniform vec2 uAcross; uniform float uW; uniform float uL;
varying vec2 vQ;
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
void main(){
  vQ = uv;
  // The drawing laid down on the ground away from the light: its width across, its height along.
  vec3 objectNormal = vec3(0., 1., 0.);
  #include <defaultnormal_vertex>
  vec2 g = uAcross * (uv.x - .5) * uW + uDir * uv.y * uL;
  // (raised as the planet's surface curves away under its far end)
  vec3 transformed = vec3(g.x, .025 + dot(g, g) / (2. * ${PLANET_RADIUS.toFixed(1)}), g.y);
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;
const SHADE_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec4 uXf; uniform float uOpacity; uniform float uBlur; uniform vec3 uColor;
varying vec2 vQ;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
float at(vec2 q) { return texture2D(uMap, uXf.xy + clamp(q, vec2(.003), vec2(.997)) * uXf.zw).a; }
void main(){
  // Sharp at the feet, softer and fainter toward the head's end (the penumbra widens with distance
  // from what casts it); and none where something else already shades the ground.
  float b = uBlur * (.15 + vQ.y);
  float a = .28 * at(vQ) + .18 * (at(vQ + vec2(b, 0.)) + at(vQ - vec2(b, 0.)) + at(vQ + vec2(0., b * .6)) + at(vQ - vec2(0., b * .6)));
  a *= uOpacity * (1. - .35 * vQ.y) * getShadowMask();
  if (a < .004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const _sun = new THREE.Vector3();
const _yUp = new THREE.Vector3(0, 1, 0);
const _rq = new THREE.Quaternion();
const _mq = new THREE.Quaternion();

/**
 * A figure's shadow on the ground: its drawing (whichever frame shows) laid flat away from the sun,
 * stretched by how low the sun is, softening toward its far end, and fading under cloud and where a
 * wall's shadow already covers the ground. Laid across as if the figure were round (a card lit from
 * the side would throw only a sliver), the right way round as the camera sees it.
 */
class FigureShadow {
  readonly mesh: THREE.Mesh;
  private u = {
    uMap: { value: null as THREE.Texture | null },
    uXf: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDir: { value: new THREE.Vector2(0, 1) },
    uAcross: { value: new THREE.Vector2(1, 0) },
    uW: { value: 1 },
    uL: { value: 1 },
    uOpacity: { value: 0.3 },
    uBlur: { value: 0.02 },
    uColor: { value: new THREE.Color("#2c3a44") },
  };
  private src: Silhouette = { map: null, w: 1, h: 1, turn: 0, mirror: 1 };
  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHADE_VERT,
      fragmentShader: SHADE_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]),
      lights: true,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // (merge copies uniforms: these are kept by reference so they can be set each frame)
    Object.assign(mat.uniforms, this.u);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    hideFromOverride(this.mesh);
  }

  /** Cast from `card`'s drawing, for a figure standing at `root` (its frame: y up). */
  update(card: { silhouette(out: Silhouette): Silhouette }, root: THREE.Object3D, fade = 1) {
    const s = card.silhouette(this.src);
    const u = this.u;
    const map = s.map;
    this.mesh.visible = !!map && sunlight.strength > 0.02;
    if (!this.mesh.visible || !map) return;
    u.uMap.value = map;
    u.uXf.value.set(map.offset.x, map.offset.y, map.repeat.x, map.repeat.y);
    // Laid level on the ground (the figure itself may lean, into a bend or over a foot).
    root.getWorldQuaternion(_rq).invert();
    root.getWorldPosition(_sun).normalize().applyQuaternion(_rq);
    this.mesh.quaternion.setFromUnitVectors(_yUp, _sun);
    // The sun in that frame: the shadow runs away from it, longer the lower it is.
    _rq.premultiply(_mq.copy(this.mesh.quaternion).invert());
    _sun.copy(sunlight.dir).applyQuaternion(_rq);
    const flat = Math.hypot(_sun.x, _sun.z);
    if (flat < 1e-3) return void (this.mesh.visible = false);
    // (swung round toward the camera, as from a sun further ahead: thrown straight across the road from
    // a sun off to the side, a flat figure's shadow is only a thin streak seen from behind)
    u.uDir.value.set(-_sun.x / flat + 1.4 * Math.sin(s.turn), -_sun.z / flat + 1.4 * Math.cos(s.turn)).normalize();
    const tanUp = Math.max(0.45, _sun.y / flat);
    u.uL.value = Math.min(s.h / tanUp, 2.2 * s.h);
    u.uW.value = s.w;
    // Across: square to the shadow's run, turned the way the card's own right points (mirrored too).
    const rx = Math.cos(s.turn) * s.mirror;
    const rz = -Math.sin(s.turn) * s.mirror;
    let ax = u.uDir.value.y;
    let az = -u.uDir.value.x;
    if (ax * rx + az * rz < 0) (ax = -ax), (az = -az);
    u.uAcross.value.set(ax, az);
    // Softer and fainter as cloud thins the light.
    u.uOpacity.value = 0.3 * sunlight.strength * fade;
    u.uBlur.value = 0.03 + 0.03 * (1 - sunlight.strength);
  }
}

const _cam = new THREE.Vector3();

/** A drawn figure on a camera-facing card. Height in metres. */
class Card {
  readonly root = new THREE.Group();
  protected card: THREE.Mesh;
  /** The card's width, metres. */
  protected width: number;
  protected mat: THREE.MeshBasicMaterial;
  protected hop = 0;
  /** The soft dark patch it stands on. */
  private contact: THREE.Mesh;

  /** The cell's height on the card, metres (the drawing's ground line is the card's y = 0). */
  protected cell: number;
  /** The leg layers' uniforms, for a card drawn with them (the courier). */
  protected legs?: LegUniforms;

  /**
   * `below`: how far the card reaches under the ground line (m), for feet drawn nearer the camera.
   * `aspect`: a cell's width over its height; `fill`: how much of the cell's height the figure fills.
   */
  constructor(url: string, height: number, tint?: string, private cols = 4, private rows = 2, legs?: LegUniforms, below = 0, aspect = CELL_ASPECT, fill = 312 / 320) {
    this.mat = cardMaterial(url, cols, rows, tint, legs);
    this.cell = height / fill;
    this.width = this.cell * aspect;
    this.legs = legs;
    legs?.uCard.value.set(this.width, this.cell);
    const geo = new THREE.PlaneGeometry(this.width, this.cell + below);
    geo.translate(0, (this.cell + below) / 2 - below, 0);
    // v follows the height on the cell, so the part below the ground line lies outside it (v < 0).
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / this.cell);
    this.card = new THREE.Mesh(geo, this.mat);
    this.card.castShadow = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.mat.map, alphaTest: 0.5 });
    // The shadow uses the cell only (below its ground line the atlas holds the next frame).
    depth.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vCellY;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCellY = vec2(mapTransform[2][1], mapTransform[2][1] + mapTransform[1][1]);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vCellY;")
        .replace(
          "#include <alphatest_fragment>",
          "#include <alphatest_fragment>\nif (vMapUv.y < min(vCellY.x, vCellY.y) || vMapUv.y > max(vCellY.x, vCellY.y)) discard;",
        );
    };
    depth.customProgramCacheKey = () => "card-depth";
    this.card.customDepthMaterial = depth;
    normalModeHook(this.card, this.mat);
    this.contact = contactShadow();
    this.root.add(this.card, this.contact);
    this.root.traverse((o) => (o.frustumCulled = false));
  }

  /** The bouquet drawn on this card takes this time's colours (see pickBouquet), within `r` metres
   *  of (x, y) on it (r over 9: anywhere on it). */
  paintBouquet(x: number, y: number, r: number) {
    (this.mat.userData.bouquetAt as { value: THREE.Vector3 }).value.set(x, y, r);
  }

  protected frame(i: number) {
    const map = this.mat.map!;
    map.offset.set((i % this.cols) / this.cols, 1 - (Math.floor(i / this.cols) + 1) / this.rows);
  }

  /** Turn the card about the figure's own up so it faces the camera. */
  protected face(camera: THREE.Camera) {
    this.root.updateWorldMatrix(true, false);
    _cam.copy(camera.position);
    this.root.worldToLocal(_cam);
    this.card.rotation.y = Math.atan2(_cam.x, _cam.z);
  }

  /** What a shadow of it is cast from: the drawing showing, its size, and which way the card faces. */
  silhouette(out: Silhouette) {
    out.map = this.mat.map;
    out.w = this.width;
    out.h = this.cell;
    out.turn = this.card.rotation.y;
    out.mirror = this.card.scale.x < 0 ? -1 : 1;
    return out;
  }

  /** Hold something on the card (in its own frame: x across, y up, +z toward the camera). */
  carry(o: THREE.Object3D) {
    this.card.add(o);
  }
  /** What a carried thing hangs on (the drawing itself, which turns and flips with them). */
  get holder(): THREE.Object3D {
    return this.card;
  }

  /** How much of the figure shows (0..1): see uFade. */
  set fade(v: number) {
    (this.mat.userData.fade as { value: number }).value = v;
    (this.contact.material as THREE.MeshBasicMaterial).opacity = 0.5 * v;
  }
  get fade() {
    return (this.mat.userData.fade as { value: number }).value;
  }

  /** A little hop: how a drawn figure says hello. */
  wave() {
    this.hop = 0.6;
  }

  protected tickHop(dt: number): void {
    if (this.hop <= 0) {
      this.card.position.y = 0;
      return;
    }
    this.hop = Math.max(0, this.hop - dt);
    const t = 1 - this.hop / 0.6;
    this.card.position.y = Math.sin(Math.min(1, t * 2) * Math.PI) * 0.18;
  }

  dispose() {
    this.root.removeFromParent();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}

/**
 * Where the planted foot is in each run frame, as a fraction of the card's width from its centre
 * (measured on the run's legs, art/run-cycle8.py: the right foot is down from frame 8 to 39, the left
 * from 40 to 7). The foot's contact shadow sits under it, and a footstep sounds as it changes.
 */
const PLANTED = [-0.082, -0.082, -0.082, -0.082, -0.105, -0.105, -0.105, -0.089, 0.044, 0.044, 0.044, 0.075, 0.075, 0.075, 0.075, 0.075, 0.074, 0.074, 0.074, 0.074, 0.074, 0.074, 0.074, 0.074, 0.074, 0.041, 0.041, 0.041, 0.055, 0.055, 0.055, 0.055, 0.077, 0.077, 0.077, 0.077, 0.077, 0.100, 0.100, 0.084, -0.049, -0.049, -0.049, -0.081, -0.081, -0.081, -0.081, -0.081, -0.079, -0.079, -0.079, -0.079, -0.079, -0.079, -0.080, -0.080, -0.080, -0.046, -0.046, -0.046, -0.060, -0.060, -0.060, -0.082];
/** Where across each foot is held while it is down: the middle of where the drawings put it then. */
const STANCE_AT = (() => {
  const mid = (from: number, n: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = PLANTED[(from + i) % 64];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return (lo + hi) / 2;
  };
  return { left: mid(Math.round(LEFT_DOWN * 64), 32), right: mid(Math.round(RIGHT_DOWN * 64), 32) };
})();
/**
 * The body's height through one step (0 at the foot's landing, 1 at the next landing), -1..1: already
 * coming down as the foot lands, quickly down into the bent knee a quarter of the way in (the weight
 * taken), held low while the knee carries it, then driven up by the push into the float before the next
 * landing. (A plain wave, down and up evenly, read as floating; this lands, gives, and drives.) A smooth
 * loop through those points (Catmull-Rom), so the speed never jumps.
 */
const RISE = [
  [0, 0.3],
  [0.2, -1],
  [0.45, -0.72],
  [0.8, 0.6],
] as const;
function stepRise(u: number) {
  u = ((u % 1) + 1) % 1;
  const n = RISE.length;
  let i = n - 1;
  while (i > 0 && RISE[i][0] > u) i--;
  const at = (k: number) => {
    const j = ((k % n) + n) % n;
    const wrap = Math.floor(k / n);
    return [RISE[j][0] + wrap, RISE[j][1]] as const;
  };
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  const t = (u - p1[0]) / (p2[0] - p1[0]);
  // (tangents scaled to the uneven spacing of the points)
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * (p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}
/** A round patch, dark in the middle and fading to nothing at its edge (the foot's contact shadow). */
let _softSpot: THREE.Texture | null = null;
function softSpot() {
  if (_softSpot) return _softSpot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _softSpot = new THREE.CanvasTexture(c);
  return _softSpot;
}
/** The satchel's swing: how quick its spring is (rad/s), how damped (1 = not bouncing), how much its
 *  lag behind the hips shows. */
const BAG_OMEGA = 6.5;
const BAG_DAMP = 0.45;
const BAG_SWING = 0.65;
/** How far the hips and the shoulders tilt each step (radians, ~2 and ~1.4 degrees, opposite ways). */
const ROLL = [0.05, -0.036];
/** How much the drawings' timing slows round each landing and speeds up through the swing (0 = even). */
const POSE_EASE = 0.25;
/** The hips' centre line in the drawings (between the two planted positions). */
const HIPS = -0.03;

/** Heights on the card (m): the legs move not at all from LEG_TOP up, just under the shorts, so
 *  they stay joined to the body (and a foot in full below FOOT_TOP: see there). */
const LEG_TOP = 0.42;

/**
 * Steadying for the drawn body, per run frame (card metres): the drawings bob up and down by up to
 * 2.5 cm and shift sideways by about 1 cm at random from one to the next (drawn one by one), which
 * reads as a jittery, stiff torso. Each frame's body is moved back onto a smooth path (fitted to the
 * hair and shoulders, art/bodyfix64.py, on all 64 frames); the rhythm is then added in code, in time
 * with the feet.
 */
const BODY_DY = [-0.0131, -0.0055, -0.0022, 0.0025, 0.0097, 0.0091, 0.0076, 0.0071, 0.0061, 0.0013, -0.0027, -0.0044, -0.0024, -0.0051, -0.0062, -0.0063, -0.0070, -0.0100, -0.0104, -0.0106, -0.0092, -0.0059, 0.0008, 0.0089, 0.0106, 0.0109, -0.0138, -0.0130, -0.0125, -0.0074, -0.0036, 0.0027, 0.0094, 0.0160, 0.0109, 0.0063, 0.0025, 0.0021, -0.0005, -0.0013, -0.0023, 0.0025, -0.0014, -0.0080, -0.0113, -0.0103, -0.0061, -0.0002, 0.0037, 0.0094, 0.0125, 0.0210, 0.0286, 0.0205, 0.0092, 0.0070, -0.0071, -0.0042, -0.0058, -0.0052, -0.0045, -0.0055, -0.0087, -0.0056];
const BODY_DX = [-0.0059, -0.0037, -0.0019, -0.0018, 0.0008, 0.0005, 0.0017, 0.0014, 0.0018, 0.0079, 0.0097, 0.0101, 0.0100, 0.0075, 0.0035, -0.0029, -0.0117, -0.0077, -0.0047, 0.0001, 0.0041, 0.0038, 0.0021, 0.0019, 0.0045, 0.0056, -0.0100, -0.0096, -0.0088, -0.0087, -0.0069, -0.0013, 0.0037, 0.0042, 0.0059, 0.0031, -0.0011, -0.0006, 0.0021, 0.0022, 0.0023, -0.0009, -0.0020, -0.0036, -0.0062, -0.0033, -0.0010, 0.0036, 0.0094, 0.0096, 0.0097, 0.0075, 0.0029, 0.0018, 0.0004, -0.0010, -0.0040, -0.0038, -0.0046, -0.0049, -0.0052, -0.0056, -0.0061, -0.0059];
/** The run's rhythm (m at a jog): the body sinks into each landing and rises as the foot pushes off
 *  (lowest mid-stance), and the hips carry over the planted foot. */
const BOB = 0.032;
const SWAY = 0.02;
/**
 * The body is not one block: the hips lead, the chest follows a moment later and the head later
 * still (fractions of a stride), so each landing travels up through the body (the torso squashing a
 * touch as the hips drop under it, and stretching as they push up again) and the shoulders and head
 * ride the sway more quietly than the hips. [delay of the bob, its size; delay of the sway, its size].
 */
// (side to side the chest goes AGAINST the hips (a negative size): the hips go over onto the foot that
// carries the weight and the shoulders lean back the other way to balance, so the torso tilts against
// the pelvis at every step instead of the whole body swaying across as one; the head, steadied, follows
// the hips only a little)
const CHEST = [0.095, 1.1, 0.07, -0.3];
const HEAD = [0.155, 0.95, 0.1, 0.15];
/** How far the hips drop into each landing (times BOB): further than the chest and head, so the
 *  supporting leg shortens under the weight (the knee giving) and the spine takes up the rest, rather
 *  than the whole body riding up and down as one block on a straight leg. */
const HIPS_DROP = 1.45;
/** ...and stay down a little past the middle of the step (fraction of a stride) before the leg drives
 *  them up again: the knee carries the weight a moment longer instead of straightening as it lands. */
const HIPS_LATE = 0.035;
/** And the whole figure gives a little at each landing (squashing, widening a touch) and pitches
 *  forward as each foot pushes off. */
const SQUASH = 0.02;
const PITCH = 0.018;
/** Standing: a slow breath (m the chest rises, breaths a second). */
const BREATH = 0.004;
const BREATH_HZ = 0.28;

const makeLegUniforms = (): LegUniforms => ({
  uLegs: { value: new THREE.Vector4(0, 0, LEG_TOP, FOOT_TOP) },
  uBody: { value: new THREE.Vector4() },
  uHead: { value: new THREE.Vector2() },
  uRoll: { value: new THREE.Vector2() },
  uLegShift: { value: new THREE.Vector4() },
  uLegDepth: { value: 1 },
  uLegLat: { value: new THREE.Vector2() },
  uFootTop: { value: new THREE.Vector2(FOOT_TOP, FOOT_TOP) },
  uBag: { value: new THREE.Vector2() },
  uLegProj: { value: new THREE.Matrix4() },
  uCard: { value: new THREE.Vector2(1, 1) },
  legMask: { value: legsTexture() },
});

const _back = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _s0 = new THREE.Vector2();
const _s1 = new THREE.Vector2();

/**
 * The courier: a 32-frame jog seen from behind, stepped by distance so the legs turn over at the
 * pace of the ground. The drawings carry the legs and the body's own rise and fall with a foot always
 * on the ground line. Code adds what a flat drawing can't: each leg moving toward or away from the
 * camera, so the planted foot holds the road while the body passes over it (see LEGS_FRAG); weight
 * shifting over the planted foot; a lean into speeding up (and back when braking); and a small
 * contact shadow under whichever foot is down, where it actually is.
 */
/** The courier's size on the planet (times the drawing's 1.4 m): a touch taller than the people at the
 *  stops' doors, so he holds the street rather than looking timid in it (as 1, he did). */
export const COURIER_SCALE = 1.12;

export class Courier extends Card {
  /** 0..1 through the current stride cycle. */
  phase = 0;
  /** Called as each foot lands. */
  onStep?: (strength: number) => void;
  /** The foot that came down this frame (-1 the left, 1 the right), or 0: see footAt. */
  landed = 0;
  private motion = 0;
  private pace = 0;
  private accel = 0;
  private weight = 0;
  private slope = 0;
  private breath = 0;
  private side = 0;
  /** The satchel's own place and speed on its spring (card m, m/s): see uBag. */
  private bagP = new THREE.Vector2();
  private bagV = new THREE.Vector2();
  private foot: THREE.Mesh;
  private runMap: THREE.Texture;
  /** The jog holding the umbrella up, and the umbrella held (see holdUmbrella). */
  private umbrellaMap?: THREE.Texture;
  private umbrella?: Umbrella;
  /** How the umbrella is held up over his head as he runs. */
  private umbrellaLean = 0;
  private umbrellaGrip = 0;
  private holding = false;
  private shade = new FigureShadow();
  constructor(tint?: string) {
    super(RUN_URL, 1.4, tint, 8, 8, makeLegUniforms(), 0.26);
    this.runMap = this.mat.map!;
    this.frame(0);
    // A small, darker patch where the planted foot presses the road (soft-edged, so it reads as the
    // foot's own shadow on the ground rather than a disc under it).
    this.foot = new THREE.Mesh(
      new THREE.CircleGeometry(0.088, 24),
      new THREE.MeshBasicMaterial({ color: "#16242a", map: softSpot(), transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.foot.rotation.x = -Math.PI / 2;
    this.foot.scale.set(1, 1.5, 1);
    this.foot.renderOrder = 2;
    this.foot.frustumCulled = false;
    this.root.add(this.foot);
    // His shadow is drawn from his outline (FigureShadow), not cast by the card: lit from the side, a
    // card facing the camera throws only a thin sliver.
    this.card.castShadow = false;
    this.root.add(this.shade.mesh);
  }
  protected frame(i: number) {
    super.frame(i);
    // (both sheets keep to the same frame, so either can be shown)
    this.runMap.offset.copy(this.mat.map!.offset);
    this.umbrellaMap?.offset.copy(this.mat.map!.offset);
  }

  /** Load the jog with the umbrella, and hold `umbrella` (umbrella.ts) in the raised fist while it
   *  shows (and in his hand in each action's clip). */
  prepareUmbrella(umbrella: Umbrella) {
    if (this.umbrellaMap) return;
    this.umbrellaMap = sheet(UMBRELLA_RUN_URL);
    this.umbrellaMap.repeat.copy(this.runMap.repeat);
    this.umbrella = umbrella;
    this.umbrellaLean = umbrella.lean;
    this.umbrellaGrip = umbrella.grip;
    this.carry(umbrella.root);
    umbrella.cover = true;
  }

  get holdingUmbrella() {
    return this.holding;
  }

  /** Run holding the umbrella up (once its drawings have loaded), or swinging both arms. */
  holdUmbrella(on: boolean) {
    const want = on && !!this.umbrellaMap && this.umbrellaMap.version > 0 && rainArtReady();
    if (want === this.holding) return;
    this.holding = want;
    const map = want ? this.umbrellaMap! : this.runMap;
    map.offset.copy(this.mat.map!.offset);
    this.mat.map = map;
    (this.card.customDepthMaterial as THREE.MeshDepthMaterial).map = map;
  }

  /**
   * dist: metres moved along the road this frame; pace: speed (1 = jogging pace); grade: the rise of
   * the ground per metre in the direction of travel (ramps), so a foot behind sits lower uphill.
   */
  update(dt: number, dist: number, pace: number, camera: THREE.Camera, grade = 0) {
    const moving = pace > 0.08;
    this.motion = THREE.MathUtils.damp(this.motion, moving ? 1 : 0, 6, dt);
    if (dt > 0) this.accel = THREE.MathUtils.damp(this.accel, (pace - this.pace) / dt, 5, dt);
    // (at the frame's average speed: see strideAt)
    const stride = strideAt(((pace + this.pace) / 2) * WALK_SPEED);
    this.pace = pace;
    const before = this.phase;
    // (up and down a ramp the feet go further than the ground covered along the road)
    this.phase = advanceStride(this.phase, dist * Math.hypot(1, grade), stride, moving, dt);
    // (the drawings shown a little slower round each landing and a little faster through the swing,
    // landings themselves where they always fall: a stride that settles onto each foot and snaps
    // through, rather than ticking evenly through its poses)
    const u = (this.phase - LEFT_DOWN) * 2;
    const f = frameAt(this.phase - (POSE_EASE / (4 * Math.PI)) * Math.sin(2 * Math.PI * u) * this.motion);
    this.frame(f);
    this.face(camera);
    // A footstep as the planted foot changes sides.
    const side = Math.sign(PLANTED[f] - HIPS);
    this.landed = 0;
    if (moving && side !== this.side && this.side !== 0 && before !== this.phase) {
      this.onStep?.(Math.min(1, pace));
      this.landed = side;
    }
    this.side = side;

    const m = this.motion;
    const rhythm = Math.min(1, pace) * m;
    // Weight over the planted foot: the figure tips a little toward it (pivoting at the feet), in a
    // smooth swing with the stride (with the hips' sway), never a turn that starts as the foot lands.
    this.weight = THREE.MathUtils.damp(this.weight, rhythm * Math.cos(2 * Math.PI * (this.phase - RIGHT_DOWN - 0.25)), 18, dt);
    this.card.position.x = 0;
    this.card.rotation.z = -this.weight * 0.016;
    // (squashed most just after each landing, as the weight comes down onto the foot; pitched forward
    // most as it pushes off)
    // (in step with the body's drop into the bent knee: see stepRise)
    const land = Math.max(0, -stepRise((this.phase - LEFT_DOWN) * 2));
    this.card.scale.set(1 + SQUASH * 0.5 * rhythm * land, 1 - SQUASH * rhythm * land, 1);
    const push = Math.cos(4 * Math.PI * (this.phase - 20 / 32));
    // Forward lean: a jogger's slight tilt, more while speeding up, less while braking; and into a
    // climb (back a little going down).
    this.slope = THREE.MathUtils.damp(this.slope, THREE.MathUtils.clamp(grade, -0.4, 0.4) * m, 4, dt);
    this.card.rotation.x = -(0.035 * m + THREE.MathUtils.clamp(this.accel * 0.03, -0.04, 0.06) + 0.16 * this.slope + PITCH * rhythm * push);
    this.tickHop(dt);

    // The legs. Each foot's place fore and aft of the body, from the stride (scaled down to nothing
    // as the courier stops, so standing still both feet are under them as drawn).
    // (in the card's own metres: the courier is drawn COURIER_SCALE times life size)
    const travel = (PLANT * stride * STANCE * m) / COURIER_SCALE;
    const pL = footBack(this.phase, LEFT_DOWN, travel);
    const pR = footBack(this.phase, RIGHT_DOWN, travel);
    const legs = this.legs!;
    legs.uLegs.value.x = pL;
    legs.uLegs.value.y = pR;
    // (and each foot held at one place across while it is down, easing in as it lands and out as it
    // lifts, over the first and last tenth of the step)
    const leftDown = isDown(this.phase, LEFT_DOWN);
    const into = ((((this.phase - (leftDown ? LEFT_DOWN : RIGHT_DOWN)) % 1) + 1) % 1) / 0.5;
    const hold = m * THREE.MathUtils.smoothstep(into, 0, 0.1) * THREE.MathUtils.smoothstep(1 - into, 0, 0.1);
    const across = ((leftDown ? STANCE_AT.left : STANCE_AT.right) - PLANTED[f]) * this.width * hold;
    legs.uLegLat.value.set(leftDown ? across : 0, leftDown ? 0 : across);
    // (each foot moved whole up to the knee once it has lifted, until just before it lands)
    const lifted = (down: number) => {
      const t = (((this.phase - down) % 1) + 1) % 1;
      return THREE.MathUtils.smoothstep(t, STANCE - 0.02, STANCE + 0.02) * (1 - THREE.MathUtils.smoothstep(t, 0.86, 0.98));
    };
    legs.uFootTop.value.set(
      THREE.MathUtils.lerp(FOOT_TOP, FOOT_LIFTED, lifted(LEFT_DOWN)),
      THREE.MathUtils.lerp(FOOT_TOP, FOOT_LIFTED, lifted(RIGHT_DOWN)),
    );
    // The body: steadied, then sinking into each landing and swaying over the planted foot (mid-stance
    // of the left foot is at 12/32 of the cycle, of the right at 28/32).
    // (each part of the body on its own beat: see CHEST, HEAD; the drawings' own jitter taken out of
    // all of it, a little less of it sideways up top, where it was measured)
    const dx = BODY_DX[f] * m;
    const dy = BODY_DY[f] * m;
    const bob = (late: number, k: number) => BOB * k * rhythm * stepRise((this.phase - LEFT_DOWN - late) * 2);
    // (the weight goes over onto the new foot soon after it lands and stays there while it carries it,
    // rather than swinging across evenly: a softened square wave, not a sine)
    const sway = (late: number, k: number) => SWAY * k * rhythm * (Math.tanh(2 * Math.cos(2 * Math.PI * (this.phase - RIGHT_DOWN - 0.25 - late))) / Math.tanh(2));
    this.breath += dt * BREATH_HZ * 2 * Math.PI;
    const breath = BREATH * (1 - m) * (0.5 - 0.5 * Math.cos(this.breath));
    legs.uBody.value.set(dx + sway(0, 1), dy + bob(HIPS_LATE, HIPS_DROP), dx * 0.88 + sway(CHEST[2], CHEST[3]), dy + bob(CHEST[0], CHEST[1]) + breath);
    legs.uHead.value.set(dx * 0.57 + sway(HEAD[2], HEAD[3]), dy + bob(HEAD[0], HEAD[1]) + breath * 0.8);
    // The hips tilt down toward the swinging leg's side over the foot that carries the weight, and the
    // shoulders tilt back the other way to balance (radians; one beat later up the body).
    const tilt = (late: number) => rhythm * (Math.tanh(2 * Math.cos(2 * Math.PI * (this.phase - RIGHT_DOWN - 0.25 - late))) / Math.tanh(2));
    legs.uRoll.value.set(ROLL[0] * tilt(0), ROLL[1] * tilt(0.06));
    // The satchel hangs from his shoulder and swings after him: a loose, slightly bouncy spring pulled
    // along by his hips, so it lags each sway and bob and overshoots a little (drawn where it is: see
    // uBag in LEGS_FRAG).
    {
      const hx = legs.uBody.value.x, hy = legs.uBody.value.y;
      const k = BAG_OMEGA * BAG_OMEGA, c = 2 * BAG_DAMP * BAG_OMEGA;
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.bagV.x += (k * (hx - this.bagP.x) - c * this.bagV.x) * h;
        this.bagV.y += (k * (hy - this.bagP.y) - c * this.bagV.y) * h;
        this.bagP.x += this.bagV.x * h;
        this.bagP.y += this.bagV.y * h;
      }
      const lag = (v: number) => THREE.MathUtils.clamp(v * BAG_SWING, -0.035, 0.035);
      legs.uBag.value.set(lag(this.bagP.x - hx), lag(this.bagP.y - hy));
    }
    // The umbrella in the raised fist, which rides with the body (as the shader moves it: see
    // bodyShift), just behind the card so the fist and head come in front of the shaft.
    if (this.umbrella && !this.posing) {
      const [fx, fy] = FIST[f];
      const b = bodyShift(legs, fy, _s0, fx);
      this.umbrella.holdIn(this.card, fx + b.x, fy + b.y, -0.03, this.umbrellaLean, this.umbrellaGrip);
      this.umbrella.carry(b.x - dx * 0.6, b.y - dy);
      this.umbrella.cover = true;
    }
    // "Toward the camera" for a foot means back along the road (and down a slope when climbing), in
    // the card's own frame; and where that moves a point on the card as the camera sees it.
    this.card.updateWorldMatrix(true, false);
    _cam.copy(camera.position);
    this.card.worldToLocal(_cam);
    _back.set(0, -grade, -1).applyQuaternion(_q.copy(this.card.quaternion).invert());
    const shift = (y: number, out: THREE.Vector2) => {
      const d = 0.05;
      _p.set(0, y, 0).addScaledVector(_back, d);
      const t = _cam.z / Math.max(1e-3, _cam.z - _p.z);
      _x.copy(_p).sub(_cam).multiplyScalar(t).add(_cam);
      return out.set(_x.x / d, (_x.y - y) / d);
    };
    shift(0, _s0);
    shift(LEG_TOP, _s1);
    legs.uLegShift.value.set(_s0.x, _s0.y, _s1.x, _s1.y);
    legs.uLegDepth.value = _back.dot(_p.set(0, LEG_TOP / 2, 0).sub(_cam).negate().normalize());
    legs.uLegProj.value.copy(camera.projectionMatrix);

    // The planted foot's contact shadow, under that foot where it is (not where the card is).
    const stance = isDown(this.phase, LEFT_DOWN) ? pL : pR;
    _p.set(this.width * PLANTED[f] + across, 0, 0).addScaledVector(_back, stance).applyMatrix4(this.card.matrix);
    this.foot.position.set(_p.x, 0.016, _p.z);
    // (fainter as the foot peels off the road at the end of its step: see STANCE)
    const peel = THREE.MathUtils.smoothstep(into * 0.5, STANCE, 0.5) * m;
    // (and darker as the weight comes down onto it: see stepRise)
    (this.foot.material as THREE.MeshBasicMaterial).opacity = this.fade * 0.62 * (0.35 + 0.65 * Math.max(m, moving ? 1 : 0.6)) * (1 - 0.6 * peel) * (0.85 + 0.25 * land);

    // Picking the flowers, waving, holding them out: that action's clip in place of the run (turned
    // toward the garden or the girl), the one holding the umbrella up while it is out. The umbrella
    // goes with him from card to card, held where that frame has his hand on its shaft.
    this.card.visible = !this.posing;
    this.foot.visible = !this.posing;
    const shown = this.posing ? this.clipOf(this.posing) : null;
    for (const [name, still] of Object.entries(this.poses)) {
      still.root.visible = name === shown;
      if (name !== shown) continue;
      still.show(camera, this.posingSide);
      const frame = this.clipFrame(this.posing!);
      still.showFrame(frame);
      if (this.umbrella && this.holding) {
        const at = CLIPS[shown as keyof typeof CLIPS].umbrella[frame] as readonly number[] | undefined;
        if (at) {
          const grip = CLIP_GRIP[shown] ?? 0;
          // (stood up from his hand as the clip has it: leant in over his head from his side, it read
          // as tipped over, not held)
          this.umbrella.holdIn(still.holder, at[0], at[1], -0.03, at[2], grip);
          // (turned to the side, he is not under it from the camera's view: no canopy over his head)
          this.umbrella.cover = false;
        }
      }
    }

    // His shadow on the ground, cast from whichever drawing shows.
    this.shade.update(shown ? this.poses[shown] : this, this.root, this.fade);
  }

  /** Which clip shows an action: the one with the umbrella while it is up. */
  private clipOf(kind: Pose) {
    return this.holding ? (`${kind}Rain` as const) : kind;
  }
  /** The frame of an action's clip at this moment of it (see lib/gift.ts: poseT, stoop, lift). The
   *  last two keys of waving and of picking are the moves repeated (the hand rocking, a stem lifted). */
  private clipFrame(kind: Pose) {
    const c = CLIPS[this.clipOf(kind)];
    const a = c.keys[c.keys.length - 2];
    const b = c.keys[c.keys.length - 1];
    const { t, stoop, lift } = this.posed;
    if (kind === "wave" || kind === "greet") {
      // The arm comes up, then the hand rocks out and in, a tilt each WAVE_BEAT.
      if (t < RAISE_S) return Math.round((t / RAISE_S) * a);
      const u = (t - RAISE_S) / WAVE_BEAT;
      return a + Math.round((1 - Math.abs((u % 2) - 1)) * (b - a));
    }
    if (kind === "give") return Math.round(Math.min(1, t / REACH_S) * (c.frames - 1));
    // Picking: down into the crouch, each stem lifted to the bunch, and up again. In the rain the
    // drawings between are the stem pinched, tugged free and carried up (not to be played backward):
    // the hand goes straight back down to reach for the next.
    if (lift > 0) return a + Math.round(lift * (b - a));
    if (lift < 0) return this.holding ? (lift < -0.5 ? Math.min(c.frames - 1, b + 1) : a) : a + Math.round(-lift * (b - a));
    return Math.round(stoop * a);
  }

  /** The clips of the courier picking flowers, waving and holding out the bouquet, dry and holding the
   *  umbrella, made ahead so they are loaded by the time they are needed. */
  private poses: Record<string, Still> = {};
  private posing: Pose | null = null;
  private posed = { t: 0, stoop: 1, lift: 0 };
  /** Turned toward the right of the screen (1) or the left (-1). */
  private posingSide = 1;
  prepareGift() {
    if (this.poses.give) return;
    for (const name of Object.keys(CLIPS) as (keyof typeof CLIPS)[]) {
      const still = clipPose(name);
      // (the bunch in his hand, the stem he picks, the bouquet held out: no colour of theirs is
      // anywhere else on him)
      if (name.startsWith("pick") || name.startsWith("give")) still.paintBouquet(0, 0, 10);
      still.root.traverse((o) => (o.castShadow = false));
      still.root.visible = false;
      this.root.add(still.root);
      this.poses[name] = still;
    }
  }
  /**
   * Show an action (null: running as usual), turned to `side`; t: seconds into it; stoop, lift: how far
   * down into the crouch and how far the picked stem is lifted, while picking. The drawings face left
   * (picking) and right (waving, giving).
   */
  pose(kind: Pose | null, side: number, t = 0, stoop = 1, lift = 0) {
    if (kind) this.prepareGift();
    this.posing = kind;
    this.posed.t = t;
    this.posed.stoop = stoop;
    this.posed.lift = lift;
    this.posingSide = kind === "give" || kind === "wave" || kind === "greet" ? side : -side;
  }
  /** Where the flowers are in his hand (world), in whichever drawing he is in. */
  handAt(out: THREE.Vector3) {
    const k = this.posing;
    const still = k ? this.poses[this.clipOf(k)] : undefined;
    if (!still || !k) return out.copy(this.root.position);
    const h = k === "pick" ? PICK_HAND : GIVE_HAND;
    return still.pointAt(h.x, h.y, out);
  }
  /**
   * Where water drips from when he is soaked (world): the hoodie's hem and cuffs, the bottom of the
   * satchel, the ends of his hair, as drawn from behind (card metres across and up), `i` picks which.
   */
  dripAt(i: number, out: THREE.Vector3) {
    const p = DRIPS[i % DRIPS.length];
    this.card.updateWorldMatrix(true, false);
    // (a little in front of the card: the legs are drawn up to a few centimetres nearer than it)
    return out.set(p[0], p[1], 0.09).applyMatrix4(this.card.matrixWorld);
  }
  /** Where the planted foot is on the ground (world). */
  footAt(out: THREE.Vector3) {
    return this.foot.getWorldPosition(out);
  }
  /** Where the satchel is (world): on his left hip, as drawn from behind. */
  bagAt(out: THREE.Vector3) {
    this.card.updateWorldMatrix(true, false);
    return out.set(-0.13, 0.7, 0).applyMatrix4(this.card.matrixWorld);
  }
}

/** One of the townspeople, standing; who picks which (a cell of the atlas, see content/townsfolk.ts). */
export class Townsperson extends Card {
  constructor(who: number) {
    super(FOLK_URL, 1.6, undefined, FOLK_CELLS, FOLK_ROWS);
    this.mat.map!.repeat.set(1 / FOLK_CELLS, FOLK_ROW_V);
    this.frame(who);
  }
  protected frame(i: number) {
    const row = Math.floor(i / FOLK_CELLS);
    // (v runs up from the bottom: the first row is the top one, above the gap)
    this.mat.map!.offset.set((i % FOLK_CELLS) / FOLK_CELLS, row === 0 ? FOLK_ROW_V + FOLK_GAP_V : 0);
  }
  private feeling: Mood = "waiting";
  private holding = false;
  /** A drawing of the moment between two moods, shown briefly as she changes (see mood), and how long
   *  is left of it (s). */
  private passing: Passing | null = null;
  private passLeft = 0;
  /**
   * The schoolgirl: waiting; happily surprised as the courier comes up to her; reaching out as the
   * bouquet comes to her; holding it. She passes through a drawing of the moment in between as she
   * notices him, and as the bouquet lands in her hands.
   */
  mood(m: Mood) {
    if (m === this.feeling) return;
    const from = this.feeling;
    this.feeling = m;
    this.passing = from === "waiting" && m === "surprised" ? "noticing" : from === "reaching" && m === "flowers" ? "receiving" : null;
    this.passLeft = this.passing ? PASS_S : 0;
    this.show();
  }
  /** ...and with her umbrella in her hand, or not. */
  holdUmbrella(on: boolean) {
    if (on === this.holding) return;
    this.holding = on;
    this.show();
  }
  /** Where her hand holds the umbrella, in the drawing she is in now. */
  get umbrellaHand() {
    return GIRL_UMBRELLA[this.passing ?? this.feeling];
  }
  private show() {
    const cell = GIRL_CELLS[this.passing ?? this.feeling] + (this.holding ? GIRL_RAIN : 0);
    this.frame(cell);
  }
  /** Where her hands hold the bouquet, as drawn: up from her feet (m) and across to the right (m). */
  static readonly HANDS = { up: 1.07, right: -0.075 };
  /** Greeting (wave(): a letter delivered, the courier coming up with the flowers): no jump, which
   *  looked like they bounced as he came near; a little lift onto the toes and a nod toward him. */
  private greet = 0;
  protected tickHop(dt: number) {
    this.card.position.y = 0;
    if (this.hop <= 0) {
      this.greet = 0;
      this.card.rotation.x = 0;
      return;
    }
    this.hop = Math.max(0, this.hop - dt);
    const t = 1 - this.hop / 0.6;
    const k = Math.sin(t * Math.PI);
    this.greet = 0.012 * k;
    this.card.rotation.x = -0.05 * k * k;
  }
  /** Breathing: a slow, slight rise and fall, each person on their own time. */
  private breath = Math.random() * 10;
  update(dt: number, camera: THREE.Camera) {
    this.face(camera);
    this.tickHop(dt);
    this.breath += dt;
    this.card.scale.y = 1 + 0.007 * Math.sin((this.breath * Math.PI * 2) / 3.4) + this.greet;
    if (this.passLeft > 0) {
      this.passLeft -= dt;
      if (this.passLeft <= 0) {
        this.passing = null;
        this.show();
      }
    }
  }
}

type Mood = "waiting" | "surprised" | "reaching" | "flowers";
type Passing = "noticing" | "receiving";
/** How long she holds a drawing of the moment between two moods (s). */
const PASS_S = 0.16;
/** Her drawings in the townsfolk atlas (art/pack-gift.py, art/girl-moves.py); the ones holding the
 *  umbrella are GIRL_RAIN cells on from each. */
const GIRL_CELLS: Record<Mood | Passing, number> = { waiting: 3, flowers: 4, surprised: 5, noticing: 9, reaching: 10, receiving: 11 };
const GIRL_RAIN = 3;
/**
 * Where the schoolgirl's hand holds her umbrella's shaft in each drawing (m: across, up from her feet),
 * and how far the shaft tips over (radians, top to the left as drawn): art/pack-girl-umbrella.py. The
 * reaching mood is drawn only as a moment between (art/girl-moves.py).
 */
const GIRL_UMBRELLA: Record<Mood | Passing, { x: number; y: number; tilt: number }> = {
  waiting: { x: -0.117, y: 1.073, tilt: 0.056 },
  flowers: { x: -0.139, y: 1.075, tilt: 0.121 },
  surprised: { x: -0.093, y: 1.078, tilt: 0.109 },
  // (art/girl-moves.py: where the umbrella's drawing goes on from, just inside her outline)
  noticing: { x: -0.107, y: 1.19, tilt: 0.101 },
  reaching: { x: -0.11, y: 1.21, tilt: 0.099 },
  receiving: { x: -0.11, y: 1.205, tilt: 0.104 },
};

/** Player colours softened toward the scene's greys, so they sit in the world. */
export const softTint = (color: string) => "#" + new THREE.Color(color).lerp(new THREE.Color("#8d9a96"), 0.3).getHexString();

/** A single drawing on a card, turned to the camera: a pose held for a moment, or a thing in the air. */
export class Still extends Card {
  /** `cols`, `rows`, `cell`: for a sheet of several drawings in rows, which one. */
  constructor(url: string, height: number, aspect: number, fill = 312 / 320, cols = 1, cell = 0, rows = 1) {
    super(url, height, undefined, cols, rows, undefined, 0, aspect, fill);
    this.frame(cell);
    // (no patch of shadow of its own: it stands where something else already has one, or flies)
    this.root.children[1].visible = false;
  }
  /** Show drawing `i` of the sheet. */
  showFrame(i: number) {
    this.frame(i);
  }
  /** Face the camera, drawn as is (1) or flipped left to right (-1). */
  show(camera: THREE.Camera, mirror = 1) {
    this.card.scale.x = mirror;
    this.face(camera);
  }
  /** A point on the drawing (m: across, as drawn, and up from its foot) in the world. */
  pointAt(x: number, y: number, out: THREE.Vector3) {
    this.card.updateWorldMatrix(true, false);
    return out.set(x, y, 0).applyMatrix4(this.card.matrixWorld);
  }
}

/**
 * An action's clip (art/pose-clips.py): its frames in rows, 1.4 m tall like the run. Waving is
 * drawn a little larger in its cell (620 of 640 px); the others like the run (312 of 320).
 */
export const clipPose = (name: keyof typeof CLIPS) => {
  const c = CLIPS[name];
  const fill = name.startsWith("wave") || name.startsWith("greet") ? 620 / 640 : 312 / 320;
  return new Still(`/planet/tex/clip-${name.replace("Rain", "-rain")}.webp`, 1.4, c.cell[0] / c.cell[1], fill, c.cols, 0, c.rows);
};
/** Where the bouquet is in that drawing (m from between the feet: across to the right, and up). */
export const GIVE_HAND = { x: 0.42, y: 1.1 };
/** The courier's actions besides the run: crouched picking stems, waving, holding the bouquet out,
 *  and greeting (waving with nothing in his hand: stopping by people on the walk, before the flowers). */
export type Pose = "pick" | "wave" | "give" | "greet";
/** Waving: how long the arm takes to come up (s), then each tilt of the hand. */
const RAISE_S = 0.32;
const WAVE_BEAT = 0.2;
/** How far up the umbrella's shaft he holds it in a clip (m): crouched to pick, choked up on it
 *  (resting on his shoulder) so the canopy comes down close over him. */
const CLIP_GRIP: Record<string, number> = { pickRain: 0.17 };
/** Holding the bouquet out: how long the arm takes to reach out with it (s). */
const REACH_S = 0.5;

/** Where the raised fist holding the umbrella is in each frame of that jog (card metres: across, up;
 *  art/umbrella-run.py). */
const FIST: [number, number][] = [
  [-0.168, 1.171], [-0.168, 1.162], [-0.168, 1.158], [-0.164, 1.153], [-0.164, 1.144], [-0.166, 1.145], [-0.168, 1.145], [-0.169, 1.146], [-0.171, 1.147], [-0.175, 1.147], [-0.180, 1.151], [-0.180, 1.156], [-0.184, 1.156], [-0.192, 1.170], [-0.183, 1.170], [-0.178, 1.170], [-0.178, 1.170], [-0.178, 1.170], [-0.183, 1.170], [-0.183, 1.170], [-0.192, 1.170], [-0.194, 1.161], [-0.190, 1.156], [-0.185, 1.156], [-0.185, 1.152], [-0.185, 1.159], [-0.185, 1.165], [-0.185, 1.172], [-0.185, 1.179], [-0.179, 1.174], [-0.179, 1.169], [-0.179, 1.165], [-0.179, 1.160], [-0.179, 1.160], [-0.179, 1.160], [-0.174, 1.160], [-0.174, 1.165], [-0.176, 1.165], [-0.178, 1.165], [-0.180, 1.165], [-0.182, 1.165], [-0.182, 1.165], [-0.182, 1.169], [-0.178, 1.169], [-0.178, 1.169], [-0.177, 1.179], [-0.177, 1.175], [-0.177, 1.170], [-0.177, 1.166], [-0.177, 1.161], [-0.177, 1.157], [-0.181, 1.148], [-0.181, 1.143], [-0.185, 1.146], [-0.185, 1.155], [-0.181, 1.168], [-0.181, 1.177], [-0.180, 1.177], [-0.179, 1.177], [-0.178, 1.177], [-0.177, 1.177], [-0.164, 1.162], [-0.164, 1.167], [-0.168, 1.167],
];

/** Drip points on the running courier (card metres: across, up). */
const DRIPS: [number, number][] = [[-0.17, 0.63], [0.15, 0.63], [0, 0.61], [-0.27, 0.7], [0.26, 0.72], [-0.13, 0.52], [-0.09, 1.25], [0.1, 1.24], [0.02, 1.2]];
export const DRIP_POINTS = DRIPS.length;
/** Where the bunch he has picked is in that drawing. */
export const PICK_HAND = { x: -0.27, y: 0.48 };
/** The bouquet on its own, 0.34 m tall (filling 240 px of its 256 px cell; its middle is 0.18 m up). */
export const bouquetCard = () => {
  const b = new Still(BOUQUET_URL, 0.34, 180 / 256, 240 / 256);
  b.paintBouquet(0, 0, 10);
  return b;
};
export const BOUQUET_MID = 0.18;
