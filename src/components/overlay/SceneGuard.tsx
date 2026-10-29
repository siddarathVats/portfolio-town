"use client";

import { Component, type ReactNode } from "react";
import { SCENE_READY_EVENT } from "@/lib/journey";
import { reportError } from "@/lib/stats";

/**
 * Keeps the page up if the 3D town can't be drawn (no WebGL, a phone out of memory, its files gone
 * missing after a deploy): the cards, the menu and the walk's scrolling go on over the plain sky, and
 * the loader lifts at once, instead of the whole page giving way to an error.
 */
export class SceneGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError("scene", error);
    window.dispatchEvent(new Event(SCENE_READY_EVENT));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
