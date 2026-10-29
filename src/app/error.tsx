"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/stats";
import { isStale, reloadFresh } from "@/lib/stale";

/**
 * If the page itself falls over: its files gone after a deploy, it loads afresh at once (the new
 * version); anything else is reported, with a way to try again, in place of the framework's bare
 * "Application error".
 */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  const stale = isStale(error);
  useEffect(() => {
    if (stale && reloadFresh()) return;
    reportError("page", error);
  }, [error, stale]);
  return (
    <div className="loader crash" role="alert">
      <p className="loader__text">{stale ? "Loading the new version…" : "The town didn't load this time"}</p>
      <button type="button" className="crash__retry" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  );
}
