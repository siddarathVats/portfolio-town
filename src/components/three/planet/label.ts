import * as THREE from "three";

const at = new THREE.Vector3();

/**
 * The frame callback priority to place labels with: after every ordinary one (the camera is moved in
 * Runner's), before the picture is drawn (the composer's, at 1). Placed earlier, a label trails the
 * scene by a frame and shakes against it while the camera moves.
 */
export const LABELS_LAST = 0.5;

/**
 * A bit of the page pinned over a point in the world (a speech bubble, an emote), centred on it like
 * drei's <Html center>. drei's moves every label every frame, shown or not: with a bubble over each of
 * the townspeople that was some fifteen restyled layers a frame, most of them far off screen, in a
 * frame that has 33 ms all told where the browser caps it at 30 fps. This one moves only while it is
 * shown, and only when it has moved.
 */
export class Label {
  /** Placed at the point; put what shows in `inner`, which is centred on it. */
  readonly el: HTMLDivElement;
  readonly inner: HTMLDivElement;
  private x = NaN;
  private y = NaN;
  private shown = false;
  constructor(z: number) {
    this.el = document.createElement("div");
    this.el.className = "label";
    this.el.style.zIndex = String(z);
    this.el.style.display = "none";
    this.inner = document.createElement("div");
    this.inner.className = "label__in";
    this.el.appendChild(this.inner);
  }
  mount(parent: HTMLElement | null | undefined) {
    parent?.appendChild(this.el);
  }
  dispose() {
    this.el.remove();
  }
  /** Over `p` (world) on a canvas `width` × `height` px; hidden while `on` is false or `p` is behind
   *  the camera; with a `margin` (px), held that far in from the canvas's sides. Whether it shows. */
  place(p: THREE.Vector3, camera: THREE.Camera, width: number, height: number, on = true, margin = 0) {
    const show = on && at.copy(p).project(camera).z < 1;
    if (show !== this.shown) {
      this.shown = show;
      this.el.style.display = show ? "" : "none";
    }
    if (!show) return false;
    let x = ((at.x + 1) / 2) * width;
    if (margin) x = THREE.MathUtils.clamp(x, margin, width - margin);
    const y = ((1 - at.y) / 2) * height;
    // (written as "not within", so the first placing, from NaN, counts as a move)
    if (!(Math.abs(x - this.x) <= 0.05 && Math.abs(y - this.y) <= 0.05)) {
      this.x = x;
      this.y = y;
      this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    return true;
  }
  /** Where it is across and down the canvas (px), as last placed. */
  get screenX() {
    return this.x;
  }
  get screenY() {
    return this.y;
  }
}

/** Below this (px from the top of the canvas) the page's own bar stands over the scene: the header,
 *  and on a phone the stepper under it. */
const topBar = (width: number) => (width <= 760 ? 104 : 72);
/** Kept this far (px) in from the screen's sides. */
const SIDE = 8;

/**
 * A speech bubble sits over its speaker (centred on its label's point, or, `above`, stood on it); near
 * the edge of the screen, or up under the page's bar at the top (on a phone, where the courier's head
 * is close under it), that runs it off the screen or behind the bar. Slid back in, its tail kept
 * pointing at the speaker. `x`, `y`: the label's point on the canvas (px), `width` the canvas's.
 * (Worked out from those and the bubble's size, measured once as it appears, not read back from the
 * page each frame: that made the browser lay the page out again mid-frame, several times a frame with
 * a few bubbles up. Delete `dataset.w` to have it measured again, as when its words change.)
 */
export function keepOnScreen(el: HTMLElement, x: number, y: number, width: number, above = false) {
  let w = parseFloat(el.dataset.w || "0");
  let h = parseFloat(el.dataset.h || "0");
  if (!w) {
    // (0: hidden for now, as while its speaker is behind the camera: measured when it shows)
    if (!el.offsetWidth) return;
    el.dataset.w = String((w = el.offsetWidth));
    el.dataset.h = String((h = el.offsetHeight));
  }
  let dx = 0;
  if (x - w / 2 < SIDE) dx = SIDE - (x - w / 2);
  else if (x + w / 2 > width - SIDE) dx = width - SIDE - (x + w / 2);
  const top = y - (above ? h : h / 2);
  const dy = Math.max(0, topBar(width) - top);
  if (Math.abs(dx - parseFloat(el.dataset.dx || "0")) < 0.5 && Math.abs(dy - parseFloat(el.dataset.dy || "0")) < 0.5) return;
  el.dataset.dx = String(dx);
  el.dataset.dy = String(dy);
  el.style.translate = `${dx}px ${dy}px`;
  // (the tail stays under the speaker, but never off the bubble's own rounded corner)
  el.style.setProperty("--tail", `${THREE.MathUtils.clamp(-dx, -(w / 2 - 16), w / 2 - 16)}px`);
}
