"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { gsap } from "gsap";
import { BLOCKS, ZONES, journey, type Zone } from "@/lib/journey";
import { ROUTE_LENGTH } from "@/lib/world";
import { scrollToId } from "@/lib/scroll";
import { emoteGlyph, players, type EmoteEvent } from "@/lib/players";
import { crowd } from "@/lib/crowd";
import { experience } from "@/content/portfolio";

const none: ReturnType<typeof crowd.getList> = [];

const SIZE = 120;
const C = SIZE / 2;
const RING = 44;

/** The road round the planet as a ring, home at the top, walking clockwise. */
const at = (s: number, r = RING) => {
  const a = (s / ROUTE_LENGTH) * Math.PI * 2 - Math.PI / 2;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
};
const arc = (s0: number, s1: number) => {
  const [x0, y0] = at(s0);
  const [x1, y1] = at(s1);
  const large = s1 - s0 > ROUTE_LENGTH / 2 ? 1 : 0;
  return `M${x0.toFixed(1)},${y0.toFixed(1)}A${RING},${RING} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
};

/** The planet from above: the loop of the road, every stop, where you are and everyone else playing. */
export function Minimap() {
  const geo = useMemo(() => {
    const zones = (Object.keys(ZONES) as Zone[]).map((z) => {
      const [a, b] = ZONES[z];
      // Town starts just before the front door, so it wraps round the top of the ring.
      return { z, d: a < 0 ? `${arc(ROUTE_LENGTH + a, ROUTE_LENGTH - 0.01)}${arc(0, b)}` : arc(a, b) };
    });
    // (the jobs along the trail are stops to go to as well, each named by its role)
    const stops = BLOCKS.map((b) => {
      const [x, y] = at(b.s);
      const job = experience.find((r) => `exp-${r.slug}` === b.id);
      return { id: b.id, label: b.label ?? job?.role, job: !!job, x, y };
    });
    return { zones, stops };
  }, []);

  const dot = useRef<SVGCircleElement>(null);
  // Everyone else drawn on the planet (lib/crowd.ts: the nearest few, moving smoothly), round the
  // loop where they are; their emotes rise from their dots.
  const shown = useSyncExternalStore(crowd.subscribe, crowd.getList, () => none);
  const dots = useRef(new Map<string, SVGGElement>());
  const where = useRef(new Map<string, { x: number; y: number }>());
  useEffect(() => {
    let last = "";
    const tick = () => {
      const [x, y] = at(journey.s);
      const v = `${x.toFixed(1)},${y.toFixed(1)}`;
      if (v !== last && dot.current) {
        dot.current.setAttribute("transform", `translate(${v})`);
        last = v;
      }
      crowd.update(performance.now() / 1000);
      for (const g of crowd.getList()) {
        const [ox, oy] = at(g.s, RING);
        where.current.set(g.p.id, { x: ox, y: oy });
        const el = dots.current.get(g.p.id);
        if (!el) continue;
        el.setAttribute("transform", `translate(${ox.toFixed(2)},${oy.toFixed(2)})`);
        el.setAttribute("opacity", g.fade.toFixed(2));
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  const [bubbles, setBubbles] = useState<(EmoteEvent & { x: number; y: number })[]>([]);
  useEffect(() => {
    const timers = new Set<number>();
    const off = players.onEmote((e) => {
      const at = e.id === players.getState().me?.id ? null : where.current.get(e.id);
      if (!at) return;
      setBubbles((b) => [...b.slice(-5), { ...e, ...at }]);
      const id = window.setTimeout(() => {
        timers.delete(id);
        setBubbles((b) => b.filter((x) => x.key !== e.key));
      }, 1800);
      timers.add(id);
    });
    return () => {
      off();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return (
    <nav className="map" aria-label="Planet map">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={C} cy={C} r={RING + 9} className="map__planet" />
        {geo.zones.map((z) => (
          <path key={z.z} d={z.d} className={`map__road map__road--${z.z}`} />
        ))}
        {geo.stops.map((s) => (
          <circle
            key={s.id}
            cx={s.x}
            cy={s.y}
            r={s.job ? 2.6 : s.label ? 3.2 : 1.8}
            className={s.job ? "map__stop map__stop--job" : s.label ? "map__stop map__stop--major" : "map__stop"}
          />
        ))}
        {shown.map((g) => (
          <g
            key={g.p.id}
            ref={(el) => void (el ? dots.current.set(g.p.id, el) : dots.current.delete(g.p.id))}
            className="map__player"
            transform={`translate(${at(g.s, RING).map((v) => v.toFixed(2)).join(",")})`}
            opacity={g.fade}
          >
            <title>{g.p.name}</title>
            <circle r={3.4} fill={g.p.color} />
          </g>
        ))}
        <circle ref={dot} r={4.4} className="map__you" />
      </svg>
      {geo.stops.map((s) =>
        s.label ? (
          <button key={s.id} className="map__hit" style={{ top: `${(s.y / SIZE) * 100}%`, left: `${(s.x / SIZE) * 100}%` }} onClick={() => scrollToId(s.id, s.label)} aria-label={`Go to ${s.label}`}>
            <span className="map__label">{s.label}</span>
          </button>
        ) : null,
      )}
      {bubbles.map((b) => (
        <span key={b.key} className="map__bubble" style={{ top: `${(b.y / SIZE) * 100}%`, left: `${(b.x / SIZE) * 100}%` }} aria-hidden="true">
          {emoteGlyph(b.emote)}
        </span>
      ))}
    </nav>
  );
}
