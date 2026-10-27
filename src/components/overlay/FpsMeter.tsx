"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { liveQuality, type Live } from "@/components/three/quality";
import { pacer, pct } from "@/components/three/pacer";
import { journey } from "@/lib/journey";

/**
 * ?fps: a small live meter for frame pacing, over the last two seconds of frames the scene actually
 * drew (not display refreshes, which would read 60 even when every other one is skipped): the typical
 * (p50) and slow (p95) frame time, how many frames were uneven (more than a third off the typical
 * one, which is what reads as judder), and frames per second. The second line says what the pacer is
 * doing (the display's refresh rate and which refreshes it draws on) and what a frame costs: the main
 * thread's share and, where the browser can time it, the GPU's. Its switches change resolution,
 * shadows, edge smoothing and the pacing live, to compare them on the same stretch of road.
 */
export function FpsMeter() {
  const [on, setOn] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const el2 = useRef<HTMLDivElement>(null);
  const live = useSyncExternalStore(liveQuality.subscribe, liveQuality.get, liveQuality.get);
  useEffect(() => setOn(location.search.includes("fps")), []);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      if (!el.current || !el2.current) return;
      const all = journey.frameMs;
      const win: number[] = [];
      let acc = 0;
      for (let i = all.length - 1; i >= 0 && acc < 2000; i--) {
        win.push(all[i]);
        acc += all[i];
      }
      if (!win.length) return;
      const p50 = pct(win, 0.5);
      const p95 = pct(win, 0.95);
      const uneven = win.filter((d) => Math.abs(d - p50) > p50 / 3).length / win.length;
      el.current.textContent = `p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} ms · ${(uneven * 100).toFixed(0)}% uneven · ${(win.length / (acc / 1000)).toFixed(0)} fps`;
      const gpu = pacer.gpu.length ? ` · gpu ${pct(pacer.gpu, 0.5).toFixed(1)}` : "";
      el2.current.textContent = `${(1000 / pacer.vsync).toFixed(0)} Hz, drawing every ${pacer.k === 1 ? "refresh" : `${pacer.k} refreshes`} · main ${pct(pacer.main, 0.5).toFixed(1)}${gpu} ms`;
    }, 500);
    return () => window.clearInterval(id);
  }, [on]);
  if (!on) return null;
  const opt = <K extends keyof Live>(key: K, value: Live[K], label: string) => (
    <button key={label} className={live[key] === value ? "on" : ""} onClick={() => ((liveQuality.manual = true), liveQuality.set({ [key]: value } as Partial<Live>))}>
      {label}
    </button>
  );
  return (
    <div className="fps">
      <div ref={el} />
      <div ref={el2} />
      <div className="fps__row">res {opt("dpr", 0.6, "0.6")}{opt("dpr", 0.75, "0.75")}{opt("dpr", 1, "1")}{opt("dpr", 1.25, "1.25")} · now {live.dpr.toFixed(2)}</div>
      <div className="fps__row">shadow {opt("shadow", 0, "off")}{opt("shadow", 1024, "1024")}{opt("shadow", 2048, "2048")}</div>
      <div className="fps__row">AA {opt("aa", "off", "off")}{opt("aa", "fxaa", "FXAA")}{opt("aa", "smaa", "SMAA")}</div>
      <div className="fps__row">pace {opt("pace", "auto", "auto")}{opt("pace", 60, "60")}{opt("pace", 30, "30")}</div>
    </div>
  );
}
