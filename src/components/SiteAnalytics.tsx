"use client";

import { useEffect } from "react";
import { Analytics } from "@vercel/analytics/next";
import { startStats } from "@/lib/stats";

/**
 * Vercel Web Analytics: visitors, where they come from (country, the site that linked them), their
 * device and browser; and the site's own stats (lib/stats.ts: time at each stop, clicks, visit
 * length). Test visits (?debug, ?vclock) are left out, so they don't count as visitors.
 */
export function SiteAnalytics() {
  useEffect(() => startStats(), []);
  return <Analytics beforeSend={(e) => (/[?&](debug|vclock)/.test(new URL(e.url).search) ? null : e)} />;
}
