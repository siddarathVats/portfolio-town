"use client";

import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BLOCKS, FAST_TRAVEL_EVENT, journey, routeS } from "./journey";

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
export const getLenis = () => lenis;

/** Where the walk last put the page (px), to the fraction: see scrollPageTo. */
let exact = NaN;

/**
 * Put the page at y (px), at once: how the autopilot moves it each frame. The browser keeps the page's
 * scroll in whole pixels, so its steady 2.9 px a frame comes through as 3, 3, 2, 3, ...; the exact
 * place is kept here for the cards and the walk to read instead (below).
 */
export function scrollPageTo(y: number) {
  exact = y;
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
}

/**
 * The page's scroll as the cards and the walk read it: to a fraction of a pixel. Read as the browser
 * keeps it, whole pixels, the cards (scrubbed by it) slid in and out at a speed that stuttered by a
 * third from frame to frame. Where the walk put the page, if it is still there (within the rounding);
 * else where Lenis's smooth scrolling has it; else the page's own.
 */
if (typeof window !== "undefined")
  ScrollTrigger.scrollerProxy(document.documentElement, {
    scrollTop(value?: number) {
      if (arguments.length && value !== undefined) return scrollPageTo(value);
      const y = window.scrollY;
      if (Math.abs(exact - y) < 1) return exact;
      return lenis && Math.abs(lenis.animatedScroll - y) < 1.5 ? lenis.animatedScroll : y;
    },
    // (the viewport, as for the page's own scroll)
    getBoundingClientRect: () => ({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }),
  });

/** Fired when the visitor navigates somewhere themselves, so the autopilot hands over control. */
export const MANUAL_SCROLL_EVENT = "journey:manual-scroll";
const manual = () => window.dispatchEvent(new Event(MANUAL_SCROLL_EVENT));

/**
 * Is this a card's text with more in it than shows (so a wheel or swipe over it scrolls the text,
 * not the journey)? A card whose text fits passes the wheel on to the page like the rest of it. A
 * details view counts too: the page is held while it is open, and Lenis would swallow its swipes.
 */
export const scrollsInCard = (node: Element | null) => {
  const body = node?.closest?.(".panel__body, .dialog__inner");
  return !!body && body.scrollHeight > body.clientHeight + 1;
};

/**
 * Lenis marks the page "lenis-scrolling" while it moves, taking its classes off <html> and putting them
 * back each time. The autopilot moves the page every frame, so that flipped on and off every frame, and
 * each change to <html>'s classes restyles the whole page (~30 ms on an Iris Xe laptop: the walk ran at
 * 13 fps, unevenly). Nothing here styles by it (lenis.css only uses -smooth for iframes, of which there
 * are none), so <html> keeps just "lenis" and "lenis-stopped" (which locks the page while a details view
 * is open), changed only when stopped is.
 */
function keepRootClassesStill(l: Lenis) {
  const root = l.rootElement;
  // (a private method of Lenis's, replaced on this one instance)
  const own = l as unknown as { updateClassName: () => void };
  own.updateClassName = () => {
    if (!root.classList.contains("lenis")) root.classList.add("lenis");
    if (root.classList.contains("lenis-stopped") !== l.isStopped) root.classList.toggle("lenis-stopped", l.isStopped);
  };
  own.updateClassName();
}

/**
 * The walk goes into the picture, up the screen, so pushing "up" walks on: the arrow and page keys and
 * the wheel are turned round from a page's (a page scrolls on with "down"), so that Up walks forward
 * and Down walks back. A touch swipe keeps a page's way round (the finger drags the world toward you),
 * as does Space (on, as everywhere). Scrolling the text in a card keeps its own way too.
 */
const KEY_WAY: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
/** How far an arrow press goes (px); a page key goes most of a screen. */
const ARROW_STEP = 140;

/** Smooth scrolling (skipped for reduced motion) + one master ScrollTrigger feeding journey.target. */
export function startScroll(): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  journey.reducedMotion = reduce;

  let raf: ((time: number) => void) | null = null;
  if (!reduce) {
    // (wheelMultiplier -1: the wheel turned round, see KEY_WAY)
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true, syncTouch: false, wheelMultiplier: -1, prevent: scrollsInCard });
    keepRootClassesStill(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    raf = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
  }

  // The keys, turned round (KEY_WAY): not while typing, in a card's own text, or with the page held
  // (a details view open). Presses in quick succession add up, each going on from where the last was
  // headed (read back from Lenis, the second of a quick run went no further than the first).
  let keyTo = 0;
  let keyAt = -1e9;
  const onKey = (e: KeyboardEvent) => {
    const way = KEY_WAY[e.key];
    const el = e.target as HTMLElement | null;
    if (!way || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (el?.closest?.("input, textarea, select, [contenteditable], dialog") || scrollsInCard(el) || lenis?.isStopped) return;
    e.preventDefault();
    const step = way * (e.key.startsWith("Page") ? window.innerHeight * 0.85 : ARROW_STEP);
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const from = e.timeStamp - keyAt < 700 ? keyTo : window.scrollY;
    keyTo = Math.min(max, Math.max(0, from + step));
    keyAt = e.timeStamp;
    if (lenis) lenis.scrollTo(keyTo);
    else window.scrollTo(0, keyTo);
  };
  window.addEventListener("keydown", onKey);
  // (without the smooth scrolling, for reduced motion, the wheel is turned round here)
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || scrollsInCard(e.target as Element)) return;
    e.preventDefault();
    window.scrollBy(0, -e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1));
  };
  if (!lenis) window.addEventListener("wheel", onWheel, { passive: false });

  const master = ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (self) => {
      journey.target = self.progress;
    },
  });
  journey.target = master.progress;
  journey.current = master.progress;

  // ?debug exposes the journey state so tests can jump the camera without waiting for damping (and
  // ?fps, to measure the walk's smoothness as it really runs).
  if (/[?&](debug|fps)/.test(location.search)) Object.assign(window, { __journey: journey, __ST: ScrollTrigger });

  const fine = window.matchMedia("(pointer: fine)").matches;
  const onMove = (e: PointerEvent) => {
    journey.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    journey.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  if (fine) window.addEventListener("pointermove", onMove, { passive: true });

  return () => {
    master.kill();
    if (raf) gsap.ticker.remove(raf);
    lenis?.destroy();
    lenis = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", onWheel);
  };
}

/**
 * After a jump of the page (the lap back to the top, fast travel): settle every scrubbed card where the
 * new scroll puts it at once. Left to catch up (scrub), each card on the way would play backwards
 * through its visible middle: all of them up on screen together for a moment. ScrollTrigger starts
 * its catch-up a frame or so after the jump, so for the next few frames each catch-up is finished as
 * soon as it starts.
 */
export function settleScrub() {
  ScrollTrigger.update();
  let n = 5;
  const settle = () => {
    ScrollTrigger.getAll().forEach((t) => {
      // (getTween() is false, not undefined, on a trigger that doesn't scrub)
      const tween = t.getTween();
      if (tween) tween.progress(1);
    });
    if (--n <= 0) gsap.ticker.remove(settle);
  };
  settle();
  gsap.ticker.add(settle);
}

/** Eased in and out: the page sets off from rest instead of lurching at full speed on the tap. */
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Further than this along the road (m), a jump fades through fast travel and cuts there, instead of
 * scrolling the whole way: the walker can't run that fast, so they would cut ahead in jumps of the
 * camera while the cards streamed past.
 */
const TRAVEL_M = 25;
/** How long the fast-travel cover takes to come up (globals.css .travel), before the cut. */
const COVER_MS = 470;

/** Take the page to y (px), as the visitor would: the autopilot hands over. */
function goTo(y: number, label: string, duration: number) {
  manual();
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  if (!lenis) return window.scrollTo({ top: y, behavior: journey.reducedMotion ? "auto" : "smooth" });
  if (Math.abs(routeS(y / max) - routeS(journey.target)) <= TRAVEL_M) return void lenis.scrollTo(y, { duration, easing: inOut });
  window.dispatchEvent(new CustomEvent(FAST_TRAVEL_EVENT, { detail: label }));
  window.setTimeout(() => {
    lenis?.scrollTo(y, { immediate: true, force: true });
    settleScrub();
    journey.target = journey.current = y / max;
    journey.teleport++;
  }, COVER_MS);
}

/** Go to a block of the page (by id); `label` names it on the fast-travel cover if it is far. */
export function scrollToId(id: string, label?: string) {
  const el = document.getElementById(id);
  if (!el) return;
  label ??= BLOCKS.find((b) => b.id === id)?.label ?? el.querySelector("h1, h2, h3")?.textContent?.trim() ?? "";
  goTo(el.getBoundingClientRect().top + window.scrollY, label, 2.4);
}

/** Scroll to a point of the walk (0..1 of the page), as the visitor would: the autopilot hands over.
 *  `label` names the place on the fast-travel cover, if it is far. */
export function scrollToProgress(p: number, label = "") {
  goTo(p * Math.max(0, document.documentElement.scrollHeight - window.innerHeight), label, 1.6);
}

export function scrollToTop() {
  goTo(0, "Home", 3.2);
}

export const pauseScroll = () => lenis?.stop();
export const resumeScroll = () => lenis?.start();
