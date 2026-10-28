"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { journey } from "@/lib/journey";
import { makeRig, stepRig } from "@/lib/rig";

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
  const st = useRef(makeRig());
  useFrame((_, rawDt) => {
    const r = st.current;
    // (The pacer passes each refresh's own timestamp, so dt is exactly the time this frame will be on
    // screen: 16.7 or 33.3 ms, not whatever a clock read part-way through the work says.)
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME);
    journey.dt = dt;

    stepRig(r, dt);
  });
  return null;
}
