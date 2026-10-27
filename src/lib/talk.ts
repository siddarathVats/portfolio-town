/**
 * A word with someone on the walk (content/townsfolk.ts): stopped beside a person, or sent to them by
 * clicking them, they say their line and react. Planet.tsx runs it. The courier's own bubble
 * (Runner.tsx) reads what he is saying here: only to the girl, as he gives her the flowers (lib/gift.ts).
 */
export const talk = {
  /** The stop whose person is being talked with, or null. */
  with: null as string | null,
  /** Seconds into it. */
  t: 0,
  /** What the courier is saying now, or "" (shown over his head). */
  mine: "",
  /** How much of it he has typed out so far (characters as seen: an emoji is one). */
  typed: Infinity,
};

/** When their reaction pops up (s into a word with them), and when it is over. */
export const REACT_AT = 0.9;
export const TALK_S = 3.6;
