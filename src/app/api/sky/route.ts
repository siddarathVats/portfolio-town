import type { NextRequest } from "next/server";

/**
 * The weather where the visitor is, now, for the live sky (lib/sky.ts). Where they are comes from
 * Vercel's estimate from their IP address (city level; no permission prompt), rounded to a tenth of a
 * degree (~10 km) before it goes to Open-Meteo (free, no key). Nothing is stored. Answers for the same
 * spot are shared for ten minutes.
 *
 * Off Vercel (no location headers) it takes `?lat=&lon=` instead, for trying it out locally.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SkyReport = {
  /** WMO weather code (https://open-meteo.com/en/docs#weathervariables). */
  code: number;
  /** Rain and snow falling now (mm/h, cm/h), overcast (0..1), wind (km/h). */
  rain: number;
  snow: number;
  cloud: number;
  wind: number;
  temp: number;
  isDay: boolean;
  city: string | null;
};

const round = (v: number) => Math.round(v * 10) / 10;

export async function GET(req: NextRequest) {
  const h = req.headers;
  const q = req.nextUrl.searchParams;
  const headerLat = h.get("x-vercel-ip-latitude");
  const lat = Number(headerLat ?? q.get("lat"));
  const lon = Number(h.get("x-vercel-ip-longitude") ?? q.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "no location" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const rawCity = headerLat ? h.get("x-vercel-ip-city") : q.get("city");
  let city: string | null = null;
  try {
    city = rawCity ? decodeURIComponent(rawCity) : null;
  } catch {
    city = rawCity;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${round(lat)}&longitude=${round(lon)}` +
    `&current=temperature_2m,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m&wind_speed_unit=kmh`;
  try {
    const r = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(String(r.status));
    const c = (await r.json()).current;
    const report: SkyReport = {
      code: c.weather_code,
      rain: (c.rain ?? 0) + (c.showers ?? 0),
      snow: c.snowfall ?? 0,
      cloud: (c.cloud_cover ?? 0) / 100,
      wind: c.wind_speed_10m ?? 0,
      temp: c.temperature_2m,
      isDay: c.is_day === 1,
      city,
    };
    return Response.json(report, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    return Response.json({ error: "weather unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
