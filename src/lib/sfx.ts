"use client";

import { sound } from "./audio";
import { daylight } from "./daylight";
import { weather } from "./weather";

/**
 * The world's small sounds, synthesised in the browser (no files): soft footsteps in time with the
 * stride, a quiet bed of wind (rising with the weather's wind and in snow) with the odd bird (not in
 * the rain or snow, nor at night), the hiss of a shower, thunder after lightning, the faint crackle of a
 * record under the music, and a two-note chime when a letter is delivered.
 * Only while the visitor has sound on: it starts from their click on the sound toggle, like the music.
 */
class Sfx {
  private ctx?: AudioContext;
  private out?: GainNode;
  private noise?: AudioBuffer;
  private bedGain?: GainNode;
  private bedFilter?: BiquadFilterNode;
  private crackleGain?: GainNode;
  private rumble?: AudioBuffer;
  private airLevel = 0;
  private rainGain?: GainNode;
  private rainLevel = 0;
  private birdTimer = 0;
  private sleepTimer = 0;
  private wired = false;

  /** Call once on the client. */
  wire() {
    if (this.wired) return;
    this.wired = true;
    sound.subscribe((on) => (on ? this.start() : this.stop()));
    if (sound.on) this.start();
  }

  private start() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(this.ctx.destination);
      // One second of white noise, reused for steps and wind.
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.bed();
      this.rainBed();
      this.crackle();
      weather.onStrike = (far) => this.thunder(far);
    }
    // (turned back on before the last stop had put it to sleep: it stays awake)
    window.clearTimeout(this.sleepTimer);
    void this.ctx.resume();
    this.bedGain?.gain.setTargetAtTime(this.bedLevel(), this.ctx.currentTime, 1.2);
    this.crackleGain?.gain.setTargetAtTime(0.022, this.ctx.currentTime, 1.2);
    this.rainGain?.gain.setTargetAtTime(0.05 * this.rainLevel, this.ctx.currentTime, 1.2);
    this.scheduleBird();
  }

  private stop() {
    if (!this.ctx) return;
    window.clearTimeout(this.birdTimer);
    this.bedGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    this.crackleGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    this.rainGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    this.sleepTimer = window.setTimeout(() => void this.ctx?.suspend(), 900);
  }

  /** Wind: looping noise through a slowly wandering low-pass filter. */
  private bed() {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    this.bedFilter = lp;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency);
    this.bedGain = c.createGain();
    this.bedGain.gain.value = 0;
    src.connect(lp).connect(this.bedGain).connect(this.out!);
    src.start();
    lfo.start();
  }

  /** Rain: hiss of noise, high and soft (only while sound is on; its level follows the shower). */
  private rainBed() {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6500;
    this.rainGain = c.createGain();
    this.rainGain.gain.value = 0;
    src.connect(hp).connect(lp).connect(this.rainGain).connect(this.out!);
    src.start();
  }

  /** The record's crackle: now and then a soft tick or pop, and a faint hiss, looped (4 s). */
  private crackle() {
    const c = this.ctx!;
    const len = c.sampleRate * 4;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.04;
    for (let n = 0; n < 70; n++) {
      const at = Math.floor(Math.random() * (len - 200));
      const amp = (Math.random() < 0.15 ? 1 : 0.35) * (Math.random() < 0.5 ? -1 : 1);
      for (let k = 0; k < 40; k++) d[at + k] += amp * Math.exp(-k / 6) * (k % 2 ? -0.6 : 1);
    }
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    this.crackleGain = c.createGain();
    this.crackleGain.gain.value = 0;
    src.connect(hp).connect(this.crackleGain).connect(this.out!);
    src.start();
  }

  /** Thunder: a crack if it is close, then a long rolling rumble (`far` 0..1: later, softer, duller). */
  private thunder(far: number) {
    const c = this.ctx;
    if (!c || !sound.on || c.state !== "running") return;
    if (!this.rumble) {
      // Four seconds of brown noise (deep and rolling).
      const len = c.sampleRate * 4;
      this.rumble = c.createBuffer(1, len, c.sampleRate);
      const d = this.rumble.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) {
        v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = v * 3.5;
      }
    }
    const t = c.currentTime + 0.5 + far * 2.5;
    const loud = 0.5 * (1 - 0.55 * far);
    const src = c.createBufferSource();
    src.buffer = this.rumble;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(far < 0.3 ? 900 : 380, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(loud, t + 0.08 + far * 0.4);
    // (rolling: it swells again once or twice as it dies away)
    let at = t + 0.5 + far * 0.4;
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(loud * (0.35 + 0.4 * Math.random()) * (1 - i * 0.25), at);
      at += 0.4 + Math.random() * 0.6;
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.9);
    src.connect(lp).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + 4);
  }

  /** The wind's level: a breath on a still day, gusting in a gale or a snowfall. */
  private bedLevel() {
    return 0.03 + 0.08 * this.airLevel;
  }

  /** How windy it is and how hard it snows (lib/weather.ts), as one 0..1. */
  air(wind: number, snow: number) {
    const level = Math.min(1, Math.max(wind, 0.6 * snow));
    if (Math.abs(level - this.airLevel) < 0.02) return;
    this.airLevel = level;
    if (!this.ctx || !sound.on) return;
    this.bedGain?.gain.setTargetAtTime(this.bedLevel(), this.ctx.currentTime, 0.8);
    this.bedFilter?.frequency.setTargetAtTime(420 + 700 * level, this.ctx.currentTime, 0.8);
  }

  /** How hard it is raining (lib/weather.ts), 0..1. */
  rain(level: number) {
    if (Math.abs(level - this.rainLevel) < 0.02) return;
    this.rainLevel = level;
    if (this.ctx && this.rainGain && sound.on) this.rainGain.gain.setTargetAtTime(0.05 * level, this.ctx.currentTime, 0.5);
  }

  private scheduleBird() {
    window.clearTimeout(this.birdTimer);
    this.birdTimer = window.setTimeout(
      () => {
        if (!sound.on) return;
        // (birds keep quiet in the rain and snow, and at night)
        if (weather.rain + weather.snow < 0.3 && daylight.night < 0.5) this.bird();
        this.scheduleBird();
      },
      3500 + Math.random() * 6000,
    );
  }

  /** A short two- or three-note chirp. */
  private bird() {
    const c = this.ctx;
    if (!c) return;
    const n = 2 + Math.floor(Math.random() * 2);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * 0.11;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** One soft footstep on asphalt. */
  step(strength = 1) {
    const c = this.ctx;
    if (!c || !sound.on || c.state !== "running") return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700 + Math.random() * 300;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * strength * (0.8 + Math.random() * 0.4), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.8, 0.08);
  }

  /** A line said in a word with someone: a soft two-note murmur (higher: `high`). */
  blip(high = false) {
    const c = this.ctx;
    if (!c || !sound.on || c.state !== "running") return;
    const base = high ? 523.25 : 392;
    [base, base * 1.122].forEach((f, i) => {
      const t = c.currentTime + i * 0.07;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + 0.18);
    });
  }

  /** A letter typed out in the courier's bubble: a tiny soft tap. */
  tap() {
    const c = this.ctx;
    if (!c || !sound.on || c.state !== "running") return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.value = 1150 + Math.random() * 250;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.014, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.05);
  }

  /** The delivery chime: two bell-ish notes. */
  chime() {
    const c = this.ctx;
    if (!c || !sound.on || c.state !== "running") return;
    [880, 1318.5].forEach((f, i) => {
      const t = c.currentTime + i * 0.12;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + 0.75);
    });
  }
}

export const sfx = new Sfx();
