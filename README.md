# Portfolio Town

**Live: [portfolio-town-snowy.vercel.app](https://portfolio-town-snowy.vercel.app)**

My portfolio as a small painted planet you walk round. Scrolling moves a courier along the road
through a town, over a river, into a forest and back home through the fields. Each stop on the way
is part of my story: about me, my skills, and the jobs I've had. One lap of the planet is one day,
from morning at the front door through sunset at the bridge to night in the forest.

I'm Siddarath Vats, an AI engineer in Dallas. I build agents, retrieval systems and machine learning
for startups. If you're building something with AI, [get in touch](mailto:siddarathvats.ele17@gmail.com)
or find me on [LinkedIn](https://www.linkedin.com/in/siddarath-vats-51bb65155/).

## What it does

- **Scroll is the walk.** The page and the 3D world stay in step: each card comes up as its landmark
  goes by, and the minimap jumps straight to any stop.
- **Play the journey.** An autopilot walks the whole lap on its own, stopping to greet the people
  along the way.
- **Live weather.** The sky matches the weather where the visitor is: rain, snow, cloud and wind
  come from [Open-Meteo](https://open-meteo.com), using only a city-level estimate of location.
- **Other visitors.** Anyone else on the site at the same time shows up walking the planet, and can
  wave.
- **Music.** A lo-fi playlist plays as you walk, with a switch to turn it off.
- **Private visit stats.** A small first-party counter (time on the page, time at each stop, clicks)
  stored in Redis. IP addresses are scrambled before anything is saved, and the numbers are only
  readable by me.
- **Works on phones**, and respects reduced-motion settings.

## Built with

Next.js 15 (App Router), React 19, TypeScript, Three.js with React Three Fiber, custom GLSL shaders
(water, sky, foliage), GSAP ScrollTrigger and Lenis for scroll, Upstash Redis, Vercel.

All art on the planet was made for this site.

## Run it locally

Needs Node 22.

```bash
npm install
npm run dev
```

Then open [localhost:3000](http://localhost:3000). Add `?debug` to the address to skip the music and
the visit counter while working on it.

The visit stats need an Upstash Redis database (`KV_REST_API_URL` and `KV_REST_API_TOKEN` in
`.env.local`). Without them the site runs as normal and simply doesn't count visits.

## Where things are

| Path | What's there |
| --- | --- |
| `src/content/portfolio.ts` | All the words: about me, skills, jobs and projects |
| `src/lib/journey.ts` | The stops round the planet and how scrolling maps to the walk |
| `src/components/three/planet/` | The planet: terrain, water, sky, weather, the courier and the townsfolk |
| `src/components/overlay/` | Everything on top of the 3D: header, cards, minimap, dialogs |
| `src/app/api/` | Live weather, who's online, and the visit counter |

## Credits

Music from [Mixkit](https://mixkit.co/free-stock-music/) under the Mixkit Stock Music Free License.
Track names and artists are in `public/audio/CREDITS.txt`.
