import { RECENT_SESSIONS, SESSION_DAYS, statsDb, visitorOf } from "@/lib/server/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SID = /^[A-Za-z0-9_-]{8,40}$/;
const STOP = /^[a-z0-9-]{2,40}$/;
/** The latest errors visitors met, newest first, and how many are kept. */
const ERRORS = "stats:errors";
const KEPT_ERRORS = 100;
/** The most a report can add (ms): it is sent every half minute or so, and as the page is left. */
const MAX_MS = 120_000;

type Report = {
  sid: string;
  /** Sent with the first report of a visit. */
  start?: { ref?: string; mobile?: boolean };
  /** Time the page was in view since the last report (ms). */
  ms?: number;
  /** Of that, the time at each stop (ms). */
  stops?: Record<string, number>;
  /** What was clicked, and how often. */
  clicks?: Record<string, number>;
  /** Something that went wrong on the page, sent on its own as it happens. */
  error?: string;
};

const count = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);
const entries = (o: unknown, key: (k: string) => boolean, max: number) =>
  o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).filter(([k]) => key(k)).slice(0, 24).map(([k, v]) => [k, count(v, max)] as const).filter(([, v]) => v > 0) : [];

/** A visit's report (sent with navigator.sendBeacon, so read as text): added to the totals. */
export async function POST(req: Request) {
  const db = statsDb();
  if (!db) return new Response(null, { status: 204 });
  let r: Report;
  try {
    const text = await req.text();
    if (text.length > 8_000) return new Response(null, { status: 413 });
    r = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!r || typeof r.sid !== "string" || !SID.test(r.sid)) return new Response(null, { status: 400 });

  const day = new Date().toISOString().slice(0, 10);
  const session = `stats:session:${r.sid}`;
  const p = db.pipeline();
  if (r.start) {
    const h = req.headers;
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
    const visitor = visitorOf(ip);
    const country = (h.get("x-vercel-ip-country") ?? "??").slice(0, 2);
    const city = decodeURIComponent(h.get("x-vercel-ip-city") ?? "").slice(0, 60) || "unknown";
    const device = r.start.mobile ? "phone" : "desktop";
    let referrer = "direct";
    try {
      if (r.start.ref) referrer = new URL(r.start.ref).hostname.slice(0, 80) || "direct";
    } catch {}
    p.hincrby("stats:visits", day, 1);
    p.pfadd(`stats:uniq:${day}`, visitor);
    p.pfadd("stats:uniq:all", visitor);
    p.hincrby("stats:country", country, 1);
    p.hincrby("stats:city", `${city}, ${country}`, 1);
    p.hincrby("stats:referrer", referrer, 1);
    p.hincrby("stats:device", device, 1);
    p.hset(session, { start: Date.now(), country, city, device, referrer, visitor, ms: 0 });
    p.lpush("stats:sessions", r.sid);
    p.ltrim("stats:sessions", 0, RECENT_SESSIONS - 1);
  }
  const ms = count(r.ms, MAX_MS);
  if (ms > 0) {
    p.hincrby("stats:time_ms", day, ms);
    p.hincrby(session, "ms", ms);
  }
  for (const [stop, t] of entries(r.stops, (k) => STOP.test(k), MAX_MS)) p.hincrby("stats:stop_ms", stop, t);
  for (const [label, n] of entries(r.clicks, (k) => k.length > 0 && k.length <= 60, 50)) {
    p.hincrby("stats:click", label, n);
    p.hincrby(session, `click:${label}`, n);
  }
  if (typeof r.error === "string" && r.error) {
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
    p.lpush(ERRORS, JSON.stringify({ at: Date.now(), sid: r.sid, error: r.error.slice(0, 300), ua }));
    p.ltrim(ERRORS, 0, KEPT_ERRORS - 1);
  }
  p.expire(session, SESSION_DAYS * 86_400);
  try {
    await p.exec();
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}
