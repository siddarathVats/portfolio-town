"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BLOCKS, SCENE_READY_EVENT, journey, stopNear } from "@/lib/journey";
import { sfx } from "@/lib/sfx";
import { gift, graphemes } from "@/lib/gift";
import { daylight } from "@/lib/daylight";
import { weather } from "@/lib/weather";
import { PLANET_RADIUS, loopDelta, makeFrame, standAt } from "@/lib/world";
import { emoteGlyph, players } from "@/lib/players";
import { talk } from "@/lib/talk";
import { spring, spring2 } from "@/lib/spring";
import { BRIDGE_S, deckGrade, walkFrame, walkLift } from "./plan";
import { LOD_LAYER } from "./warm";
import { body } from "./drips";
import { prints } from "./prints";
import { Umbrella } from "./umbrella";
import { LABELS_LAST, Label, keepOnScreen } from "./label";

const SUN_DAY = new THREE.Color("#fff4e2");
const SUN_DUSK = new THREE.Color("#ffbd86");
const MOONLIGHT = new THREE.Color("#a9bfe8");

/** Where the camera cranes up to show the stream valley and the planet curving away: over the bridge,
 *  rising over the last few metres coming up to it and settling after. (It trails some 7 m behind the
 *  courier: any earlier, and on the bend coming out of town it rose through the inventory's shop.) */
const OVERLOOK_S = BRIDGE_S + 0.5;
const CRANE_RISE = 3;
const CRANE_FALL = 6;
/** Seconds the opening shot takes to swoop from the whole planet down behind the courier. */
const INTRO = 3.4;
/** How long the courier must keep going the other way before the camera swings round behind them (s). */
const SIDE_HOLD = 0.5;
import { COURIER_SCALE, Courier, sunlight } from "./sprite";

/** How long the courier waves on stopping beside someone (s), before standing turned to them. */
const GREET_WAVE = 2.2;


/**
 * You: a little messenger walking the road round the planet, seen from behind and above like a
 * game's third-person camera. The camera leans away from whichever side the card is on, so the
 * walker is never under it; on phones it looks down a little more, so the walker stays above the
 * cards at the bottom. The sun follows along, so the light and shadows look the same everywhere.
 */
/**
 * The phone's chase camera (portrait): close enough behind that the runner's stride reads (about a fifth
 * of the picture's height), aimed so they run in the upper middle of it, clear of the cards along the
 * bottom. (m behind, m up; where it looks: m up from the road and m ahead of the runner.)
 */
const PHONE_CAM = { back: 5.2, high: 2.6, aimUp: -1, aimAhead: 2.4 };
// (?debug: tests can try other placements)
if (typeof window !== "undefined" && location.search.includes("debug")) Object.assign(window, { __phoneCam: PHONE_CAM });

export function Runner({ shadows: mapSize }: { shadows: number }) {
  const shadows = mapSize > 0;
  // You are the courier as drawn; other players wear their own colour.
  const walker = useMemo(() => new Courier(), []);
  useEffect(() => () => walker.dispose(), [walker]);
  // ...with an umbrella for the rain, held up in the raised fist of the jog drawn holding it.
  // (a child's umbrella, held low over his head, a little way up its shaft: its rim just above his
  // ears. Held about upright, the canopy level, as it reads from behind; tipped further in to centre
  // it over his head, it looked slanted.)
  const umbrella = useMemo(() => new Umbrella(false, -0.1, 0.27, 0.9), []);
  useEffect(() => {
    walker.prepareUmbrella(umbrella);
    return () => {
      umbrella.root.removeFromParent();
      umbrella.dispose();
    };
  }, [walker, umbrella]);
  useEffect(() => {
    sfx.wire();
    walker.onStep = (k) => sfx.step(k);
    walker.prepareGift();
  }, [walker]);

  // ?debug: where the bridge is, so tests can run the courier up its ramp, and the courier itself.
  useEffect(() => {
    if (/[?&](debug|fps)/.test(location.search)) Object.assign(window, { __bridgeS: BRIDGE_S, __walker: walker });
  }, [walker]);

  // The opening shot: the whole little planet, then a swoop down behind the courier.
  const intro = useRef({ t: -1, done: false });
  useEffect(() => {
    const skip = window.matchMedia("(prefers-reduced-motion: reduce)").matches || location.search.includes("nointro");
    if (skip) intro.current.done = true;
    const go = () => window.setTimeout(() => (intro.current.t = 0), 350);
    window.addEventListener(SCENE_READY_EVENT, go, { once: true });
    return () => window.removeEventListener(SCENE_READY_EVENT, go);
  }, []);

  // Over his head: an emote you send pops up there (as others' do over theirs), and what he says to
  // the girl as he gives her the flowers (lib/talk.ts), typed out.
  const gl = useThree((s) => s.gl);
  const head = useMemo(() => ({ at: new THREE.Vector3(), up: new THREE.Vector3(), emote: null as Label | null, bubble: null as Label | null, say: null as HTMLDivElement | null, said: "", chars: [] as string[], typed: -1, emoting: false, fading: 0 }), []);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    const emote = new Label(12);
    const bubble = new Label(12);
    // (sat on the point, not centred on it: it stands up from over his head)
    bubble.inner.classList.add("label__in--above");
    const say = document.createElement("div");
    say.className = "say say--mine";
    // (the whole line is laid out from the start, the part not typed yet hidden, so the bubble is its
    // full size as it comes up and doesn't grow as the letters come)
    const typed = document.createElement("span");
    const rest = document.createElement("span");
    rest.className = "say__untyped";
    say.append(typed, rest);
    bubble.inner.appendChild(say);
    emote.mount(parent);
    bubble.mount(parent);
    Object.assign(head, { emote, bubble, say, said: "" });
    let t = 0;
    const off = players.onEmote((e) => {
      if (e.id !== players.getState().me?.id) return;
      walker.wave();
      // (a new span each time, so its pop plays again)
      const span = document.createElement("span");
      span.className = "tag__emote tag__emote--mine";
      span.setAttribute("aria-hidden", "true");
      span.textContent = emoteGlyph(e.emote);
      emote.inner.replaceChildren(span);
      head.emoting = true;
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        emote.inner.replaceChildren();
        head.emoting = false;
      }, 2200);
    });
    return () => {
      off();
      window.clearTimeout(t);
      emote.dispose();
      bubble.dispose();
      Object.assign(head, { emote: null, bubble: null, say: null, emoting: false });
    };
  }, [walker, gl, head]);
  // (placed once the camera has moved for the frame: see LABELS_LAST)
  useFrame(({ camera, size }, rawDt) => {
    const { emote, bubble, say } = head;
    if (!emote || !bubble || !say) return;
    const up = head.up.copy(walker.root.position).normalize();
    emote.place(head.at.copy(walker.root.position).addScaledVector(up, 1.4 * COURIER_SCALE + 0.3), camera, size.width, size.height, head.emoting);
    // His bubble: its words changed while it is down, so it comes up with them.
    const mine = talk.mine;
    const shown = say.classList.contains("say--on");
    if (mine && mine !== head.said && !shown) {
      head.said = mine;
      head.chars = graphemes(mine);
      head.typed = -1;
      // (its size, kept by keepOnScreen, measured again)
      delete say.dataset.w;
    }
    const typed = Math.min(head.chars.length, talk.typed);
    if (typed !== head.typed && head.said) {
      head.typed = typed;
      (say.firstChild as HTMLElement).textContent = head.chars.slice(0, typed).join("");
      (say.lastChild as HTMLElement).textContent = head.chars.slice(typed).join("");
    }
    const on = !!mine && mine === head.said;
    if (on !== shown) say.classList.toggle("say--on", on);
    // (kept in place while it fades out)
    head.fading = on ? 0.4 : Math.max(0, head.fading - Math.min(rawDt, 0.1));
    // (over the umbrella's canopy, when he has it up)
    const over = walker.holdingUmbrella ? 0.62 : 0.12;
    if (bubble.place(head.at.copy(walker.root.position).addScaledVector(up, 1.4 * COURIER_SCALE + over), camera, size.width, size.height, head.fading > 0))
      keepOnScreen(say, bubble.screenX, bubble.screenY, size.width, true);
  }, LABELS_LAST);

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null);
  // The sun's shadows come from the town's large-shapes layer (see Planet's Culled), plus the
  // characters on the default layer.
  useEffect(() => {
    sun.current?.shadow.camera.layers.enable(LOD_LAYER);
  }, []);
  // The town's shadows are drawn into the sun's map every other frame, not every frame: the map was
  // some 70 draws a frame, as many again as the picture itself, and it barely changes from one frame
  // to the next (the town stands still and the sun moves with the walker in whole texels). The map is
  // looked up with the sun's view as it was drawn (three keeps them together), so the shadows stay on
  // the ground where they are between drawings; only something moving casts a frame behind.
  useEffect(() => {
    gl.shadowMap.autoUpdate = !shadows;
    gl.shadowMap.needsUpdate = true;
    return () => void (gl.shadowMap.autoUpdate = true);
  }, [gl, shadows]);
  // A new shadow map size (switched live from the ?fps meter) needs a fresh map.
  useEffect(() => {
    const l = sun.current;
    if (!l || !mapSize) return;
    l.shadow.mapSize.set(mapSize, mapSize);
    l.shadow.map?.dispose();
    l.shadow.map = null;
    gl.shadowMap.needsUpdate = true;
  }, [mapSize, gl]);
  const st = useRef({ f: makeFrame(), fwd: new THREE.Vector3(), lean: 0, face: 1, init: false, look: new THREE.Vector3(), m: new THREE.Matrix4(), s: NaN, f2: makeFrame(), f3: makeFrame(), bank: 0, lat: 0, crane: 0, ahead: 0, fov: 0, side: 1, sideWant: 1, sideFor: 0, lift: 0, frameK: 0, frameX: 0, frameBack: 0, frameAt: new THREE.Vector3(), frameSeen: new THREE.Vector3(), keep: 0, tp: 0, paceV: 0, paceF: 0, drift: 0, shadowOdd: false, shadowNow: true,
    // (velocities of the values that follow something that can jump, see lib/spring.ts)
    v: {} as Record<string, number>,
    // Scratch vectors, reused every frame so the run makes no garbage (GC pauses show as stutters).
    sd: new THREE.Vector3(), su: new THREE.Vector3(), sr: new THREE.Vector3(), right: new THREE.Vector3(), heading: new THREE.Vector3(), pos: new THREE.Vector3(), target: new THREE.Vector3(), far: new THREE.Vector3(), origin: new THREE.Vector3() });
  // (?debug: the camera's state, for tests)
  useEffect(() => {
    if (location.search.includes("debug")) Object.assign(window, { __runner: st.current });
  }, []);

  useFrame((_, rawDt) => {
    // One clock for the walker, the courier and the camera (set by the rig, which runs first).
    const dt = journey.dt || Math.min(rawDt, 1 / 20);
    const r = st.current;
    // A cut (fast travel): the camera starts over where the walker now is, rather than swinging in
    // from the old heading and settling its springs from the old place.
    if (r.tp !== journey.teleport) {
      r.tp = journey.teleport;
      // (only if the walker really went somewhere: at the end of a lap they walk on in through the door)
      if (Number.isFinite(r.s) && Math.abs(loopDelta(r.s, journey.s)) > 2) r.init = false;
      if (!r.init) {
        r.shadowNow = true;
        r.keep = 0;
        for (const k in r.v) delete r.v[k];
      }
    }
    // (on the walkers' line: the road's, but straight over the bridge, see walkFrame)
    const f = walkFrame(journey.s, r.f);
    // A damped heading, so the camera swings smoothly through the bends.
    if (!r.init) r.fwd.copy(f.fwd);
    r.fwd.lerp(f.fwd, 1 - Math.exp(-dt * 4)).addScaledVector(f.up, -r.fwd.dot(f.up)).normalize();
    const right = r.right.crossVectors(r.fwd, f.up).normalize();

    // The walker, facing the way they are going (turning round to walk back).
    r.face = THREE.MathUtils.damp(r.face, journey.dir, 8, dt);
    const heading = r.heading.copy(r.fwd).multiplyScalar(r.face).addScaledVector(right, (1 - Math.abs(r.face)) * 1.2);
    r.look.copy(f.pos).add(heading);
    // Feet on whatever is under them (asphalt, the dirt path, the bridge's ramps and deck), never sunk
    // into it or floating over it.
    standAt(f.pos, r.look, COURIER_SCALE, r.m, walkLift(journey.s));
    r.m.decompose(walker.root.position, walker.root.quaternion, walker.root.scale);
    // Stepping across toward the garden or the girl while stopped there (and back into the lane after).
    r.lat = spring2(r.lat, gift.stopping ? gift.lat : 0, r.v, "lat", 7, dt);
    walker.root.position.addScaledVector(f.right, r.lat);
    // Lean into the bends, more the faster we go.
    const turn = r.fwd.dot(walkFrame(journey.s + 1.5, r.f2).right) * journey.dir;
    r.bank = THREE.MathUtils.damp(r.bank, THREE.MathUtils.clamp(-turn * 2.2 * journey.speed, -0.22, 0.22), 6, dt);
    walker.root.rotateZ(r.bank);
    const moved = Number.isFinite(r.s) ? Math.abs(loopDelta(r.s, journey.s)) : 0;
    r.s = journey.s;
    // Picking the flowers, or holding them out to the girl, while that part lasts (lib/gift.ts); or,
    // stopped beside someone on the walk, a wave to them and then standing turned to them (the
    // greeting's first drawing, arms down), not frozen mid-stride; under the umbrella in the rain.
    const greet = journey.greet;
    if (gift.pose || !greet) walker.pose(gift.pose, gift.side, gift.poseT, gift.stoop, gift.lift);
    else walker.pose("greet", greet.side, greet.t < GREET_WAVE ? greet.t : 0);
    walker.update(dt, moved < 3 ? moved : 0, journey.speed, camera, deckGrade(journey.s) * (journey.dir || 1));
    // A footprint pressed into the snow as each foot lands (Footprints.tsx).
    // (and a splash, if it comes down in a puddle: Puddles.tsx)
    if (walker.landed && !gift.pose) {
      const step = { p: walker.footAt(new THREE.Vector3()), fwd: heading.clone(), side: walker.landed };
      prints.queue.push(step);
      prints.steps.push(step);
    }
    walker.handAt(gift.hand);
    walker.bagAt(gift.bag);
    // The umbrella: up while it rains, all the while (his actions have clips drawn holding it, see
    // sprite.ts), rocking a touch with the stride.
    // (rolling some 3 degrees each way with his stride, a beat behind it, as a carried thing does)
    // (kept upright as they lean into a bend, as you hold one over your head: the card faces back
    // toward the camera, so their lean shows on it the other way round)
    umbrella.update(dt, weather.rain > 0.3, 0.06 * Math.sin(2 * Math.PI * (walker.phase - 0.18)) * Math.min(1, journey.speed) + r.bank * 0.85);
    // (the raised fist only while it is in hand: coming out from behind the back, or put away there,
    // it is in the other, swinging hand's reach)
    walker.holdUmbrella(umbrella.amount > 0.1);
    // (not shown in a hand not drawn holding it, unless it is on its way out from, or away behind,
    // their back: then it is behind them anyway)
    if (!walker.holdingUmbrella && umbrella.amount > 0.1) umbrella.root.visible = false;
    weather.shelter = walker.holdingUmbrella && umbrella.isOpen ? 1 : 0;
    umbrella.shelter(body.shelter);
    // Where water drips off them (see Puddles): the umbrella's rib tips, and their clothes and hair.
    body.rimOn = walker.holdingUmbrella ? umbrella.amount : 0;
    body.rim.forEach((p, i) => umbrella.rimAt(i, p));
    body.fling = walker.holdingUmbrella && weather.wet > 0.05 ? umbrella.flung : 0;
    body.cloth.forEach((p, i) => walker.dripAt(i, p));
    body.up.copy(f.up);
    body.vel.copy(r.fwd).multiplyScalar(journey.vel);
    body.ready = true;

    // Lean away from the card, by how close its stop is. (Each stop's pull fades with distance and
    // they are added up, so between a card on the left and one on the right the lean passes through
    // the middle, rather than flipping over where the nearer stop changes.)
    const portrait = size.height > size.width;
    let lean = 0;
    if (!portrait) for (let i = 0; i < BLOCKS.length; i++) lean += BLOCKS[i].side * Math.min(1, stopNear(i, journey.current) * 1.6);
    lean = THREE.MathUtils.clamp(lean, -1, 1);
    r.lean = spring(r.lean, lean, r.v, "lean", 5.4, dt);
    if (!r.init) r.lean = lean;

    // Low and close behind, like a game's third-person camera; a wide lens makes the street tower.
    // Low and level, about chest height, so walls stand upright in frame instead of leaning.
    // At the overlook the camera cranes up and back, so the stream valley and the planet's curve
    // open out below.
    const toOverlook = loopDelta(journey.s, OVERLOOK_S);
    const o = Math.max(0, 1 - Math.abs(toOverlook) / (toOverlook > 0 ? CRANE_RISE : CRANE_FALL));
    r.crane = THREE.MathUtils.damp(r.crane, o * o * (3 - 2 * o), 2.5, dt);
    // Look into the bends a little before the road turns.
    r.ahead = THREE.MathUtils.damp(r.ahead, turn * 3, 3, dt);
    // A little further back and higher than a tight chase cam, so the street has room around the
    // courier (they fill about a third of the frame height, like the reference).
    // A touch above head height and looking slightly down, so the legs don't fill the foreground and
    // the road the courier is running on stays in view.
    // While the girl is in the scene (she sees him coming, he walks up and gives her the flowers), the
    // camera makes room for her too: it slides over toward her side and draws back a little, as far
    // as it takes to have them both in the picture (the phone's narrow frame cut her off). On a phone
    // it does the same for whoever he stops beside at a stop, who stood half off its edge.
    const host = portrait && !gift.framing ? journey.greet : null;
    if (gift.framing) r.frameAt.copy(gift.frame);
    else if (host) r.frameAt.set(host.at.x, host.at.y, host.at.z);
    r.frameK = spring2(r.frameK, gift.framing || (host ? 1 : 0), r.v, "frameK", 4.5, dt);
    const across = r.sd.subVectors(r.frameAt, f.pos).dot(right) - r.lat;
    r.frameX = spring2(r.frameX, THREE.MathUtils.clamp(across * 0.5, -1.4, 1.4), r.v, "frameX", 6, dt);
    r.frameBack = spring2(r.frameBack, THREE.MathUtils.clamp(Math.abs(across) - 0.5, 0, 1.6) * (portrait ? 1.3 : 0.5), r.v, "frameBack", 6, dt);
    // The camera follows a change of pace a beat late, as one carried after a runner does: setting off
    // or speeding up they draw away from it a little, slowing they come back toward it.
    // (from the pace smoothed first: the walker's speed changes in small steps, and each one jolted the
    // camera a couple of centimetres in a frame)
    r.paceF = spring2(r.paceF, journey.vel, r.v, "paceF", 9, dt);
    r.paceV = spring(r.paceV, r.paceF, r.v, "paceV", 2.4, dt);
    // (held within 0.8 m softly: a hard limit, reached, set the camera's speed jumping)
    const lag = journey.reducedMotion ? 0 : 0.8 * Math.tanh(((r.paceF - r.paceV) * 0.55) / 0.8);
    const back = (portrait ? PHONE_CAM.back : 5.2) + r.crane * 2.2 + r.frameK * r.frameBack + lag;
    const high = (portrait ? PHONE_CAM.high : 1.5) + r.crane * 2.6 + r.frameK * r.frameBack * 0.35;
    // Which end of the courier the camera sits behind: swings round smoothly when they turn back,
    // instead of cutting to the other side in one frame; and only once they have kept going the other
    // way for SIDE_HOLD s (a nudge of the wheel back up the page swung the camera up and over them and
    // straight back again, as if it lurched), slowly.
    const dir = journey.dir || 1;
    r.sideFor = dir === r.sideWant ? 0 : r.sideFor + dt;
    if (r.sideFor > SIDE_HOLD || !r.init) {
      r.sideWant = dir;
      r.sideFor = 0;
    }
    r.side = spring2(r.side, r.sideWant, r.v, "side", 2.8, dt);
    if (!r.init) r.side = r.sideWant;
    const sideSign = r.side >= 0 ? 1 : -1;
    // The camera rides the lane itself, `back` metres behind along the road (a rail camera), so on
    // tight bends it stays in the street instead of cutting the corner through the houses.
    const fb = walkFrame(journey.s - back * Math.abs(r.side) * sideSign, r.f3, 11);
    const pos = r.pos.copy(fb.pos).addScaledVector(fb.up, high).addScaledVector(fb.right, r.lean * 0.3);
    // Mid-swing it cranes up and over the courier's shoulder (the lane is too narrow to swing
    // round at head height without the walls filling the lens), looking down on them.
    const swing = 1 - Math.abs(r.side);
    pos.addScaledVector(f.right, swing * 1.1 * sideSign).addScaledVector(f.up, swing * 2.4);
    const target = r.target
      .copy(f.pos)
      .addScaledVector(f.up, (portrait ? PHONE_CAM.aimUp : 0.9) - r.crane * 0.4 - swing * 0.5)
      // (aim at the courier themself while the camera swings round)
      .addScaledVector(r.fwd, (portrait ? PHONE_CAM.aimAhead : 5) * r.side * Math.abs(r.side))
      .addScaledVector(right, (r.lean * 1.6 - r.ahead) * sideSign);
    // Up and over the bridge with the walker (eased: it glides over the hump rather than riding each
    // step of it), so they don't climb up the picture and the deck doesn't fill the lens.
    r.lift = THREE.MathUtils.damp(r.lift, walkLift(journey.s), 5, dt);
    pos.addScaledVector(f.up, r.lift * 0.9);
    target.addScaledVector(f.up, r.lift);
    const slide = r.frameK * r.frameX * (portrait ? 1 : 0.5);
    pos.addScaledVector(right, slide);
    target.addScaledVector(right, slide);
    // (No bob with the steps: the camera glides, so the courier's stride reads against a steady frame.)

    const I = intro.current;
    // Keep the courier in the picture: where the rail camera leaves them near an edge (on a bend, off
    // the bridge's straight line, stepping into the garden), it slides sideways till they are back
    // inside a margin, on a spring, and drifts back as they come in. (A phone's narrow frame shows
    // little either side of them.)
    camera.position.copy(pos);
    camera.up.copy(f.up);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const seen = r.su.copy(walker.root.position).addScaledVector(f.up, 0.6).project(camera);
    // (further out while it makes room for someone beside them: kept to the middle, the courier pulled
    // the camera back from them, and they stayed off the edge of a phone's picture)
    const margin = portrait ? 0.45 + 0.4 * r.frameK : 0.7;
    const over = seen.x - THREE.MathUtils.clamp(seen.x, -margin, margin);
    const depth = r.sr.subVectors(walker.root.position, pos).dot(r.sd.subVectors(target, pos).normalize());
    const halfWidth = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    // (making room for someone on a phone, it centres on the two of them instead: the slide toward
    // them alone, on a bend, still left them off the edge)
    let keep = over * halfWidth;
    if (portrait && r.frameK > 0.01) keep = THREE.MathUtils.lerp(keep, ((seen.x + r.frameSeen.copy(r.frameAt).project(camera).x) / 2) * halfWidth, r.frameK);
    r.keep = spring(r.keep, I.done ? keep : 0, r.v, "keep", 3, dt);
    const sideways = r.sr.setFromMatrixColumn(camera.matrixWorld, 0);
    pos.addScaledVector(sideways, r.keep);
    target.addScaledVector(sideways, r.keep);
    // A loose, hand-held float: the camera drifts slowly about (never in step with the stride), so the
    // runner wanders a little about the picture instead of being pinned to one spot in it.
    if (!journey.reducedMotion) {
      r.drift += dt * (0.4 + 0.6 * Math.min(1, journey.speed));
      const t = r.drift;
      pos.addScaledVector(sideways, 0.17 * Math.sin(t * 0.61) + 0.08 * Math.sin(t * 1.27 + 1.3));
      pos.addScaledVector(f.up, 0.09 * Math.sin(t * 0.47 + 0.4) + 0.05 * Math.sin(t * 1.09 + 2.1));
    }

    // The opening shot, eased from high above the planet down to the chase camera.
    if (!I.done && I.t >= 0) {
      I.t += dt;
      const k = Math.min(1, I.t / INTRO);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const far = r.far.copy(f.up).multiplyScalar(PLANET_RADIUS * 3.4).addScaledVector(r.fwd, -PLANET_RADIUS * 0.8);
      pos.lerpVectors(far, pos, e);
      target.lerpVectors(r.origin, target, e);
      if (k >= 1) I.done = true;
    } else if (!I.done) {
      pos.copy(f.up).multiplyScalar(PLANET_RADIUS * 3.4).addScaledVector(r.fwd, -PLANET_RADIUS * 0.8);
      target.set(0, 0, 0);
    }
    // Thin the haze while the whole planet is in view, then settle back to street level.
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      const clear = I.done ? 0 : 1 - Math.min(1, Math.max(0, I.t) / INTRO);
      // (and closes in under a shower, and further in a fog)
      fog.near = Math.max(4, 34 - 16 * weather.cloud - 24 * weather.haze) + clear * 200;
      fog.far = 110 - 45 * weather.cloud - 45 * weather.haze + clear * 300;
    }
    camera.position.copy(pos);
    camera.up.copy(f.up);
    camera.lookAt(target);
    // A touch wider at a run, narrower standing still.
    r.fov = THREE.MathUtils.damp(r.fov, Math.min(1, journey.speed) * 3, 2, dt);
    const fovNow = 46 + r.fov + r.crane * 4;
    if (Math.abs(camera.fov - fovNow) > 0.01) {
      camera.fov = fovNow;
      camera.updateProjectionMatrix();
    }
    r.init = true;

    // Sun high, ahead and to the right of the walker, so shadows fall toward the camera.
    const l = sun.current;
    if (l) {
      // Sun ahead, high and a little to the right: buildings still throw long shapes across the lane,
      // and the runner's shadow falls under and just behind them, so they read as on the ground.
      // Lower, longer and golden as the sun goes down; at night a dim blue moonlight (lib/daylight.ts).
      l.position.copy(f.pos).addScaledVector(f.up, 10 - 4 * daylight.dusk).addScaledVector(r.fwd, 3).addScaledVector(right, 9);
      l.intensity = 1.5 * (1 - 0.5 * daylight.night) * (1 - 0.55 * weather.cloud);
      l.color.copy(SUN_DAY).lerp(SUN_DUSK, daylight.dusk).lerp(MOONLIGHT, daylight.night);
      l.target.position.copy(f.pos).addScaledVector(r.fwd, 3);
      // Move the shadow map only in whole texels across the light's view, so shadow edges hold
      // still as the sun follows the walker instead of crawling and shimmering.
      if (shadows) {
        const texel = 36 / mapSize;
        const dir = r.sd.subVectors(l.position, l.target.position).normalize();
        const su = r.su.copy(r.fwd).addScaledVector(dir, -r.fwd.dot(dir)).normalize();
        const sr = r.sr.crossVectors(su, dir);
        const a = l.target.position.dot(sr);
        const b = l.target.position.dot(su);
        const shift = r.sd.copy(sr).multiplyScalar(Math.round(a / texel) * texel - a).addScaledVector(su, Math.round(b / texel) * texel - b);
        l.position.add(shift);
        l.target.position.add(shift);
      }
      l.target.updateMatrixWorld();
      // (for the figures' own shadows, sprite.ts)
      sunlight.dir.subVectors(l.position, l.target.position).normalize();
      sunlight.strength = (1 - 0.9 * weather.cloud) * (1 - 0.55 * daylight.night);
      if (shadows) {
        l.shadow.camera.up.copy(r.fwd);
        l.shadow.camera.updateProjectionMatrix();
        // (every other frame; at once after a cut, and through the opening swoop, which crosses the planet)
        r.shadowOdd = !r.shadowOdd;
        if (r.shadowOdd || r.shadowNow || !I.done) gl.shadowMap.needsUpdate = true;
        r.shadowNow = false;
      }
    }
  });

  return (
    <>
      <primitive object={walker.root} />
      <directionalLight
        ref={sun}
        intensity={1.5}
        castShadow={shadows}
        shadow-mapSize={[mapSize || 2048, mapSize || 2048]}
        shadow-radius={2}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={45}
      />
    </>
  );
}
