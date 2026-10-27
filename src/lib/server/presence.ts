/**
 * Who is on the site right now. In-memory, in this one server process: fine for `next start` on a
 * single machine. A serverless or multi-instance deploy needs a shared realtime service instead
 * (e.g. PartyKit or Liveblocks) behind the same messages.
 */

export const EMOTES = ["wave", "cheer", "heart", "star"] as const;
export type Emote = (typeof EMOTES)[number];

export type Player = { id: string; name: string; color: string; s: number };
type Entry = Player & { seen: number; lastEmote: number };

export type ServerMessage =
  | { type: "players"; players: Player[] }
  | { type: "emote"; id: string; name: string; color: string; emote: Emote };

type Hub = { players: Map<string, Entry>; subscribers: Set<(m: ServerMessage) => void>; timer?: ReturnType<typeof setTimeout>; sweeper?: ReturnType<typeof setInterval> };

// One hub per process, kept on globalThis so every route module (and dev reloads) share it.
const g = globalThis as unknown as { __presenceHub?: Hub };
const hub: Hub = (g.__presenceHub ??= { players: new Map(), subscribers: new Set() });

/** Players not heard from for this long are dropped (clients check in every 5s while open). */
const STALE_MS = 15_000;
const MAX_PLAYERS = 200;

const list = (): Player[] => [...hub.players.values()].map(({ id, name, color, s }) => ({ id, name, color, s }));

function send(m: ServerMessage) {
  hub.subscribers.forEach((fn) => fn(m));
}

/** Positions change often: tell everyone at most ~5 times a second. */
function broadcastPlayers() {
  if (hub.timer) return;
  hub.timer = setTimeout(() => {
    hub.timer = undefined;
    send({ type: "players", players: list() });
  }, 200);
}

hub.sweeper ??= setInterval(() => {
  const now = Date.now();
  let changed = false;
  hub.players.forEach((p, id) => {
    if (now - p.seen > STALE_MS) {
      hub.players.delete(id);
      changed = true;
    }
  });
  if (changed) broadcastPlayers();
}, 5_000);

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function validId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

/** Add or update a player from a client's report. Returns false for malformed input. */
export function upsert(input: { id?: unknown; name?: unknown; color?: unknown; s?: unknown }) {
  const { id, name, color, s } = input;
  if (!validId(id) || typeof name !== "string" || typeof color !== "string" || !COLOR.test(color) || typeof s !== "number" || !Number.isFinite(s)) return false;
  const clean = name.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 24) || "Player";
  const prev = hub.players.get(id);
  if (!prev && hub.players.size >= MAX_PLAYERS) return false;
  hub.players.set(id, { id, name: clean, color, s: Math.max(-10, Math.min(1000, s)), seen: Date.now(), lastEmote: prev?.lastEmote ?? 0 });
  broadcastPlayers();
  return true;
}

export function emote(id: unknown, e: unknown) {
  if (!validId(id) || !EMOTES.includes(e as Emote)) return false;
  const p = hub.players.get(id);
  if (!p) return false;
  const now = Date.now();
  // One emote every 600ms per player, so nobody can flood everyone's screen.
  if (now - p.lastEmote < 600) return true;
  p.lastEmote = now;
  p.seen = now;
  send({ type: "emote", id, name: p.name, color: p.color, emote: e as Emote });
  return true;
}

export function leave(id: unknown) {
  if (validId(id) && hub.players.delete(id)) broadcastPlayers();
}

/** Subscribe a live stream; it gets the current players at once. Returns the unsubscribe function. */
export function subscribe(fn: (m: ServerMessage) => void) {
  hub.subscribers.add(fn);
  fn({ type: "players", players: list() });
  return () => void hub.subscribers.delete(fn);
}
