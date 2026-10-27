"use client";

import { useEffect, useState } from "react";
import { SCENE_READY_EVENT } from "@/lib/journey";
import { autopilot } from "@/lib/autopilot";

/** Covers the first frames while the run loads; never blocks for more than 8s. Then the journey starts playing. */
export function Loader() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setDone(true);
      autopilot.autostart();
    };
    window.addEventListener(SCENE_READY_EVENT, finish);
    const t = window.setTimeout(finish, 8000);
    return () => {
      window.removeEventListener(SCENE_READY_EVENT, finish);
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div className={`loader ${done ? "loader--done" : ""}`} aria-hidden={done}>
      <span className="loader__bar"><i /></span>
      <p className="loader__text">Now loading…</p>
    </div>
  );
}
