"use client";

import { BLOCKS, journey, nearestStop } from "./journey";

/**
 * The site's own visit stats (app/api/stats, for the owner alone): how long the page is in view, how
 * much of that at each stop, and what is clicked. Reported every half minute and as the page is left
 * (sendBeacon, so it survives the tab closing). Test visits (?debug, ?vclock) report nothing.
 */
const EVERY_MS = 30_000;
/** The first report goes a few seconds in (a visit that leaves at once still counts). */
const FIRST_MS = 3_000;

/** What a click was on, by where it is and what it says (a link's "(opens in a new tab)" left off). */
function labelOf(el: Element) {
  const area = el.closest(".map")
    ? "Map"
    : el.closest(".nav, .header")
      ? "Menu"
      : el.closest("dialog")
        ? "Details"
        : (el.closest("section.block")?.id ?? "Page");
  const text = (el.getAttribute("aria-label") || el.textContent || "")
    .replace(/\((opens in a new tab|copies the address)\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${area}: ${text || el.tagName.toLowerCase()}`.slice(0, 60);
}

export function startStats(): () => void {
  if (/[?&](debug|vclock)/.test(location.search)) return () => {};
  const sid = (crypto.randomUUID?.() ?? `${Math.random()}${Date.now()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  let started = false;
  let ms = 0;
  let stops: Record<string, number> = {};
  let clicks: Record<string, number> = {};
  // (from the moment the page was asked for: the wait while it loads is time spent on it too, and a
  // visitor who gave up during it showed as a visit of 0 s)
  let last = 0;
  let begun = false;
  /** Whether the page was in view at the last count (the time since is counted by that). */
  let shown = document.visibilityState === "visible";

  // The time in view, and where on the walk it was spent (a second at a time). A stretch counts if
  // the page was in view when it began: a busy page (still setting up the town) may only get round to
  // counting after the visitor has already switched away.
  const tick = () => {
    const now = performance.now();
    const dt = begun ? Math.min(now - last, 5_000) : now;
    begun = true;
    last = now;
    const was = shown;
    shown = document.visibilityState === "visible";
    if (!was) return;
    ms += dt;
    const id = BLOCKS[nearestStop(journey.current).index].id;
    stops[id] = (stops[id] ?? 0) + dt;
  };
  const send = () => {
    tick();
    if (started && ms < 500 && !Object.keys(clicks).length) return;
    const body = JSON.stringify({
      sid,
      start: started ? undefined : { ref: document.referrer || undefined, mobile: window.matchMedia("(pointer: coarse)").matches },
      ms: Math.round(ms),
      stops: Object.fromEntries(Object.entries(stops).map(([k, v]) => [k, Math.round(v)])),
      clicks,
    });
    const sent = navigator.sendBeacon?.("/api/stats", body);
    if (!sent) void fetch("/api/stats", { method: "POST", body, keepalive: true }).catch(() => {});
    started = true;
    ms = 0;
    stops = {};
    clicks = {};
  };

  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.("a, button");
    if (!el) return;
    const label = labelOf(el);
    clicks[label] = (clicks[label] ?? 0) + 1;
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") send();
    else {
      last = performance.now();
      shown = true;
    }
  };
  const ticker = window.setInterval(tick, 1_000);
  const first = window.setTimeout(send, FIRST_MS);
  const reporter = window.setInterval(send, EVERY_MS);
  document.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", send);
  return () => {
    window.clearInterval(ticker);
    window.clearTimeout(first);
    window.clearInterval(reporter);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", send);
  };
}
