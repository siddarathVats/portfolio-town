import { ROUTE_LENGTH, wrapS } from "./world";

/**
 * Day and night, as the walk goes round: one lap of the planet is one day. Bright day through the
 * village and the high street, the sun going down over the river and the bridge, night with stars and
 * the moon in the forest, and dawn coming up over the fields on the way home, so every lap starts in
 * the morning at the front door.
 *
 * `dusk` is the warm light of sunset (and, more faintly, sunrise), `night` how dark it is; both 0..1.
 * The sky, the light, the fog and the colour grade all read them (Sky, Runner, Ink).
 */
export const daylight = { night: 0, dusk: 0 };

/** Fractions of the lap where each change starts and ends. */
const DUSK = [0.5, 0.64];
const NIGHT = [0.64, 0.74];
const DAWN = [0.88, 0.98];

const ramp = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How dark and how golden it is at a place on the road (m). */
export function timeOfDay(s: number, out = { night: 0, dusk: 0 }) {
  const f = wrapS(s) / ROUTE_LENGTH;
  const fall = ramp(f, NIGHT[0], NIGHT[1]);
  const rise = ramp(f, DAWN[0], DAWN[1]);
  out.night = fall * (1 - rise);
  // Golden as the sun goes down, fading into the night; a paler blush as it comes up again.
  out.dusk = ramp(f, DUSK[0], DUSK[1]) * (1 - fall) + 0.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, (f - DAWN[0]) / (DAWN[1] - DAWN[0]))));
  return out;
}
