"use client";

import { journey } from "./journey";

/**
 * Everyone on the site right now, as players on the route. Each tab is a player with a random name
 * and colour (kept across reloads of that tab); it reports where it is on the run (journey.s, metres along the
 * minimap route) and hears about everyone else over a server-sent event stream (/api/presence).
 */

export const EMOTES = [
  { id: "wave", glyph: "👋", label: "Wave" },
  { id: "cheer", glyph: "🎉", label: "Cheer" },
  { id: "heart", glyph: "❤️", label: "Heart" },
  { id: "star", glyph: "⭐", label: "Star" },
] as const;
export type EmoteId = (typeof EMOTES)[number]["id"];
export const emoteGlyph = (id: string) => EMOTES.find((e) => e.id === id)?.glyph ?? "✨";

export type Player = { id: string; name: string; color: string; s: number };
export type EmoteEvent = { key: number; id: string; name: string; color: string; emote: EmoteId };

const ADJ = ["Swift", "Sunny", "Brave", "Sleepy", "Lucky", "Quiet", "Zippy", "Mellow", "Bold", "Breezy", "Tiny", "Merry"];
const ANIMAL = ["Fox", "Tanuki", "Crow", "Cat", "Frog", "Koi", "Owl", "Bunny", "Deer", "Shiba", "Otter", "Sparrow"];
const COLORS = ["#ff6b6b", "#ffb547", "#ffe066", "#7bd389", "#4cc9f0", "#5b8def", "#b388ff", "#ff8fc7", "#2ec4b6", "#f4a261"];
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

const KEY = "walk:player";
type Me = { id: string; name: string; color: string };

function loadMe(): Me {
  const id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  let saved: Partial<Me> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {}
  const me = {
    // A fresh id per page load; the name and colour stay with the tab, so two tabs are two players.
    id,
    name: typeof saved.name === "string" && saved.name ? saved.name : `${pick(ADJ)} ${pick(ANIMAL)}`,
    color: typeof saved.color === "string" && COLORS.includes(saved.color) ? saved.color : pick(COLORS),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name: me.name, color: me.color }));
  } catch {}
  return me;
}

type State = { me: Me | null; players: Player[]; connected: boolean };

class Players {
  state: State = { me: null, players: [], connected: false };
  private listeners = new Set<() => void>();
  private emoteListeners = new Set<(e: EmoteEvent) => void>();
  private source: EventSource | null = null;
  private lastS = NaN;
  private lastSent = 0;
  private timer = 0;
  private key = 0;
  private users = 0;
  /** A test tab (?debug, which jumps about the route) watches the others but is never shown to them. */
  private silent = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;
  onEmote(fn: (e: EmoteEvent) => void) {
    this.emoteListeners.add(fn);
    return () => void this.emoteListeners.delete(fn);
  }

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private post(body: object, beacon = false) {
    const data = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/presence", new Blob([data], { type: "application/json" }));
    else fetch("/api/presence", { method: "POST", body: data, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  }

  /** Tell the others where we are: when we move, and every few seconds so we are not dropped. */
  private report(force = false) {
    const me = this.state.me;
    if (!me || this.silent) return;
    const s = Math.round(journey.s * 10) / 10;
    const now = performance.now();
    if (!force && Math.abs(s - this.lastS) < 0.5 && now - this.lastSent < 5000) return;
    this.lastS = s;
    this.lastSent = now;
    this.post({ id: me.id, name: me.name, color: me.color, s });
  }

  private leave = () => {
    if (this.state.me) this.post({ id: this.state.me.id, leave: true }, true);
  };

  /** Join the game. Components call this on mount; the connection is shared and closes with the last. */
  connect() {
    this.users++;
    if (this.source) return () => this.disconnect();
    if (!this.state.me) this.set({ me: loadMe() });
    this.silent = location.search.includes("debug");
    const es = new EventSource("/api/presence");
    this.source = es;
    es.onopen = () => {
      this.set({ connected: true });
      this.report(true);
    };
    es.onerror = () => this.set({ connected: false });
    es.onmessage = (ev) => {
      let m: { type: string; players?: Player[]; id?: string; name?: string; color?: string; emote?: EmoteId };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "players" && Array.isArray(m.players)) this.set({ players: m.players });
      // (your own come back from the server too: already shown, the moment you sent them)
      else if (m.type === "emote" && m.id && m.emote && m.id !== this.state.me?.id) {
        const e = { key: ++this.key, id: m.id, name: m.name ?? "Player", color: m.color ?? "#ffffff", emote: m.emote };
        this.emoteListeners.forEach((fn) => fn(e));
      }
    };
    this.timer = window.setInterval(() => this.report(), 500);
    window.addEventListener("pagehide", this.leave);
    return () => this.disconnect();
  }

  private disconnect() {
    if (--this.users > 0) return;
    this.leave();
    this.source?.close();
    this.source = null;
    window.clearInterval(this.timer);
    window.removeEventListener("pagehide", this.leave);
    this.set({ connected: false });
  }

  emote(e: EmoteId) {
    const me = this.state.me;
    if (!me) return;
    if (!this.silent) this.post({ id: me.id, emote: e });
    // (shown here at once, over your own head, not after the round trip, and offline too)
    const ev = { key: ++this.key, id: me.id, name: me.name, color: me.color, emote: e };
    this.emoteListeners.forEach((fn) => fn(ev));
  }

  /** Roll a new random name and colour. */
  reroll() {
    const me = this.state.me;
    if (!me) return;
    const next = { ...me, name: `${pick(ADJ)} ${pick(ANIMAL)}`, color: pick(COLORS.filter((c) => c !== me.color)) };
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ name: next.name, color: next.color }));
    } catch {}
    this.set({ me: next });
    this.report(true);
  }
}

export const players = new Players();
