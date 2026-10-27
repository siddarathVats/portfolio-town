"use client";

import { useEffect, useState } from "react";
import { sound } from "@/lib/audio";

/** Music on/off. Four bars dance while it plays; they rest flat when it's off. */
export function SoundToggle({ variant = "header" }: { variant?: "header" | "hero" | "menu" }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(sound.on);
    return sound.subscribe(setOn);
  }, []);
  const label = variant === "hero" ? (on ? "Sound on" : "Play with sound") : variant === "menu" ? (on ? "Music: on" : "Music: off") : "Sound";
  return (
    <button
      type="button"
      className={`sound sound--${variant} ${on ? "sound--on" : ""}`}
      aria-pressed={on}
      aria-label={variant === "header" ? "Music" : label}
      onClick={() => sound.toggle()}
    >
      <span className="sound__bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="sound__label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
