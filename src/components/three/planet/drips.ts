import * as THREE from "three";
import { DRIP_POINTS } from "./sprite";
import { TIP_POINTS } from "./umbrella";

/** Points along the umbrella's lower rim where the rain runs off (see umbrella.ts). */
export const RIM_POINTS = TIP_POINTS;

/**
 * Where water drips off the courier (world), set by the Runner each frame; Puddles drops the drips:
 * off the umbrella's rim while it is up in the rain, and off their clothes and hair while those are
 * soaked (lib/weather.ts soak).
 */
export const body = {
  rim: Array.from({ length: RIM_POINTS }, () => new THREE.Vector3()),
  cloth: Array.from({ length: DRIP_POINTS }, () => new THREE.Vector3()),
  /** How far the umbrella is up (0..1): drips run off its rim only once it is open. */
  rimOn: 0,
  /** Drops flung off the rim this frame (the umbrella shaken out as it is furled). */
  fling: 0,
  up: new THREE.Vector3(0, 1, 0),
  vel: new THREE.Vector3(),
  ready: false,
  /** The dry space under the umbrella (centre, reach; reach 0 when it is down): no rain falls there. */
  shelter: new THREE.Vector4(),
};
