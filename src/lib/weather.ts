/**
 * Now and then a shower passes over while you walk: the sky clouds over and greys, the haze closes in,
 * and for half a minute or so it rains (streaks, splashes, puddles gathering on the road) or, now and
 * then, snows (flakes drifting down, a white cover settling on the roofs, the road and the grass).
 * Then it clears again, and the puddles dry up and the snow melts away a while later.
 *
 * Levels, 0..1: `rain` and `snow` (how hard it is coming down), `cloud` (the overcast, either way),
 * `wet` (the puddles) and `cover` (the snow lying). The sky, the light, the fog, the colour grade and
 * the materials read them.
 *
 * Live (lib/sky.ts, the default when it can be had): it does what the sky over the visitor's town is
 * doing, and holds it: rain or snow as hard as it is coming down there, the overcast, fog (`haze`),
 * the wind (`wind`: rain slants, snow drifts) and, in a thunderstorm, lightning (`flash`).
 *
 * Story (the visitor switched live off, or it couldn't be had): the first shower comes along after the
 * walk has been going a little while (so a visitor sees one), then they come at random, a minute or two
 * apart, about one in three of them snow.
 *
 * Time only runs while the page is being drawn.
 */
import { sky } from "./sky";

type Kind = "rain" | "snow";

export const weather = {
  rain: 0,
  snow: 0,
  cloud: 0,
  /** Mist closing in (fog). */
  haze: 0,
  /** How windy, 0..1. */
  wind: 0,
  /** A lightning flash, 1 at the strike and dying away. */
  flash: 0,
  /** Seconds to the next strike, while there is thunder about. */
  strike: 8,
  /** Called at each strike (the thunder follows a little after). */
  onStrike: null as ((far: number) => void) | null,
  /** How wet the ground is: it fills the puddles while it rains (or the snow melts), they dry up after. */
  wet: 0,
  /** How much snow lies on the ground. */
  cover: 0,
  /** How soaked the courier's clothes are: wet through in a few seconds of rain without the umbrella,
   *  hardly at all under it; dripping, drying slowly after. */
  soak: 0,
  /** How wet their legs and shoes are: splashed from the road even under the umbrella. */
  splash: 0,
  /** How far the courier's umbrella is up (0..1), set by the Runner. */
  shelter: 0,
  /** Seconds left of the current dry spell or shower. */
  left: 40,
  raining: false,
  /** Whether it was following the live sky last frame. */
  wasLive: false,
  kind: "rain" as Kind,
  /** ?debug: what the next shower will be. */
  next: null as Kind | null,
  update(dt: number) {
    const ease = (v: number, want: number, rate: number) => v + Math.sign(want - v) * Math.min(Math.abs(want - v), rate * dt);
    const live = sky.live ? sky.target : null;
    let rainTo: number, snowTo: number, overcast = 0, hazeTo = 0, windTo = 0.15;
    if (live) {
      rainTo = live.rain;
      snowTo = live.snow;
      overcast = live.overcast;
      hazeTo = live.haze;
      windTo = live.wind;
      this.raining = rainTo > 0 || snowTo > 0;
      if (this.raining) this.kind = snowTo > rainTo ? "snow" : "rain";
      this.wasLive = true;
    } else {
      // (back in story weather it clears, and the next shower is a little way off)
      if (this.wasLive) {
        this.wasLive = false;
        this.raining = false;
        this.left = 40;
      }
      this.left -= dt;
      if (this.left <= 0) {
        this.raining = !this.raining;
        if (this.raining) this.kind = this.next ?? (Math.random() < 0.35 ? "snow" : "rain");
        this.next = null;
        this.left = this.raining ? 22 + Math.random() * 14 : 60 + Math.random() * 60;
      }
      rainTo = this.raining && this.kind === "rain" ? 1 : 0;
      snowTo = this.raining && this.kind === "snow" ? 1 : 0;
      if (this.raining) windTo = this.kind === "snow" ? 0.3 : 0.25;
    }
    // Clouding over takes a few seconds; it then sets in, and eases off the same way.
    this.rain = ease(this.rain, rainTo, rainTo > this.rain ? 0.22 : 0.18);
    this.snow = ease(this.snow, snowTo, snowTo > this.snow ? 0.18 : 0.15);
    this.haze = ease(this.haze, hazeTo, 0.1);
    this.wind = ease(this.wind, windTo, 0.08);
    this.cloud = Math.max(this.rain, this.snow, ease(this.cloud, overcast, 0.1), 0.6 * this.haze);
    // Thunder: a strike every so often while it pours, flickering once or twice as it dies away.
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (live?.storm && this.rain > 0.7) {
      this.strike -= dt;
      if (this.strike <= 0) {
        this.strike = 9 + Math.random() * 18;
        this.flash = 1;
        const far = Math.random();
        if (Math.random() < 0.6) window.setTimeout(() => (this.flash = Math.max(this.flash, 0.7)), 140 + far * 120);
        this.onStrike?.(far);
      }
    }
    // Puddles fill over a quarter of a minute of rain, and take most of a minute to dry up after. Snow
    // settles over half a minute and melts over a minute or so, leaving the road wet as it goes.
    const pour = Math.max(0, (this.rain - 0.25) / 0.75);
    const fall = Math.max(0, (this.snow - 0.25) / 0.75);
    const melt = fall > 0.05 ? 0 : Math.min(this.cover, 0.016 * dt);
    this.cover = Math.min(1, Math.max(0, this.cover + dt * 0.045 * fall) - melt);
    this.wet = Math.min(1, Math.max(0, this.wet + dt * (pour > 0.05 ? 0.07 * pour : -0.02) + melt * 3));
    const out = 1 - 0.92 * this.shelter;
    this.soak = Math.min(1, Math.max(0, this.soak + dt * (pour > 0.05 ? 0.18 * pour * out - 0.022 * (1 - out) : -0.022)));
    this.splash = Math.min(1, Math.max(0, this.splash + dt * (pour > 0.05 ? 0.06 * pour : -0.016)));
  },
};

// ?debug: tests can start or stop a shower (`__weather.next = "snow"; __weather.left = 0`).
if (typeof window !== "undefined" && location.search.includes("debug")) (window as unknown as { __weather: typeof weather }).__weather = weather;
