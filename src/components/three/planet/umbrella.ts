import * as THREE from "three";
import { Still } from "./sprite";

/**
 * An umbrella for the rain, drawn (Codex, art/pack-umbrella8.py and art/pack-umbrella14.py): fourteen
 * drawings of it opening, from furled with its strap fastened, through the strap loosening and undone,
 * a bud, a cone, to a domed canopy, seen from behind and a little below, its shaft running down to the
 * foot of the card. It is held on the card of whoever carries it, just behind them (so their head and hand
 * come in front of its shaft): the courier holds it up in his raised fist (sprite.ts, the umbrella
 * jog), the schoolgirl over her shoulder. Held low over the head of someone seen from behind (the
 * courier running away from the camera), its canopy is also drawn in front of them (`cover`): the
 * near half of a real canopy hides the top of the head under it, and only the bit of shaft between
 * the hand and the rim shows.
 */
const RED = "/planet/tex/umbrella.webp";
const BLUE = "/planet/tex/umbrella-blue.webp";
/** The same drawings with the shaft under the canopy taken out (art/umbrella-top.py). */
const RED_TOP = "/planet/tex/umbrella-top.webp";
const BLUE_TOP = "/planet/tex/umbrella-blue-top.webp";
/** How far in front of the full drawing the canopy-only one lies (m): in front of the holder's head. */
const COVER_Z = 0.085;
/** A drawing's cell (m), the shaft's foot at its bottom centre (art/pack-umbrella.py). */
const CELL_W = 1.101;
const CELL_H = 1.217;
/** The open canopy: where the middle of its rim is above the shaft's foot, and how far it reaches. */
const RIM_Y = 0.727;
const REACH = 0.485;
/** The rib tips along the open canopy's lower edge (m, from the shaft's foot), where the rain runs off. */
const TIPS: [number, number][] = [[-0.47, 0.727], [-0.467, 0.538], [-0.209, 0.401], [0.209, 0.401], [0.472, 0.547], [0.481, 0.727]];
export const TIP_POINTS = TIPS.length;

/** How many drawings there are of it opening (art/pack-umbrella14.py), in rows of COLS; the first
 *  FURL_CELLS of them furled (fastened, the strap loosening, undone), then opening out. */
const CELLS = 14;
const COLS = 8;
const FURL_CELLS = 3;
/** How long opening takes (s), and furling; how far open it is while still furled (coming out of the
 *  bag, the strap undone); and the shake that flicks the rain off once furled (s, twists). */
const OPEN_S = 0.62;
const FURL_S = 0.62;
const FURLED = 0.24;
/** How much slower it goes while furled, coming out and being put away. */
const STOW_RATE = 0.42;
/** The shake (s from its start, radians about the wrist, + top to the left): wound back 14 degrees,
 *  flicked out hard to 34 (held there a beat), a rebound of 11, settled. */
const SHAKE: [number, number][] = [[0, 0], [0.1, -0.24], [0.19, 0.6], [0.24, 0.58], [0.36, -0.2], [0.52, 0]];
const SHAKE_S = 0.52;
/** The cloth's spring as it snaps taut: stiffness, damping, and the kick that stretches it ~9% past
 *  its shape (then it recoils a little under, and settles). */
const TAUT_K = 300;
const TAUT_DAMP = 0.38;
const TAUT_KICK = 40;
/**
 * Carried: the canopy has weight on the end of its shaft. As the hand carrying it moves, the canopy
 * lags it and swings past (radians of tilt per m/s² the hand moves sideways), and its ribs give as the
 * hand dips into each step and lifts out of it (the cloth flexing down at the edges, then springing
 * back): a spring for the flex, its stiffness and damping, and how much of the hand's rise and fall
 * goes into it.
 */
const SWING = 0.12;
const FLEX_K = 340;
const FLEX_DAMP = 0.32;
const FLEX_IN = 0.0025;
/**
 * A damped spring (stiffness k, damping ratio `damp`, pushed by `push`) stepped on over dt: its place
 * and speed after. In steps of at most 1/240 s, so it stays steady however long the frame; stepped
 * once a frame, a slow one (up to a quarter of a second) threw the stiff ones off to infinity, and
 * the umbrella went with them.
 */
const _sp = new THREE.Vector2();
const spring = (x: number, v: number, k: number, damp: number, push: number, dt: number) => {
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  const c = 2 * Math.sqrt(k) * damp;
  for (let i = 0; i < n; i++) {
    v += (-k * x - c * v + push) * h;
    x += v * h;
  }
  return _sp.set(x, v);
};

/** A value eased (in and out) between keys [t, v]. */
const keyed = (keys: [number, number][], t: number) => {
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u))));
    }
  }
  return keys[keys.length - 1][1];
};

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** The shaft as drawn, across its width (sRGB, art/pack-umbrella14.py's open cell), and how wide it is (m). */
const SHAFT_INK = ["#2f3838", "#24302e", "#394744", "#475552", "#586664", "#475351"];
const SHAFT_W = 0.022;
/** Up to where the shaft shows below the open canopy, seen from below (m above its foot). */
const SHAFT_TO = 0.45;

export class Umbrella {
  private cells: Still[];
  /** The shaft between the hand and the canopy drawn again in front of the holder (see shaftInFront). */
  private front?: THREE.Mesh;
  private tops: Still[];
  /** Draw the canopy over the holder's head too (seen from behind, it is between them and the camera). */
  cover = false;
  /** Placed at the hand that holds it, and turned about it. */
  readonly root = new THREE.Group();
  /** The drawings, slid down the shaft so the hand grips it `grip` metres above its foot. */
  private body = new THREE.Group();
  /** 0 put away, 1 open. */
  private open = 0;
  /** The cloth snapping taut as it opens (a spring: stretched wide past its shape, then settling). */
  private taut = 0;
  private tautV = 0;
  /** Shaken out once furled, the rain flicked off (s left), and the drops thrown off this frame. */
  private shakeT = 0;
  private shook = false;
  flung = 0;
  /** The tilt as held, sprung: it follows the hand's lean a moment late and rocks a little past it. */
  private ang = 0;
  private angV = 0;
  private t = 0;
  /** Where the hand holds it (in its holder's drawing), and how far it still is from there, having
   *  been taken from another hand (eased away: it moves over, not jumps). */
  private at = new THREE.Vector3();
  private slide = new THREE.Vector2();
  private gripWant = 0;
  /** How the hand carrying it rides with the body (see carry), last frame's place, its speed and
   *  how it is speeding up; and the ribs' flex. */
  private carried = new THREE.Vector2();
  private hand = new THREE.Vector2(NaN, NaN);
  private handV = new THREE.Vector2();
  private handA = new THREE.Vector2();
  private flex = 0;
  private flexV = 0;

  /**
   * lean: how far it tips over (radians, top to the left as the camera sees it); grip: how far up the
   * shaft from its foot the hand holds it (m; the foot is lost behind the hand and body); size: how
   * big it is drawn (1: the 1 m canopy of an adult's umbrella).
   */
  constructor(blue = false, public lean = -0.07, grip = 0, size = 1) {
    // (one card per drawing, so each is loaded and ready to show at once)
    const card = (url: string, i: number) => {
      const c = new Still(url, CELL_H, CELL_W / CELL_H, 1, COLS, i, Math.ceil(CELLS / COLS));
      // (its shadow on the ground is left to the light: under rain clouds there is none to speak of)
      c.root.traverse((o) => (o.castShadow = false));
      c.root.visible = false;
      this.body.add(c.root);
      return c;
    };
    const all = Array.from({ length: CELLS }, (_, i) => i);
    this.cells = all.map((i) => card(blue ? BLUE : RED, i));
    this.tops = all.map((i) => card(blue ? BLUE_TOP : RED_TOP, i));
    for (const c of this.tops) c.root.position.z = COVER_Z;
    this.body.scale.setScalar(size);
    this.grip = grip;
    this.gripWant = grip;
    this.root.add(this.body);
    this.root.visible = false;
  }

  /**
   * Held in `parent`'s hand at (x, y, z) of it, tipped `lean`, gripped `grip` up the shaft. Taken from
   * another hand (another drawing), it goes on from just where it was, and on over to the new hand
   * within a moment, its tilt sprung from the tilt it had.
   */
  holdIn(parent: THREE.Object3D, x: number, y: number, z: number, lean: number, grip: number) {
    if (this.root.parent !== parent) {
      const was = this.root.parent;
      if (was && this.root.visible) {
        this.root.updateWorldMatrix(true, false);
        _a.setFromMatrixPosition(this.root.matrixWorld);
        _b.set(0, 1, 0).applyMatrix4(this.root.matrixWorld);
        parent.add(this.root);
        parent.updateWorldMatrix(true, false);
        parent.worldToLocal(_a);
        parent.worldToLocal(_b);
        this.slide.set(_a.x - x, _a.y - y);
        // (its tilt as it was, as seen in the new drawing, which may be the other way round)
        this.ang = Math.atan2(-(_b.x - _a.x), _b.y - _a.y);
      } else {
        parent.add(this.root);
        this.slide.set(0, 0);
        this.ang = lean;
        this.angV = 0;
        this.grip = grip;
      }
    }
    this.at.set(x, y, z);
    this.lean = lean;
    this.gripWant = grip;
  }

  /**
   * up: whether it should be up. It comes out furled, the strap is undone, and it opens out through
   * the drawings slowly at first and faster as the runner goes up, till the cloth snaps taut (and
   * stretches a touch past its shape, and settles). Furling is the same way back, quicker as it
   * collapses; then it is given a shake to flick the rain off, and put away. Turned round at any
   * moment (the rain starting again), it goes back from where it is. sway: radians this frame (it rocks
   * a touch with the stride).
   */
  update(dt: number, up: boolean, sway = 0) {
    const was = this.open;
    if (up) {
      this.shakeT = 0;
      this.shook = false;
    }
    // (held still while it is shaken out)
    const hold = !up && this.shakeT > 0;
    // (taken out from behind the back and put away there more slowly than it opens and furls: a
    // carry down an arm's length, not a blink)
    const slow = this.open < FURLED ? STOW_RATE : 1;
    if (!hold) this.open = THREE.MathUtils.clamp(this.open + (up ? dt / OPEN_S : -dt / FURL_S) * slow, 0, 1);
    // Snapping taut: a kick to the cloth's spring as the last ribs lock (it stretches some 9% past its
    // shape, recoils, and settles in about a third of a second), and the canopy rocks a little on it.
    if (was < 1 && this.open >= 1) {
      this.tautV += TAUT_KICK;
      this.angV += 0.7 * Math.sign(this.lean || -1);
    }
    // Shaken out once furled, while the strap is still loose (only if it was out in the rain).
    if (!up && was >= FURLED && this.open < FURLED && !this.shook) {
      this.open = FURLED - 1e-4;
      this.shakeT = SHAKE_S;
      this.shook = true;
    }
    if (this.open <= 0) this.shook = false;
    spring(this.taut, this.tautV, TAUT_K, TAUT_DAMP, 0, dt);
    this.taut = _sp.x;
    this.tautV = _sp.y;
    const o = this.open;
    this.root.visible = o > 0;
    this.flung = 0;
    if (!this.root.visible) return;
    const cell = this.cellAt(o, up);
    this.cells.forEach((c, i) => (c.root.visible = i === cell));
    // (the canopy over the head only while it is a canopy: not furled, nor being put away behind them)
    this.tops.forEach((c, i) => (c.root.visible = this.cover && o >= FURLED && i === cell));
    // (the shaft in front of them only once it is up in their hand, not while it comes out from
    // behind them or is put away there)
    if (this.front) this.front.visible = o >= 0.14 && !(this.shakeT > 0);
    // Coming out: brought up from behind their back, along an arc (the length of it kept: it is hidden
    // behind them, not shrunk); put away the same way back down.
    const rise = THREE.MathUtils.smoothstep(o, 0, 0.14);
    const away = 1 - rise;
    // Anticipation, opening: the hand dips a moment (the thumb on the catch), then thrusts it up as
    // the runner goes.
    const dip = up && o > 0.14 && o < FURLED ? -0.03 * Math.sin((Math.PI * (o - 0.14)) / (FURLED - 0.14)) : 0;
    const thrust = up && o >= FURLED && o < 0.55 ? 0.025 * Math.sin((Math.PI * (o - FURLED)) / (0.55 - FURLED)) : 0;
    // (and the cloth breathing a touch in the wind once it is open)
    this.t += dt;
    const flutter = 0.008 * o * Math.sin(this.t * 4.3) * Math.sin(this.t * 1.7 + 1);
    // How the hand carrying it moves with the body (smoothed a little).
    const hx = this.carried.x;
    const hy = this.carried.y;
    if (dt > 0 && Number.isFinite(this.hand.x) && was > 0) {
      const vx = (hx - this.hand.x) / dt;
      const vy = (hy - this.hand.y) / dt;
      const k = 1 - Math.exp(-dt / 0.035);
      this.handA.x += (THREE.MathUtils.clamp((vx - this.handV.x) / dt, -40, 40) - this.handA.x) * k;
      this.handA.y += (THREE.MathUtils.clamp((vy - this.handV.y) / dt, -40, 40) - this.handA.y) * k;
      this.handV.set(vx, vy);
    } else {
      this.handV.set(0, 0);
      this.handA.set(0, 0);
    }
    this.hand.set(hx, hy);
    // The ribs give as the hand pulls it down into a step and lifts it out of one (+ flexed down).
    spring(this.flex, this.flexV, FLEX_K, FLEX_DAMP, this.handA.y * FLEX_IN * FLEX_K * 0.1, dt);
    this.flex = THREE.MathUtils.clamp(_sp.x, -0.04, 0.04);
    this.flexV = _sp.y;
    const give = this.flex * THREE.MathUtils.smoothstep(o, FURLED, 1);
    this.root.scale.set(1 + 0.06 * this.taut + flutter + give * 0.5, (1 - 0.02 * this.taut) * (1 - flutter * 0.5) * (1 - give), 1);
    // The shake: wound back, flicked out hard, a rebound, settled (radians, about the wrist), drops
    // flung off as it turns at the end of the flick and of the rebound.
    let shake = 0;
    if (this.shakeT > 0) {
      const before = SHAKE_S - this.shakeT;
      this.shakeT = Math.max(0, this.shakeT - dt);
      const now = SHAKE_S - this.shakeT;
      shake = keyed(SHAKE, now);
      if (before < SHAKE[2][0] && now >= SHAKE[2][0]) this.flung = 14;
      else if (before < SHAKE[4][0] && now >= SHAKE[4][0]) this.flung = 5;
    }
    // The tilt: sprung toward where the hand holds it (a light frame on a stick, so it trails the
    // hand a moment and settles with a small rock), straight there as it first comes out.
    // (and swung by the hand carrying it: the canopy, heavy on the end of the shaft, trails the hand
    // as it goes one way and swings past as it comes back)
    const want = this.lean + sway + THREE.MathUtils.clamp(this.handA.x * SWING, -0.12, 0.12) * THREE.MathUtils.smoothstep(o, FURLED, 1);
    if (was === 0 || dt <= 0) {
      this.ang = want;
      this.angV = 0;
    } else {
      const k = 90;
      spring(this.ang - want, this.angV, k, 0.45, 0, dt);
      this.ang = want + _sp.x;
      this.angV = _sp.y;
    }
    // (a shake, and the arc it is put away along, are the wrist's own doing: followed straight)
    this.root.rotation.z = this.ang + shake - 0.35 * away;
    // Over to the hand holding it now (a quick ease, no overshoot), sliding up or down the shaft too.
    const ease = 1 - Math.exp(-dt / 0.09);
    this.slide.multiplyScalar(1 - ease);
    this.grip += (this.gripWant - this.grip) * ease;
    this.root.position.set(this.at.x + this.slide.x + 0.12 * away, this.at.y + this.slide.y - 0.95 * away + dip + thrust, this.at.z);
  }

  /** Which drawing shows, `o` of the way open: furled while it comes out (and its strap undone, once
   *  there is a drawing of that), then opening, slow off the catch and quicker as the runner goes;
   *  furling, it keeps its spread a moment and then collapses. */
  private cellAt(o: number, up: boolean) {
    // (shaken out with the strap undone)
    if (this.shakeT > 0) return FURL_CELLS - 1;
    // Coming out, the strap loosens and comes undone on the way up; put away, it is fastened again
    // late, once it is down behind them.
    if (o < FURLED) {
      const f = o / FURLED;
      return up ? (f > 0.75 ? 2 : f > 0.45 ? 1 : 0) : f > 0.5 ? 2 : f > 0.25 ? 1 : 0;
    }
    // (the last drawing, taut, only once it is right open: it snaps there)
    if (o >= 1) return CELLS - 1;
    const u = Math.pow((o - FURLED) / (1 - FURLED), up ? 1.15 : 0.6);
    return FURL_CELLS + Math.min(CELLS - 2 - FURL_CELLS, Math.floor(u * (CELLS - 1 - FURL_CELLS)));
  }

  /** How far the hand carrying it has moved with the body's rhythm this frame (m on the holder's
   *  card; the smooth sway and bob, not the drawn arm's own small jumps), so it swings with it. */
  carry(x: number, y: number) {
    this.carried.set(x, y);
  }

  /** Taken into another hand (another drawing): held at its new tilt at once, not swung there. */
  settle() {
    this.ang = this.lean;
    this.angV = 0;
  }

  /**
   * Draw the shaft from the hand up to the canopy again, `z` m in front of the holder's card. Held
   * against someone's shoulder, seen from the front (the schoolgirl), the shaft goes up past their
   * shoulder and hair, in front of them; with the whole drawing behind them it seemed to grow out
   * from behind their shoulder rather than from their hand.
   */
  shaftInFront(z: number) {
    if (this.front) return;
    const c = document.createElement("canvas");
    c.width = SHAFT_INK.length;
    c.height = 1;
    const g = c.getContext("2d")!;
    SHAFT_INK.forEach((ink, i) => {
      g.fillStyle = ink;
      g.fillRect(i, 0, 1, 1);
    });
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(SHAFT_W, SHAFT_TO).translate(0, SHAFT_TO / 2, 0);
    this.front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, fog: true, side: THREE.DoubleSide }));
    this.front.position.z = z;
    this.front.visible = false;
    this.body.add(this.front);
  }

  /** How far up the shaft from its foot it is held (m). */
  get grip() {
    return -this.body.position.y;
  }
  set grip(m: number) {
    this.body.position.y = -m;
  }

  /** How far it is open (0..1). */
  get amount() {
    return this.open;
  }

  /** Fully open (rain runs off its rim, and none falls under it). */
  get isOpen() {
    return this.open >= 1;
  }

  /** The shelter under it (world): the middle of the rim (xyz) and how far it reaches (w), 0 when down. */
  shelter(out: THREE.Vector4) {
    if (!this.root.visible || this.open < 0.85) return out.set(0, 0, 0, 0);
    this.body.updateWorldMatrix(true, false);
    _p.set(0, RIM_Y, 0).applyMatrix4(this.body.matrixWorld);
    return out.set(_p.x, _p.y, _p.z, REACH * this.body.scale.x);
  }

  /** The tip of rib `i` on the open canopy's lower edge (world), where the rain runs off. */
  rimAt(i: number, out: THREE.Vector3) {
    const t = TIPS[i % TIPS.length];
    this.body.updateWorldMatrix(true, false);
    return out.set(t[0], t[1], 0).applyMatrix4(this.body.matrixWorld);
  }

  dispose() {
    if (this.front) {
      this.front.geometry.dispose();
      const m = this.front.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.cells.forEach((c) => c.dispose());
    this.tops.forEach((c) => c.dispose());
  }
}
