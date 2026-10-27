"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { WALK_SPEED, journey, routeS } from "@/lib/journey";
import { BRAKE, RUN, placeMover, stepMover, type Mover } from "@/lib/locomotion";
import { loopDelta, wrapS } from "@/lib/world";

/** Longest frame simulated in full (s); a longer stall (a hidden tab) jumps rather than races. */
const MAX_FRAME = 0.25;

/**
 * Runs first every frame and moves the walker along the road like a body, not a cursor:
 *
 * - The page (scroll, or the autopilot's clock) says where the walker should be. The walker runs
 *   there with limited acceleration, braking and top speed, slowing so it arrives and stops exactly
 *   (lib/locomotion.ts), instead of easing toward it at a speed proportional to the gap, which made a
 *   flick of the wheel a 30 m/s dash with legs to match.
 * - Movement is integrated in fixed 1/120 s steps, so 30 fps, 60 fps and a dropped frame cover the
 *   same ground at the same speed. (Before, any frame longer than 50 ms was cut short, so on a slow
 *   machine the walker lost time on every slow frame and lurched to catch up.)
 * - It publishes the frame's time step, speed and direction for the courier and the camera, so
 *   everything moves on one clock.
 */
export function Rig() {
  const st = useRef({ teleport: 0, mover: { s: NaN, v: 0, acc: 0 } as Mover, flowing: false, park: null as number | null, parkAt: 0 });
  useFrame((_, rawDt) => {
    const r = st.current;
    // (The pacer passes each refresh's own timestamp, so dt is exactly the time this frame will be on
    // screen: 16.7 or 33.3 ms, not whatever a clock read part-way through the work says.)
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME);
    journey.dt = dt;

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
    // Paused (the autopilot let go): pull up where the legs would stop of themselves, not where the
    // page is (its progress lags the run a little, and after the last stop it reads as that stop), so
    // the walker doesn't brake past it and turn round to walk back, swinging the camera round with
    // them. Parked there until the page is scrolled.
    if (r.flowing && !flow && stop === null && Number.isFinite(m.s)) {
      r.park = wrapS(m.s + (Math.sign(m.v) * m.v * m.v) / (2 * BRAKE) + Math.sign(m.v) * 0.05);
      r.parkAt = journey.target;
    }
    r.flowing = flow;
    if (flow || stop !== null || cut || Math.abs(journey.target - r.parkAt) > 1e-4) r.park = null;
    journey.parked = r.park;
    const want = stop !== null ? wrapS(stop) : flow ? wrapS(journey.flowTime * WALK_SPEED) : (r.park ?? routeS(journey.current));

    if (!Number.isFinite(m.s) || (cut && Math.abs(loopDelta(m.s, want)) > 2)) placeMover(m, want, flow ? RUN : 0);
    else stepMover(m, want, dt, flow);

    // Pace (1 = jogging pace) and facing, for the walker's legs and the camera.
    journey.vel = m.v;
    journey.speed = Math.abs(m.v) / WALK_SPEED;
    if (Math.abs(m.v) > 0.3) journey.dir = m.v > 0 ? 1 : -1;
    journey.s = m.s;
  });
  return null;
}
