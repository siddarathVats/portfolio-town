"use client";

import { journey } from "./journey";
import { players, type Player } from "./players";
import { loopDelta, wrapS } from "./world";

/**
 * The other players drawn on the planet and the map: at most MAX_SHOWN of them, the nearest along the
 * road, each moving smoothly. Positions arrive about twice a second (and as little as every 5 s when
 * someone stands still), so drawing each report as it came made people lurch forward and stop; here
 * they are played back a moment late, between the reports either side (as games show other players),
 * and they fade in and out instead of popping, also when someone jumps across the planet.
 */

/** Draw at most this many other players. */
export const MAX_SHOWN = 5;
/** How far behind their reports others are shown (s): a report's interval plus the server's batching. */
const DELAY = 0.75;
/** A newcomer has to be this much nearer (m) than someone shown to take their place, so the choice
 *  doesn't flip back and forth when two are about as far. */
const KEEP = 4;
/** Moves longer than this (m) between reports are jumps (fast travel, a scroll across the page). */
const JUMP = 30;
/** Seconds to fade in or out. */
const FADE = 0.45;

type Sample = { t: number; s: number };

export type Ghost = {
  p: Player;
  /** Where along the road they are drawn now (m), and how far that moved this frame. */
  s: number;
  step: number;
  /** 0..1: how much of them shows (fading in, or out as they leave or jump). */
  fade: number;
  /** Their reports, the road unwrapped so a lap goes on counting up. */
  samples: Sample[];
  leaving: boolean;
  /** A jump in progress: the reports from the new place, shown there once they have faded out. */
  jumpTo: Sample[] | null;
};

class Crowd {
  private ghosts = new Map<string, Ghost>();
  private list: Ghost[] = [];
  private listeners = new Set<() => void>();
  private last = -1;
  private picked = 0;
  private wired = false;

  subscribe = (fn: () => void) => {
    this.wire();
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  /** Everyone drawn (also those fading out), stable until someone joins or goes. */
  getList = () => this.list;
  get(id: string) {
    return this.ghosts.get(id);
  }

  private wire() {
    if (this.wired || typeof window === "undefined") return;
    this.wired = true;
    players.subscribe(() => this.take(players.getState().players));
    this.take(players.getState().players);
  }

  private changed() {
    this.list = [...this.ghosts.values()];
    this.listeners.forEach((fn) => fn());
  }

  /** A report from the server: everyone's latest place. */
  private take(all: Player[]) {
    const now = performance.now() / 1000;
    const me = players.getState().me?.id;
    const others = all.filter((p) => p.id !== me);
    for (const p of others) {
      const g = this.ghosts.get(p.id);
      if (g) this.report(g, p, now);
    }
    this.pick(others, now);
  }

  private report(g: Ghost, p: Player, now: number) {
    g.p = p;
    const into = g.jumpTo ?? g.samples;
    const prev = into[into.length - 1];
    const d = loopDelta(wrapS(prev.s), wrapS(p.s));
    if (Math.abs(d) < 1e-3) return;
    if (Math.abs(d) > JUMP) {
      g.jumpTo = [{ t: now, s: p.s }];
      return;
    }
    // (after standing still a while, the move is played over the usual interval, not the whole wait)
    if (now - prev.t > 1) into.push({ t: now - 0.5, s: prev.s });
    into.push({ t: now, s: prev.s + d });
    // (kept a little past what playback still needs)
    while (into.length > 2 && into[1].t < now - DELAY - 1) into.shift();
  }

  /** Who to draw: the nearest MAX_SHOWN along the road, those already shown kept by a margin. */
  private pick(others: Player[], now: number) {
    this.picked = now;
    const want = others
      .map((p) => ({ p, d: Math.abs(loopDelta(journey.s, wrapS(p.s))) - (this.ghosts.get(p.id)?.leaving === false ? KEEP : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_SHOWN);
    const ids = new Set(want.map((w) => w.p.id));
    let changed = false;
    for (const { p } of want) {
      const g = this.ghosts.get(p.id);
      if (!g) {
        this.ghosts.set(p.id, { p, s: wrapS(p.s), step: 0, fade: 0, samples: [{ t: now, s: p.s }], leaving: false, jumpTo: null });
        changed = true;
      } else if (g.leaving) g.leaving = false;
    }
    this.ghosts.forEach((g, id) => {
      if (!ids.has(id)) g.leaving = true;
    });
    if (changed) this.changed();
  }

  /** Move everyone on to `now` (s, performance clock); called by whatever draws them, once a frame. */
  update(now: number) {
    if (now === this.last) return;
    const dt = this.last < 0 ? 0 : Math.min(0.1, now - this.last);
    this.last = now;
    // (who is nearest changes as you walk, too, not only when someone reports)
    if (now - this.picked > 1) this.take(players.getState().players);
    let gone = false;
    this.ghosts.forEach((g, id) => {
      const show = !g.leaving && !g.jumpTo;
      g.fade = Math.min(1, Math.max(0, g.fade + (show ? dt : -dt) / FADE));
      if (g.jumpTo && g.fade === 0) {
        // (out of sight: put them down at the new place, to fade in there)
        g.samples = g.jumpTo;
        g.s = wrapS(playback(g.samples, now - DELAY));
        g.jumpTo = null;
      }
      if (g.leaving && g.fade === 0) {
        this.ghosts.delete(id);
        gone = true;
        return;
      }
      const s = playback(g.samples, now - DELAY);
      const step = loopDelta(g.s, wrapS(s));
      g.step = step;
      g.s = wrapS(g.s + step);
    });
    if (gone) this.changed();
  }
}

/** Where the reports put someone at time t: between the two either side, or at the last. */
function playback(samples: Sample[], t: number) {
  if (t <= samples[0].t) return samples[0].s;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (t <= b.t) return a.s + (b.s - a.s) * ((t - a.t) / Math.max(1e-3, b.t - a.t));
  }
  return samples[samples.length - 1].s;
}

export const crowd = new Crowd();

// ?debug: tests can play other players' reports in (`__players.set({ players })`) and watch them.
if (typeof window !== "undefined" && location.search.includes("debug")) Object.assign(window, { __crowd: crowd, __players: players });
