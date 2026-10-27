import type { PaceMode } from "./pacer";

/**
 * - high: a discrete graphics card (full resolution, big shadow map, live glass blur).
 * - mid: integrated laptop graphics (Intel Iris/UHD, AMD APUs, Apple): the same world drawn at a
 *   lower internal resolution, a smaller shadow map and no live blur behind the glass panels. On an
 *   Iris Xe at 1800×900 the full-quality frame measured 16-19 delivered fps with uneven pacing,
 *   which makes any animation look jerky; this tier is sized to hold a steady frame instead.
 * - low: phones and low-core devices (no shadows).
 */
export type Tier = "high" | "mid" | "low";

export type Quality = { tier: Tier; dpr: number; shadow: 0 | 1024 | 2048; blur: boolean };

export const QUALITY: Record<Tier, Quality> = {
  high: { tier: "high", dpr: 1.25, shadow: 2048, blur: true },
  mid: { tier: "mid", dpr: 0.75, shadow: 1024, blur: false },
  low: { tier: "low", dpr: 0.75, shadow: 0, blur: false },
};

/** The graphics chip's name, where the browser tells it. */
export function gpuName() {
  if (typeof document === "undefined") return "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

const DISCRETE = /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|radeon r9|arc a\d/i;
const INTEGRATED = /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega|apple|mali|adreno|powervr|swiftshader|llvmpipe/i;

export function detectTier(): Tier {
  if (typeof window === "undefined") return "high";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse || cores <= 4 || mem <= 4) return "low";
  const gpu = gpuName();
  if (DISCRETE.test(gpu)) return "high";
  if (INTEGRATED.test(gpu)) return "mid";
  return "high";
}

/**
 * Settings that can be switched live from the ?fps meter, to compare their cost on the same route
 * without reloading: pixel ratio, shadow map size (0 = off), edge smoothing, and the frame pacing
 * (auto, or a steady 60 or 30: see pacer.ts).
 */
export type Live = { dpr: number; shadow: 0 | 1024 | 2048; aa: "off" | "fxaa" | "smaa"; pace: PaceMode };
let live: Live = { dpr: 0, shadow: 2048, aa: "fxaa", pace: "auto" };
const subs = new Set<() => void>();
export const liveQuality = {
  /** Set once the visitor picks settings themselves (the ?fps switches): no automatic changes after. */
  manual: false,
  get: () => live,
  set(p: Partial<Live>) {
    live = { ...live, ...p };
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
