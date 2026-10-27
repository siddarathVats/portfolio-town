"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Canvas, advance, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Noise, SMAA, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { SCENE_READY_EVENT, journey } from "@/lib/journey";
import { LOD_LAYER, warmUp } from "./planet/warm";
import { QUALITY, detectTier, liveQuality, type Tier } from "./quality";
import { createGovernor, keep, pacer, paceBounds, pct, type PaceMode } from "./pacer";
import { Rig } from "./Rig";
import { Planet } from "./planet/Planet";
import { Runner } from "./planet/Runner";
import { Others } from "./planet/Others";
import { Sky } from "./planet/Sky";
import { Ink, InkFXAA } from "./planet/Ink";

/**
 * Tells the page the world is up, so the loader can lift: after the warm-up frames, in which every
 * piece of the town is drawn once (culling off) so all its shaders compile and all its geometry
 * reaches the GPU behind the loader. Otherwise each street would compile or upload the first time it
 * came into view, mid-run, as a hitch of 50-120 ms (on Windows, shader compiles are slow).
 */
const WARM_FRAMES = 2;
function Ready() {
  const n = useRef(0);
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const k = n.current++;
    if (k > WARM_FRAMES) return;
    const warm = k < WARM_FRAMES;
    warmUp.on = warm;
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (warm) {
        if (o.userData.cull === undefined) o.userData.cull = o.frustumCulled;
        o.frustumCulled = false;
      } else if (o.userData.cull !== undefined) o.frustumCulled = o.userData.cull;
    });
    if (!warm) requestAnimationFrame(() => window.dispatchEvent(new Event(SCENE_READY_EVENT)));
  });
  return null;
}

/**
 * ?debug: window.__step(frames) switches to a manual clock and advances it, so tests can play the
 * run forward in a background tab (where the browser stops animation frames).
 */
function DebugStepper() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!location.search.includes("debug")) return;
    let t = -1;
    const w = window as unknown as { __step: (n?: number, dt?: number) => unknown; __r3f: typeof get };
    w.__r3f = get;
    w.__step = (n = 60, dt = 1 / 60) => {
      if (t < 0) {
        // Manual clock from zero: every step is exactly dt.
        setFrameloop("never");
        t = 0;
        advance(t);
      }
      for (let i = 0; i < n; i++) advance((t += dt));
      return [t, get().clock.elapsedTime];
    };
  }, [setFrameloop, get]);
  return null;
}

/**
 * Keeps the frame rate up on slower GPUs. The pacer (below) already keeps every frame on screen for
 * the same time; this lowers the cost when it can only manage half the display's rate, or when it
 * can't even keep to the slowest rate it may draw at (where the browser itself caps pages at 30 fps,
 * as Chrome's energy saver does, half the display's rate isn't on offer, and frames that miss show as
 * a jerky 20-30): after 4 s of that, one step down (resolution, then the shadow map, then the edge
 * smoothing pass), then the pacer tries the full rate again. Where the GPU can be timed and isn't what
 * is holding the frame back (a busy main thread), a lower resolution wouldn't help, so it leaves the
 * picture as it is. It only ever steps down, so it can't flip-flop (each step resizes buffers and
 * hitches once).
 */
function AutoQuality() {
  const st = useRef({ t: 0, slowSince: 0, done: false });
  useFrame(() => {
    const s = st.current;
    if (s.done || liveQuality.manual || pacer.mode !== "auto" || document.visibilityState !== "visible") return;
    s.t += journey.dt;
    if (s.t < 6) return; // let the opening swoop and the first streets pass
    const now = performance.now();
    // (missing their refresh at the slowest rate allowed: more than 1 in 8 of the last 2 s of frames)
    const { maxK } = paceBounds(pacer.vsync);
    const recent = journey.frameMs.slice(-Math.round(2000 / (pacer.k * pacer.vsync)));
    const late = recent.filter((ms) => ms > pacer.k * pacer.vsync * 1.4).length;
    const capped = pacer.k >= maxK && recent.length >= 30 && late > recent.length / 8;
    if (pacer.k <= pacer.minK && !capped) return void (s.slowSince = 0);
    if (!s.slowSince) s.slowSince = now;
    if (now - s.slowSince < 4000) return;
    // (at the cap, the GPU timing can't be trusted to say it isn't the GPU: drivers under-report it)
    const gpuBound = capped || !pacer.gpu.length || pct(pacer.gpu, 0.9) > pacer.vsync * pacer.minK * 0.75;
    const q = liveQuality.get();
    if (gpuBound && q.dpr > 0.62) liveQuality.set({ dpr: Math.max(0.6, q.dpr * 0.85) });
    else if (gpuBound && q.shadow > 1024) liveQuality.set({ shadow: 1024 });
    else if (gpuBound && q.aa !== "off") liveQuality.set({ aa: "off" });
    else return void (s.done = true); // as light as it goes, or not the GPU: an even half rate it is
    pacer.retry = 1;
    s.slowSince = now + 3000; // judge the new setting after it settles
  });
  return null;
}

/**
 * Draws the scene on chosen display refreshes, with the refresh's own timestamp (see pacer.ts), and
 * measures each frame's main-thread and GPU time for that choice and for the ?fps meter.
 */
function Pacer({ mode }: { mode: PaceMode }) {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    pacer.mode = mode;
  }, [mode]);
  useEffect(() => {
    // ?debug: tests step the clock themselves (__step).
    if (location.search.includes("debug")) return;
    setFrameloop("never");
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const timer = ctx.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    let timing = !!timer;
    const queries: WebGLQuery[] = [];
    // A message posted at the end of the frame's scripts runs after the browser's own frame work
    // (style, layout, paint), so it measures the whole main-thread frame.
    const channel = new MessageChannel();
    let started = 0;
    channel.port1.onmessage = () => keep(pacer.main, performance.now() - started);
    const ticks: number[] = [];
    const governor = createGovernor();
    let raf = 0;
    let lastTick = 0;
    let lastDraw = 0;
    // The scene's clock is the refresh timestamps, counted from here.
    let origin = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (pacer.manual) return;
      if (lastTick && now - lastTick < 250) keep(ticks, now - lastTick);
      lastTick = now;
      // The refresh interval: a low percentile of recent ones (busy frames skip refreshes).
      if (ticks.length >= 15) pacer.vsync = Math.max(4, pct(ticks, 0.2));
      const v = pacer.vsync;
      const { minK, maxK } = paceBounds(v);
      pacer.minK = minK;
      if (pacer.mode === 60) pacer.k = Math.max(1, Math.round(1000 / 60 / v));
      else if (pacer.mode === 30) pacer.k = Math.max(1, Math.round(1000 / 30 / v));
      else pacer.k = Math.min(maxK, Math.max(minK, pacer.k));
      const k = pacer.k;
      if (!lastDraw || now - lastDraw > 250) {
        // First frame, or back from a hidden tab: the scene's clock carries on from where it was,
        // one frame on, rather than jumping.
        origin = now - get().clock.elapsedTime * 1000 - k * v;
        lastDraw = now - k * v;
        governor.reset();
      }
      if (now - lastDraw < k * v - v / 2) return;
      keep(journey.frameMs, now - lastDraw, 240);
      if (pacer.mode === "auto") governor.frame(now, Math.round((now - lastDraw) / v) > k, v);
      lastDraw = now;
      started = performance.now();
      let q: WebGLQuery | null = null;
      if (timing && timer) {
        q = ctx.createQuery();
        if (q) ctx.beginQuery(timer.TIME_ELAPSED_EXT, q);
      }
      advance((now - origin) / 1000);
      if (q && timer) {
        ctx.endQuery(timer.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      channel.port2.postMessage(0);
      // GPU times arrive a few frames later.
      while (timer && queries.length && ctx.getQueryParameter(queries[0], ctx.QUERY_RESULT_AVAILABLE)) {
        const done = queries.shift()!;
        if (!ctx.getParameter(timer.GPU_DISJOINT_EXT)) keep(pacer.gpu, ctx.getQueryParameter(done, ctx.QUERY_RESULT) / 1e6);
        ctx.deleteQuery(done);
      }
      if (queries.length > 10) {
        // Results never come (some drivers): stop timing.
        queries.forEach((x) => ctx.deleteQuery(x));
        queries.length = 0;
        timing = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      channel.port1.close();
      queries.forEach((x) => ctx.deleteQuery(x));
      setFrameloop("always");
    };
  }, [get, gl, setFrameloop]);
  return null;
}

/**
 * ?perf=flag,flag switches parts off to measure what each costs (noshadow, lowres, noink).
 * Diagnostics only.
 */
const perf = (flag: string) => typeof location !== "undefined" && new URLSearchParams(location.search).get("perf")?.split(",").includes(flag);

export default function Scene() {
  const [tier, setTier] = useState<Tier>("high");
  const live = useSyncExternalStore(liveQuality.subscribe, liveQuality.get, liveQuality.get);
  useEffect(() => {
    const t = (new URLSearchParams(location.search).get("tier") as Tier | null) ?? detectTier();
    const q = QUALITY[t] ?? QUALITY.high;
    setTier(q.tier);
    // No live blur behind the glass panels on integrated graphics (see globals.css .gpu-lite).
    document.documentElement.classList.toggle("gpu-lite", !q.blur);
    // (a phone's screen has few CSS pixels: drawn sharper it still costs about what a laptop's does)
    const phone = window.matchMedia("(pointer: coarse)").matches && window.innerWidth * window.innerHeight < 520_000;
    // (phones are 2-3x screens: at 1x the drawings' thin ink lines came out blocky, stretched to the
    // glass; 1.5x keeps them clean, and the governor below steps it down if the phone can't keep up)
    const screen = q.tier === "high" ? Math.min(window.devicePixelRatio, q.dpr) : phone ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 1) * q.dpr;
    liveQuality.set({
      dpr: screen * (perf("lowres") ? 0.75 : 1),
      shadow: perf("noshadow") ? 0 : q.shadow,
      aa: perf("noaa") ? "off" : perf("smaa") ? "smaa" : "fxaa",
      pace: (perf("cap30") ? 30 : perf("cap60") ? 60 : "auto") as PaceMode,
    });
  }, []);
  const dpr = live.dpr || 1;
  // The canvas keeps its shadow renderer once on; switching shadows off live just stops the sun casting.
  const shadows = QUALITY[tier].shadow > 0 && !perf("noshadow");
  const ink = !perf("noink");

  return (
    <Canvas
      className="journey-canvas"
      dpr={dpr}
      shadows={shadows ? "percentage" : false}
      camera={{ fov: 44, near: 0.1, far: 140, position: [0, 34, 8] }}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      onCreated={({ gl, scene }) => {
        // Flat toon colours, shown as painted: no filmic curve.
        gl.toneMapping = THREE.NoToneMapping;
        scene.fog = new THREE.Fog("#abd9d0", 34, 110);
        // three picks shadow casters by the main camera's layers, so the town's large shapes (on
        // their own layer, so the camera doesn't draw them up close; see Planet's Culled) never
        // reached the sun's shadow map and the buildings cast no shadows. The shadow pass looks with
        // that layer switched on.
        const castShadows = gl.shadowMap.render.bind(gl.shadowMap);
        gl.shadowMap.render = (lights, s, camera) => {
          const mask = camera.layers.mask;
          camera.layers.enable(LOD_LAYER);
          castShadows(lights, s, camera);
          camera.layers.mask = mask;
        };
      }}
      fallback={<div className="journey-fallback" />}
    >
      {/* A fixed resolution, no auto-switching: changing it mid-run resizes every buffer and hitches. */}
      {/* Rig must mount first: it puts the walker on the road before anything reads it. */}
      <Rig />
      {/* Strong sky fill, softer sun: shadows stay readable mid-tones (about 60% of lit) as in a
          painted scene, not near-black holes. */}
      <hemisphereLight args={["#d8ecea", "#a3bba3", 2.6]} />
      <Sky />
      <Planet />
      <Runner shadows={live.shadow} />
      <Others />
      <Ready />
      <AutoQuality />
      <Pacer mode={live.pace} />
      {/* 8-bit buffers: the colours are flat and untonemapped, so half-float precision bought nothing
          and cost ~9 ms a frame in memory bandwidth on integrated GPUs. */}
      <EffectComposer multisampling={0} frameBufferType={THREE.UnsignedByteType}>
        {/* Line weight in rendered pixels: thinner when the internal resolution is lower, so the
            lines keep their on-screen weight after the upscale. */}
        {ink ? <Ink thickness={dpr > 1.2 ? 1.7 : dpr < 0.9 ? 1.05 : 1.3} /> : <></>}
        <Vignette offset={0.45} darkness={0.15} />
        <Noise opacity={0.018} premultiply />
        {/* Smooths the stair-steps on moving edges and ink lines. FXAA is one pass (SMAA is three and
            measured ~5 ms a frame on an integrated GPU); SMAA stays switchable from ?fps to compare. */}
        {live.aa === "fxaa" ? <InkFXAA /> : live.aa === "smaa" ? <SMAA /> : <></>}
      </EffectComposer>
      <DebugStepper />
    </Canvas>
  );
}
