"use client";

import { useEffect, useState } from "react";
import { autopilot, type AutoState } from "@/lib/autopilot";

const LABEL: Record<AutoState, string> = { playing: "Pause", paused: "Play journey", done: "Replay" };
/** (phones: a short word that fits the header beside the menu) */
const SHORT: Record<AutoState, string> = { playing: "Pause", paused: "Auto-walk", done: "Replay" };

/** Play / pause the self-playing journey. Required as much for a11y (moving content) as for control. */
export function AutoToggle() {
  const [state, setState] = useState<AutoState>("paused");
  useEffect(() => {
    setState(autopilot.state);
    return autopilot.subscribe(setState);
  }, []);
  return (
    <button
      type="button"
      className={`auto auto--${state}`}
      aria-pressed={state === "playing"}
      aria-label={state === "playing" ? "Pause the journey" : state === "done" ? "Replay the journey" : "Play the journey"}
      onClick={() => (state === "done" ? autopilot.replay() : autopilot.toggle())}
    >
      <span className="auto__icon" aria-hidden="true" />
      <span className="auto__label" aria-hidden="true">
        {LABEL[state]}
      </span>
      <span className="auto__short" aria-hidden="true">
        {SHORT[state]}
      </span>
    </button>
  );
}
