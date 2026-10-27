"use client";

import { useEffect, useRef, useState } from "react";
import { experience, projects, skillGroups } from "@/content/portfolio";
import { OPEN_DETAILS_EVENT, type DetailsKey } from "@/lib/journey";
import { pauseScroll, resumeScroll } from "@/lib/scroll";
import { sound } from "@/lib/audio";
import { autopilot } from "@/lib/autopilot";

/**
 * The full story behind a card (a job and the projects done in it, or the whole inventory of skills),
 * opened from its "Details" button.
 * The cards themselves carry a title and one plain sentence, so the walk stays easy to take in; the
 * points, numbers and tools are here for whoever wants them. The walk waits while it is open.
 */
export function DetailsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState<DetailsKey | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setKey((e as CustomEvent<DetailsKey>).detail);
      pauseScroll();
      sound.duck = true;
      autopilot.hold(true);
      // (the card behind says the same in short: hidden meanwhile, so it isn't read twice)
      document.documentElement.classList.add("details-open");
      ref.current?.showModal();
    };
    window.addEventListener(OPEN_DETAILS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DETAILS_EVENT, onOpen);
  }, []);

  const close = () => ref.current?.close();
  const role = key?.startsWith("role:") ? experience.find((r) => `role:${r.slug}` === key) : undefined;
  const work = role ? projects.filter((p) => p.job === role.slug) : [];

  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={() => {
        sound.duck = false;
        resumeScroll();
        autopilot.hold(false);
        document.documentElement.classList.remove("details-open");
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="dialog-title"
    >
      {key && (
        <button className="dialog__close" onClick={close} aria-label="Close details">
          ✕
        </button>
      )}
      {key && (
        <div className="dialog__inner">
          {role && (
            <>
              <p className="eyebrow">
                {role.period} · {role.place}
              </p>
              <p className="kicker">{role.org}</p>
              <h2 id="dialog-title" className="h2">
                {role.role}
              </h2>
              <p className="lede">{role.summary}</p>
              <h3 className="dialog__sub">What I did</h3>
              <ul className="ticks">
                {role.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
              {work.length > 0 && <h3 className="dialog__sub">{work.length > 1 ? "Projects" : "Project"}</h3>}
              {work.map((p) => (
                <section key={p.slug} className="work" style={{ ["--accent" as string]: p.color }} aria-labelledby={`w-${p.slug}`}>
                  <p className="eyebrow">
                    {p.status} · {p.period}
                  </p>
                  <h4 id={`w-${p.slug}`} className="work__title">
                    {p.title}
                  </h4>
                  <p className="body">{p.summary}</p>
                  <ul className="ticks">
                    {p.points.map((pt) => (
                      <li key={pt}>{pt}</li>
                    ))}
                  </ul>
                  <ul className="chips">
                    {p.stack.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
          {key === "skills" && (
            <>
              <h2 id="dialog-title" className="h2">
                Inventory
              </h2>
              <div className="skills">
                {skillGroups.map((g) => (
                  <div key={g.label} className="skills__group">
                    <h3 className="skills__label">{g.label}</h3>
                    <ul className="chips">
                      {g.items.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
