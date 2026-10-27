/**
 * The site's visit stats (app/api/stats), for the owner: run here, never deployed.
 *
 *   npx tsx --env-file=.env.local scripts/stats-report.mts [days]
 *
 * (`vercel env pull .env.local --yes` first, if .env.local is missing the database's KV_ variables.)
 */
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL;
// (the full token: the read-only one may not run PFCOUNT, which counts the unique visitors)
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("No KV_REST_API_URL / token: run `vercel env pull .env.local --yes` first.");
  process.exit(1);
}
const db = new Redis({ url, token });
const DAYS = Number(process.argv[2] ?? 30);

const num = (h: Record<string, unknown> | null) => Object.entries(h ?? {}).map(([k, v]) => [k, Number(v)] as const);
const top = (h: Record<string, unknown> | null, n = 12) => num(h).sort((a, b) => b[1] - a[1]).slice(0, n);
const mins = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);
const table = (title: string, rows: (readonly [string, number])[], fmt = (v: number) => String(v)) => {
  console.log(`\n${title}`);
  if (!rows.length) return console.log("  (none yet)");
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${fmt(v)}`);
};

const days = Array.from({ length: DAYS }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
const [visits, time, stops, clicks, country, city, referrer, device, uniqAll, recent] = await Promise.all([
  db.hgetall("stats:visits"),
  db.hgetall("stats:time_ms"),
  db.hgetall("stats:stop_ms"),
  db.hgetall("stats:click"),
  db.hgetall("stats:country"),
  db.hgetall("stats:city"),
  db.hgetall("stats:referrer"),
  db.hgetall("stats:device"),
  db.pfcount("stats:uniq:all"),
  db.lrange("stats:sessions", 0, 14),
]);
const uniqDays = await Promise.all(days.map((d) => db.pfcount(`stats:uniq:${d}`)));

const v = Object.fromEntries(num(visits));
const t = Object.fromEntries(num(time));
const totalVisits = days.reduce((s, d) => s + (v[d] ?? 0), 0);
const totalMs = days.reduce((s, d) => s + (t[d] ?? 0), 0);
console.log(`Last ${DAYS} days: ${totalVisits} visits, average ${totalVisits ? mins(totalMs / totalVisits) : "-"} on the page`);
console.log(`Unique visitors (by scrambled IP): ${uniqAll} all time`);
console.log("\nBy day");
for (const d of days.filter((x) => v[x])) console.log(`  ${d}: ${v[d]} visits · ${uniqDays[days.indexOf(d)]} unique · ${mins((t[d] ?? 0) / v[d])} average`);
table("Time at each stop (all time)", top(stops, 20), mins);
table("Clicks (all time)", top(clicks, 25));
table("Countries", top(country));
table("Cities", top(city));
table("Came from", top(referrer));
table("Devices", top(device));

console.log("\nLatest visits");
for (const sid of recent as string[]) {
  const s = await db.hgetall<Record<string, string | number>>(`stats:session:${sid}`);
  if (!s) continue;
  const clicked = Object.entries(s)
    .filter(([k]) => k.startsWith("click:"))
    .map(([k, n]) => `${k.slice(6)}${Number(n) > 1 ? ` ×${n}` : ""}`);
  console.log(
    `  ${new Date(Number(s.start)).toISOString().slice(0, 16).replace("T", " ")}  ${s.city}, ${s.country} · ${s.device} · from ${s.referrer} · ${mins(Number(s.ms))}` +
      (clicked.length ? `\n      clicked: ${clicked.join("; ")}` : ""),
  );
}
