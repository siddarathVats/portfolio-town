"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WALK_SPEED } from "@/lib/journey";
import { crowd } from "@/lib/crowd";
import { emoteGlyph, players, type Player } from "@/lib/players";
import { PLANET_RADIUS, makeFrame, standAt } from "@/lib/world";
import { deckGrade, walkFrame, walkLift } from "./plan";
import { COURIER_SCALE, Courier, softTint } from "./sprite";
import { LABELS_LAST, Label } from "./label";

const none: ReturnType<typeof crowd.getList> = [];
/** How far round the planet (rad) past the horizon a name tag, 1.7 m up, still shows over it. */
const TAG_PEEK = Math.acos(PLANET_RADIUS / (PLANET_RADIUS + 1.7));

/** Each player keeps to their own lane, so a crowd does not stand in one spot; the middle of the
 *  road is your own courier's, so no one else walks right through them. */
const LANES = [-0.75, -0.42, 0.42, 0.75];
const laneFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return LANES[(h >>> 0) % LANES.length];
};

function Other({ p, bubble }: { p: Player; bubble?: { glyph: string; key: number } }) {
  const walker = useMemo(() => new Courier(softTint(p.color)), [p.color]);
  useEffect(() => () => walker.dispose(), [walker]);
  useEffect(() => {
    if (bubble) walker.wave();
  }, [bubble, walker]);

  const st = useRef({ pace: 0, dir: 1, m: new THREE.Matrix4(), look: new THREE.Vector3(), f: makeFrame(), pos: new THREE.Vector3(), tag: new THREE.Vector3(), seen: false, fade: 0, fading: 0, opacity: "" });
  const lane = laneFor(p.id);

  // Their name tag (and any emote they send, popping up over it), on the page over the canvas: see
  // label.ts, which moves it only while it shows.
  const gl = useThree((s) => s.gl);
  const tag = useMemo(() => ({ label: null as Label | null, box: null as HTMLDivElement | null, name: null as HTMLSpanElement | null }), []);
  useEffect(() => {
    const label = new Label(12);
    const box = document.createElement("div");
    box.className = "tag";
    const name = document.createElement("span");
    name.className = "tag__name";
    box.appendChild(name);
    label.inner.appendChild(box);
    label.mount(gl.domElement.parentElement);
    Object.assign(tag, { label, box, name });
    st.current.opacity = "";
    return () => {
      label.dispose();
      Object.assign(tag, { label: null, box: null, name: null });
    };
  }, [gl, tag]);
  useEffect(() => {
    if (!tag.box || !tag.name) return;
    tag.box.style.setProperty("--c", p.color);
    tag.name.textContent = p.name;
  }, [tag, p.color, p.name]);
  useEffect(() => {
    const box = tag.box;
    if (!box) return;
    box.querySelector(".tag__emote")?.remove();
    if (!bubble) return;
    // (a new element each time, so its pop plays again)
    const emote = document.createElement("span");
    emote.className = "tag__emote";
    emote.setAttribute("aria-hidden", "true");
    emote.textContent = bubble.glyph;
    box.prepend(emote);
  }, [tag, bubble]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const r = st.current;
    // (where they are is played back smoothly from their reports: lib/crowd.ts)
    crowd.update(performance.now() / 1000);
    const g = crowd.get(p.id);
    if (!g) return;
    const step = g.step;
    const v = Math.abs(step) / Math.max(dt, 1e-3);
    r.pace = THREE.MathUtils.damp(r.pace, Math.min(1.3, v / WALK_SPEED), 5, dt);
    if (Math.abs(step) > 1e-3) r.dir = step > 0 ? 1 : -1;
    walker.fade = g.fade;

    // (on the walkers' line, straight over the bridge: see walkFrame)
    const f = walkFrame(g.s, r.f);
    const pos = r.pos.copy(f.pos).addScaledVector(f.right, lane).setLength(PLANET_RADIUS);
    r.look.copy(pos).addScaledVector(f.fwd, r.dir);
    standAt(pos, r.look, COURIER_SCALE, r.m, walkLift(g.s));
    r.m.decompose(walker.root.position, walker.root.quaternion, walker.root.scale);
    walker.update(dt, Math.abs(step) < 3 ? Math.abs(step) : 0, r.pace, camera, deckGrade(g.s) * r.dir);
    r.tag.copy(pos).addScaledVector(f.up, 1.7);
    // Name tags only for players this side of the horizon (the planet would hide them): within the
    // camera's horizon plus as far again as a tag up over a head can peek over it. (Tested as above a
    // fixed height before, from a camera only a metre or two up the tags hid ten metres ahead.)
    const c = camera.position.length();
    r.seen = f.up.dot(camera.position) / c > Math.cos(Math.acos(Math.min(1, PLANET_RADIUS / c)) + TAG_PEEK);
    r.fade = g.fade;
  });
  // (placed once the camera has moved for the frame: see LABELS_LAST)
  useFrame(({ camera, size }, rawDt) => {
    const r = st.current;
    if (!tag.label || !tag.box) return;
    const opacity = r.seen ? r.fade.toFixed(2) : "0";
    if (opacity !== r.opacity) tag.box.style.opacity = r.opacity = opacity;
    // (kept in place while it fades out, .tag's transition)
    r.fading = r.seen && r.fade > 0 ? 0.35 : Math.max(0, r.fading - Math.min(rawDt, 0.1));
    tag.label.place(r.tag, camera, size.width, size.height, r.fading > 0);
  }, LABELS_LAST);

  return <primitive object={walker.root} />;
}

/** Everyone else on the site right now, walking the same planet. */
export function Others() {
  const shown = useSyncExternalStore(crowd.subscribe, crowd.getList, () => none);
  const [bubbles, setBubbles] = useState<Record<string, { glyph: string; key: number }>>({});

  useEffect(() => {
    const timers = new Set<number>();
    const off = players.onEmote((e) => {
      setBubbles((b) => ({ ...b, [e.id]: { glyph: emoteGlyph(e.emote), key: e.key } }));
      const t = window.setTimeout(() => {
        timers.delete(t);
        setBubbles((b) => (b[e.id]?.key === e.key ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== e.id)) : b));
      }, 2200);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <>
      {shown.map((g) => (
        <Other key={g.p.id} p={g.p} bubble={bubbles[g.p.id]} />
      ))}
    </>
  );
}
