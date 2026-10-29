import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

/**
 * The site's own visit stats, kept in the project's Upstash Redis (Vercel Marketplace) for the owner
 * alone: nothing on the site reads them back (see scripts/stats-report.ts). Visitors are told apart by
 * a scrambled form of their IP address; the address itself is never stored.
 *
 * Keys (all under `stats:`):
 *   visits (hash day → visits), uniq:<day> and uniq:all (HyperLogLog of visitors), time_ms (hash
 *   day → ms on the page), stop_ms (hash stop → ms), click (hash label → clicks), country, city,
 *   referrer, device (hash → visits), session:<id> (hash: start, country, city, device, referrer,
 *   visitor, ms; kept 30 days), sessions (list of the latest session ids) and errors (list of the
 *   latest errors visitors met, as JSON: at, sid, error, user agent).
 */

let redis: Redis | null = null;
/** (made on first use: building the site without the database's env vars must still work) */
export function statsDb() {
  if (!redis) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    redis = new Redis({ url, token });
  }
  return redis;
}

/** A visitor's IP, scrambled with the database's own secret: the same visitor gives the same id, but
 *  the address can't be read back from it. */
export function visitorOf(ip: string) {
  return createHash("sha256").update(`${process.env.KV_REST_API_TOKEN ?? ""}:${ip}`).digest("hex").slice(0, 16);
}

export const SESSION_DAYS = 30;
export const RECENT_SESSIONS = 500;
