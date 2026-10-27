"use client";

import { gsap } from "gsap";
import { FAST_TRAVEL_EVENT, LAP_EVENT, PERSON_AT, RUN_END, WALK_SPEED, journey, progressAt, rideTime } from "./journey";
import { MANUAL_SCROLL_EVENT, scrollPageTo, scrollsInCard, settleScrub } from "./scroll";
import { ACCEL, BRAKE, RUN } from "./locomotion";

export type AutoState = "playing" | "paused" | "done";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
/** How long the page must stand still after the visitor steers before the walk carries on (ms). */
const STEER_LET_GO = 700;
/** A move of the page by more than this (px) between frames that wasn't ours is the visitor's. */
const MOVED = 3;
/** A finger has to travel this far (px) before a touch counts as a swipe, not a tap. */
const SWIPE = 8;
/** How long the walk stops beside each person along the way (ms): time to read their card. */
const DWELL = 6_000;
/** The people along the lap, in order of the road: where each stands (m) and when the walk is there (s). */
const PEOPLE = Object.entries(PERSON_AT)
  .sort((a, b) => a[1] - b[1])
  .map(([id, s]) => ({ id, s, t: s / WALK_SPEED }));
/** How long before reaching someone the walker starts to slow (s): their braking distance, and a step. */
const SLOW_FOR = ((RUN * RUN) / (2 * BRAKE) + 0.4) / WALK_SPEED;
/** Keys that type into a field rather than scroll the page. */
const TYPING = "input, textarea, select, [contenteditable]";

/**
 * Walks the planet by itself: the walker keeps a steady pace, never pausing, and the page scrolls
 * itself to follow, so each card comes up as its landmark goes by. It stays on until the visitor
 * presses pause: a scroll, swipe or navigation key steers it (the page follows them while they do)
 * and once they let go it walks on from wherever they left it. The road goes all the way round, so
 * after the save point the walker carries on home and the page starts again from the top: an endless
 * loop.
 */
class Autopilot {
  state: AutoState = "paused";
  private listeners = new Set<(s: AutoState) => void>();
  /** The moment of the lap the page is showing (s). */
  private clock = 0;
  /** While the page swaps back to the top after a lap, it waits for the cards to fade (ms left). */
  private lapWait = 0;
  private lastY = -1;
  private held = false;
  /** The visitor is steering (scrolling) while it plays; how long the page has been still since (ms). */
  private steering = false;
  private still = 0;
  /** Where the page stood when the visitor took it. */
  private steerFrom = 0;
  /** "New game" in progress: its fast-travel fade, and whether to play when it lands. */
  private replayTimer = 0;
  private replayPlay = false;
  /** Stopped (or slowing to stop) beside someone: which (PEOPLE), and how long is left there (ms). */
  private dwell = -1;
  private dwellLeft = 0;
  /** Setting off again from someone: the clock waits while the walker gets up to pace (s left). */
  private setOff = 0;
  private wired = false;

  subscribe(fn: (s: AutoState) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(state: AutoState) {
    if (this.state === state) return;
    this.state = state;
    this.flow();
    this.listeners.forEach((fn) => fn(state));
  }

  /** The walker runs free only while the autopilot is playing and not held. */
  private flow() {
    journey.flow = this.state === "playing" && !this.held && !this.steering;
    journey.flowTime = this.clock;
  }

  private wire() {
    if (this.wired) return;
    this.wired = true;
    // ?debug exposes the autopilot so tests can step its clock in a background tab.
    if (location.search.includes("debug")) (window as unknown as { __autopilot: Autopilot }).__autopilot = this;
    // (scrolling inside a card's own text moves only the card: not a hand on the journey; nor do a
    // sideways swipe, a pinch-zoom or the small slip of a finger tapping a button)
    const inCard = (e: Event) => scrollsInCard(e.target as Element);
    window.addEventListener("wheel", (e) => Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey && !inCard(e) && this.steer(), { passive: true });
    let touchY = 0;
    window.addEventListener("touchstart", (e) => void (touchY = e.touches[0]?.clientY ?? 0), { passive: true });
    window.addEventListener("touchmove", (e) => e.touches.length === 1 && Math.abs(e.touches[0].clientY - touchY) > SWIPE && !inCard(e) && this.steer(), { passive: true });
    window.addEventListener("keydown", (e) => {
      const el = e.target as HTMLElement;
      // (Space presses a focused button or link; the arrows and page keys still scroll the page)
      if (!NAV_KEYS.has(e.key) || el?.closest?.(TYPING) || scrollsInCard(el) || (e.key === " " && el?.closest?.("button, a"))) return;
      this.steer();
    });
    window.addEventListener(MANUAL_SCROLL_EVENT, () => this.steer());
    gsap.ticker.add(this.tick);
  }

  private scrollTo(y: number) {
    scrollPageTo(y);
    this.lastY = window.scrollY;
  }

  private maxY() {
    return document.documentElement.scrollHeight - window.innerHeight;
  }

  /** Start from the top after the loader, unless the visitor prefers reduced motion or already scrolled. */
  autostart() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.scrollY > 10) return;
    this.wire();
    this.clock = 0;
    this.lastY = window.scrollY;
    this.set("playing");
  }

  play() {
    this.wire();
    const y = window.scrollY;
    // Carry on from wherever the visitor left the page (or, paused and not scrolled since, from where
    // the walker stands, so they don't step back to the page's place first).
    // (from a standstill the clock starts as far behind them as getting up to pace takes, so they
    // set off and fall in step with it, instead of falling behind and then hurrying to catch up)
    this.clock = journey.parked !== null ? (journey.parked - (RUN * RUN) / (2 * ACCEL)) / WALK_SPEED : rideTime(y / Math.max(1, this.maxY()));
    this.lastY = y;
    this.set("playing");
  }

  pause() {
    this.steering = false;
    this.replayPlay = false;
    this.endDwell();
    this.set("paused");
  }

  /** The visitor takes the page for a moment: it follows them, and walks on once they let go. */
  private steer() {
    if (this.state !== "playing" || this.held) return;
    this.still = 0;
    if (this.steering) return;
    // (taking the page cuts a stop short: the walker goes where they scroll)
    this.endDwell();
    this.steering = true;
    this.steerFrom = window.scrollY;
    this.flow();
  }

  toggle() {
    if (this.state === "playing") this.pause();
    else this.play();
  }

  /** "Press start": set off now (the run is usually already going). */
  go() {
    if (this.state !== "playing") this.play();
  }

  /** Back home and play again: a fast-travel fade, like a game, rather than running the whole way back. */
  replay() {
    this.wire();
    this.replayPlay = true;
    // (pressed twice: the one fast-travel)
    if (this.replayTimer) return;
    this.steering = false;
    this.endDwell();
    const held = this.held;
    this.held = true;
    this.flow();
    window.dispatchEvent(new Event(FAST_TRAVEL_EVENT));
    this.replayTimer = window.setTimeout(() => {
      this.replayTimer = 0;
      this.scrollTo(0);
      settleScrub();
      journey.target = journey.current = 0;
      journey.teleport++;
      this.clock = 0;
      this.lapWait = 0;
      this.held = held;
      // (unless paused while it travelled)
      if (this.replayPlay) this.set("playing");
      this.flow();
    }, 550);
  }

  /**
   * Carry on from where the walker now stands (m along the road), after it stopped somewhere of its
   * own accord: the clock (if playing) and the page move there, so the walk doesn't pull it back.
   */
  resumeAt(s: number) {
    const t = s / WALK_SPEED;
    const p = clamp(progressAt(t), 0, 1);
    if (this.state === "playing") this.clock = t;
    journey.target = journey.current = p;
    this.scrollTo(p * this.maxY());
    if (this.state === "playing") journey.flowTime = this.clock;
  }

  /** The stop whose person the walk is stopping beside (BLOCKS id), or null. */
  get visiting() {
    return this.dwell >= 0 ? PEOPLE[this.dwell].id : null;
  }

  /** Walk on from beside someone (or forget about stopping there). */
  private endDwell() {
    if (this.dwell < 0) return;
    this.dwell = -1;
    journey.stopAt = null;
  }

  /** Freeze in place (e.g. while a project is open) without giving up control. */
  hold(on: boolean) {
    this.held = on;
    if (!on) this.lastY = window.scrollY;
    this.flow();
  }

  private tick = (_time: number, deltaMs: number) => {
    if (this.state !== "playing" || this.held) return;
    // Anything that moved the page other than us (scrollbar drag, find-in-page, a link) steers too.
    if (!this.steering && Math.abs(window.scrollY - this.lastY) > MOVED) this.steer();
    if (this.steering) {
      // (following the visitor: once the page has stood still for STEER_LET_GO, walk on from there)
      if (Math.abs(window.scrollY - this.lastY) > 0.5) this.still = 0;
      else this.still += deltaMs;
      this.lastY = window.scrollY;
      if (this.still < STEER_LET_GO) return;
      this.steering = false;
      // (walking on from where they left the page; if they left it where the walk had it, as on the
      // way home with the page already at the bottom, the walk carries on, not back to the last stop)
      const max = Math.max(1, this.maxY());
      const y = window.scrollY;
      if (Math.abs(y - this.steerFrom) > MOVED && Math.abs(y - clamp(progressAt(this.clock), 0, 1) * max) > MOVED) {
        this.clock = rideTime(y / max);
        this.lapWait = 0;
      }
      this.flow();
      return;
    }
    const dt = Math.min(deltaMs / 1000, 0.1);
    // Beside someone: the walker pulls up by them (the rig brakes to journey.stopAt) and the page
    // comes to rest on their card, for DWELL; a details view open meanwhile holds the count (see hold).
    if (this.dwell >= 0) {
      const at = PEOPLE[this.dwell];
      this.clock = Math.min(at.t, this.clock + dt);
      this.dwellLeft -= deltaMs;
      journey.flowTime = this.clock;
      this.scrollTo(clamp(progressAt(this.clock), 0, 1) * this.maxY());
      if (this.dwellLeft > 0) return;
      this.endDwell();
      // (the clock starts as far behind them as getting up to pace takes, so they set off at a walk
      // and fall in step with it, instead of hurrying to catch up)
      this.setOff = RUN / (2 * ACCEL);
      return;
    }
    const before = this.clock;
    const wait = Math.min(this.setOff, dt);
    this.setOff -= wait;
    this.clock += dt - wait;
    // (coming up to someone: start slowing, to stop beside them)
    const next = PEOPLE.findIndex((p) => before < p.t - SLOW_FOR && this.clock >= p.t - SLOW_FOR);
    if (next >= 0) {
      this.dwell = next;
      this.dwellLeft = DWELL + SLOW_FOR * 1000;
      journey.stopAt = PEOPLE[next].s;
    }
    if (this.clock >= RUN_END) {
      // Round the planet and back at the front door: the walker keeps going; the page fades its
      // last card and starts again from the top.
      this.clock -= RUN_END;
      this.lapWait = 320;
      window.dispatchEvent(new Event(LAP_EVENT));
    }
    journey.flowTime = this.clock;
    if (this.lapWait > 0) {
      this.lapWait -= deltaMs;
      if (this.lapWait > 0) return;
      journey.target = journey.current = clamp(progressAt(this.clock), 0, 1);
      journey.teleport++;
      this.scrollTo(clamp(progressAt(this.clock), 0, 1) * this.maxY());
      settleScrub();
      return;
    }
    this.scrollTo(clamp(progressAt(this.clock), 0, 1) * this.maxY());
  };
}

export const autopilot = new Autopilot();
