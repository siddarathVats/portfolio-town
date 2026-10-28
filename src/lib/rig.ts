import { WALK_SPEED, journey, routeS } from "./journey";
import { BRAKE, RUN, placeMover, stepMover, type Mover } from "./locomotion";
import { loopDelta, wrapS } from "./world";

/** The walker's state between frames (components/three/Rig.tsx keeps one). */
export type RigState = {
  teleport: number;
  mover: Mover;
  flowing: boolean;
  /** Last frame, held at a stop (beside someone). */
  stopped: boolean;
  /** Where the walker pulled up when the page was let go, the page's progress then, and which way they were going. */
  park: number | null;
  parkAt: number;
  parkWay: number;
};

export const makeRig = (): RigState => ({ teleport: 0, mover: { s: NaN, v: 0, acc: 0 }, flowing: false, stopped: false, park: null, parkAt: 0, parkWay: 1 });

/**
 * One frame of the walk (dt s): reads where the page, the autopilot or a stop wants the walker
 * (journey.target, flow, flowTime, stopAt, teleport), moves them there like a body, and publishes
 * where they are, how fast and which way they face (journey.s, vel, speed, dir). Kept apart from the
 * component so the movement can be run without a page (scripts/walk-test.mts).
 */
export function stepRig(r: RigState, dt: number) {
  if (!Number.isFinite(journey.current)) journey.current = journey.target;
  let cut = false;
  if (r.teleport !== journey.teleport) {
    // Fast travel: cut straight there instead of running the whole way back.
    r.teleport = journey.teleport;
    journey.current = journey.target;
    cut = true;
  }
  // The page's progress, smoothed only lightly (the walker's own inertia does the rest).
  const lambda = journey.reducedMotion ? 14 : 8;
  journey.current += (journey.target - journey.current) * (1 - Math.exp(-dt * lambda));
  const stop = journey.stopAt;
  const flow = journey.flow && stop === null;
  const m = r.mover;
  // Paused, or the visitor taking the page while it plays (the autopilot let go): pull up where the
  // legs would stop of themselves, not where the page is (its progress lags the run a little, and
  // after the last stop it reads as that stop), so the walker doesn't brake past it and turn round
  // to walk back, swinging the camera round with them. Parked there till the page comes level and
  // takes them on, or is scrolled back the other way. (Let go at the first touch of the page, a
  // swipe on along the walk turned them round to the page's place a step behind, then on again.)
  // (likewise walking on from beside someone into the visitor's hands: the girl at the end stands past
  // the last card, where the page stops, so the page's place was a step behind them)
  if ((r.flowing || r.stopped) && !flow && stop === null && Number.isFinite(m.s)) {
    r.park = wrapS(m.s + (Math.sign(m.v) * m.v * m.v) / (2 * BRAKE) + Math.sign(m.v) * 0.05);
    r.parkAt = journey.target;
    r.parkWay = Math.sign(m.v) || 1;
  }
  r.flowing = flow;
  r.stopped = stop !== null;
  const page = routeS(journey.current);
  if (
    flow ||
    stop !== null ||
    cut ||
    (r.park !== null && ((journey.target - r.parkAt) * r.parkWay < -1e-4 || loopDelta(r.park, page) * r.parkWay >= 0))
  )
    r.park = null;
  journey.parked = r.park;
  const want = stop !== null ? wrapS(stop) : flow ? wrapS(journey.flowTime * WALK_SPEED) : (r.park ?? page);

  if (!Number.isFinite(m.s) || (cut && Math.abs(loopDelta(m.s, want)) > 2)) placeMover(m, want, flow ? RUN : 0);
  else stepMover(m, want, dt, flow);

  // Pace (1 = jogging pace) and facing, for the walker's legs and the camera.
  journey.vel = m.v;
  journey.speed = Math.abs(m.v) / WALK_SPEED;
  if (Math.abs(m.v) > 0.3) journey.dir = m.v > 0 ? 1 : -1;
  journey.s = m.s;
}
