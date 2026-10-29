"use client";

import { use, useEffect, useMemo, useRef } from "react";
import { sfx } from "@/lib/sfx";
import { townsfolk } from "@/content/townsfolk";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deliveries } from "@/lib/deliveries";
import { autopilot } from "@/lib/autopilot";
import { GIFT_LINE, GIFT_TO, GOT_S, OFFER_S, PICK_S, PICK_TIMES, SAY_HOLD_S, THANKS_S, TOSS_S, TYPE_CPS, WALK_UP_S, WAVE_S, gift, graphemes } from "@/lib/gift";
import { WALK_SPEED, journey, progressAt } from "@/lib/journey";
import { scrollToProgress } from "@/lib/scroll";
import { REACT_AT, TALK_S, talk } from "@/lib/talk";
import { BRAKE } from "@/lib/locomotion";
import { PLANET_RADIUS, loopDelta, routeFrame, standAt } from "@/lib/world";
import { C, decalMaterial, groundMaterial, paintedSolid, paneMaterial, propContactMaterial, propDepthMaterial, propMaterial, roadSignMaterial, signMaterial, solid, stoneMaterial, vendingMaterial, wettable, dusted, worldMaterial } from "./style";
import { ARCH_HALF, ARCH_RISE } from "./props";
import { BOUQUET_MID, Townsperson, bouquetCard, pickBouquet, rainArtReady } from "./sprite";
import { bladeMaterial, flowerMaterial, leafDepthMaterial, leafMaterial, wind } from "./foliage";
import { LOD_LAYER, warmUp } from "./warm";
import { FALL_T, PAVE_HALF, ROAD_HALF, heightAt, inSlices, planInSlices, type TownPlan, kerbStrip, roadStrip, roadStretches, streamStrip, type Npc, type Pickable } from "./plan";
import { Waterfall, streamMaterial } from "./Water";
import { Life } from "./Life";
import { Umbrella } from "./umbrella";
import { weather } from "@/lib/weather";
import { Rain } from "./Rain";
import { Snow } from "./Snow";
import { Puddles } from "./Puddles";
import { Footprints } from "./Footprints";
import { LABELS_LAST, Label, keepOnScreen } from "./label";


/** The ground: grass over rolling hills, a little darker on the slopes and in patches. (In steps, a
 *  `yield` every few thousand corners: see inSlices.) */
function* groundSteps() {
  const g = new THREE.IcosahedronGeometry(PLANET_RADIUS, 42);
  const pos = g.getAttribute("position");
  // Each corner is shared by several triangles: work its height out once.
  const seen = new Map<string, number>();
  const col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(C.grass);
  const b = new THREE.Color(C.grassDark);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (i % 4096 === 0) yield;
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let h = seen.get(key);
    if (h === undefined) seen.set(key, (h = heightAt(v)));
    v.setLength(PLANET_RADIUS + h);
    pos.setXYZ(i, v.x, v.y, v.z);
    const d = v.clone().normalize();
    const n = Math.sin(d.x * 17.1 + d.y * 6.3) * Math.sin(d.z * 15.7 - d.x * 5.1) + 0.5 * Math.sin(d.y * 31 + d.z * 23);
    c.copy(a).lerp(b, n > 0.3 ? 0.85 : h > 2.6 ? 0.5 : 0);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  yield;
  g.computeVertexNormals();
  return g;
}

/** What each person at a stop says as you come up to them, and in a word with them
 *  (content/townsfolk.ts). */
function lineFor(id: string) {
  return townsfolk[id] ?? null;
}

/** How near along the road (m) the courier stands to someone to be beside them, for a word. */
const REACH = 1.6;
/** Further than this (m) and he has walked off: the word with them is over. */
const LEAVE = 2.6;
/** From this far off (m), coming their way, someone notices him and nods hello. */
const NOTICE = 8;
/** Gone this far past (m), they forget they have met him (till the next lap). */
const FORGET = 12;
/** Bubbles are placed only for people this near the camera (m): the rest stay hidden and still. */
const PLACE_WITHIN = 12;
/** Where a townsperson's speech bubble stands (m up from their feet): clear of the top of their head,
 *  room left under it for its tail. */
const OVER_HEAD = 1.78;
/** How far her words stand above her label's point (px: .gift-fx__say's bottom). */
const GIFT_SAY_LIFT = 6;
/** How long a reaction stays up over someone (s; its pop, see .react in globals.css). */
const REACT_S = 1.6;

/** What rises over the girl as she takes the flowers (see .gift-fx in globals.css). */
const GIFT_FX = `<div class="gift-fx" aria-hidden="true"><span class="gift-fx__mark">!</span><div class="say gift-fx__hi">Oh…! Hi!</div><div class="say gift-fx__say">For me…? Thank you!</div><span class="gift-fx__heart">♥</span><span class="gift-fx__heart">♥</span><span class="gift-fx__heart">♥</span></div>`;
/** Page parts a click on goes to them, not to the people in the scene behind. */
const NOT_THE_SCENE = "a, button, input, textarea, select, label, summary, dialog, [role='button'], .panel, .header, .map, .check, .party, .fps";


/** People about the town; those at the stops talk as you arrive and nod when their letter lands. */
function Npcs({ npcs, garden, pickables }: { npcs: Npc[]; garden: { s: number; side: number }; pickables: Pickable[] }) {
  const people = useMemo(
    () =>
      npcs.map((n) => {
        const m = new Townsperson(n.who);
        standAt(n.pos, n.look, 1, m.root.matrix);
        m.root.matrix.decompose(m.root.position, m.root.quaternion, m.root.scale);
        return {
          id: n.id,
          s: n.s,
          m,
          done: deliveries.has(n.id),
          line: lineFor(n.id),
          up: n.pos.clone().normalize(),
          /** Has nodded to him coming, and has had a word with him, this time by. */
          noticed: false,
          met: false,
          /** A reaction up over them (see react), and how long it has left (s). */
          reacting: 0,
        };
      }),
    [npcs],
  );
  useEffect(() => () => people.forEach((p) => p.m.dispose()), [people]);

  // The girl, and the bouquet: picked in the garden, into the satchel, then from his hand to hers.
  const girl = people.findIndex((p) => p.id === GIFT_TO);

  // The bubbles over them (and what rises over the girl), on the page over the canvas.
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const labels = useRef<(Label | null)[]>([]);
  /** Where their reactions pop up, beside their heads. */
  const marks = useRef<(Label | null)[]>([]);
  const bubbles = useRef<(HTMLDivElement | null)[]>([]);
  const giftFx = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const made = people.map((p, i) => {
      if (!p.line && i !== girl) return null;
      const l = new Label(10);
      if (p.line) {
        // (stood on a point over their head, so however many lines it runs to, it grows up, not
        // down over their face)
        l.inner.classList.add("label__in--above");
        const say = document.createElement("div");
        say.className = "say";
        const who = document.createElement("span");
        who.className = "say__who";
        who.textContent = p.line.who;
        const text = document.createElement("span");
        text.className = "say__text";
        text.textContent = p.line.says;
        say.append(who, text);
        l.inner.appendChild(say);
        bubbles.current[i] = say;
      }
      if (i === girl) {
        l.inner.insertAdjacentHTML("beforeend", GIFT_FX);
        giftFx.current = l.inner.lastElementChild as HTMLDivElement;
      }
      l.mount(gl.domElement.parentElement);
      return l;
    });
    labels.current = made;
    const pops = people.map((p) => {
      if (!p.line) return null;
      const l = new Label(11);
      l.mount(gl.domElement.parentElement);
      return l;
    });
    marks.current = pops;
    return () => {
      made.forEach((l) => l?.dispose());
      pops.forEach((l) => l?.dispose());
      labels.current = [];
      marks.current = [];
      bubbles.current = [];
      giftFx.current = null;
    };
  }, [gl, people, girl]);
  // (the bouquet in her hands takes the colours of the one he picked: see pickBouquet)
  useEffect(() => {
    if (girl >= 0) people[girl].m.paintBouquet(Townsperson.HANDS.right, Townsperson.HANDS.up, 0.2);
  }, [people, girl]);
  const bouquet = useMemo(() => {
    const b = bouquetCard();
    b.root.visible = false;
    return b;
  }, []);
  useEffect(() => () => bouquet.dispose(), [bouquet]);
  // The stems the courier picks, one mesh each for the stalk and the flower, so each can go as it is
  // picked (and be back, grown again, for the next lap).
  const stems = useMemo(
    () =>
      pickables.map((p) => {
        const g = new THREE.Group();
        const stalk = new THREE.Mesh(p.blades, bladeMaterial());
        const head = new THREE.Mesh(p.flowers, flowerMaterial());
        stalk.frustumCulled = head.frustumCulled = false;
        g.add(stalk, head);
        return g;
      }),
    [pickables],
  );
  // Her umbrella for the rain (a blue one), in her hand: she is drawn holding its shaft against her
  // shoulder, and the umbrella's drawing carries it on up from there, just behind her, tipped to the
  // same angle.
  // (its shaft drawn again in front of her from her hand up to the canopy, so it goes up past her
  // shoulder rather than out from behind it)
  const shade = useMemo(() => {
    const u = new Umbrella(true);
    u.shaftInFront(0.09);
    return u;
  }, []);
  useEffect(() => {
    if (girl < 0) return;
    people[girl].m.carry(shade.root);
    return () => {
      shade.root.removeFromParent();
      shade.dispose();
    };
  }, [shade, girl, people]);
  // (the bubbles' widths, kept by keepOnScreen, measured again for the new size)
  useEffect(() => {
    const again = () => bubbles.current.forEach((el) => el && delete el.dataset.w);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []);
  const hand = useMemo(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3(), v: new THREE.Vector3(), right: new THREE.Vector3(), at: new THREE.Vector3(), stop: 0, held: false, noticed: false, greetT: 0, talkHeld: false, talking: false }), []);

  // A reaction pops up beside someone's head: "!" as they notice him (or are clicked), their own
  // glyph with their last word. (A new element each time, so its pop plays from the start.)
  const react = (i: number, glyph: string, notice = false) => {
    const l = marks.current[i];
    if (!l) return;
    const span = document.createElement("span");
    span.className = notice ? "react react--notice" : "react";
    span.setAttribute("aria-hidden", "true");
    span.textContent = glyph;
    l.inner.replaceChildren(span);
    people[i].reacting = REACT_S;
  };

  // A word with someone (lib/talk.ts): begun as he stops beside them, over once said or once he walks
  // off. If the walk is playing and didn't stop here itself (he was sent to them, or the visitor
  // scrolled him here), or the visitor `asked` for it (clicked them), it waits for them to finish.
  const startTalk = (i: number, asked = false) => {
    const p = people[i];
    endTalk();
    talk.with = p.id;
    talk.t = 0;
    p.met = true;
    p.m.wave();
    sfx.blip();
    hand.talkHeld = autopilot.state === "playing" && (asked || autopilot.visiting !== p.id);
    if (hand.talkHeld) autopilot.hold(true);
  };
  const endTalk = () => {
    talk.with = null;
    if (!hand.talkHeld) return;
    hand.talkHeld = false;
    // (a details view opened meanwhile keeps the walk waiting till it closes)
    if (!document.documentElement.classList.contains("details-open")) autopilot.hold(false);
  };
  useEffect(() => () => endTalk(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking (or tapping) someone: the courier goes over to them for a word, or, already beside them,
  // has it again. The page covers the canvas, so clicks are tested against where the people are on
  // screen rather than through the scene's own pointer events; on the page's own parts (cards,
  // buttons, the map) a click is theirs.
  const pointer = useMemo(() => ({ x: 0, y: 0, in: false, over: false, n: 0, hit: null as ((x: number, y: number) => number) | null }), []);
  useEffect(() => {
    const feet = new THREE.Vector3();
    const top = new THREE.Vector3();
    /** Who is under (x, y) on screen (px), nearest first; -1 for no one. */
    const hit = (x: number, y: number) => {
      const { camera, size } = get();
      const box = gl.domElement.getBoundingClientRect();
      let best = -1;
      let bestD = Infinity;
      people.forEach((p, i) => {
        if (!p.line || !p.m.root.visible) return;
        const d = p.m.root.position.distanceTo(camera.position);
        if (d > 30 || d > bestD) return;
        feet.copy(p.m.root.position).project(camera);
        top.copy(p.m.root.position).addScaledVector(p.up, 1.7).project(camera);
        if (feet.z > 1 || top.z > 1) return;
        const fx = box.left + ((feet.x + 1) / 2) * size.width;
        const fy = box.top + ((1 - feet.y) / 2) * size.height;
        const ty = box.top + ((1 - top.y) / 2) * size.height;
        const h = fy - ty;
        // (their figure, a little wider for a finger; and their bubble, if it is up)
        const half = Math.max(18, h * 0.24);
        const up = bubbles.current[i]?.classList.contains("say--on") ? 70 : 8;
        if (x < fx - half || x > fx + half || y < ty - up || y > fy + 6) return;
        best = i;
        bestD = d;
      });
      return best;
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || (e.target as Element).closest?.(NOT_THE_SCENE) || window.getSelection()?.toString()) return;
      const i = hit(e.clientX, e.clientY);
      if (i < 0) return;
      const p = people[i];
      // (they see they have been called on)
      react(i, "!", true);
      p.noticed = true;
      if (Math.abs(loopDelta(journey.s, p.s)) < REACH && Math.abs(journey.vel) < 0.3) return startTalk(i, true);
      // (said all again once he gets there)
      endTalk();
      p.met = false;
      scrollToProgress(progressAt(p.s / WALK_SPEED), p.line?.who);
    };
    // Over someone, the pointer says they can be clicked. (Tested a few times a second, as the scene
    // moves under a still pointer too; the page's own cursor everywhere else.)
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.in = true;
    };
    const onLeave = () => void (pointer.in = false);
    pointer.hit = hit;
    window.addEventListener("click", onClick);
    if (fine) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.body.style.cursor = "";
      pointer.hit = null;
    };
  }, [people, gl, get, pointer]); // eslint-disable-line react-hooks/exhaustive-deps
  // The flower bed: where the camera looks while he is in the garden.
  const bed = useMemo(() => {
    const f = routeFrame(garden.s);
    return f.pos.clone().addScaledVector(f.right, garden.side * 1.2);
  }, [garden]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const stopped = Math.abs(journey.vel) < 0.05;
    // Who he is beside, if anyone; and the townsfolk seeing him come.
    let by = -1;
    people.forEach((p, i) => {
      if (!p.line) return;
      const d = loopDelta(journey.s, p.s);
      if (Math.abs(d) < REACH) by = i;
      // (coming their way at a walk or more: a nod hello, once, as they see him)
      if (!p.noticed && Math.abs(d) > REACH && Math.abs(d) < NOTICE && d * journey.vel > 0.3) {
        p.noticed = true;
        p.m.wave();
        react(i, "!", true);
      }
      if (Math.abs(d) > FORGET) {
        p.noticed = false;
        p.met = false;
      }
    });
    if (talk.with === null && stopped && by >= 0 && !people[by].met) startTalk(by);
    const talking = talk.with === null ? -1 : people.findIndex((p) => p.id === talk.with);
    if (talking >= 0) {
      const p = people[talking];
      const before = talk.t;
      talk.t += dt;
      // (their line said, a moment on their reaction pops up)
      if (before < REACT_AT && talk.t >= REACT_AT && p.line) react(talking, p.line.react);
      if (talk.t > TALK_S || Math.abs(loopDelta(journey.s, p.s)) > LEAVE) endTalk();
    }

    // Over someone: the pointer shows they can be clicked (a few times a second).
    if (pointer.in && ++pointer.n % 6 === 0) {
      // (and not over a part of the page in front of them)
      const over = !!pointer.hit && pointer.hit(pointer.x, pointer.y) >= 0 && !document.elementFromPoint(pointer.x, pointer.y)?.closest(NOT_THE_SCENE);
      if (over !== pointer.over) {
        pointer.over = over;
        document.body.style.cursor = over ? "pointer" : "";
      }
    }

    people.forEach((p) => {
      const dist = p.m.root.position.distanceTo(camera.position);
      // Step out of shot when the camera brushes past, like games fade what is in the lens.
      p.m.root.visible = dist > 3;
      const done = deliveries.has(p.id);
      if (done && !p.done) {
        p.m.wave();
        sfx.chime();
      }
      p.done = done;
      p.m.update(dt, camera);
    });
    // Stopped beside someone (a word with them, the walk's stop by them, or just standing by them):
    // which side of the picture they are on, for the courier to wave to them and then stand turned to
    // them (Runner.tsx).
    const visiting = autopilot.visiting;
    const host =
      talking >= 0 ? people[talking] : stopped && by >= 0 ? people[by] : visiting && stopped ? people.find((p) => p.id === visiting) : undefined;
    if (host) {
      hand.greetT += dt;
      journey.greet = { side: sideOf(host.m.root.position, camera), t: hand.greetT, at: host.m.root.position };
    } else {
      hand.greetT = 0;
      journey.greet = null;
    }
    if (girl >= 0) {
      const h = people[girl];
      flowers(h, camera, journey.dt || dt);
      // (held where her hand is in the drawing she is in now: moving over to it, not jumping, as her
      // drawings change; taken out from behind her and put away there, as the courier does)
      const grip = h.m.umbrellaHand;
      shade.holdIn(h.m.holder, grip.x, grip.y, -0.04, grip.tilt, 0);
      shade.update(dt, weather.rain > 0.3 && rainArtReady());
      h.m.holdUmbrella(shade.amount > 0.1);
    }
  });

  // The bubbles, placed once the camera has moved for this frame (Runner's frame: after it, ahead of
  // the picture being drawn), so they keep to the people rather than trailing a frame behind.
  const side = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }, rawDt) => {
    side.set(1, 0, 0).applyQuaternion(camera.quaternion);
    people.forEach((p, i) => {
      // Their reaction, beside their head on the side toward the middle of the picture (people near
      // its edge, as often on a phone, would have it off the screen), while it lasts.
      const mark = marks.current[i];
      if (mark) {
        p.reacting = Math.max(0, p.reacting - Math.min(rawDt, 0.1));
        const up = p.reacting > 0 && p.m.root.visible;
        const head = hand.at.copy(p.m.root.position).addScaledVector(p.up, 1.62);
        const toMiddle = up && hand.v.copy(head).project(camera).x > 0 ? -1 : 1;
        mark.place(head.addScaledVector(side, 0.34 * toMiddle), camera, size.width, size.height, up, 20);
      }
      const label = labels.current[i];
      if (!label) return;
      const dist = p.m.root.position.distanceTo(camera.position);
      // The speech bubble shows while you are close and the person is ahead of you.
      const el = bubbles.current[i];
      const on = !!el && dist > 2.6 && dist < 11;
      if (el && on !== el.classList.contains("say--on")) el.classList.toggle("say--on", on);
      // (only placed while near enough to show anything, the girl's while her part plays)
      const near = dist < PLACE_WITHIN || (i === girl && gift.framing > 0);
      const shown = label.place(hand.at.copy(p.m.root.position).addScaledVector(p.up, p.line ? OVER_HEAD : 1.95), camera, size.width, size.height, near);
      if (shown && on && el) keepOnScreen(el, label.screenX, label.screenY, size.width, true);
      const fx = i === girl ? giftFx.current : null;
      if (shown && fx?.dataset.w && (fx.classList.contains("gift-fx--notice") || fx.classList.contains("gift-fx--thanks")))
        keepOnScreen(fx, label.screenX, label.screenY, size.width, true);
    });
  }, LABELS_LAST);

  /** Run up to a place on the road (m) and stop there, stepping `lat` across toward something. */
  const stopBy = (s: number, lat: number) => {
    // (or, too close to stop in time, as soon as the legs can)
    const brake = (journey.vel * journey.vel) / (2 * BRAKE);
    const to = loopDelta(journey.s, s);
    hand.stop = journey.s + (journey.vel > 0.1 ? Math.max(to, brake) : to < 0 ? 0 : to);
    journey.stopAt = hand.stop;
    gift.lat = lat;
    hand.held = hand.held || autopilot.state === "playing";
    if (hand.held) autopilot.hold(true);
  };
  /** Carry on walking from where the courier stands. */
  const release = () => {
    journey.stopAt = null;
    autopilot.resumeAt(journey.s);
    if (hand.held) autopilot.hold(false);
    hand.held = false;
  };
  const arrived = () => (Math.abs(journey.vel) < 0.05 && Math.abs(loopDelta(journey.s, hand.stop)) < 0.08) || gift.t > WALK_UP_S;
  /** Which side of the picture a point is on, from the camera. */
  const sideOf = (p: THREE.Vector3, camera: THREE.Camera) => {
    hand.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    return hand.v.subVectors(p, camera.position).dot(hand.right) >= 0 ? 1 : -1;
  };

  /** The flowers, one step a frame (lib/gift.ts). */
  const flowers = (h: (typeof people)[number], camera: THREE.Camera, dt: number) => {
    const g = gift;
    g.t += dt;
    const up = h.up;
    // Where the garden's gate and the girl are along the road from the courier (+ ahead).
    const toGarden = loopDelta(journey.s, garden.s);
    const toGirl = loopDelta(journey.s, h.s);
    const forward = journey.dir >= 0;

    if (g.phase === "given" && toGarden > 8 && toGarden < 40) {
      // Coming round to the flowers again: she is waiting once more, and they have grown back.
      h.m.mood("waiting");
      stems.forEach((m) => (m.visible = true));
      hand.noticed = false;
      // (and the bunch he will pick this time is a different one)
      pickBouquet();
      g.go("ready");
    }
    // Picking: each stem goes as his hand reaches it.
    if (g.phase === "picking") stems.forEach((m, i) => (m.visible = g.t < PICK_TIMES[i]));
    if (g.phase === "ready" && forward && toGarden > -0.5 && toGarden < 6) {
      stopBy(garden.s, garden.side * 0.5);
      g.go("toGarden");
    } else if (g.phase === "toGarden" && arrived()) {
      g.side = sideOf(hand.v.copy(routeFrame(garden.s).pos).addScaledVector(routeFrame(garden.s).right, garden.side * 2), camera);
      g.go("picking");
    } else if (g.phase === "picking" && g.t > PICK_S) {
      // Up he gets with the bunch he has picked, held in front of him (out of sight from behind), and
      // after a moment's pause carries on.
      g.go("got");
    } else if (g.phase === "got" && g.t > GOT_S) {
      release();
      g.go("carrying");
    } else if (g.phase === "carrying" && forward && toGirl > 0 && toGirl < 9 && !hand.noticed) {
      // She sees him coming with the flowers: a start, a little nod, hands up under her chin. He slows
      // to a stop where he is and waves back.
      hand.noticed = true;
      h.m.mood("surprised");
      h.m.wave();
      stopBy(journey.s, 0);
      g.waved = 0;
      // (turned toward her, not the flower bed he last turned to)
      g.side = sideOf(h.m.root.position, camera);
      g.go("waving");
    } else if (g.phase === "waving" && (g.waved > WAVE_S || g.t > WAVE_S + WALK_UP_S)) {
      // ...then walks up and stops beside her, on her side of the road, leaving her room to reach.
      const f = routeFrame(h.s);
      const lat = hand.v.subVectors(h.m.root.position, f.pos).dot(f.right);
      stopBy(h.s - 0.5, Math.sign(lat) * Math.max(0, Math.min(0.55, Math.abs(lat) - 0.65)));
      g.go("walking");
    } else if (g.phase === "walking" && arrived()) {
      // Beside her, he says his line, typed out over his head, and then holds the flowers out.
      g.side = sideOf(h.m.root.position, camera);
      talk.mine = GIFT_LINE;
      talk.typed = 0;
      g.go("saying");
    } else if (g.phase === "saying" && g.t > graphemes(GIFT_LINE).length / TYPE_CPS + SAY_HOLD_S) {
      g.go("offer");
    } else if (g.phase === "offer" && g.t > OFFER_S) {
      hand.from.copy(g.hand).addScaledVector(up, -BOUQUET_MID);
      hand.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      hand.to.copy(h.m.root.position).addScaledVector(up, Townsperson.HANDS.up - BOUQUET_MID).addScaledVector(hand.right, Townsperson.HANDS.right);
      bouquet.root.quaternion.copy(h.m.root.quaternion);
      bouquet.root.visible = true;
      // (her hands come out for it as it comes)
      h.m.mood("reaching");
      talk.mine = "";
      g.go("toss");
    } else if (g.phase === "toss" && g.t > TOSS_S) {
      bouquet.root.visible = false;
      h.m.mood("flowers");
      h.m.wave();
      sfx.chime();
      g.go("thanks");
    } else if (g.phase === "thanks" && g.t > THANKS_S) {
      release();
      g.go("given");
    }

    if (g.phase === "saying") {
      // (a letter at a time, each with a soft tap; all at once for reduced motion)
      const typed = journey.reducedMotion ? Infinity : Math.floor(g.t * TYPE_CPS);
      if (typed !== talk.typed && typed <= graphemes(GIFT_LINE).length && typed % 2 === 1) sfx.tap();
      talk.typed = typed;
    }
    if (g.phase === "toss") {
      // A short, soft arc from his hand to hers.
      const k = Math.min(1, g.t / TOSS_S);
      const e = k * k * (3 - 2 * k);
      bouquet.root.position.lerpVectors(hand.from, hand.to, e).addScaledVector(up, Math.sin(Math.PI * k) * 0.22);
      bouquet.root.scale.setScalar(1 - 0.1 * e);
      bouquet.show(camera);
    }
    // While any of it has him stopped, the page keeps up with him, so the cards come up as at any
    // stop (and the walk, or the visitor's scrolling, carries on from where he stood).
    // (the wave starts once he has stopped)
    if (g.phase === "waving" && Math.abs(journey.vel) < 0.1) g.waved += dt;
    if (journey.stopAt !== null) autopilot.resumeAt(journey.s);
    // (the camera keeps her in the picture while she is in the scene, from when she sees him coming;
    // before that, while he steps across into the garden and picks, it makes room for him and the
    // flower bed, so on a phone he doesn't end up half off the edge of the picture)
    // (and from the garden on to her without letting go in between, so the camera glides from one to
    // the other rather than settling back and setting off again)
    const inGarden = g.phase === "toGarden" || g.phase === "picking" || g.phase === "got";
    g.frame.copy(inGarden ? bed : h.m.root.position);
    g.framing = inGarden || ["carrying", "waving", "walking", "saying", "offer", "toss", "thanks"].includes(g.phase) || (g.phase === "given" && g.t < 1.2) ? 1 : 0;
    const fx = giftFx.current;
    // (her "Oh! Hi!" put away once he speaks)
    const notice = hand.noticed && ["carrying", "waving", "walking"].includes(g.phase);
    const thanks = g.phase === "thanks" || (g.phase === "given" && g.t < 3.5);
    if (fx) {
      const was = fx.classList.contains("gift-fx--notice") ? "hi" : fx.classList.contains("gift-fx--thanks") ? "say" : "";
      fx.classList.toggle("gift-fx--notice", notice);
      fx.classList.toggle("gift-fx--thanks", thanks);
      // (whichever of her words are up, kept clear of the screen's sides and the bar at its top, as
      // everyone's are: measured as they come up, for keepOnScreen)
      const now = notice ? "hi" : thanks ? "say" : "";
      const say = now && now !== was ? fx.querySelector<HTMLElement>(`.gift-fx__${now}`) : null;
      if (say) {
        fx.dataset.w = String(say.offsetWidth);
        fx.dataset.h = String(say.offsetHeight + GIFT_SAY_LIFT);
      }
    }
    // (while any of their words are up, a phone puts the "Experience" heading away: the words come up
    // over their heads, just where it is on a phone)
    const words = notice || thanks || g.phase === "saying" || g.phase === "offer";
    if (words !== hand.talking) document.documentElement.classList.toggle("gift-talk", (hand.talking = words));
  };

  return (
    <>
      {people.map((p) => (
        <primitive key={p.id} object={p.m.root} />
      ))}
      <primitive object={bouquet.root} />
      {stems.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

/** The bridge's stone casts its shadow as any solid does. */
const stoneDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });



/**
 * Draws only the chunks of town that can be seen: the planet itself hides everything past its
 * curve, so a chunk whose highest point is below the camera's horizon is skipped (with its shadow).
 * Behind the camera, three's own frustum culling already skips them.
 */
/** Beyond this distance (m) a town section is drawn from its large shapes only; fog and distance
 * hide the small things anyway. (A little hysteresis so a section doesn't flicker at the edge.) */
const FAR = 30;
const FAR_BAND = 2;
/** Sections further than this (m) cast no shadow: they are outside the sun's shadow box. */
const CAST = 30;

function Culled({
  geos,
  material,
  shadow = false,
  order = 0,
  depth,
  receive = true,
}: {
  geos: THREE.BufferGeometry[];
  material: THREE.Material;
  shadow?: boolean;
  order?: number;
  /** Cast shadows from these meshes themselves, drawn into the shadow map with this material. */
  depth?: THREE.Material;
  receive?: boolean;
}) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const lods = useRef<(THREE.Mesh | null)[]>([]);
  const info = useMemo(
    () =>
      geos.map((g) => {
        // (drawn cards keep their centres apart from the card shape they share)
        const pos = (g.userData.points as THREE.BufferAttribute | undefined) ?? g.getAttribute("position");
        // (read straight from the numbers, each point's length worked out once: through Vector3s and
        // an angle per point, this took half a second of the loading on a laptop, two on a phone)
        const n = pos.count;
        const len = new Float32Array(n);
        const xyz = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          xyz[i * 3] = x;
          xyz[i * 3 + 1] = y;
          xyz[i * 3 + 2] = z;
          len[i] = Math.sqrt(x * x + y * y + z * z);
        }
        const dir = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          if (len[i] === 0) continue;
          dir.x += xyz[i * 3] / len[i];
          dir.y += xyz[i * 3 + 1] / len[i];
          dir.z += xyz[i * 3 + 2] / len[i];
        }
        dir.normalize();
        // The chunk's angular size about the planet's centre (the widest angle from its middle: the
        // smallest cosine) and its highest point.
        let cos = 1;
        let top = PLANET_RADIUS;
        for (let i = 0; i < n; i++) {
          top = Math.max(top, len[i]);
          const c = len[i] > 0 ? (xyz[i * 3] * dir.x + xyz[i * 3 + 1] * dir.y + xyz[i * 3 + 2] * dir.z) / len[i] : 0;
          cos = Math.min(cos, c);
        }
        const spread = Math.acos(THREE.MathUtils.clamp(cos, -1, 1));
        // A sparse sample of its points, to judge how near the camera the section comes.
        const step = Math.max(1, Math.floor(pos.count / 96));
        const samples: THREE.Vector3[] = [];
        for (let i = 0; i < pos.count; i += step) samples.push(new THREE.Vector3().fromBufferAttribute(pos, i));
        return { dir, spread, top, samples, far: false };
      }),
    [geos],
  );
  const cam = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    if (warmUp.on) {
      // The loader's warm-up: draw everything once, so nothing compiles or uploads mid-run.
      meshes.current.forEach((m) => m && (m.visible = true));
      lods.current.forEach((m) => m && ((m.visible = true), m.layers.enable(0)));
      return;
    }
    const c = cam.current.copy(camera.position);
    const d = c.length();
    c.divideScalar(d);
    // Ground never dips below the planet's radius, so it hides at least this much.
    const camHorizon = Math.acos(Math.min(1, PLANET_RADIUS / d));
    info.forEach((k, i) => {
      const m = meshes.current[i];
      if (!m) return;
      const reach = camHorizon + Math.acos(Math.min(1, PLANET_RADIUS / k.top)) + k.spread;
      const seen = c.angleTo(k.dir) < reach + 0.05;
      const lod = lods.current[i];
      let near = Infinity;
      for (const p of k.samples) near = Math.min(near, p.distanceToSquared(camera.position));
      near = Math.sqrt(near);
      // Only sections near the walker cast: the sun's shadow box spans 36 m round them.
      const casts = near < CAST;
      if (!lod) {
        m.visible = seen;
        if (depth) m.castShadow = casts;
        return;
      }
      lod.castShadow = casts;
      k.far = k.far ? near > FAR - FAR_BAND : near > FAR + FAR_BAND;
      m.visible = seen && !k.far;
      // The large shapes always cast the shadows; the main camera sees them only when far.
      lod.visible = seen;
      if (k.far) lod.layers.enable(0);
      else lod.layers.disable(0);
    });
  });
  return (
    <>
      {geos.map((g, i) => (
        <mesh
          key={i}
          ref={(m) => void (meshes.current[i] = m)}
          geometry={g}
          material={material}
          castShadow={!!depth}
          customDepthMaterial={depth}
          receiveShadow={receive}
          renderOrder={order}
        />
      ))}
      {shadow &&
        geos.map((g, i) => (
          <mesh
            key={`lod${i}`}
            ref={(m) => {
              lods.current[i] = m;
              m?.layers.set(LOD_LAYER);
            }}
            geometry={g.userData.lod as THREE.BufferGeometry}
            material={material}
            castShadow
            receiveShadow
            renderOrder={order}
          />
        ))}
    </>
  );
}

/** The town and the ground it stands on, worked out a slice at a time (see inSlices): the planet's
 *  ground alone was half a second on a laptop, the page frozen through it. Once. */
let town: Promise<{ plan: TownPlan; ground: ReturnType<typeof groundOf> }> | null = null;
function townInSlices() {
  town ??= planInSlices().then(async (plan) => ({ plan, ground: groundOf(plan, await inSlices(groundSteps())) }));
  return town;
}
// (begun as soon as this code arrives, while the canvas is still being set up)
if (typeof window !== "undefined") void townInSlices();

/** The roads, paths and stream laid over the ground. */
function groundOf(plan: TownPlan, sphere: THREE.BufferGeometry) {
  const st = roadStretches();
  const strips = (list: [number, number][], l0: number, l1: number, lift: number) => list.filter(([a, b]) => b > a).map(([a, b]) => roadStrip(a, b, l0, l1, lift));
  return {
    sphere,
    pave: strips(st.paved, -PAVE_HALF, PAVE_HALF, 0.02),
    // A strip of bare earth between the pavement and the grass.
    verge: strips(st.paved, -PAVE_HALF - 0.9, -PAVE_HALF + 0.05, 0.012).concat(strips(st.paved, PAVE_HALF - 0.05, PAVE_HALF + 0.9, 0.012)),
    asphalt: strips(st.paved, -ROAD_HALF, ROAD_HALF, 0.035),
    edges: strips(st.paved, -ROAD_HALF + 0.1, -ROAD_HALF + 0.18, 0.042).concat(strips(st.paved, ROAD_HALF - 0.18, ROAD_HALF - 0.1, 0.042)),
    kerb: mergeGeometries(plan.kerbs.map(([side, a, b]) => kerbStrip(a, b, side * (ROAD_HALF + 0.08)))),
    dirt: strips(st.dirt, -ROAD_HALF * 0.85, ROAD_HALF * 0.85, 0.025),
    // Dashes down the middle of the paved road.
    dashes: mergeGeometries(
      st.paved.flatMap(([a, b]) => {
        const out: THREE.BufferGeometry[] = [];
        for (let s = a + 0.4; s + 0.7 < b; s += 1.6) out.push(roadStrip(s, s + 0.7, -0.07, 0.07, 0.045, 0.35));
        return out;
      }),
    ),
    // (the sandy bed reaches on under the waterfall's pool)
    bank: streamStrip(1.35, 0.015, -1.3, FALL_T + 0.04),
    water: streamStrip(1.0, 0.03),
  };
}

/** The town. It waits (suspends: see Scene) until its layout has been worked out. */
export function Planet() {
  const { plan, ground } = use(townInSlices());
  // Everything that grows sways on the scene's clock.
  useFrame(({ clock }) => void (wind.uTime.value = clock.elapsedTime));
  const mats = useMemo(
    () => ({
      ground: groundMaterial(),
      // (the road, the pavement and the path darken in the rain: see Puddles)
      pave: wettable(paintedSolid(C.curb, { a: "paving", scale: 1, strength: 0.7 }), 0.22),
      asphalt: wettable(paintedSolid(C.asphalt, { a: "asphalt", scale: 0.5, strength: 0.6 }), 0.32),
      // (and snow covers it right over, as it does the grass either side: only the courier's prints
      // show where it runs)
      dirt: wettable(dusted(solid(C.dirt).clone(), 1), 0.3),
      dash: solid(C.line),
      bank: solid(C.bank),
      water: streamMaterial(),
    }),
    [],
  );

  return (
    <group>
      <mesh geometry={ground.sphere} material={mats.ground} receiveShadow />
      {ground.verge.map((g, i) => (
        <mesh key={`v${i}`} geometry={g} material={mats.dirt} receiveShadow />
      ))}
      {ground.pave.map((g, i) => (
        <mesh key={`p${i}`} geometry={g} material={mats.pave} receiveShadow />
      ))}
      <mesh geometry={ground.kerb} material={mats.pave} receiveShadow />
      {ground.asphalt.map((g, i) => (
        <mesh key={`a${i}`} geometry={g} material={mats.asphalt} receiveShadow />
      ))}
      {ground.dirt.map((g, i) => (
        <mesh key={`d${i}`} geometry={g} material={mats.dirt} receiveShadow />
      ))}
      <mesh geometry={ground.dashes} material={mats.dash} />
      {ground.edges.map((g, i) => (
        <mesh key={`e${i}`} geometry={g} material={mats.dash} />
      ))}
      <mesh geometry={ground.bank} material={mats.bank} receiveShadow />
      <mesh geometry={ground.water} material={mats.water} receiveShadow />
      <Waterfall />
      <Life />
      <Rain />
      <Snow />
      <Puddles />
      <Footprints />
      <Culled geos={plan.chunks} material={worldMaterial()} shadow />
      <Culled geos={plan.decals} material={decalMaterial()} order={1} />
      <Culled geos={plan.panes} material={paneMaterial()} />
      <Culled geos={plan.signs} material={signMaterial()} />
      <Culled geos={plan.vending} material={vendingMaterial()} />
      <Culled geos={plan.roadsigns} material={roadSignMaterial()} />
      <Culled geos={plan.props} material={propContactMaterial()} order={1} receive={false} />
      <Culled geos={plan.props} material={propMaterial()} depth={propDepthMaterial()} />
      {/* Leaves cast their dappled shade but take none: a card turned to the camera can't be lit by a
          map drawn of cards turned to the sun without striping (their round masses shade them). */}
      <Culled geos={plan.leaves} material={leafMaterial()} depth={leafDepthMaterial()} receive={false} />
      <Culled geos={plan.blades} material={bladeMaterial()} />
      <Culled geos={plan.flowers} material={flowerMaterial()} />
      <Culled geos={plan.stone} material={stoneMaterial([ARCH_HALF, ARCH_RISE, ARCH_HALF + 0.36, ARCH_RISE + 0.27], 1.2)} depth={stoneDepth} />
      <Npcs npcs={plan.npcs} garden={plan.garden} pickables={plan.pickables} />
    </group>
  );
}
