"use client";

import { useEffect, useState } from "react";
import { sky } from "@/lib/sky";

/** An icon for the sky now: sun, cloud, rain, snow, fog or storm. */
function Glyph({ code }: { code: number | null }) {
  const c = code ?? 0;
  const kind =
    code === null ? "story" : c >= 95 ? "storm" : (c >= 71 && c <= 77) || c === 85 || c === 86 ? "snow" : c >= 51 ? "rain" : c === 45 || c === 48 ? "fog" : c >= 2 ? "cloud" : "sun";
  return (
    <svg className="wx__glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {kind === "sun" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </>
      ) : kind === "story" ? (
        // (a book: the walk's own weather)
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      ) : (
        <>
          <path d="M7 15.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.5 3.3 3.3 0 0 1 .3 6.5z" />
          {kind === "rain" ? <path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5" /> : null}
          {kind === "snow" ? <path d="M9 19.5h.01M12.5 21h.01M16 19.5h.01" strokeWidth="2.6" /> : null}
          {kind === "storm" ? <path d="M13 17l-2 3h3l-2 3" /> : null}
          {kind === "fog" ? <path d="M5 19h14M7 22h10" /> : null}
        </>
      )}
    </svg>
  );
}

/**
 * Live weather on/off. Live: the walk's sky does what the sky over the visitor's town is doing (and
 * the switch says what that is); off: the walk's own passing showers. Hidden if live weather can't be
 * had here.
 */
export function WeatherToggle({ variant = "hero" }: { variant?: "hero" | "menu" }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    sky.start();
    return sky.subscribe(() => setTick((n) => n + 1));
  }, []);
  if (sky.status === "unavailable") return null;
  const live = sky.mode === "live";
  const what = sky.status === "loading" ? "checking the sky…" : sky.label;
  return (
    <button
      type="button"
      className={`wx wx--${variant} ${live ? "wx--live" : ""}`}
      role="switch"
      aria-checked={live}
      onClick={() => sky.toggle()}
      title={live ? "The sky here follows the weather where you are. Tap for the story's own weather." : "Tap to bring in the weather where you are."}
    >
      <Glyph code={live ? sky.code : null} />
      <span className="wx__text">
        <span className="wx__name">{live ? "Live weather" : "Story weather"}</span>
        {live && what ? <span className="wx__what">{what}</span> : null}
      </span>
      <span className="wx__switch" aria-hidden="true" />
    </button>
  );
}
