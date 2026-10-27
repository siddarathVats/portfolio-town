import { experience } from "@/content/portfolio";
import { ROUTE_LENGTH } from "./world";

/**
 * The walk, once round the planet: from the front door, through the town, over the stream,
 * along the forest trail to the save point and back home through the fields. Every DOM block has a
 * height in vh and a place on the road (s, metres, see world.ts). Blocks are spaced round the loop
 * by how long their card takes to take in, and the walker keeps a steady pace, so the text, the
 * world and the map stay in lock-step.
 */

/** Which side the block's card sits on (-1 left, 1 right, 0 centred or none): the camera makes room. */
export type Side = -1 | 0 | 1;
export type Block = { id: string; vh: number; label?: string; s: number; side: Side };

export const expSide = (k: number) => (k % 2 === 0 ? -1 : 1);

const PLAN: Omit<Block, "s">[] = [
  { id: "home", vh: 130, label: "Home", side: -1 },
  { id: "setoff", vh: 90, side: 0 },
  { id: "origins", vh: 150, label: "About", side: -1 },
  { id: "inventory", vh: 120, label: "Inventory", side: -1 },
  { id: "bridge", vh: 90, side: 0 },
  { id: "trail", vh: 110, label: "Experience", side: 0 },
  ...experience.map((r, k): Omit<Block, "s"> => ({
    id: `exp-${r.slug}`,
    vh: 100,
    side: expSide(k) === -1 ? 1 : -1,
  })),
  { id: "shrine", vh: 150, label: "Contact", side: -1 },
];

// How much of the loop each block gets; its stop sits in the middle of its stretch. Every stop with a
// card gets the same (the quests had less than the stops in town, and came up in a hurried run, closer
// together than everything else round the planet), the one-line interludes a little less. Home's
// stretch straddles the start, so the walk back in from the fields is the first half of arriving home
// again.
// (About, with the education folded into it, keeps the road the two stops had. The planet is sized so
// a unit of weight is as much road as ever: see PLANET_RADIUS)
const INTERLUDES = new Set(["setoff", "bridge", "trail"]);
const weight = (b: Omit<Block, "s">, i: number) => (i === 0 ? 2 : INTERLUDES.has(b.id) ? 1 : b.id === "origins" ? 2.8 : 1.4);
const W = PLAN.map(weight);
const PER = ROUTE_LENGTH / W.reduce((a, b) => a + b, 0);
/** Metres of road per unit of weight, and each block's half-stretch either side of its stop. */
export const blockReach = W.map((w) => (w * PER) / 2);

export const BLOCKS: Block[] = (() => {
  let s = 0;
  return PLAN.map((b, i) => {
    if (i) s += (W[i - 1] + W[i]) * PER * 0.5;
    return { ...b, s };
  });
})();

/** Stretches of the loop and what the world looks like there (metres; town starts before 0). */
const mid = (id: string, next = 1) => {
  const i = BLOCKS.findIndex((b) => b.id === id);
  return (BLOCKS[i].s + BLOCKS[i + next].s) / 2;
};
export const ZONES = {
  town: [-blockReach[0], mid("inventory")],
  river: [mid("inventory"), mid("bridge")],
  forest: [mid("bridge"), BLOCKS[BLOCKS.length - 1].s + blockReach[BLOCKS.length - 1]],
  fields: [BLOCKS[BLOCKS.length - 1].s + blockReach[BLOCKS.length - 1], ROUTE_LENGTH - blockReach[0]],
} as const;
export type Zone = keyof typeof ZONES;
export function zoneAt(s: number): Zone {
  const q = ((s % ROUTE_LENGTH) + ROUTE_LENGTH) % ROUTE_LENGTH;
  for (const z of ["river", "forest", "fields"] as const) if (q >= ZONES[z][0] && q < ZONES[z][1]) return z;
  return "town";
}

const totalVh = BLOCKS.reduce((s, b) => s + b.vh, 0);
/** The last 100vh is the viewport itself, so it is not scroll distance. */
const scrollVh = totalVh - 100;

/** Convert a scroll distance in vh to journey progress. */
export const vhToProgress = (vh: number) => vh / scrollVh;

export const blockStarts: number[] = (() => {
  let acc = 0;
  return BLOCKS.map((b) => {
    const p = Math.min(1, acc / scrollVh);
    acc += b.vh;
    return p;
  });
})();

export const blockIndexById = Object.fromEntries(BLOCKS.map((b, i) => [b.id, i]));

/**
 * Progress at which each block's card is fully up: mid-way through its panel's visible stretch
 * (ScrollTrigger "top 45%" to "bottom 55%"), the same place the autopilot stops.
 */
export const stopProgress = BLOCKS.map((b, i) => {
  if (i === 0) return 0;
  if (i === BLOCKS.length - 1) return 1;
  const top = blockStarts[i] * scrollVh;
  return Math.min(1, (top - 45 + 0.51 * (b.vh - 10)) / scrollVh);
});

/** Metres along the minimap route for journey progress: piecewise linear between the stops. */
export function routeS(p: number) {
  const q = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < BLOCKS.length - 2 && q > stopProgress[i + 1]) i++;
  const a = stopProgress[i];
  const b = stopProgress[i + 1];
  const k = b > a ? Math.min(1, Math.max(0, (q - a) / (b - a))) : 1;
  return BLOCKS[i].s + (BLOCKS[i + 1].s - BLOCKS[i].s) * k;
}

// ---------- the walk as the clock ----------
// The walker never stops: one lap of the planet takes LOOP_SECONDS at a steady pace, and the page
// follows, so each card comes up as its landmark goes by.

/** Seconds for one lap of the planet. */
export const LOOP_SECONDS = 69;
/** Walking pace, metres per second. */
export const WALK_SPEED = ROUTE_LENGTH / LOOP_SECONDS;

/** Seconds into the lap at which each block's stop is reached. */
export const stopTime = BLOCKS.map((b) => b.s / WALK_SPEED);

/** Seconds into the lap for journey progress (scroll). */
export const rideTime = (p: number) => routeS(p) / WALK_SPEED;

/** Journey progress for a moment of the lap: the inverse of rideTime (1 on the way home after the last stop). */
export function progressAt(t: number) {
  const s = t * WALK_SPEED;
  if (s <= 0) return 0;
  const last = BLOCKS.length - 1;
  if (s >= BLOCKS[last].s) return 1;
  let i = 0;
  while (i < last - 1 && s > BLOCKS[i + 1].s) i++;
  const k = (s - BLOCKS[i].s) / (BLOCKS[i + 1].s - BLOCKS[i].s);
  return stopProgress[i] + (stopProgress[i + 1] - stopProgress[i]) * k;
}

/** One lap: back at the front door, where the next one begins. */
export const RUN_END = LOOP_SECONDS;

/** How close progress p is to block i's stop: 1 there, falling to 0 about 70vh of scroll away. */
export function stopNear(i: number, p: number) {
  return Math.max(0, 1 - Math.abs(stopProgress[i] - p) / vhToProgress(70));
}

/** Index of the block whose stop is nearest to progress p, and how close (1 = at the stop). */
export function nearestStop(p: number) {
  let best = 0;
  for (let i = 1; i < BLOCKS.length; i++) if (Math.abs(stopProgress[i] - p) < Math.abs(stopProgress[best] - p)) best = i;
  const gap = vhToProgress(70);
  return { index: best, near: Math.max(0, 1 - Math.abs(stopProgress[best] - p) / gap) };
}

// ---------- shared mutable state (read every frame, never triggers React renders) ----------

export const journey = {
  /** Scroll progress from ScrollTrigger. */
  target: 0,
  /** Damped progress the camera actually uses. */
  current: 0,
  /** How fast the walker is going, 1 = walking pace (set by the rig). */
  speed: 0,
  /** The walker's velocity along the road, m/s, signed (set by the rig). */
  vel: 0,
  /** This frame's time step, s: one clock for the walker, the courier and the camera (set by the rig). */
  dt: 0,
  /** Recent delivered frame times, ms (set by the rig, read by the ?fps meter). */
  frameMs: [] as number[],
  /** Metres along the road, 0..ROUTE_LENGTH, wrapping (set by the rig). */
  s: 0,
  /** Where the walker pulled up when the journey was paused (m), till the page is scrolled; else null. */
  parked: null as number | null,
  /** +1 walking forward, -1 walking back (set by the rig). */
  dir: 1,
  pointer: { x: 0, y: 0 },
  reducedMotion: false,
  /** Bumped when the journey jumps (fast travel), so the scroll damping cuts instead of chasing. */
  teleport: 0,
  /** True while the autopilot plays: the walker keeps going and the page follows. */
  flow: false,
  /** The autopilot's moment of the lap (s); the walker's place while flowing. */
  flowTime: 0,
  /** A place on the road (m) the walker runs to and stops at, over anything else (e.g. beside someone
   *  they are handing something to); null when free. */
  stopAt: null as number | null,
  /** Stopped beside someone on the walk (Planet.tsx): which side of the picture they are on, and
   *  seconds since arriving, so the courier waves to them and then stands facing them, and where they
   *  stand (world), so a phone's camera can make room for them; else null. */
  greet: null as { side: number; t: number; at: { x: number; y: number; z: number } } | null,
};

export const OPEN_DETAILS_EVENT = "journey:open-details";
export const SCENE_READY_EVENT = "journey:scene-ready";
export const FAST_TRAVEL_EVENT = "journey:fast-travel";
/** A lap is done: the page goes back to the top while the walker carries on through the front door. */
export const LAP_EVENT = "journey:lap";

/** What a details view can show: a job (with its projects), or the whole inventory of skills. */
export type DetailsKey = `role:${string}` | "skills";
/** Open the details behind a card (its full text), pausing the walk while it is open. */
export function openDetails(key: DetailsKey) {
  window.dispatchEvent(new CustomEvent(OPEN_DETAILS_EVENT, { detail: key }));
}

/**
 * Where the person waiting at each stop stands along the road (m), for the stops that have one: the
 * walk stops beside them for a while (lib/autopilot.ts), and the town puts them there (plan.ts).
 */
export const PERSON_AT: Record<string, number> = Object.fromEntries(
  BLOCKS.flatMap((b) => {
    const at = b.id === "shrine" ? 0.7 : b.id.startsWith("exp-") ? -0.8 : b.id === "origins" || b.id === "inventory" ? -0.9 : null;
    return at === null ? [] : [[b.id, b.s + at] as const];
  }),
);
