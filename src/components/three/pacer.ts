/**
 * Frame pacing: which display refreshes the scene is drawn on.
 *
 * Smooth motion needs every frame on screen for the same time, more than it needs a high count. A
 * game that can't quite hold 60 on a 60 Hz display shows a mix of 17 and 33 ms frames (what the ?fps
 * meter reported on an Iris Xe laptop: a median of 19-21 ms, 10-20% of frames uneven), and the run
 * judders however good the animation is. So the scene owns its loop (R3F frameloop "never") and draws
 * on every k-th refresh: every one when the frame fits, every other one (an even 30 on 60 Hz) when it
 * doesn't. It also hands the scene the refresh-aligned time, so each frame moves the world by exactly
 * the time it will be on screen (rAF's timestamp, not a clock read part-way through the work).
 *
 * In "auto" it starts at the display's rate up to ~100 fps (60 on 60 Hz, 72 on 144 Hz), steps to the
 * next even rate down when more than 1 in 10 frames misses its refresh, and tries the faster rate
 * again when the measured work (main thread, and GPU where the browser can time it) would fit, backing
 * off further each time a try fails.
 */
export type PaceMode = "auto" | 60 | 30;

export const pacer = {
  /** Display refresh interval (ms), measured from animation frames. */
  vsync: 1000 / 60,
  /** Draw on every k-th refresh. */
  k: 1,
  /** The fastest k worth drawing at on this display (rates above ~100 fps waste power). */
  minK: 1,
  mode: "auto" as PaceMode,
  /** Tests drive the clock themselves (?debug's __step): the pacer stands aside. */
  manual: false,
  /** Main-thread time per drawn frame (ms): scripts, style, layout and paint, up to the next task. */
  main: [] as number[],
  /** GPU time per drawn frame (ms), where the browser can time it. */
  gpu: [] as number[],
  /** Set by quality changes, to try the faster rate again soon. */
  retry: 0,
};

/** Recent values kept for the meter and decisions. */
export const keep = (list: number[], v: number, n = 120) => {
  list.push(v);
  if (list.length > n) list.shift();
};

export const pct = (list: number[], q: number) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/** The useful range of k on a display refreshing every v ms: up to ~100 fps, down to ~28 fps. */
export function paceBounds(v: number) {
  const minK = Math.max(1, Math.ceil(10 / v - 0.05));
  const maxK = Math.max(minK, Math.floor(1000 / 28 / v + 0.05));
  return { minK, maxK };
}

/**
 * The auto rate choice, fed one drawn frame at a time: whether it missed its refresh, and the work
 * measured so far. Steps to the next even rate down when more than 1 in 10 of the last frames
 * missed; tries the faster rate when the main thread's and GPU's time (90th percentile) would fit
 * it, or when told a quality step made room; a failed try doubles the wait before the next.
 */
export function createGovernor() {
  const late: number[] = [];
  let probing = false;
  let probeAt = 0;
  // (the first try at the faster rate comes soon: a few late frames as the walk starts shouldn't cost
  // seconds of half rate; each failed try doubles the wait)
  let backoff = 3000;
  return {
    reset() {
      late.length = 0;
    },
    /** Forget everything, as at the start: no try pending, no backing off. */
    fresh() {
      late.length = 0;
      probing = false;
      probeAt = 0;
      backoff = 3000;
    },
    frame(now: number, missed: boolean, v: number) {
      const { minK, maxK } = paceBounds(v);
      keep(late, missed ? 1 : 0, 60);
      const misses = late.reduce((a, b) => a + b, 0);
      if (late.length >= 30 && misses >= Math.max(3, late.length * 0.1)) {
        if (pacer.k < maxK) pacer.k++;
        late.length = 0;
        if (probing) backoff = Math.min(backoff * 2, 60000);
        probing = false;
        probeAt = now + backoff;
      } else if (probing && late.length >= 60) {
        probing = false;
        backoff = 3000;
      } else if (!probing && pacer.k > minK && now > probeAt && late.length >= 60) {
        const budget = (pacer.k - 1) * v;
        const fits = pct(pacer.main, 0.9) < budget * 0.7 && (!pacer.gpu.length || pct(pacer.gpu, 0.9) < budget * 0.75);
        if (fits || pacer.retry) {
          pacer.k--;
          probing = true;
          late.length = 0;
          pacer.retry = 0;
        } else probeAt = now + 2000;
      }
    },
  };
}
