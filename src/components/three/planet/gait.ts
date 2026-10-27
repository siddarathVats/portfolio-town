/**
 * The courier's stride, as numbers: how long a stride is at a speed, where through it the legs are,
 * and where each foot is fore and aft of the body. Kept free of rendering so it can be tested on its
 * own (frame-rate independence: the same distance gives the same pose at 24, 30 or 60 fps).
 */

/**
 * Frames in the jog cycle, in stride order across an 8 x 8 sheet: the upper body as drawn (16 poses,
 * art/pack16.py) with computed in-betweens (art/inbetween64.py); the legs from one run cycle drawn all
 * alike (art/run-cycle8.py with MIDS=art/run-mids-codex.png: sixteen drawn poses, eight keys and a
 * drawn in-between after each, each held for its sixteenth of the stride, as drawn animation holds its
 * drawings. Computed in-betweens smeared where the legs pass; thirty-two drawings (QUARTERS) were a
 * touch smoother but their small differences shimmered; drawn pose by pose, the legs shimmered too).
 */
export const RUN_FRAMES = 64;
/** The in-betweens of the 64 that hold the frame before (see art/inbetween64.py): none now, the
 *  passing poses where the feet go by each other being drawn (art/run-passing.py). */
export const HELD_FRAMES: number[] = [];

/**
 * Where through the stride each of the 64 frames comes up (0..1). The drawings don't change evenly:
 * for a quarter of each stride the swinging foot hangs behind with its sole up, hardly moving, while
 * the passing poses, where it comes through past the planted foot, are over in a few frames. Shown at
 * an even rate, the legs stood still and then snapped on, as if a foot stuck to the road. Each frame
 * is shown for as long as the legs move in it (the change to the next, measured on the sheet and
 * smoothed over five frames, so the drawings' own small wobble doesn't set the pace; kept between
 * 0.7 and 1.6 frames' worth), each foot's landing still
 * exactly at frames 8 and 40.
 */
const FRAME_START = [0.9884, 0.0030, 0.0165, 0.0311, 0.0491, 0.0703, 0.0911, 0.1092, 0.1250, 0.1388, 0.1521, 0.1632, 0.1743, 0.1854, 0.1966, 0.2094, 0.2235, 0.2360, 0.2475, 0.2586, 0.2697, 0.2809, 0.2930, 0.3073, 0.3265, 0.3478, 0.3715, 0.3939, 0.4141, 0.4309, 0.4458, 0.4601, 0.4739, 0.4851, 0.4963, 0.5074, 0.5241, 0.5495, 0.5750, 0.6004, 0.6250, 0.6422, 0.6552, 0.6662, 0.6771, 0.6881, 0.6991, 0.7100, 0.7210, 0.7320, 0.7429, 0.7539, 0.7651, 0.7773, 0.7899, 0.8042, 0.8214, 0.8450, 0.8701, 0.8952, 0.9202, 0.9425, 0.9588, 0.9730];
const LOOKUP = 1024;
const FRAME_OF = (() => {
  const t = new Uint8Array(LOOKUP);
  for (let k = 0; k < LOOKUP; k++) {
    const p = (k + 0.5) / LOOKUP;
    // (the frame whose start is the latest at or before p, round the loop)
    let best = 0;
    let gap = 2;
    FRAME_START.forEach((s, i) => {
      const d = (((p - s) % 1) + 1) % 1;
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    t[k] = best;
  }
  return t;
})();
/** The frame showing `phase` (0..1) of the way through the stride. */
export const frameAt = (phase: number) => FRAME_OF[Math.floor((((phase % 1) + 1) % 1) * LOOKUP) % LOOKUP];

/**
 * Metres per stride cycle (two steps) at a given speed, from the reference run's cadence: about 2.35
 * steps a second at the jogging pace, quicker and longer when sprinting, slower and shorter when
 * easing off. Legs therefore turn over at a believable rate at any speed, and the planted foot keeps
 * pace with the road. Taken at a frame's average speed (not its end speed), so the legs reach the
 * same point of the stride at the same moment whatever the frame rate.
 */
export function strideAt(speed: number) {
  const cadence = Math.min(3.1, Math.max(1.7, 2.35 + 0.32 * (speed - 2.2)));
  return Math.max(0.6, (2 * speed) / cadence);
}

/**
 * How much of the road a planted foot keeps hold of. Through the middle of each step it holds the
 * road exactly (moving back under the body at the body's own speed), so it stays on the spot of road
 * it landed on and comes down the screen as the runner passes over it, instead of treading the same
 * place in the picture, from the moment it touches down to the moment it peels off (easing only in
 * the first and last few hundredths of the step: see held). (Held to 64% before, it slid forward over
 * the road through every step: running on the spot; easing in and out over a fifth, it skated.)
 */
export const PLANT = 0.997;
/**
 * Where each foot comes down in the cycle (the drawings, art/run-cycle8.py MIRROR: the right foot on the
 * ground from frame 8, the left from 40, each down for half the stride), and whether a foot is down.
 */
export const RIGHT_DOWN = 8 / RUN_FRAMES;
export const LEFT_DOWN = 40 / RUN_FRAMES;
export const isDown = (phase: number, down: number) => ((((phase - down) % 1) + 1) % 1) < 0.5;

/**
 * The stride's progress after moving `dist` metres in `dt` seconds. The legs turn over with the ground
 * covered, from the first centimetre (so a start lands on the same pose at any frame rate); once
 * stopped, they finish the step forward onto the next pose with both feet down, never playing
 * backward.
 */
export function advanceStride(phase: number, dist: number, stride: number, moving: boolean, dt: number) {
  let p = (phase + Math.abs(dist) / stride) % 1;
  if (!moving && Math.abs(dist) < 1e-4) {
    const goal = Math.ceil(p * 2 - 1e-4) / 2;
    p = Math.min(goal, p + dt * 0.9) % 1;
  }
  return p;
}

/**
 * How much of the stride each foot holds the road: as long as the drawings keep it down (measured on
 * the sheet: each foot lifts at frame 32 / 63 of the 64, 0.35 of the stride after it lands). Held
 * longer (0.4), the drawn foot already kicked up behind was still pinned to the road, its sole drawn
 * out long toward it; and the longer hold carried the foot further back, the leg stretched after it.
 */
export const STANCE = 0.35;

/**
 * Where a foot is, fore and aft of the body (m toward the camera; negative = ahead), through the
 * stride: it lands a little ahead, stays put on the road as the body runs over it (moving back by
 * `travel` metres, the ground covered while it is down: see STANCE), then swings forward again, fast
 * mid-swing and easing into the next landing.
 */
export function footBack(phase: number, down: number, travel: number) {
  const t = (((phase - down) % 1) + 1) % 1;
  if (t < STANCE) return travel * (held(t / STANCE) - LAND_AHEAD);
  const u = (t - STANCE) / (1 - STANCE);
  // (leaving promptly and easing into the landing. Sent ahead at once (eased hard out), the leg still
  // drawn kicked up was pushed up under the shorts, the sole tucked against them; held behind through
  // the first half of the swing (eased in and out), the kicked-up shoe was brought down the card with
  // it, onto the road beside the other foot, as if dragged along it. Eased out more (squared), the foot
  // was already well ahead at the top of its kick, which moved it up the card, tucked under the shorts.)
  return travel * (1 - LAND_AHEAD - (1 - Math.pow(1 - u, 1.5)));
}
/** How much of its travel a foot spends ahead of where it is drawn: it lands that far ahead and lifts
 *  the rest behind. (Lifting 55% behind, the trailing leg was drawn out long as it pushed off; a foot
 *  ahead moves its leg up whole, under the shorts (see legMove), so leaning ahead costs less.) */
const LAND_AHEAD = 0.55;
/** 0..1 through a step on the ground → 0..1 of the way back: steady (held) through the middle,
 *  gentler at landing and push-off, where the drawing's foot is rolling anyway. */
const HELD_EDGE = 0.04;
const HELD_SLOW = 0.92;
const HELD_TOTAL = 1 - 2 * HELD_EDGE + 2 * HELD_EDGE * (HELD_SLOW + 1) / 2;
function held(x: number) {
  // Integral of a speed that ramps linearly from HELD_SLOW to 1 over each edge, normalised to 1.
  const e = HELD_EDGE;
  const ramp = (y: number) => HELD_SLOW * y + ((1 - HELD_SLOW) * y * y) / (2 * e);
  let a: number;
  if (x < e) a = ramp(x);
  else if (x < 1 - e) a = ramp(e) + (x - e);
  else a = ramp(e) + (1 - 2 * e) + (ramp(e) - ramp(1 - x));
  return a / HELD_TOTAL;
}
