"use client";

import { useEffect, useRef, useState } from "react";
import { person } from "@/content/portfolio";

/**
 * "Email": copies the address to the clipboard (rather than opening a mail app the visitor may not
 * use), and says so. The address itself isn't shown on the page.
 */
export function EmailButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // (what a screen reader is told: set afresh on each press, so a second copy is announced too)
  const [said, setSaid] = useState("");
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(person.email);
      ok = true;
    } catch {
      // (no clipboard API, e.g. over plain http: the old way, through a selected text field, then
      // back to the button, so a keyboard user keeps their place)
      const back = document.activeElement as HTMLElement | null;
      const t = document.createElement("textarea");
      t.value = person.email;
      t.setAttribute("readonly", "");
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      try {
        ok = document.execCommand("copy");
      } catch {}
      t.remove();
      back?.focus();
    }
    setState(ok ? "copied" : "failed");
    setSaid("");
    window.requestAnimationFrame(() => setSaid(ok ? "Email address copied to the clipboard" : "Couldn't copy the address"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2500);
  };

  return (
    <span className="email">
      <button type="button" className="btn btn--bright" onClick={copy}>
        {state === "copied" ? "Copied ✓" : state === "failed" ? "Couldn't copy" : "Email"}
        <span className="sr-only"> (copies the address)</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </span>
  );
}
