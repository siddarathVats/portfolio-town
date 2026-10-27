import { WALK_SPEED } from "./journey";
import { ROUTE_LENGTH } from "./world";

/** The pace a jog settles at when the visitor scrolls along (m/s); the autopilot's pace. */
export const RUN = WALK_SPEED;
/** Top speed when the walker has fallen well behind the page (m/s): a sprint, not a blur. */
export const SPRINT = WALK_SPEED * 1.9;
/** Getting up to speed, and braking (m/s²): a few strides to start, a couple to stop. */
export const ACCEL = 4.2;
export const BRAKE = 6.5;
/** Further than this behind (m), the walker cuts there (fast travel) rather than sprinting for ages. */
export const CUT = 40;
/** Simulation step (s): movement is integrated in small fixed steps, whatever the frame rate. */
export const STEP = 1 / 120;

/** Shortest signed distance from a to b round the loop. */
const delta = (a: number, b: number) => {
  let d = (b - a) % ROUTE_LENGTH;
  if (d > ROUTE_LENGTH / 2) d -= ROUTE_LENGTH;
  if (d < -ROUTE_LENGTH / 2) d += ROUTE_LENGTH;
  return d;
};
const wrap = (s: number) => ((s % ROUTE_LENGTH) + ROUTE_LENGTH) % ROUTE_LENGTH;

/**
 * The walker's body along the road: place (m), velocity (m/s), unspent simulation time (s), and
 * where it was asked to be last frame (so the target moves smoothly through a long frame's steps).
 * `s` is where it is drawn: between the last two simulation steps (`prev`, `sim`), by how far the
 * clock is into the next one. (Drawn at the last step itself, a frame that happens to fit one step
 * more or one fewer, as real frame times wobble around 16.7 ms, moves the walker, and the camera on
 * them, half as far again or half as far: a stutter.)
 */
export type Mover = { s: number; v: number; acc: number; last?: number; sim?: number; prev?: number };

/** Put the walker somewhere outright (a cut). */
export function placeMover(m: Mover, s: number, v: number) {
  m.s = m.sim = m.prev = s;
  m.v = v;
  m.acc = 0;
}

/**
 * Advances the walker toward `want` by `dt` seconds, in fixed STEP increments (the remainder carries
 * to the next frame), so the distance covered doesn't depend on the frame rate.
 *
 * - Following the autopilot (flow): match its jogging pace, closing any gap gently.
 * - Following the page (scroll): run there as fast as the gap allows, up to RUN (SPRINT when well
 *   behind), braking so as to stop on the spot: v = sqrt(2·BRAKE·distance) near the end.
 * - Speeding up is limited to ACCEL, slowing (and turning round) to BRAKE.
 */
export function stepMover(m: Mover, want: number, dt: number, flow: boolean) {
  if (Math.abs(delta(m.sim ?? m.s, want)) > CUT) {
    placeMover(m, want, flow ? RUN : 0);
    m.last = want;
    return m;
  }
  let s = m.sim ?? m.s;
  let prev = m.prev ?? s;
  const from = m.last ?? want;
  const move = delta(from, want);
  m.last = want;
  m.acc += dt;
  const n = Math.floor(m.acc / STEP);
  for (let i = 1; i <= n; i++) {
    m.acc -= STEP;
    // The target as it was at this step, not where it ended up at the end of the frame.
    const d = delta(s, wrap(from + (move * i) / n));
    let vWant: number;
    if (flow) vWant = RUN + Math.max(-RUN, Math.min(RUN * 0.6, d * 1.5));
    else {
      const top = Math.abs(d) > 6 ? SPRINT : RUN;
      vWant = Math.sign(d) * Math.min(top, Math.sqrt(2 * BRAKE * Math.max(0, Math.abs(d) - 0.03)));
    }
    const dv = vWant - m.v;
    const speedingUp = Math.sign(dv) === Math.sign(m.v || dv) && Math.abs(vWant) > Math.abs(m.v);
    const limit = (speedingUp ? ACCEL : BRAKE) * STEP;
    m.v += Math.max(-limit, Math.min(limit, dv));
    prev = s;
    s = wrap(s + m.v * STEP);
  }
  m.sim = s;
  m.prev = prev;
  m.s = wrap(prev + delta(prev, s) * Math.min(1, m.acc / STEP));
  return m;
}
