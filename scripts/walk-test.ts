/**
 * The walker's movement, run without a page: every way the visitor can take the walk (a swipe or
 * wheel along it or back, slow, fast, a fling that coasts, a wobbling finger, at 60 and 30 fps, from
 * the walk playing, standing beside someone, or paused), through the same code the site runs
 * (lib/rig.ts, lib/locomotion.ts), with the autopilot's part played here as lib/autopilot.ts plays it.
 * Fails if the walker turns round more often than the gesture asks for, walks one way facing the
 * other, or doesn't end up where the page has them.
 *
 *   npx tsx scripts/walk-test.ts
 */
import { PERSON_AT, RUN_END, WALK_SPEED, journey, progressAt, rideTime, routeS } from "../src/lib/journey";
import { ACCEL, BRAKE, RUN } from "../src/lib/locomotion";
import { makeRig, stepRig } from "../src/lib/rig";
import { loopDelta, wrapS } from "../src/lib/world";

const STEER_LET_GO = 0.7;
const DWELL = 6;
const PEOPLE = Object.values(PERSON_AT)
  .sort((a, b) => a - b)
  .map((s) => ({ s, t: s / WALK_SPEED }));
const SLOW_FOR = ((RUN * RUN) / (2 * BRAKE) + 0.4) / WALK_SPEED;

/** What the visitor does: how fast they move the page along the road (m/s, + on along the walk) at t s into the gesture. */
type Gesture = { name: string; at: "playing" | "dwell" | "paused"; slop: number; len: number; speed: (t: number) => number; turns: number };

const steady = (v: number) => () => v;
const fling = (v: number) => (t: number) => v * Math.exp(-t / 0.35);
const wobble = (v: number) => (t: number) => v + 1.2 * Math.sin(t * 40);
/** A wheel: notches 120 ms apart, each eased in by Lenis (lerp 0.085 a frame). */
const wheel = (perNotch: number) => (t: number) => {
  const k = Math.floor(t / 0.12);
  const since = t - k * 0.12;
  return k < 6 ? (perNotch / 0.12) * Math.exp(-since / 0.18) * 1.5 : 0;
};

const gestures: Gesture[] = [];
for (const at of ["playing", "dwell", "paused"] as const)
  for (const slop of [0, 0.1, 0.25]) {
    for (const v of [0.5, 2, 6, 15]) {
      gestures.push({ name: `${at}: swipe on ${v} m/s, ${slop * 1000} ms touch slop`, at, slop, len: 1.2, speed: steady(v), turns: 0 });
      // (back, then the walk turns round again to walk on once it is let go: unless paused)
      gestures.push({ name: `${at}: swipe back ${v} m/s, ${slop * 1000} ms touch slop`, at, slop, len: 1.2, speed: steady(-v), turns: at === "paused" ? 1 : 2 });
    }
    gestures.push({ name: `${at}: fling on, ${slop * 1000} ms slop`, at, slop, len: 2, speed: fling(20), turns: 0 });
    gestures.push({ name: `${at}: wobbly finger on, ${slop * 1000} ms slop`, at, slop, len: 1.5, speed: wobble(1.5), turns: 0 });
  }
for (const at of ["playing", "dwell", "paused"] as const) gestures.push({ name: `${at}: mouse wheel on`, at, slop: 0, len: 1.2, speed: wheel(0.6), turns: 0 });

function run(g: Gesture, fps: number, from: number) {
  const dt = 1 / fps;
  const r = makeRig();
  Object.assign(journey, { target: 0, current: 0, flow: false, flowTime: 0, stopAt: null, teleport: 0, dir: 1, reducedMotion: false, parked: null });
  // The autopilot: its clock (s into the lap), the page it shows (m), and what it is doing.
  let clock = from;
  let pageS = clock * WALK_SPEED;
  let state: "playing" | "paused" = "playing";
  let steering = false;
  let still = 0;
  let steerFrom = 0;
  let dwell = -1;
  let dwellLeft = 0;
  let setOff = 0;
  const show = () => (journey.target = Math.min(1, Math.max(0, progressAt(pageS / WALK_SPEED))));
  const flow = () => {
    journey.flow = state === "playing" && !steering;
    journey.flowTime = clock;
  };
  show();
  journey.current = journey.target;
  flow();

  // Settle into the walk first (and, for "dwell", walk up to the next person and stand there a while).
  let t = 0;
  let gestureAt = 1.5;
  if (g.at === "dwell") {
    const next = PEOPLE.find((p) => p.t - SLOW_FOR > clock + 0.5)!;
    gestureAt = next.t - clock + 2;
  }
  let face = 1;
  let turns = 0;
  let lastDir = 1;
  let moonwalk = 0;
  const end = gestureAt + g.slop + g.len + STEER_LET_GO + 10;
  for (; t < end; t += dt) {
    const inGesture = t >= gestureAt && t < gestureAt + g.slop + g.len;
    if (g.at === "paused" && Math.abs(t - (gestureAt - 0.6)) < dt / 2) {
      state = "paused";
      pageS = routeS(journey.target);
      dwell = -1;
      journey.stopAt = null;
      flow();
    }
    // The visitor's hand on the page: the first move of the finger (past the slop) takes it.
    if (inGesture) {
      if (state === "playing" && !steering) {
        dwell = -1;
        journey.stopAt = null;
        steering = true;
        // (the page itself: past the last stop it is at the bottom, not further on)
        pageS = routeS(journey.target);
        steerFrom = pageS;
        flow();
      }
      still = 0;
      const u = t - gestureAt - g.slop;
      if (u >= 0) pageS += g.speed(u) * dt;
      show();
    } else if (state === "playing") {
      if (steering) {
        still += dt;
        if (still >= STEER_LET_GO) {
          steering = false;
          const p = Math.min(1, Math.max(0, progressAt(clock)));
          if (Math.abs(pageS - steerFrom) > 0.03 && Math.abs(journey.target - p) > 1e-4) clock = rideTime(journey.target);
          flow();
        }
      } else if (dwell >= 0) {
        clock = Math.min(PEOPLE[dwell].t, clock + dt);
        dwellLeft -= dt;
        journey.flowTime = clock;
        pageS = clock * WALK_SPEED;
        show();
        if (dwellLeft <= 0) {
          dwell = -1;
          journey.stopAt = null;
          setOff = RUN / (2 * ACCEL);
        }
      } else {
        const before = clock;
        const wait = Math.min(setOff, dt);
        setOff -= wait;
        clock += dt - wait;
        const next = PEOPLE.findIndex((p) => before < p.t - SLOW_FOR && clock >= p.t - SLOW_FOR);
        if (next >= 0) {
          dwell = next;
          dwellLeft = DWELL + SLOW_FOR;
          journey.stopAt = PEOPLE[next].s;
        }
        if (clock >= RUN_END) {
          clock -= RUN_END;
          journey.teleport++;
        }
        journey.flowTime = clock;
        pageS = clock * WALK_SPEED;
        show();
      }
    }
    stepRig(r, dt);
    // The courier's facing, as Runner turns it.
    face += (journey.dir - face) * (1 - Math.exp(-8 * dt));
    if (journey.dir !== lastDir) turns++;
    lastDir = journey.dir;
    // Walking one way while still facing the other (past the turn's midpoint): a moonwalk.
    if (t > 0.5 && Math.abs(journey.vel) > 0.6 && Math.sign(face) !== Math.sign(journey.vel)) moonwalk += dt;
  }
  // Where they should be at the end: the walk's place if it plays, else the page's (or a little ahead of it, parked).
  // (the page's place as the walk reads it: past the last stop it reads as that stop)
  const want = journey.flow ? wrapS(clock * WALK_SPEED) : routeS(journey.target);
  const off = loopDelta(want, journey.s);
  return { turns, moonwalk, off };
}

let failed = 0;
let total = 0;
for (const fps of [60, 30])
  for (const from of [8, 30, 60])
    for (const g of gestures) {
      total++;
      const { turns, moonwalk, off } = run(g, fps, from);
      // (paused and swiped on less far than they would have stopped: left standing just ahead of the page)
      const offOk = journey.flow ? Math.abs(off) < 0.6 : off > -0.15 && off < 0.8;
      const ok = turns === g.turns && moonwalk < 0.12 && offOk;
      if (!ok) {
        failed++;
        console.log(`FAIL ${fps} fps, from ${from} s, ${g.name}: turned ${turns}x (want ${g.turns}), walked backwards for ${moonwalk.toFixed(2)} s, ${off.toFixed(2)} m from the page`);
      }
    }
console.log(`${total - failed}/${total} movements as they should be`);
process.exit(failed ? 1 : 0);
