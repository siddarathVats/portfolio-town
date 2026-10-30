import * as THREE from "three";
import { GIFT_TO, GIRL_AT, PICK_AT } from "@/lib/gift";
import { BLOCKS, PERSON_AT, ZONES, zoneAt } from "@/lib/journey";
import { experience } from "@/content/portfolio";
import { townsfolk } from "@/content/townsfolk";
import { PLANET_RADIUS, ROUTE_LENGTH, beside, distanceToRoute, loopDelta, makeFrame, randomSurface, rng, routeFrame, routePoint, standAt, wrapS, type Frame } from "@/lib/world";
import { C } from "./style";
import * as P from "./props";

/**
 * Where everything stands on the planet, built once and deterministically: a landmark for every
 * stop (home, a shop per project, the bridge, a tower per job, the post office at the save point),
 * a hillside town of houses, shops and small blocks round the road with gardens and gaps between,
 * the forest and the fields, and the rest of the little world covered in trees. Static props are merged into a few
 * vertex-coloured meshes, one per stretch of road, so they draw (and cull) in big pieces.
 */

/** Road half-width, and the pavement either side in town (metres). */
export const ROAD_HALF = 0.95;
export const PAVE_HALF = 1.5;
/** Where the people waiting at the town's stops stand: mid-pavement, clear of the shop fronts. */
const KERBSIDE = 1.22;
/** The stream crosses the road at the bridge stop. */
export const BRIDGE_S = BLOCKS.find((b) => b.id === "bridge")!.s;
/** How far a walker's feet are above the bare ground at s on the bridge: up and over its hump. 0 off it. */
export const deckLift = (s: number) => P.bridgeRise(loopDelta(BRIDGE_S, s));
/** The rise of the bridge per metre along the road at s (positive going up toward its middle). */
export const deckGrade = (s: number) => (deckLift(s + 0.05) - deckLift(s - 0.05)) / 0.1;

/** Paved road (asphalt top) or dirt path (packed earth) under the walker, by the stretches drawn. */
let stretches: { paved: [number, number][]; dirt: [number, number][] } | null = null;
const inStretch = (list: [number, number][], s: number, edge: number) => {
  let k = 0;
  // (stretches meet across the loop's seam, so look either side of it too)
  for (const x of [s, s - ROUTE_LENGTH, s + ROUTE_LENGTH])
    for (const [a, b] of list) k = Math.max(k, Math.min(1, Math.max(0, Math.min(x - a, b - x) / edge + 0.5)));
  return k;
};
/**
 * How far a walker's feet are above the bare ground at s: on the asphalt (3.5 cm proud of the
 * ground), the dirt path (2.5 cm), or the bridge, so feet stand on what is drawn under them instead
 * of floating over it or sinking into it.
 */
export function walkLift(s: number) {
  stretches ??= roadStretches();
  const w = wrapS(s);
  const surface = 0.035 * inStretch(stretches.paved, w, 0.4) + 0.025 * inStretch(stretches.dirt, w, 0.4);
  return Math.max(surface, deckLift(s));
}

const CHUNKS = 24;

// ---------- hills ----------
// The land is flat along the road and rises into hills away from it, so the town climbs the
// slopes on either side; the stream keeps a valley of its own.
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hillNoise = (d: THREE.Vector3) =>
  0.5 + 0.3 * Math.sin(d.x * 5.1 + d.y * 2.3) * Math.sin(d.z * 4.7 - d.x * 1.9) + 0.2 * Math.sin(d.y * 11 + d.z * 7.3 + 1.1);
const _bf = routeFrame(BRIDGE_S);
const _hd = new THREE.Vector3();

/**
 * Where a walker goes at s, and which way they face: along the road, except over the bridge. The road
 * bends some 30 degrees through it, but the bridge is straight, so on the road's line they walked a
 * curve across its deck, drifting toward one wall and back, and the camera behind them on the same
 * curve looked across the bridge from beside it. Over the bridge they keep to the middle of its deck,
 * easing off the road's bend onto that line along the last WALK_IN metres of each approach.
 */
const WALK_IN = 4;
const _wp = new THREE.Vector3();
const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
function walkPoint(s: number, out: THREE.Vector3, reach: number) {
  routePoint(s, out);
  const d = loopDelta(BRIDGE_S, s);
  const w = 1 - smooth(P.BRIDGE_HALF, P.BRIDGE_HALF + reach, Math.abs(d));
  if (w <= 0) return out;
  _wp.copy(_bf.pos).addScaledVector(_bf.fwd, d).setLength(PLANET_RADIUS);
  return out.lerp(_wp, w).setLength(PLANET_RADIUS);
}
/** `reach`: how far out along the approaches the line is eased onto the bridge's (the camera, some
 *  way behind the walker, keeps to it further out, so it is behind them, not beside the bridge). */
export function walkFrame(s: number, out: Frame = makeFrame(), reach = WALK_IN) {
  routeFrame(s, out);
  if (Math.abs(loopDelta(BRIDGE_S, s)) > P.BRIDGE_HALF + reach + 0.5) return out;
  walkPoint(s, out.pos, reach);
  out.up.copy(out.pos).normalize();
  out.fwd.subVectors(walkPoint(s + 0.35, _wa, reach), walkPoint(s - 0.35, _wb, reach));
  out.fwd.addScaledVector(out.up, -out.fwd.dot(out.up)).normalize();
  out.right.crossVectors(out.fwd, out.up).normalize();
  return out;
}
/** Height of the ground above the sphere at a surface point (metres). */
export function heightAt(p: THREE.Vector3) {
  const d = _hd.copy(p).normalize();
  const road = smooth(3.4, 15, distanceToRoute(p));
  if (road <= 0) return 0;
  const stream = smooth(2.2, 7, Math.abs(Math.asin(Math.min(1, Math.abs(d.dot(_bf.fwd))))) * PLANET_RADIUS);
  return road * stream * (1.2 + 4.2 * hillNoise(d));
}
/** A surface point lifted onto the hills. */
export const onGround = (p: THREE.Vector3) => p.setLength(PLANET_RADIUS + heightAt(p));
/** Landmarks stand on the side away from the card, so the card never hides them. */
const landmarkSide = (side: number) => (side === 0 ? 1 : -side);

export type Landmark = { id: string; pos: THREE.Vector3; height: number; quest: boolean };
/** Someone waiting at a stop for their letter. */
export type Npc = { id: string; pos: THREE.Vector3; look: THREE.Vector3; who: number; s: number };
/** A stem the courier picks: its stalk and its flower, built on their own. */
export type Pickable = { blades: THREE.BufferGeometry; flowers: THREE.InstancedBufferGeometry };


/**
 * The town's layout: every building, prop, tree and person, laid out from fixed random sequences.
 * Worked out as a series of steps (a `yield` between them), so the page can do it a slice at a time
 * (planInSlices) rather than in one go: half a second on a laptop, two or more on a phone, through
 * which the page would otherwise stand frozen, its loading bar stuck.
 */
function* planSteps() {
  const r = rng(11);
  const chunks = Array.from({ length: CHUNKS }, () => new P.Geo());
  const chunkOf = (s: number) => chunks[Math.floor((wrapS(s) / ROUTE_LENGTH) * CHUNKS) % CHUNKS];
  const taken: { p: THREE.Vector3; r: number; road?: boolean; building?: boolean }[] = [];
  const landmarks: Landmark[] = [];
  const npcs: Npc[] = [];
  /** Kerb runs: which side of the road (-1, 1), and from and to s (m). */
  const kerbs: [number, number, number][] = [];
  const v = new THREE.Vector3();
  const free = (p: THREE.Vector3, rad: number) => taken.every((t) => t.p.distanceTo(p) > t.r + rad);
  const claim = (p: THREE.Vector3, rad: number, building = false) => rad > 0 && taken.push({ p: p.clone(), r: rad, building });
  /**
   * Props that would stand in another's space are built into this, which is never drawn: nothing
   * ends up parked through anything else, and the random draws (so the rest of the layout) stay
   * exactly the same.
   */
  const ghost = new P.Geo();
  /** Room for a prop: on the pavement it only has to clear other props (the road strip is kept
   * clear of buildings, not of bins and bicycles); elsewhere, anything already there. */
  const clear = (pos: THREE.Vector3, rad: number, lat: number) =>
    // (Buildings are claimed as circles that overhang the pavement; their fronts stand behind it.)
    Math.abs(lat) < PAVE_HALF + 0.4 ? taken.every((t) => t.road || t.building || t.p.distanceTo(pos) > t.r + rad) : free(pos, rad);
  const room = (pos: THREE.Vector3, rad: number, s: number, lat: number) => {
    if (rad > 0 && !clear(pos, rad, lat)) return ghost;
    claim(pos, rad, Math.abs(lat) > 2.5 && rad >= 1.4);
    return chunkOf(s);
  };

  /** A prop beside the road at s, its front turned to the road. */
  /** Things near the lane stand to the lane's vertical, so the street reads upright, not splayed. */
  const laneUp = (s: number, lat: number) => (Math.abs(lat) < 6 ? routeFrame(s).up : undefined);
  const facing = (s: number, lat: number, rad = 0) => {
    const pos = onGround(beside(s, lat));
    return new P.Kit(room(pos, rad, s, lat), standAt(pos, routePoint(s), 1, new THREE.Matrix4(), -0.06, laneUp(s, lat)));
  };
  /** A prop beside the road at s, its front turned the way the road runs. */
  const along = (s: number, lat: number, rad = 0) => {
    const pos = onGround(beside(s, lat));
    return new P.Kit(room(pos, rad, s, lat), standAt(pos, beside(s + 1, lat), 1, new THREE.Matrix4(), -0.06, laneUp(s, lat)));
  };
  /** A prop off the road, turned any way. */
  const loose = (pos: THREE.Vector3, s: number, rad = 0) => {
    onGround(pos);
    claim(pos, rad);
    const f = routeFrame(s);
    const look = pos.clone().add(f.fwd.applyAxisAngle(pos.clone().normalize(), r() * Math.PI * 2));
    return new P.Kit(chunkOf(s), standAt(pos, look, 1, new THREE.Matrix4(), -0.03));
  };
  /** Where each person waits (s, lateral), to move them if a wall turns out too near. */
  const waits: [number, number][] = [];
  const npc = (id: string, s: number, lat: number) => {
    const pos = onGround(beside(s, lat));
    claim(pos, 0.4);
    // The schoolgirl (drawing 3) is Hana, who waits at one stop only (see lib/gift.ts); each of the
    // others is someone of their own (content/townsfolk.ts).
    const who = id === GIFT_TO ? 3 : (townsfolk[id]?.drawing ?? 0);
    npcs.push({ id, pos, look: routePoint(s), who, s });
    waits.push([s, lat]);
  };

  // The road itself is never built on.
  for (let s = 0; s < ROUTE_LENGTH; s += 0.8) taken.push({ p: routePoint(s), r: PAVE_HALF - 0.2, road: true });
  yield;
  /** Each building draws from its own random sequence, so how it is dressed never shifts anything else. */
  const own = () => rng(Math.floor(r() * 4294967296));
  /** A stop's own building, dressed in full. */
  const rich = (k: P.Kit) => ((k.detail = 2), k);
  /** Metres along a row of buildings standing `lat` out, per metre of road at s: fewer on the inside
   *  of a bend, where the plots fan in, more on the outside. */
  const stretch = (s: number, lat: number) => beside(s + 0.5, lat, v).distanceTo(beside(s - 0.5, lat));
  /**
   * The ground plans of the buildings put up so far (centre, axes, half sizes), so none goes up
   * standing in another: plots that clear each other along the road can still meet at the back on a
   * bend, or at a corner when turned off square.
   */
  type Plan = { c: THREE.Vector3; x: THREE.Vector3; z: THREE.Vector3; hw: number; hd: number; reach: number };
  /** A building's plan: its walls, and how far its cornice or eaves reach past them. */
  const planOf = (m: THREE.Matrix4, w: number, d: number, reach = 0.25): Plan => ({
    c: new THREE.Vector3().setFromMatrixPosition(m),
    x: new THREE.Vector3().setFromMatrixColumn(m, 0).normalize(),
    z: new THREE.Vector3().setFromMatrixColumn(m, 2).normalize(),
    hw: w / 2,
    hd: d / 2,
    reach,
  });
  const plans: Plan[] = [];
  /** Whether two plans' roofs come within `gap` of each other (tested across each one's sides). */
  const near = (a: Plan, b: Plan, gap: number) => {
    const t = b.c.clone().sub(a.c);
    const g = gap + a.reach + b.reach;
    if (t.length() > a.hw + a.hd + b.hw + b.hd + g) return false;
    const half = (p: Plan, n: THREE.Vector3) => p.hw * Math.abs(p.x.dot(n)) + p.hd * Math.abs(p.z.dot(n));
    return [a.x, a.z, b.x, b.z].every((n) => Math.abs(t.dot(n)) < half(a, n) + half(b, n) + g);
  };
  const crowded = (p: Plan, gap: number) => plans.some((q) => near(p, q, gap));
  /** Where the stops' buildings stand along the lane (s from, to, and which side), so the street's
   *  buildings keep clear of them. */
  const spans: { side: number; from: number; to: number }[] = [];
  const span = (k: P.Kit, s: number, lat: number, w: number, d: number) => {
    plans.push(planOf(k.frame, w, d, 0.35));
    const side = Math.sign(lat);
    const sc = Math.min(stretch(s, lat - (side * d) / 2), stretch(s, lat + (side * d) / 2));
    spans.push({ side, from: s - w / 2 / sc, to: s + w / 2 / sc });
    // (the street keeps 0.8 m from it: room for its eaves and the neighbour's)
    k.sideRoom = [0.8, 0.8];
  };

  // ---------- landmarks, one per stop ----------
  const paved = (s: number) => zoneAt(s) === "town";
  /** The stops along the lane through town. */
  const city = BLOCKS.filter((b) => paved(b.s));
  /** The stops whose surroundings are dressed in full: the labelled ones. */
  const focal = city.filter((b) => b.label);
  const dressedAt = (s: number) => focal.some((b) => Math.abs(loopDelta(b.s, s)) < 4.5);
  BLOCKS.forEach((b) => {
    const side = landmarkSide(b.side);
    const s = b.s;
    const mark = (lat: number, height: number, quest = false) => landmarks.push({ id: b.id, pos: onGround(beside(s, lat)), height, quest });
    if (b.label && paved(s)) P.crossing(along(s + 2.2, 0), ROAD_HALF);
    if (b.id === "home") {
      const k = rich(facing(s, side * 3.2, 1.5));
      span(k, s, side * 3.2, 3.4, 2.8);
      P.house(k, own(), 3.4, 2.8);
      P.postBox(facing(s - 2.1, side * 1.35, 0.3), 0, 0);
      P.planters(facing(s + 2.3, side * 1.4, 0.4), r);
      mark(side * 3.2, 3);
    } else if (b.id === "setoff") {
      P.busSign(facing(s + 1.2, -1.42, 0.3));
    } else if (b.id === "origins") {
      // (the school, About and the education in one stop: a block a floor taller than the
      // neighbours', its door under a blue sign)
      const k = rich(facing(s, side * 3.2, 1.5));
      span(k, s, side * 3.2, 3.6, 3);
      P.block(k, own(), 3.6, 3, 4);
      npc(b.id, PERSON_AT[b.id], side * KERBSIDE);
      mark(side * 3.2, 4 * P.FLOOR, true);
    } else if (b.id === "inventory") {
      const k = rich(facing(s, side * 3.15, 1.5));
      span(k, s, side * 3.15, 3.2, 2.8);
      P.shop(k, own(), 3.2, 2.8, C.awning[2]);
      // (a lantern by the door on the near side only: the camera, on the bend past the shop toward the
      // bridge, came through one hung on the far side)
      const ahead = new THREE.Vector3().setFromMatrixColumn(k.frame, 0).dot(routeFrame(s).fwd) > 0;
      if (dressedAt(s)) P.lantern(k, ahead ? -1.05 : 1.05, 2.45, 1.7);
      // (the vending machine on the near side of the shop: past it the lane bends for the bridge, and
      // the camera, easing onto the bridge's line behind the courier, came through it there)
      // (back by the shop's side wall, out of the kerb: in front of it, it stood between the camera
      // and the shopkeeper, who said his line from behind it)
      P.vending(facing(s - 2.1, side * 2.45, 0.4), r);
      spans.push({ side, from: s - 2.6, to: s - 1.6 });
      npc(b.id, PERSON_AT[b.id], side * KERBSIDE);
      mark(side * 3.15, 2 * P.FLOOR, true);
    } else if (b.id === "bridge") {
      // An overlook before the bridge: the lane opens to the stream and the hills beyond, behind
      // a barrier with warning signs, and a bench to sit and look.
      P.barrier(facing(s - 4.5, 2.2, 0.4), 1.6);
      P.barrier(facing(s - 6.5, 2.4, 0.4), 1.6);
      // (the signs back by the barriers: at the road's edge, their poles stood up through the middle
      // of the picture as the camera rose for the view)
      P.warningSign(facing(s - 5.5, 2.9, 0.3));
      P.noEntry(facing(s - 7.5, -2.6, 0.3));
      P.bench(facing(s - 5.5, -2.4, 0.6));
      // The stream runs across the road here; the bridge carries the road over it.
      P.bridge(along(s, 0), 2.4);
      for (const k of [-1, 1]) {
        P.boulder(facing(s + k * 2.6, -k * 3.2, 0.8), r, 1.3);
        P.bush(facing(s - k * 2.4, k * 3, 0.8), r, 1.2);
      }
    } else if (b.id === "trail") {
      P.signpost(facing(s, -2.5, 0.4), r);
      P.bench(facing(s + 1.4, 3, 0.7));
    } else if (b.id.startsWith("exp-")) {
      const k = experience.findIndex((x) => `exp-${x.slug}` === b.id);
      const t = facing(s, side * 4.8, 2.8);
      P.tower(t, own(), 3.2, 3.2, 6 + k, C.sign[k % C.sign.length]);
      plans.push(planOf(t.frame, 3.2, 3.2, 0.1));
      npc(b.id, PERSON_AT[b.id], side * 2.2);
      mark(side * 4.8, (6 + k) * P.FLOOR, true);
    } else if (b.id === "shrine") {
      const po = rich(facing(s, side * 4.6, 2.8));
      P.postOffice(po, own());
      plans.push(planOf(po.frame, 3.6, 3, 0.35));
      P.bench(facing(s + 2.2, -side * 2.9, 0.7));
      P.tree(facing(s - 2.6, -side * 3.2, 0.8), r, 1.2);
      npc(b.id, PERSON_AT[b.id], side * 2.1);
      mark(side * 4.6, 2 * P.FLOOR + 1, true);
    }
  });

  yield;
  // ---------- the hillside town ----------
  // A lane of houses, shops and small blocks with slivers of space between them, each turned a
  // little off square and set a little in or out, and a thin scatter of roofs on the slopes behind.
  // It is composed rather than filled: between the stops a lot is left open now and then (a garden
  // behind a low wall, or a view up the hill past a railing), the town thins out to houses at its
  // ends, and only the stretches round a few stops are dressed in full (meters, lamps, AC units,
  // lanterns, bikes and pots by the doors). Elsewhere the facades stay quiet, so those places stand out.
  const [t0, t1] = ZONES.town;
  /** The open lots between each pair of stops along the lane, in walking order: on which side, and a
   *  garden or a view (none where the street should stay close). */
  const OPENINGS: [side: -1 | 1, kind: "garden" | "view"][][] = [
    [[-1, "garden"]],
    [[-1, "garden"], [1, "view"]],
    [[1, "view"]],
    [[1, "view"]], // (up the hill to the water tower)
    [[-1, "garden"]],
    [],
    [[1, "view"]],
    [[-1, "garden"], [1, "view"]],
    [[-1, "view"]],
    [],
    [[1, "garden"]],
  ];
  const lots = city.slice(1).flatMap((b, i) => {
    const a = city[i];
    const half = Math.min(2.5, (b.s - a.s - 6.5) / 2);
    const mid = (a.s + b.s) / 2;
    return half < 1.5 ? [] : OPENINGS[i % OPENINGS.length].map(([side, kind]) => ({ side, kind, from: mid - half, to: mid + half }));
  });
  // The flowers (lib/gift.ts), on the forest trail: the courier picks them from a patch of wildflowers
  // beside the path just past the trail's signpost, and the girl waits a few steps on, by the
  // bench, among the trees (at night by the time the walk gets there, with the fireflies out).
  const trailS = BLOCKS.find((b) => b.id === "trail")!.s;
  const garden = { s: trailS + PICK_AT, side: -1 };
  npc(GIFT_TO, trailS + GIRL_AT, 1.55);
  // The bed of wild flowers by the path (its own random sequence and no claim on the ground, so
  // nothing else in the forest moves), and at its near edge, by the courier's hand as they crouch,
  // the three stems they pick: each built on its own, so it can go as it is picked (and grow back).
  const BED = 1.55;
  P.wildflowerBed(facing(garden.s, garden.side * BED), rng(29), 2.2, 1.3);
  const pickables = [
    [-0.12, 0.92, 0, 0.3],
    [0.06, 0.88, 1, 0.34],
    [0.2, 0.95, 0, 0.28],
  ].map(([ds, lat, kind, h], i) => {
    const g = new P.Geo();
    const sp = garden.s + ds;
    const pos = onGround(beside(sp, garden.side * lat));
    const k = new P.Kit(g, standAt(pos, routePoint(sp), 1, new THREE.Matrix4(), -0.06, laneUp(sp, lat)));
    P.wildflower(k, rng(71 + i), kind, 0, 0, h);
    return { blades: g.buildBlades()!, flowers: g.buildFlowers()! };
  });
  /** How far before the town's end its lane stops being built up (m). */
  const LANE_OPEN = 4;
  /** Toward the ends of the town the street thins out to houses. */
  const edgeAt = (s: number) => Math.min(s - t0, t1 - s) < 9;
  /** Where a building facing the lane at s stands, turned `yaw` (radians) off square. */
  const frontFrame = (s: number, lat: number, yaw: number) => {
    const look = beside(s + Math.tan(yaw) * Math.abs(lat), 0);
    return standAt(onGround(beside(s, lat)), look, 1, new THREE.Matrix4(), -0.12, laneUp(s, lat));
  };
  /** Put up a building there: claim its ground (a circle of `rad`), keep its plan, hand back its kit
   *  (and once it is built, `built` notes how far its roof reaches). */
  const build = (s: number, m: THREE.Matrix4, w: number, d: number, rad: number) => {
    claim(new THREE.Vector3().setFromMatrixPosition(m), rad, true);
    plans.push(planOf(m, w, d));
    return new P.Kit(chunkOf(s), m);
  };
  const built = (k: P.Kit) => void (plans[plans.length - 1].reach = k.reach);
  const xAxis = new THREE.Vector3();
  for (const side of [-1, 1]) {
    // What the street's buildings keep clear of on this side: the stops' buildings and the open lots.
    const keepOut = [...spans.filter((b) => b.side === side).map((b) => ({ ...b, open: false })), ...lots.filter((l) => l.side === side).map((l) => ({ ...l, open: true }))];
    let s = t0 + r() * 2;
    /** Where the last building on this side ended (none yet, or an open lot behind). */
    let end = -Infinity;
    // (the last few metres before the stream are left open: the lane opens out to the view of it)
    while (s < t1 - LANE_OPEN) {
      yield;
      const w = 2.8 + r() * 1.2;
      const d = 2.6 + r() * 0.5;
      // (wide enough for a cornice or the eaves on both sides of it)
      const gap = 0.6 + r() * 0.45;
      const front = PAVE_HALF + 0.12 + r() * 0.35;
      // The plot's length along the road: its width at the front or the back, whichever is the
      // tighter fit on a bend.
      const sc = Math.min(stretch(s + w / 2, side * front), stretch(s + w / 2, side * (front + d)));
      const ws = w / sc;
      const hit = keepOut.find((b) => s < b.to + (b.open ? 0.5 : 0.8) && s + ws > b.from - (b.open ? 0.5 : 0.8));
      if (hit) {
        s = hit.to + (hit.open ? 0.5 : 0.8);
        end = hit.open ? -Infinity : hit.to;
        continue;
      }
      const c = s + ws / 2;
      const lat = side * (front + d / 2);
      const m = frontFrame(c, lat, (r() - 0.5) * 0.22);
      // (where its roof would touch a neighbour's, try a little further along)
      if (crowded(planOf(m, w, d), 0.1)) {
        s += 0.3;
        continue;
      }
      if (free(beside(c, lat, v), 1.4)) {
        const k = build(c, m, w, d, Math.min(w, d) / 2);
        // The clear ground beside each side wall (m): the gap back to the last building, and on to the next.
        const next = keepOut.find((b) => b.from - 0.8 >= s + ws && b.from - 0.8 < s + ws + gap / sc);
        const ahead = next ? (next.open ? 9 : (next.from - (s + ws)) * sc) : gap;
        const behind = end === -Infinity ? 9 : (s - end) * sc;
        // (The frame's x runs along the road, one way or the other; and turned off square, a corner can
        // come up to 0.2 m nearer the neighbour.)
        const plusX = xAxis.setFromMatrixColumn(k.frame, 0).dot(routeFrame(c).fwd) > 0;
        k.sideRoom = [plusX ? behind : ahead, plusX ? ahead : behind].map((x) => x - 0.2) as [number, number];
        // Round the focal stops every building is dressed; elsewhere most facades stay quiet, and the
        // rest keep the usual fittings, so the plain stretches never look unfinished.
        const dressed = dressedAt(c);
        k.detail = dressed || r() < 0.4 ? 1 : 0;
        const rb = own();
        const u = r();
        if (edgeAt(c)) P.house(k, rb, w, d);
        else if (u < 0.5) {
          P.block(k, rb, w, d, 2 + (r() < (dressed ? 0.5 : 0.15) ? 1 : 0));
          if (dressed && r() < 0.35) P.banner(k, w / 2 - 0.5, 1.6, d / 2, rb);
        } else P.house(k, rb, w, d);
        built(k);
        // Life gathered at the entrance (pots or bins), mostly where the street is dressed;
        // each stands along the kerb, inside the pavement.
        if (r() < (dressed ? 0.85 : 0.45)) {
          const at = side * (PAVE_HALF - 0.22);
          const u = r();
          if (u < 0.6) P.potRow(facing(c - side * (w / 2 - 1.2), at, 0.3), r, 0.6 + r() * 0.6);
          else if (u < 0.85) P.bins(facing(c + side * 0.9, at, 0.45), r);
          // (where a stack of crates stood, nothing: they read as blocks. Its two draws are still
          // taken, so nothing placed after it moves.)
          else {
            r();
            r();
          }
        }
      }
      // (Where something already stands, it counts as a building beside the next.)
      end = s + ws;
      s += ws + gap / sc;
    }
  }
  // The open lots: a garden behind a low wall with a gap for a gate (a tree, a shrub, the verge's
  // flowers in the grass), or a view up the hillside past a white railing.
  for (const lot of lots) {
    yield;
    const len = lot.to - lot.from;
    const c = (lot.from + lot.to) / 2;
    if (lot.kind === "garden") {
      for (const e of [-1, 1]) P.wall(facing(c + e * (len / 4 + 0.35), lot.side * (PAVE_HALF + 0.3)), len / 2 - 0.7, 0.55);
      // (in the middle of the lot, so its canopy stays clear of the houses either side)
      P.tree(facing(c + (r() - 0.5) * len * 0.15, lot.side * (PAVE_HALF + 2.5 + r() * 0.5), 1), r, 0.8 + r() * 0.15);
      P.bush(facing(c + (r() < 0.5 ? -1 : 1) * len * 0.3, lot.side * (PAVE_HALF + 1.0), 0.5), r, 0.9);
    } else P.pipeRail(facing(c, lot.side * (PAVE_HALF + 0.12)), len - 0.8);
  }
  // A water tower on the hill above the town: a landmark that shows over the rooftops from far off.
  {
    const s = (t0 + t1) / 2 - 8;
    P.waterTower(loose(onGround(beside(s, 12.5, new THREE.Vector3())), s, 2));
  }
  // The rows behind, higher up the slopes: a thinner scatter of lower roofs, so the hills and the sky
  // show between them, and none behind the views.
  const behindLot = (s: number, side: number) => lots.some((l) => l.kind === "view" && l.side === side && s > l.from - 1 && s < l.to + 1);
  for (const [lo, hi, step, keep] of [
    [7, 9, 3.6, 0.75],
    [11.5, 14, 4.2, 0.6],
  ] as const) {
    for (let s = t0; s < t1; s += step + r()) {
      for (const side of [-1, 1]) {
        const lat = side * (lo + r() * (hi - lo));
        if (r() > keep || behindLot(s, side) || !free(beside(s, lat, v), 2)) continue;
        const m = frontFrame(s, lat, (r() - 0.5) * 0.4);
        const isBlock = r() < (lo < 10 ? 0.5 : 0.35);
        const [w, d] = isBlock ? [3 + r() * 0.8, 3] : [3, 2.6];
        if (crowded(planOf(m, w, d, isBlock ? 0.25 : 0.4), 0.2)) continue;
        const k = build(s, m, w, d, 2);
        k.detail = 0;
        k.sideRoom = [0.6, 0.6];
        if (isBlock) P.block(k, own(), w, d, 2 + Math.floor(r() * 2));
        else P.house(k, own(), w, d);
        built(k);
      }
    }
  }
  // Road paint, drains along the gutters, lettering where the lane meets each labelled stop, wear
  // on the asphalt.
  for (let s = t0 + 3; s < t1; s += 22 + r() * 8) P.roadArrow(along(s, -0.45));
  for (let s = t0; s < t1; s += 8 + r() * 3) {
    const side = r() < 0.5 ? 1 : -1;
    P.grate(along(s, side * (ROAD_HALF - 0.2)));
  }
  for (const b of BLOCKS.filter((x) => x.label && zoneAt(x.s) === "town")) P.roadGlyphs(along(b.s - 3.2, -0.45), r);
  for (let s = t0; s < t1; s += 4 + r() * 5) P.wear(along(s, (r() - 0.5) * 1.3), r);
  // Kerbs along the lane, with the odd manhole.
  // One continuous kerb, broken now and then by a driveway dip: the runs here, swept along the
  // road's curve (kerbStrip). (Built of straight 64 cm stones, every one stuck out a corner past
  // the next on a bend, and the ink drew each corner: a sawtooth down both sides of the street.)
  const gaps = [-1, 1].map(() => new Set<number>());
  for (let s = t0; s < t1; s += 0.5) for (const g of gaps) if (r() < 0.012) for (let k = 0; k < 4; k++) g.add(Math.round(s / 0.5) + k);
  const open: ([number, number, number] | null)[] = [null, null];
  for (let s = t0; s < t1; s += 0.5) {
    [-1, 1].forEach((side, i) => {
      if (gaps[i].has(Math.round(s / 0.5))) return void (open[i] = null);
      const run = open[i];
      if (run) run[2] = s + 0.32;
      else kerbs.push((open[i] = [side, s - 0.32, s + 0.32]));
    });
    if (r() < 0.012) P.manhole(along(s + 0.5, (r() - 0.5) * 0.5));
  }

  // ---------- the river and the forest ----------
  // (Nothing grows on the waterfall's ledge or in its pool: what would is built out of sight, so the
  // draws, and everything placed after, stay as they were.)
  const fallAt = fallFrame().base;
  const byFall = (s: number, lat: number) => beside(s, lat, new THREE.Vector3()).distanceTo(fallAt) < 3.6;
  // (nor in the stream: the verges' grass and the trees and rocks by the road stood in the water
  // where it crosses at the bridge)
  const brook: THREE.Vector3[] = [];
  for (let t = -1.3; t <= FALL_T; t += 0.01) brook.push(streamPoint(t).multiplyScalar(PLANET_RADIUS));
  const inBrook = (s: number, lat: number, gap: number) => {
    const p = beside(s, lat, new THREE.Vector3());
    return brook.some((b) => b.distanceTo(p) < gap);
  };
  const wet = (s: number, lat: number, gap: number) => byFall(s, lat) || inBrook(s, lat, gap);
  for (let s = ZONES.river[0]; s < ZONES.forest[1]; s += 0.9) {
    yield;
    for (let k = 0; k < 3; k++) {
      const side = r() < 0.5 ? -1 : 1;
      const lat = side * (2.7 + r() * 9);
      const sa = s + r() * 0.8;
      if (!free(beside(sa, lat, v), 1)) continue;
      const kit = facing(sa, lat, 1);
      if (wet(sa, lat, 2.2)) kit.g = ghost;
      const forest = zoneAt(s) === "forest";
      const sc = 0.85 + r() * 0.5;
      if (forest && r() < 0.6) P.pine(kit, r, sc);
      else if (r() < 0.75) P.tree(kit, r, sc);
      else P.bush(kit, r, sc);
    }
    if (r() < 0.25) {
      const lat = (r() < 0.5 ? -1 : 1) * (2.5 + r() * 1.5);
      if (free(beside(s, lat, v), 0.4)) {
        const kit = facing(s, lat, 0.4);
        if (wet(s, lat, 1.6)) kit.g = ghost;
        if (r() < 0.5) P.boulder(kit, r, 0.7);
        else P.flowers(kit, r);
      }
    }
  }
  // Guardrail on the river bends.
  for (let s = ZONES.river[0] + 1; s < BRIDGE_S - 3; s += 2.6)
    for (const side of [-1, 1]) if (free(beside(s, side * 2.3, v), 0.2)) P.guardrail(facing(s, side * 2.3), 2.5);

  // ---------- the fields on the way home ----------
  for (let s = ZONES.fields[0]; s < ZONES.fields[1]; s += 2.2) {
    yield;
    for (const side of [-1, 1]) {
      if (free(beside(s, side * 2.6, v), 0.2)) P.fence(facing(s, side * 2.6), 2.1);
      for (let k = 0; k < 2; k++) {
        const lat = side * (3.4 + r() * 4);
        if (free(beside(s, lat, v), 0.4)) P.flowers(facing(s + r(), lat, 0.4), r);
      }
    }
  }
  for (let s = ZONES.fields[0] + 2; s < ZONES.fields[1]; s += 6) {
    const lat = (r() < 0.5 ? -1 : 1) * 8.5;
    if (free(beside(s, lat, v), 2.5)) P.house(facing(s, lat, 2.5), r, 3, 2.6);
  }

  // Grass tufts and flowers along every verge.
  for (let s = 0; s < ROUTE_LENGTH; s += 0.6) {
    yield;
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (PAVE_HALF + 0.35 + r() * 2.5);
    if (!free(beside(s, lat, v), 0.2)) continue;
    const k = facing(s, lat, 0.2);
    if (wet(s, lat, 1.5)) k.g = ghost;
    if (r() < 0.75) P.tuft(k, r);
    else P.flowers(k, r);
  }

  // The rest of the planet: woods and meadows to the horizon in every direction.
  for (let k = 0; k < 380; k++) {
    yield;
    const p = randomSurface(r, new THREE.Vector3());
    if (distanceToRoute(p) < 12 || !free(p, 1.2)) continue;
    const s = nearestS(p);
    const kit = loose(p, s, 1.2);
    const u = r();
    const sc = 0.9 + r() * 0.6;
    if (u < 0.08) P.boulder(kit, r, 1.4);
    else if (u < 0.5) P.pine(kit, r, sc);
    else if (u < 0.92) P.tree(kit, r, sc);
    // (a house out here keeps clear of the town's roofs)
    else if (!crowded(planOf(kit.frame, 3, 2.6, 0.4), 0.2)) {
      P.house(kit, r, 3, 2.6);
      plans.push(planOf(kit.frame, 3, 2.6, kit.reach));
    }
  }

  yield;
  // ---------- the waterfall ----------
  // The stream springs from under a ledge of boulders off to the right of the bridge and falls into
  // a pool: rocks frame the fall, shrubs and grass grow on top. (Its own random sequence, so nothing
  // placed before it moves.)
  {
    const q = rng(41);
    const f = fallFrame();
    const at = f.base.clone();
    const frame = standAt(at, at.clone().add(f.down), 1, new THREE.Matrix4(), 0);
    const g = chunkOf(nearestS(at));
    const k = new P.Kit(g, frame);
    // In the kit: x across the stream, z downstream; the water lands at the origin.
    const stone = new THREE.Color(C.rock);
    const dark = stone.clone().multiplyScalar(0.9);
    k.rock(-1.15, 0.9, -0.6, 0.85, stone, 0.4);
    k.rock(1.2, 0.8, -0.55, 0.8, dark, 1.3);
    k.rock(-0.8, 1.75, -1.05, 0.72, dark, 2.1);
    k.rock(0.9, 1.7, -1.1, 0.7, stone, 0.9);
    k.rock(0.05, 1.45, -1.55, 1.15, stone, 3.3);
    // the lip the water pours over
    k.tilted(0, FALL_DROP - 0.07, -FALL_LIP, 1.25, 0.14, 0.7, dark, 0.08);
    for (const [x, z, rad] of [
      [-1.45, 0.55, 0.36],
      [1.5, 0.75, 0.3],
      [-1.3, 1.5, 0.22],
      [1.25, 1.65, 0.26],
      [-0.6, 2.3, 0.16],
    ])
      k.rock(x, rad * 0.3, z, rad, q() < 0.5 ? stone : dark, q() * 6);
    // Greenery on the ledge and at its feet.
    const sub = (x: number, y: number, z: number) => new P.Kit(g, frame.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)));
    P.bush(sub(-0.85, 2.05, -1.15), q, 0.75);
    P.bush(sub(1.0, 1.95, -1.3), q, 0.65);
    P.bush(sub(-1.6, 0.0, 0.2), q, 0.8);
    P.tree(sub(0.4, 1.9, -2.4), q, 0.9);
    for (const [x, y, z] of [
      [-0.35, 2.12, -0.95],
      [0.5, 2.1, -0.8],
      [-1.75, 0.0, 1.0],
      [1.8, 0.0, 0.3],
      [1.55, 0.0, 1.3],
    ])
      P.tuft(sub(x, y, z), q);
  }

  yield;
  // ---------- the forest floor ----------
  // Grass and ferns between the trees, thick by the path and thinning out up the slopes; none in the
  // stream, on the bridge, round a trunk or in the waterfall's pool. (Its own sequence again.)
  {
    const q = rng(53);
    const p = new THREE.Vector3();
    for (let s = ZONES.river[0]; s < ZONES.forest[1]; s += 0.3) {
      yield;
      const lat = (q() < 0.5 ? -1 : 1) * (1.0 + Math.pow(q(), 1.7) * 9);
      const sa = s + q() * 0.3;
      beside(sa, lat, p);
      if (Math.abs(loopDelta(sa, BRIDGE_S)) < P.BRIDGE_HALF + 0.4 && Math.abs(lat) < 1.6) continue;
      if (byFall(sa, lat) || brook.some((b) => b.distanceTo(p) < 1.7)) continue;
      if (!taken.every((t) => t.road || t.p.distanceTo(p) > t.r * 0.6 + 0.1)) continue;
      const k = facing(sa, lat);
      if (q() < 0.7) P.tuft(k, q);
      else P.fern(k, q, 0.8 + q() * 0.5);
    }
  }

  // Nobody waits inside a wall: a drawn person turns to face the camera, so from the side they
  // reach about 0.3 m either way. Anyone nearer a building than that steps out toward the lane.
  const wallGap = (p: THREE.Vector3) => {
    let gap = Infinity;
    for (const q of plans) {
      if (q.c.distanceTo(p) > 8) continue;
      const t = v.copy(p).sub(q.c);
      const lx = Math.abs(t.dot(q.x)) - q.hw;
      const lz = Math.abs(t.dot(q.z)) - q.hd;
      gap = Math.min(gap, lx > 0 || lz > 0 ? Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) : Math.max(lx, lz));
    }
    return gap;
  };
  npcs.forEach((n, i) => {
    const [s, lat] = waits[i];
    for (let k = 1; k <= 6 && wallGap(n.pos) < 0.45; k++) onGround(beside(s, lat - Math.sign(lat) * 0.1 * k, n.pos));
  });

  // The geometry, each kind for every section of the town in turn.
  yield;
  const sheets = <T,>(make: (c: P.Geo) => T | null) => chunks.map(make).filter((g): g is T => g !== null);
  const out = { chunks: chunks.filter((c) => !c.empty).map((c) => c.build()) };
  yield;
  const decals = sheets((c) => c.buildDecals());
  const panes = sheets((c) => c.buildSheet("windows"));
  const signs = sheets((c) => c.buildSheet("signs"));
  const vending = sheets((c) => c.buildSheet("vending"));
  const roadsigns = sheets((c) => c.buildSheet("roadsigns"));
  yield;
  const props = sheets((c) => c.buildProps());
  yield;
  const leaves = sheets((c) => c.buildLeaves());
  yield;
  const blades = sheets((c) => c.buildBlades());
  const flowers = sheets((c) => c.buildFlowers());
  const stone = sheets((c) => c.buildStone());
  return { ...out, decals, panes, signs, vending, roadsigns, props, leaves, blades, flowers, stone, landmarks, npcs, garden, pickables, kerbs };
}

export type TownPlan = ReturnType<typeof buildPlan>;

/** The town's layout, all in one go (scripts and tests). */
export function buildPlan() {
  const steps = planSteps();
  for (;;) {
    const n = steps.next();
    if (n.done) return n.value;
  }
}

/** How long each slice of work may run (ms): about a frame, so the page stays responsive. */
const SLICE_MS = 12;
/** Back after the browser has had its turn (a message to itself: unlike a timeout, never held back). */
const breathe = () =>
  new Promise<void>((resolve) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => {
      c.port1.close();
      resolve();
    };
    c.port2.postMessage(0);
  });
/** Runs a piece of work written as steps (a `yield` between them) a slice at a time, the page
 *  drawing and answering in between; its result. A step can yield a promise to wait on. */
export async function inSlices<T>(steps: Generator<unknown, T>) {
  let t = performance.now();
  for (;;) {
    const n = steps.next();
    if (n.done) return n.value;
    if (n.value instanceof Promise) {
      await n.value;
      t = performance.now();
    } else if (performance.now() - t > SLICE_MS) {
      await breathe();
      t = performance.now();
    }
  }
}
let planned: Promise<TownPlan> | null = null;
/** The town's layout, worked out a slice at a time. Once: every call has the same one. */
export function planInSlices() {
  planned ??= inSlices(planSteps());
  return planned;
}

/** Rough s of the road point nearest a surface point. */
function nearestS(p: THREE.Vector3) {
  let best = 0;
  let bd = Infinity;
  const q = new THREE.Vector3();
  for (let s = 0; s < ROUTE_LENGTH; s += 1) {
    const d = routePoint(s, q).distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// ---------- ground geometry ----------

/** A strip draped on the surface along the road from s0 to s1, between two laterals. It is cut
 *  into narrow lanes across its width too, so it follows the curve of the planet instead of
 *  sinking into it in the middle. */
export function roadStrip(s0: number, s1: number, l0: number, l1: number, lift: number, step = 0.3) {
  const lanes = Math.max(1, Math.ceil(Math.abs(l1 - l0) / 0.5));
  const pos: number[] = [];
  const idx: number[] = [];
  const a = new THREE.Vector3();
  // Rows land exactly on both ends, so strips that meet leave no gap.
  const rows = Math.max(1, Math.ceil((s1 - s0) / step));
  let n = 0;
  for (let i = 0; i <= rows; i++) {
    const s = s0 + ((s1 - s0) * i) / rows;
    for (let k = 0; k <= lanes; k++) {
      beside(s, l0 + ((l1 - l0) * k) / lanes, a).setLength(PLANET_RADIUS + lift);
      pos.push(a.x, a.y, a.z);
    }
    if (n)
      for (let k = 0; k < lanes; k++) {
        const p = (n - 1) * (lanes + 1) + k;
        const q = n * (lanes + 1) + k;
        idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A kerb along the road from s0 to s1, centred lat across it: its top and both faces as one run
 * that follows the road's curve. Each corner is doubled so the faces shade flat across and the
 * edges stay crisp. It stands from just under the pavement to top above the bare ground.
 */
export function kerbStrip(s0: number, s1: number, lat: number, half = 0.1, top = 0.08, step = 0.25) {
  // (across: up the face at lat - half, over the top, down the face at lat + half)
  const prof: [number, number][] = [
    [-half, 0],
    [-half, top],
    [-half, top],
    [half, top],
    [half, top],
    [half, 0],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  const a = new THREE.Vector3();
  const rows = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= rows; i++) {
    const s = s0 + ((s1 - s0) * i) / rows;
    for (const [x, y] of prof) {
      beside(s, lat + x, a).setLength(PLANET_RADIUS + y);
      pos.push(a.x, a.y, a.z);
    }
    if (i)
      for (let k = 0; k < prof.length; k += 2) {
        const p = (i - 1) * prof.length + k;
        const q = i * prof.length + k;
        idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Where the stream rises: a waterfall off to the right of the bridge (radians round the planet). */
export const FALL_T = 6.3 / PLANET_RADIUS;
const _sa = new THREE.Vector3();
/** A point on the stream's middle, t radians from the bridge (+ to the right of the road), on the sphere. */
export function streamPoint(t: number, out = new THREE.Vector3()) {
  // A gentle meander along the great circle through the bridge, square to the road.
  const c = out.copy(_bf.up).multiplyScalar(Math.cos(t)).addScaledVector(_bf.right, Math.sin(t)).normalize();
  return c.addScaledVector(_bf.fwd, Math.sin(t * 5) * 0.08).normalize();
}
/** Across the stream at t: unit, along the surface. */
export function streamAcross(t: number, out = new THREE.Vector3()) {
  const along = streamPoint(t, _sa);
  return out.copy(_bf.fwd).addScaledVector(along, -_bf.fwd.dot(along)).normalize();
}

/** How far the water falls, and how far back from its landing the ledge's lip is (m). */
export const FALL_DROP = 2.0;
export const FALL_LIP = 0.4;
/** The waterfall's footing: where it lands (on the sphere at the stream's level), the up there,
 *  downstream (the way the water runs off) and across. */
export function fallFrame() {
  const base = streamPoint(FALL_T).multiplyScalar(PLANET_RADIUS);
  const up = base.clone().normalize();
  const down = streamPoint(FALL_T - 0.01).multiplyScalar(PLANET_RADIUS).sub(base);
  down.addScaledVector(up, -down.dot(up)).normalize();
  const across = new THREE.Vector3().crossVectors(up, down).normalize();
  return { base, up, down, across };
}

/**
 * The stream: a band across the road at the bridge, from the waterfall on the right off round the
 * planet to the left. `flow` carries (across 0..1, metres downstream) for the water's moving light.
 */
export function streamStrip(half: number, lift: number, from = -1.3, to = FALL_T) {
  const LANES = 8;
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const along = new THREE.Vector3();
  const side = new THREE.Vector3();
  let n = 0;
  const step = 0.02;
  const rows = Math.ceil((to - from) / step);
  for (let i = 0; i <= rows; i++) {
    const t = from + ((to - from) * i) / rows;
    streamPoint(t, along);
    streamAcross(t, side);
    const w = half * (1 + 0.25 * Math.sin(t * 7 + 1));
    for (let k = 0; k <= LANES; k++) {
      const a = along
        .clone()
        .multiplyScalar(PLANET_RADIUS)
        .addScaledVector(side, w - (2 * w * k) / LANES)
        .setLength(PLANET_RADIUS + lift);
      pos.push(a.x, a.y, a.z);
      // (downstream runs from the fall toward the far end, so its metres count up away from the fall)
      flow.push(k / LANES, (to - t) * PLANET_RADIUS);
    }
    if (n)
      for (let k = 0; k < LANES; k++) {
        const p = (n - 1) * (LANES + 1) + k;
        const q = n * (LANES + 1) + k;
        idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Road stretches by surface: paved through town, a dirt path elsewhere. */
export function roadStretches() {
  const L = ROUTE_LENGTH;
  // (no path under the arch: from its feet on, the bridge's walls stand over it)
  const bridgeGap = [BRIDGE_S - P.ARCH_HALF - 0.15, BRIDGE_S + P.ARCH_HALF + 0.15];
  const townFrom = wrapS(ZONES.town[0]);
  return {
    paved: [
      [townFrom, L],
      [0, ZONES.town[1]],
    ] as [number, number][],
    dirt: [
      [ZONES.town[1], bridgeGap[0]],
      [bridgeGap[1], townFrom],
    ] as [number, number][],
  };
}
