"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BLOCKS, LAP_EVENT, expSide, journey, openDetails, stopProgress } from "@/lib/journey";
import { deliveries } from "@/lib/deliveries";
import { startScroll, scrollToId, scrollToProgress } from "@/lib/scroll";
import { autopilot } from "@/lib/autopilot";
import { experience, origins, person, projects, skillGroups } from "@/content/portfolio";
import { Header } from "./Header";
import { Minimap } from "./Minimap";
import { FastTravel } from "./FastTravel";
import { PlayersHud } from "./PlayersHud";
import { Checklist } from "./Checklist";
import { FpsMeter } from "./FpsMeter";
import { DetailsDialog } from "./DetailsDialog";
import { Loader } from "./Loader";
import { SoundToggle } from "./SoundToggle";
import { WeatherToggle } from "./WeatherToggle";
import { EmailButton } from "./EmailButton";
import { sound } from "@/lib/audio";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const Scene = dynamic(() => import("@/components/three/Scene"), { ssr: false });

/** How much of the inventory its card shows: the first few groups, the main few of each (the whole
 *  of it is in its details). */
const SKILLS_SHOWN = 3;
const GROUPS_SHOWN = 3;
/** The groups left for the details, named under the card's. */
const MORE_GROUPS = skillGroups.slice(GROUPS_SHOWN).map((g) => g.label);

/** How far along the walk you are: a thin bar under the header (shown on phones, in place of the
 *  minimap and the counters). */
function TripBar() {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = -1;
    const tick = () => {
      const p = Math.round(journey.target * 400) / 400;
      if (p !== last && bar.current) bar.current.style.transform = `scaleX(${(last = p)})`;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);
  return (
    <div className="trip" aria-hidden="true">
      <span ref={bar} className="trip__fill" />
    </div>
  );
}

/** The stops a phone steps between (BLOCKS indices). */
const STEPS = BLOCKS.map((_, i) => i);

/**
 * Phones: back and forth between the stops, a step at a time (‹ and ›), with which stop this is. The
 * walker runs there (and the autopilot, if it was walking, hands over, as when the page is scrolled).
 */
function Stepper() {
  const [at, setAt] = useState(0);
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    // (each stop by its card's title, or its label)
    setNames(
      STEPS.map((i) => {
        const b = BLOCKS[i];
        const h = document.getElementById(b.id)?.querySelector("h1, h2, h3")?.textContent?.trim();
        return b.label ?? (h && h.length < 28 ? h : h ? `${h.slice(0, 26)}…` : b.id === "bridge" ? "The bridge" : "On the road");
      }),
    );
    let last = -1;
    const tick = () => {
      const p = journey.target;
      let k = 0;
      for (let j = 1; j < STEPS.length; j++) if (Math.abs(stopProgress[STEPS[j]] - p) < Math.abs(stopProgress[STEPS[k]] - p)) k = j;
      if (k !== last) setAt((last = k));
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);
  const go = (d: number) => {
    const k = Math.min(STEPS.length - 1, Math.max(0, at + d));
    setAt(k);
    scrollToProgress(stopProgress[STEPS[k]]);
  };
  return (
    <nav className="stepper" aria-label="Stops">
      <button type="button" className="stepper__btn" onClick={() => go(-1)} disabled={at <= 0} aria-label="Previous stop">
        <span aria-hidden="true">‹</span>
      </button>
      <span className="stepper__now" aria-live="polite">
        <b>{at + 1}</b>/{STEPS.length} · {names[at] ?? ""}
      </span>
      <button type="button" className="stepper__btn" onClick={() => go(1)} disabled={at >= STEPS.length - 1} aria-label="Next stop">
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

export default function Journey() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => startScroll(), []);
  // A lap of the planet is done: the cards blink out while the page goes back to the top, and the
  // walker carries on through the front door.
  useEffect(() => {
    let t = 0;
    const lap = () => {
      const el = root.current;
      if (!el) return;
      el.classList.remove("journey--lap");
      void el.offsetWidth;
      el.classList.add("journey--lap");
      window.clearTimeout(t);
      t = window.setTimeout(() => el.classList.remove("journey--lap"), 700);
    };
    window.addEventListener(LAP_EVENT, lap);
    return () => {
      window.removeEventListener(LAP_EVENT, lap);
      window.clearTimeout(t);
    };
  }, []);
  useEffect(() => sound.resumeFromPreference(), []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ reduce: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)", phone: "(max-width: 760px)" }, (ctx) => {
        const reduce = Boolean(ctx.conditions?.reduce);
        // (phones: every card is a sheet along the bottom, so it rises from there and sinks back,
        // never sliding in from a side where it would start off the screen)
        const phone = Boolean(ctx.conditions?.phone);
        gsap.utils.toArray<HTMLElement>("[data-panel]").forEach((panel) => {
          const section = panel.closest("section");
          if (!section) return;
          const side = phone && panel.dataset.side !== "center" ? "bottom" : panel.dataset.side;
          const dx = reduce ? 0 : side === "left" ? -90 : side === "right" ? 90 : 0;
          const dy = reduce ? 0 : side === "center" ? 36 : side === "bottom" ? 60 : 0;

          if (section.id === "home") {
            gsap.set(panel, { autoAlpha: 1 });
            gsap.to(panel, {
              autoAlpha: 0,
              y: reduce ? 0 : -50,
              ease: "none",
              scrollTrigger: { trigger: section, start: "top top", end: "55% top", scrub: true },
            });
            return;
          }
          const last = section.id === "shrine";
          const tl = gsap.timeline({
            scrollTrigger: { trigger: section, start: "top 45%", end: last ? "bottom bottom" : "bottom 55%", scrub: reduce ? true : 0.25 },
          });
          // Glass materialises (scales up from the side it arrives on) and leaves the way it came.
          const s0 = reduce ? 1 : 0.94;
          gsap.set(panel, { transformOrigin: side === "left" ? "0% 50%" : side === "right" ? "100% 50%" : side === "bottom" ? "50% 100%" : "50% 50%" });
          // Quick in and out: the run never stops, so most of each card's stretch is spent fully up.
          // (the glass itself thickens as it arrives, its blur growing with its scale (--mat, see
          // globals.css), and thins again as it goes: a material arriving, not a picture fading in)
          tl.fromTo(panel, { autoAlpha: 0, x: dx, y: dy, scale: s0, "--mat": reduce ? 1 : 0 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, "--mat": 1, duration: 0.16, ease: "power2.out" });
          tl.to(panel, { autoAlpha: 1, duration: last ? 0.84 : 0.68 });
          if (!last) tl.to(panel, { autoAlpha: 0, x: dx * 0.4, y: dy * 0.5, scale: s0, "--mat": reduce ? 1 : 0, duration: 0.16, ease: "power2.in" });
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const block = (id: string) => BLOCKS.find((b) => b.id === id)!;
  const height = (id: string) => ({ height: `${block(id).vh}vh` });

  return (
    <div ref={root} className="journey">
      <a className="skip-link" href="#trail" onClick={(e) => {
          e.preventDefault();
          scrollToId("trail");
        }}>
        Skip to experience
      </a>
      <div className="canvas-layer" aria-hidden="true">
        <Scene />
      </div>
      <Loader />
      <Header />
      <TripBar />
      <Stepper />
      <Minimap />
      <FastTravel />
      <PlayersHud />
      <Checklist />
      <FpsMeter />
      <DetailsDialog />

      <main>
        {/* Home */}
        <section id="home" className="block" style={height("home")} aria-labelledby="hero-name">
          <div className="panel panel--hero" data-panel data-side="left">
            <h1 id="hero-name" className="hero-name">
              {person.name.split(" ").map((w) => (
                <span key={w}>{w}</span>
              ))}
            </h1>
            <p className="hero-title">{person.title}</p>
            <p className="hero-tagline">{person.tagline}</p>
            <div className="hero-actions">
              <button className="cta" onClick={() => autopilot.go()}>
                Start the walk <span aria-hidden="true">▶</span>
              </button>
              <SoundToggle variant="hero" />
            </div>
            <WeatherToggle />
            <p className="hint">Sit back and watch, or scroll at your own pace</p>
          </div>
        </section>

        <section id="setoff" className="block" style={height("setoff")} aria-label="Interlude">
          <div className="panel panel--line" data-panel data-side="center">
            <p className="whisper">Every adventure starts at the front door.</p>
          </div>
        </section>

        {/* About, and the education */}
        <section id="origins" className="block" style={height("origins")} aria-labelledby="origins-h">
          <div className="panel panel--side" data-panel data-side="left">
            <div className="panel__body">
              <h2 id="origins-h" className="h2">About me</h2>
              <p className="lede">{origins.intro}</p>
              <h3 className="edu__head">Education</h3>
              <ul className="edu">
                {origins.education.map((e) => (
                  <li key={e.degree}>
                    <span className="edu__deg">{e.degree}</span>
                    <span className="edu__meta">
                      {e.school} · {e.place}
                    </span>
                    <span className="edu__meta">{e.period}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="inventory" className="block" style={height("inventory")} aria-labelledby="skills-h">
          <div className="panel panel--side panel--wide" data-panel data-side="left">
            <div className="panel__body">
              <h2 id="skills-h" className="h2">Inventory</h2>
              <div className="skills">
                {skillGroups.slice(0, GROUPS_SHOWN).map((g) => (
                  <div key={g.label} className="skills__group">
                    <span className="skills__label">{g.label}</span>
                    <ul className="chips">
                      {g.items.slice(0, SKILLS_SHOWN).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {MORE_GROUPS.length > 0 && <p className="skills__more">+ {MORE_GROUPS.join(", ")}</p>}
              <div className="card-actions">
                <button className="btn" onClick={() => openDetails("skills")}>
                  View details
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="bridge" className="block" style={height("bridge")} aria-label="Interlude">
          <div className="panel panel--line" data-panel data-side="center">
            <p className="whisper">The road ran out. The path didn’t.</p>
          </div>
        </section>

        {/* Experience */}
        <section id="trail" className="block" style={height("trail")} aria-labelledby="exp-h">
          <div className="panel panel--line" data-panel data-side="center">
            <h2 id="exp-h" className="h2 h2--center">Experience</h2>
          </div>
        </section>

        {experience.map((r, k) => {
          const side = expSide(k) === -1 ? "right" : "left";
          return (
            <section key={r.slug} id={`exp-${r.slug}`} className="block" style={height(`exp-${r.slug}`)} aria-labelledby={`r-${r.slug}`}>
              <article className={`panel panel--card panel--${side}`} data-panel data-side={side}>
                <div className="panel__body">
                  <p className="eyebrow">
                    {r.period} · {r.place}
                  </p>
                  <h3 id={`r-${r.slug}`} className="h3">
                    {r.role}
                  </h3>
                  <p className="kicker">{r.org}</p>
                  <p className="body">{r.summary}</p>
                  <div className="card-actions">
                    <button className="btn" onClick={() => openDetails(`role:${r.slug}`)} aria-label={`Details: ${r.role}, ${r.org}`}>
                      Details
                    </button>
                    {/* (the work's own links beside it, a tap away) */}
                    {projects
                      .filter((p) => p.job === r.slug)
                      .flatMap((p) => p.links)
                      .map((l) => (
                        <a key={l.href} className="btn btn--bright" href={l.href} target="_blank" rel="noreferrer">
                          {l.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ))}
                  </div>
                </div>
              </article>
            </section>
          );
        })}

        {/* Contact */}
        <section id="shrine" className="block" style={height("shrine")} aria-labelledby="contact-h">
          <div className="panel panel--gate" data-panel data-side="left">
            <h2 id="contact-h" className="h2 h2--gate">Let&apos;s work together</h2>
            <p className="lede">Building something with AI? I&apos;d love to hear about it.</p>
            <div className="gate-actions">
              <EmailButton />
              <a className="btn" href={person.linkedin} target="_blank" rel="noreferrer">
                LinkedIn ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
              {person.github && (
                <a className="btn btn--ghost" href={person.github} target="_blank" rel="noreferrer">
                  GitHub ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
            <button
              className="loop"
              onClick={() => {
                deliveries.reset();
                autopilot.replay();
              }}
            >
              <span aria-hidden="true">↺</span> Start over
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
