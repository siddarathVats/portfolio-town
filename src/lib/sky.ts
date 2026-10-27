"use client";

import type { SkyReport } from "@/app/api/sky/route";

/**
 * Live weather: the sky over the visitor's town (app/api/sky), turned into what the walk's weather
 * (lib/weather.ts) should be doing: how hard it rains or snows, how overcast and misty it is, the wind,
 * and whether there is thunder about. The visitor can switch it off on the way in ("story weather":
 * the walk's own passing showers); the choice is remembered on this device.
 *
 * If the weather can't be had (no location, the service down) the walk falls back to story weather.
 */
export type SkyMode = "live" | "story";
export type SkyStatus = "loading" | "live" | "unavailable";

/** What the walk's weather should settle to, 0..1 each. */
export type SkyTarget = { rain: number; snow: number; overcast: number; haze: number; wind: number; storm: boolean };

const PREF_KEY = "walk:weather";
const REFRESH_MS = 15 * 60 * 1000;

const readPref = (): SkyMode => {
  try {
    return localStorage.getItem(PREF_KEY) === "story" ? "story" : "live";
  } catch {
    return "live";
  }
};

/** The WMO weather codes, as words for the switch. */
function describe(code: number) {
  if (code <= 1) return "clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 61 || code === 80) return "light rain";
  if (code === 63 || code === 81 || code === 66) return "rain";
  if (code === 65 || code === 82 || code === 67) return "heavy rain";
  if (code === 71 || code === 77 || code === 85) return "light snow";
  if (code === 73) return "snow";
  if (code === 75 || code === 86) return "heavy snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

/**
 * The code and the amounts, as levels for the walk. Rain and snow only show above a quarter (that is
 * the cloud gathering, lib/weather.ts), so even a drizzle starts there.
 */
export function targetFor(r: SkyReport): SkyTarget {
  const c = r.code;
  const lift = (amount: number, floor: number) => Math.min(1, Math.max(floor, amount));
  let rain = 0;
  let snow = 0;
  if (c >= 51 && c <= 57) rain = lift(0.45 + r.rain / 4, 0.45);
  else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) {
    const base = c === 61 || c === 80 ? 0.6 : c === 65 || c === 82 || c >= 95 ? 0.95 : 0.8;
    rain = lift(base + r.rain / 20, base);
  } else if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
    const base = c === 71 || c === 77 || c === 85 ? 0.55 : c === 73 ? 0.78 : 0.95;
    snow = lift(base + r.snow / 4, base);
  }
  // (sleet and freezing rain come down as rain; the codes say which way the precipitation is falling)
  const overcast = c === 3 ? 0.55 : c === 2 ? 0.25 : Math.min(0.45, r.cloud * 0.4);
  const haze = c === 45 || c === 48 ? 1 : 0;
  const wind = Math.min(1, Math.max(0, (r.wind - 8) / 40));
  return { rain, snow, overcast, haze, wind, storm: c >= 95 };
}

class Sky {
  mode: SkyMode = "live";
  status: SkyStatus = "loading";
  report: SkyReport | null = null;
  target: SkyTarget | null = null;
  private listeners = new Set<() => void>();
  private timer = 0;
  private started = false;

  /** Whether the walk is following the real weather right now. */
  get live() {
    return this.mode === "live" && this.status === "live" && this.target !== null;
  }

  /** Words for the switch, e.g. "Austin · light rain". */
  get label() {
    if (!this.report) return null;
    const what = describe(this.report.code);
    return this.report.city ? `${this.report.city} · ${what}` : what;
  }

  get code() {
    return this.report?.code ?? null;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** Call once on the client. */
  start() {
    if (this.started) return;
    this.started = true;
    this.mode = readPref();
    this.emit();
    void this.fetch();
    this.timer = window.setInterval(() => void this.fetch(), REFRESH_MS);
  }

  setMode(mode: SkyMode) {
    this.mode = mode;
    try {
      localStorage.setItem(PREF_KEY, mode);
    } catch {
      /* private mode: not remembered */
    }
    this.emit();
  }

  toggle() {
    this.setMode(this.mode === "live" ? "story" : "live");
  }

  /** ?debug: pretend the sky is this (a WMO code, with rain/snow amounts if wanted). */
  fake(code: number, extra: Partial<SkyReport> = {}) {
    this.set({ code, rain: 0, snow: 0, cloud: 0.8, wind: 10, temp: 5, isDay: true, city: "Testville", ...extra });
  }

  private set(r: SkyReport) {
    this.report = r;
    this.target = targetFor(r);
    this.status = "live";
    this.emit();
  }

  private async fetch() {
    const q = new URLSearchParams(location.search);
    // (?lat=&lon= for trying it locally, where there's no location from the host)
    const local = q.get("lat") && q.get("lon") ? `?lat=${q.get("lat")}&lon=${q.get("lon")}&city=${encodeURIComponent(q.get("city") ?? "")}` : "";
    try {
      const r = await fetch(`/api/sky${local}`);
      if (!r.ok) throw new Error(String(r.status));
      this.set(await r.json());
    } catch {
      if (this.status !== "live") {
        this.status = "unavailable";
        window.clearInterval(this.timer);
        this.emit();
      }
    }
  }
}

export const sky = new Sky();

if (typeof window !== "undefined" && location.search.includes("debug")) (window as unknown as { __sky: Sky }).__sky = sky;
