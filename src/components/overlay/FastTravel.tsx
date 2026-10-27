"use client";

import { useEffect, useState } from "react";
import { FAST_TRAVEL_EVENT } from "@/lib/journey";

/** A quick fade through the sky colour while the runner is sent somewhere far (home, by default). */
export function FastTravel() {
  const [on, setOn] = useState(false);
  const [to, setTo] = useState("Home");
  useEffect(() => {
    let t = 0;
    const go = (e: Event) => {
      setTo((e as CustomEvent<string | undefined>).detail || "Home");
      setOn(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setOn(false), 900);
    };
    window.addEventListener(FAST_TRAVEL_EVENT, go);
    return () => {
      window.removeEventListener(FAST_TRAVEL_EVENT, go);
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div className={`travel ${on ? "travel--on" : ""}`} aria-hidden="true">
      <p className="travel__text">Going to {to}</p>
    </div>
  );
}
