"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DELIVERABLE, deliveries } from "@/lib/deliveries";
import { scrollToId } from "@/lib/scroll";
import { experience } from "@/content/portfolio";

const none: string[] = [];

/** Rows of the checklist: single stops, and groups (the jobs) counted together. */
const ROWS: { label: string; ids: string[]; go: string }[] = [
  { label: "Home", ids: ["home"], go: "home" },
  { label: "About", ids: ["origins"], go: "origins" },
  { label: "Inventory", ids: ["inventory"], go: "inventory" },
  { label: "Experience", ids: experience.map((r) => `exp-${r.slug}`), go: "trail" },
  { label: "Contact", ids: ["shrine"], go: "shrine" },
];

/** How much of the walk you have seen: each stop ticked off once its card has been up, and a list
 *  of them to jump to. */
export function Checklist() {
  const done = useSyncExternalStore(deliveries.subscribe, deliveries.getState, () => none);
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(0);
  useEffect(() => deliveries.start(), []);
  useEffect(() => {
    if (done.length) setPop((p) => p + 1);
  }, [done.length]);

  const total = DELIVERABLE.length;
  const all = done.length >= total;
  return (
    <aside className={`check ${open ? "check--open" : ""}`} aria-label="Progress">
      <button className="check__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="check__icon" aria-hidden="true">
          ✓
        </span>
        <span key={pop} className="check__count">
          {all ? "All seen" : `${done.length} of ${total} seen`}
        </span>
      </button>
      <div className="check__body">
        <p className="check__title">Stops</p>
        <ol className="check__list">
          {ROWS.map((r) => {
            const n = r.ids.filter((id) => done.includes(id)).length;
            const ok = n === r.ids.length;
            return (
              <li key={r.label}>
                <button className={`check__row ${ok ? "check__row--done" : ""}`} onClick={() => scrollToId(r.go)}>
                  <span className="check__box" aria-hidden="true">
                    {ok ? "✓" : ""}
                  </span>
                  <span className="check__label">{r.label}</span>
                  {r.ids.length > 1 && (
                    <span className="check__n">
                      {n}/{r.ids.length}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
