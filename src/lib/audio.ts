"use client";

import { gsap } from "gsap";
import { blockIndexById, blockStarts, journey } from "./journey";
import { daylight } from "./daylight";
import { weather } from "./weather";

/**
 * A playlist, by mood: brighter tracks for a clear day, softer ones for the rain, the snow and the
 * night. Each is crossfaded into the next, shuffled (none of the last RECENT again); when the weather
 * turns for a while, the music follows it into a track of that mood. All Mixkit, see
 * public/audio/CREDITS.txt.
 */
type Mood = "clear" | "rain" | "snow" | "night";
const TRACKS: { src: string; moods: Mood[] }[] = [
  { src: "/audio/sleepy-cat.mp3", moods: ["clear", "night"] },
  { src: "/audio/sweet-september.mp3", moods: ["clear"] },
  { src: "/audio/lofi-02.mp3", moods: ["clear"] },
  { src: "/audio/lofi-01.mp3", moods: ["rain", "clear"] },
  { src: "/audio/slow-rain.mp3", moods: ["rain"] },
  { src: "/audio/thinking-about-you.mp3", moods: ["snow", "night", "rain"] },
  { src: "/audio/lofi-04.mp3", moods: ["night", "snow"] },
  { src: "/audio/slow-walk.mp3", moods: ["snow", "night"] },
  { src: "/audio/lofi-03.mp3", moods: ["night", "rain"] },
  { src: "/audio/lofi-05.mp3", moods: ["clear"] },
  { src: "/audio/just-walk.mp3", moods: ["clear", "rain"] },
  { src: "/audio/winter-wind.mp3", moods: ["snow", "clear"] },
  { src: "/audio/day-dreamin.mp3", moods: ["clear"] },
  { src: "/audio/nostalgic-night.mp3", moods: ["night", "snow"] },
  { src: "/audio/green-chair.mp3", moods: ["clear", "night"] },
  { src: "/audio/serene-view.mp3", moods: ["snow", "rain", "night"] },
  { src: "/audio/chill-bro.mp3", moods: ["clear", "night"] },
];
/** How many of the last tracks are kept from coming round again (and remembered between visits, so
 *  a return visit doesn't open on the same one). */
const RECENT = 6;
const RECENT_KEY = "walk:recent";
const VOLUME = 0.5;
/** Seconds of crossfade between tracks. */
const XFADE = 6;
/** A change of weather has to last this long (s), and the track have played this long, to change track for it. */
const MOOD_HOLD = 14;
const MIN_PLAY = 35;
// (renamed when the music became on by default, so an "off" kept from before, when it had to be
// turned on, doesn't keep it off; and again when it began trying to start as the page opens)
const PREF_KEY = "walk:music:v2";

const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
};
const readRecent = (): number[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((i) => Number.isInteger(i) && i >= 0 && i < TRACKS.length).slice(0, RECENT) : [];
  } catch {
    return [];
  }
};
const writeRecent = (v: number[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(v));
  } catch {
    /* private mode: just not remembered */
  }
};
const writePref = (v: "on" | "off") => {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* private mode: preference just isn't remembered */
  }
};

/** The mood the weather and the hour call for now. */
function moodNow(): Mood {
  if (weather.snow > 0.5) return "snow";
  if (weather.rain > 0.5) return "rain";
  if (daylight.night > 0.5) return "night";
  return "clear";
}

/** Two players, so one track can fade out while the next fades in. */
type Deck = { el: HTMLAudioElement; gain: GainNode; track: number; started: number };
/** How long before a track ends (s) the next one is loaded on the idle deck, ready to come in. */
const QUEUE_AHEAD = 30;

/**
 * Background music, on by default: browsers let it start only from a gesture, so it starts with the
 * visitor's first click, tap or key (unless they turned it off on a visit before), or the toggle. The music stays muffled indoors,
 * at the front door, and opens up (the low-pass filter lifts) once the runner sets off. The weather
 * colours it as it plays: muffled a little under the rain (as if heard from under the umbrella), airy
 * and reverberant in the snow.
 */
class Sound {
  private ctx?: AudioContext;
  private decks: Deck[] = [];
  private live = 0;
  private recent: number[] = [];
  private gain?: GainNode;
  private filter?: BiquadFilterNode;
  private dry?: GainNode;
  private wet?: GainNode;
  private room?: ConvolverNode;
  private roomOn = false;
  private listeners = new Set<(on: boolean) => void>();
  private ticking = false;
  private pauseTimer = 0;
  private mood: Mood = "clear";
  private moodSince = 0;
  private fading = false;
  on = false;
  /** Lowered while a project dialog is open. */
  duck = false;
  /** Stops waiting for the first gesture to start the music (see resumeFromPreference). */
  private disarm?: () => void;

  subscribe(fn: (on: boolean) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.on));
  }

  private setup() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // ("playback": bigger buffers than the default, made for a game's input. With the street drawing
    // every frame, the small ones ran dry on phones now and then and the music crackled.)
    this.ctx = new AC({ latencyHint: "playback" });
    const ctx = this.ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.cutoff(journey.current);
    this.filter.Q.value = 0.8;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    // Dry, and through a room (a made-up two-second tail) for the snow.
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    const room = ctx.createConvolver();
    room.buffer = this.tail(ctx, 2.4);
    this.filter.connect(this.dry).connect(this.gain);
    // (the room joined only while it is heard: a two-second convolution costs the audio thread a lot,
    // and running all the time for nothing it helped starve it on phones. See tick.)
    room.connect(this.wet).connect(this.gain);
    this.room = room;
    this.gain.connect(ctx.destination);
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.filter);
      el.addEventListener("ended", () => this.ended(i));
      this.decks.push({ el, gain, track: -1, started: 0 });
    }

    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) {
        void this.ctx.suspend();
        this.decks.forEach((d) => d.el.pause());
      } else if (this.on) this.wake();
    });
    // (iOS stops the audio for a call or another app's sound: back on with the next touch)
    ctx.addEventListener("statechange", () => {
      if (this.on && !document.hidden && ctx.state !== "running") this.wake();
    });
  }

  /** A reverb's tail: decaying noise, a little different in each ear. */
  private tail(ctx: AudioContext, seconds: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  private get deck() {
    return this.decks[this.live];
  }

  /** Muffled at home, fully open by the first stop down the street. */
  private cutoff(p: number) {
    const leap = blockStarts[blockIndexById.setoff];
    const fall = blockStarts[blockIndexById.origins];
    if (p <= leap) return 900;
    const t = Math.min(1, (p - leap) / (fall - leap));
    return 900 * Math.pow(20000 / 900, t * t);
  }

  /** The next track: one for the mood if there is one not played lately, else any not played lately. */
  private pick(mood: Mood) {
    const fresh = TRACKS.map((_, i) => i).filter((i) => !this.recent.includes(i));
    const fit = fresh.filter((i) => TRACKS[i].moods.includes(mood));
    const from = fit.length ? fit : fresh;
    const i = from[Math.floor(Math.random() * from.length)];
    this.recent = [i, ...this.recent].slice(0, RECENT);
    writeRecent(this.recent);
    return i;
  }

  /** The deck not playing. */
  private get idle() {
    return this.decks[1 - this.live];
  }

  /** Load a track on the idle deck ahead of time, so it can come in without a gap. */
  private queue(track: number) {
    const d = this.idle;
    if (d.track === track && d.el.src.endsWith(TRACKS[track].src)) return;
    d.track = track;
    d.el.src = TRACKS[track].src;
    d.el.load();
  }

  /**
   * Bring a track in on the other deck, fading the one playing out (or straight in, at the start).
   * The fades start once the new track is actually sounding: on a slow connection the old one plays
   * on meanwhile, rather than both going quiet. (play() is called at once, still inside the tap that
   * turned the music on, the first time: iOS only lets a player start inside one.)
   */
  private play(track: number, fade = XFADE) {
    const { ctx } = this;
    if (!ctx) return Promise.resolve();
    const out = this.deck.track >= 0 ? this.deck : null;
    if (out) this.live = 1 - this.live;
    const d = this.deck;
    if (d.track !== track || !d.el.src.endsWith(TRACKS[track].src)) {
      d.track = track;
      d.el.src = TRACKS[track].src;
    }
    d.started = ctx.currentTime;
    d.gain.gain.cancelScheduledValues(ctx.currentTime);
    d.gain.gain.setValueAtTime(0, ctx.currentTime);
    if (out) this.fading = true;
    // (the old deck's pause, once faded: called off if the new track fails after all)
    let outTimer = 0;
    const begin = () => {
      const t = ctx.currentTime;
      d.started = t;
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(0, t);
      d.gain.gain.linearRampToValueAtTime(1, t + (out ? fade : 0.6));
      if (!out) return;
      out.gain.gain.cancelScheduledValues(t);
      out.gain.gain.setValueAtTime(out.gain.gain.value, t);
      out.gain.gain.linearRampToValueAtTime(0, t + fade);
      outTimer = window.setTimeout(() => {
        out.el.pause();
        // (free for the next track to be loaded on)
        out.track = -1;
        this.fading = false;
      }, fade * 1000 + 100);
    };
    let begun = false;
    const once = () => {
      if (begun) return;
      begun = true;
      d.el.removeEventListener("playing", once);
      begin();
    };
    d.el.addEventListener("playing", once);
    // (and if it never says so, after a few seconds anyway)
    window.setTimeout(once, 4000);
    return d.el.play().catch((e: unknown) => {
      if (!out) throw e;
      // (couldn't start the next one: the one playing carries on, and it tries again shortly)
      d.el.removeEventListener("playing", once);
      begun = true;
      // (if the fallback already began the crossfade, the old one comes back up instead of stopping)
      if (outTimer) {
        window.clearTimeout(outTimer);
        const t = ctx.currentTime;
        out.gain.gain.cancelScheduledValues(t);
        out.gain.gain.setValueAtTime(out.gain.gain.value, t);
        out.gain.gain.linearRampToValueAtTime(1, t + 0.6);
      }
      d.gain.gain.cancelScheduledValues(ctx.currentTime);
      d.gain.gain.setValueAtTime(0, ctx.currentTime);
      d.track = -1;
      this.fading = false;
      // (too late: the old one has already stopped, so another track is tried in a moment)
      if (out.track < 0) {
        window.setTimeout(() => void (this.on && this.deck.track < 0 && this.play(this.pick(moodNow()))?.catch(() => {})), 3000);
        return;
      }
      this.live = 1 - this.live;
    });
  }

  private ended(i: number) {
    if (i === this.live && this.on) void this.play(this.idle.track >= 0 ? this.idle.track : this.pick(moodNow()), 0.6);
  }

  /** Back from the background (or an interruption): carry on, with the next touch if it takes one. */
  private wake() {
    const go = () => {
      if (!this.on || !this.ctx) return;
      void this.ctx.resume();
      return this.deck.el.play();
    };
    const retry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      void go()?.catch(() => {});
    };
    go()?.catch(() => {
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });
  }

  async enable() {
    this.setup();
    const { ctx, gain } = this;
    if (!ctx || !gain) return;
    window.clearTimeout(this.pauseTimer);
    this.on = true;
    this.emit();
    writePref("on");
    // Everything that starts a player happens here, before anything is waited on: iOS lets a player
    // start only inside the tap itself. (Waiting on the audio context first, the second deck was never
    // let start, so the music stopped when the first track ended.)
    let started: Promise<unknown>;
    if (this.deck.track < 0) {
      this.mood = moodNow();
      this.moodSince = ctx.currentTime;
      // (the first time: any track for the mood, shuffled, but none of the last few played, on this
      // visit or the one before: it used to open on the same track every time)
      if (this.recent.length === 0) this.recent = readRecent();
      started = this.play(this.pick(this.mood));
    } else started = this.deck.el.play();
    // (the other deck, started silently and stopped, so it may start later on its own)
    const other = this.idle.el;
    if (!other.src) {
      other.muted = true;
      other.src = TRACKS[this.deck.track === 0 ? 1 : 0].src;
      void other
        .play()
        .then(() => other.pause())
        .catch(() => {})
        .finally(() => (other.muted = false));
    }
    try {
      await Promise.all([ctx.resume(), started]);
    } catch {
      this.on = false;
      this.emit();
      return;
    }
    this.disarm?.();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.8);
    if (!this.ticking) {
      this.ticking = true;
      gsap.ticker.add(this.tick);
    }
  }

  disable() {
    this.disarm?.();
    this.on = false;
    this.emit();
    writePref("off");
    const { ctx, gain } = this;
    if (!ctx || !gain) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    this.pauseTimer = window.setTimeout(() => {
      this.decks.forEach((d) => d.el.pause());
      gsap.ticker.remove(this.tick);
      this.ticking = false;
    }, 1200);
  }

  /** What is playing, how far in, and the mood it is following. */
  nowPlaying() {
    const d = this.decks[this.live];
    return d && d.track >= 0 ? { src: TRACKS[d.track].src, at: d.el.currentTime, mood: this.mood } : null;
  }

  toggle() {
    if (this.on) this.disable();
    else void this.enable();
  }

  /**
   * Music is on unless the visitor turned it off before. It is tried as the page opens (a browser
   * lets it play then only for a site the visitor has been using: otherwise it is refused, quietly),
   * and else starts on their first gesture. It keeps listening until the music actually plays: on a
   * phone a finger going down doesn't count yet, only lifting it (a scroll's swipe doesn't count at
   * all, nor does a mouse wheel). (Not tried on its own in a test, ?debug, which stubs it out after.)
   */
  resumeFromPreference() {
    if (readPref() === "off") return () => {};
    if (!location.search.includes("debug")) void this.enable();
    const EVENTS = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
    const go = (e: Event) => {
      // (a tap on the music switch itself is left to the switch: started here and then toggled by its
      // own click, the music stopped as it began)
      if ((e.target as Element | null)?.closest?.(".sound")) return;
      if (!this.on) void this.enable();
    };
    const off = () => {
      EVENTS.forEach((t) => window.removeEventListener(t, go));
      this.disarm = undefined;
    };
    EVENTS.forEach((t) => window.addEventListener(t, go));
    this.disarm = off;
    return off;
  }

  private tick = () => {
    const { ctx, filter, gain, dry, wet } = this;
    if (!ctx || !filter || !gain || !dry || !wet) return;
    const now = ctx.currentTime;
    // Under the rain the top comes off (down to ~2.5 kHz in a downpour); in the snow, a little, and
    // the room opens up around it.
    const muffle = 20000 * Math.pow(0.13, weather.rain) * Math.pow(0.45, weather.snow);
    filter.frequency.setTargetAtTime(Math.min(this.cutoff(journey.current), muffle), now, 0.25);
    const wetTo = 0.45 * weather.snow + 0.12 * weather.haze;
    wet.gain.setTargetAtTime(wetTo, now, 0.5);
    if (this.room && wetTo > 0.01 && !this.roomOn) {
      filter.connect(this.room);
      this.roomOn = true;
    } else if (this.room && this.roomOn && wetTo <= 0.01 && wet.gain.value < 0.002) {
      filter.disconnect(this.room);
      this.roomOn = false;
    }
    dry.gain.setTargetAtTime(1 - 0.25 * weather.snow, now, 0.5);
    if (this.on) gain.gain.setTargetAtTime(this.duck ? VOLUME * 0.4 : VOLUME, now, 0.3);
    if (!this.on || this.fading) return;

    // Nearly over: the next one loaded in good time, then brought in.
    const d = this.deck;
    if (d.track < 0) return;
    const left = d.el.duration ? d.el.duration - d.el.currentTime : Infinity;
    if (left < QUEUE_AHEAD && this.idle.track < 0) this.queue(this.pick(moodNow()));
    if (left < XFADE + 0.2) {
      void this.play(this.idle.track >= 0 ? this.idle.track : this.pick(moodNow()));
      return;
    }
    // The weather has turned, and stayed turned: follow it, unless this track suits it already.
    const m = moodNow();
    if (m !== this.mood) {
      this.mood = m;
      this.moodSince = now;
    }
    if (now - this.moodSince > MOOD_HOLD && now - d.started > MIN_PLAY && !TRACKS[d.track].moods.includes(this.mood)) {
      void this.play(this.pick(this.mood));
    }
  };
}

export const sound = new Sound();

// ?debug: tests can see what is playing (`__sound.nowPlaying()`).
if (typeof window !== "undefined" && location.search.includes("debug")) (window as unknown as { __sound: Sound }).__sound = sound;
