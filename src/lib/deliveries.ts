"use client";

import { gsap } from "gsap";
import { BLOCKS, journey, nearestStop } from "./journey";

/**
 * The messenger's checklist: every stop with a card is a delivery, ticked off once its card has been
 * up for a moment. Kept for the tab's session, so a reload carries on where it was.
 */
const KEY = "walk:delivered";
/** Stops that count (the interludes are just scenery). */
export const DELIVERABLE = BLOCKS.filter((b) => !["setoff", "bridge", "trail"].includes(b.id)).map((b) => b.id);

class Deliveries {
  private done = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: string[] = [];
  private dwell = 0;
  private dwellId = "";
  private started = false;

  has(id: string) {
    return this.done.has(id);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.snapshot;

  private mark(id: string) {
    if (this.done.has(id) || !DELIVERABLE.includes(id)) return;
    this.done.add(id);
    this.snapshot = [...this.done];
    try {
      sessionStorage.setItem(KEY, JSON.stringify(this.snapshot));
    } catch {}
    this.listeners.forEach((fn) => fn());
  }

  /** Start watching the walk. Safe to call more than once. */
  start() {
    if (this.started) return;
    this.started = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) saved.forEach((id) => typeof id === "string" && DELIVERABLE.includes(id) && this.done.add(id));
      this.snapshot = [...this.done];
    } catch {}
    gsap.ticker.add((_t, deltaMs) => {
      const { index, near } = nearestStop(journey.current);
      const id = BLOCKS[index].id;
      // Delivered once its card has been up for a moment.
      if (near > 0.5 && id === this.dwellId) this.dwell += deltaMs;
      else {
        this.dwellId = id;
        this.dwell = 0;
      }
      if (this.dwell > 350) this.mark(id);
    });
  }

  reset() {
    this.done.clear();
    this.snapshot = [];
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    this.listeners.forEach((fn) => fn());
  }
}

export const deliveries = new Deliveries();
