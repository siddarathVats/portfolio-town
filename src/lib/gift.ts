"use client";

import * as THREE from "three";

/**
 * The flowers, once every lap: on the forest trail the courier stops at a bed of wild flowers by the
 * path, crouches and picks a bunch, and a few steps on stops by the girl waiting by the bench and
 * gives it to her. The scene runs the moment (Planet's Npcs and the Runner); this holds where it has
 * got to. When the courier comes round to the flowers again, she is back to waiting, the flowers have
 * grown back, and it all happens again.
 *
 *   ready → toGarden (runs up and stops) → picking (crouched, the stems going one by one) → got (up
 *   again, the bunch held in front of him) → carrying → waving (she notices him and calls out; he
 *   stops and waves back) → walking (walks up beside her) → saying (his line to her, typed
 *   out over his head) → offer (holds it out) → toss (from his hand to hers) → thanks (she hugs it, hops, hearts rise) → given
 */
export type GiftPhase = "ready" | "toGarden" | "picking" | "got" | "carrying" | "waving" | "walking" | "saying" | "offer" | "toss" | "thanks" | "given";

/** The girl (the schoolgirl drawing), as a person in the plan. */
export const GIFT_TO = "girl";
/** Where, from the forest trail's stop (m along the path), the courier picks the flowers and the girl waits.
 *  (The camera is some 5 m behind him while he picks: any nearer the bridge, it is still on it, and
 *  the parapet fills a corner of the picture.) */
export const PICK_AT = 1.2;
export const GIRL_AT = 4.5;

/** What he says to her as he gives them, typed out a letter at a time (TYPE_CPS a second), then held
 *  up for SAY_HOLD_S before he holds the flowers out. */
export const GIFT_LINE = "Hey Princy! A little flowers, a little love ☕️";
export const TYPE_CPS = 17;
export const SAY_HOLD_S = 0.9;

let segmenter: Intl.Segmenter | null | undefined;
/** A line's characters as they are seen (an emoji, with its variation selector, is one). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return segmenter ? Array.from(segmenter.segment(text), (x) => x.segment) : Array.from(text);
}

/** Seconds each step lasts. */
export const PICK_S = 2;
/** When, into the picking, each of the three stems comes away (s); the hand pinches it, tugs it free
 *  and carries it up to the bunch for the first LIFT_UP of LIFT_S after, then reaches down again. */
export const PICK_TIMES = [0.3, 0.8, 1.3];
export const LIFT_S = 0.42;
const LIFT_UP = 0.6;
/** How long bending down into the crouch takes, and getting up again (s). */
export const STOOP_S = 0.26;
export const GOT_S = 0.5;
export const OFFER_S = 1.1;
/** How long he waves back at her, once stopped (s), and each tilt of the waving hand. */
export const WAVE_S = 1.4;
export const WAVE_BEAT = 0.2;
export const TOSS_S = 0.55;
export const THANKS_S = 1.7;
/** Longest the courier may take to pull up somewhere before carrying on anyway. */
export const WALK_UP_S = 4;

class Gift {
  phase: GiftPhase = "ready";
  /** Seconds into the current phase. */
  t = 0;
  /** Which side of the screen the garden or the girl is on (1 right, -1 left): the way he turns. */
  side = 1;
  /** How far across the road the courier steps toward them as they stop (m, + to the road's right). */
  lat = 0;
  /** Seconds he has been waving back at her (counted while stopped). */
  waved = 0;
  /** Where the bouquet is in the courier's hand, picking or holding it out (world; set by the Runner). */
  readonly hand = new THREE.Vector3();
  /** Where the satchel is (world; set by the Runner): the bouquet goes in there. */
  readonly bag = new THREE.Vector3();
  /** Where the girl stands (world), and whether the camera should keep her in the picture with him
   *  (1 while she is part of the scene: see Runner). */
  readonly frame = new THREE.Vector3();
  framing = 0;

  go(phase: GiftPhase) {
    this.phase = phase;
    this.t = 0;
  }

  /** Which action the courier is in (sprite.ts plays its clip): crouched picking, waving back,
   *  holding the bouquet out; or none (running, or standing as he runs). */
  get pose(): "pick" | "wave" | "give" | null {
    if (this.phase === "picking") return "pick";
    if (this.phase === "waving") return this.waved <= 0 || this.waved > WAVE_S ? null : "wave";
    return this.phase === "offer" ? "give" : null;
  }
  /** Seconds into that action. */
  get poseT() {
    return this.phase === "waving" ? this.waved : this.t;
  }
  /** Picking: how far down into the crouch he is (0 standing, 1 right down): he bends down at the
   *  start and gets up again at the end. */
  get stoop() {
    if (this.phase !== "picking") return 1;
    return THREE.MathUtils.clamp(Math.min(this.t, PICK_S - this.t) / STOOP_S, 0, 1);
  }
  /** Picking: how far his hand has brought the stem just picked up to the bunch (0..1), and then, as
   *  a negative number, how far it still is up there as it reaches down for the next (-1..0). */
  get lift() {
    if (this.phase !== "picking") return 0;
    for (const t0 of PICK_TIMES) {
      const u = (this.t - t0) / LIFT_S;
      if (u >= 0 && u < LIFT_UP) return u / LIFT_UP;
      if (u >= LIFT_UP && u < 1) return -(1 - u) / (1 - LIFT_UP);
    }
    return 0;
  }
  /** Whether the courier is stopped for the flowers (so they step over to that side of the road). */
  get stopping() {
    return ["toGarden", "picking", "got", "waving", "walking", "saying", "offer", "toss", "thanks"].includes(this.phase);
  }
}

export const gift = new Gift();
// ?debug: tests read where the flowers have got to.
if (typeof window !== "undefined" && location.search.includes("debug")) (window as unknown as { __gift: Gift }).__gift = gift;
