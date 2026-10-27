import * as THREE from "three";

/** Footsteps waiting to be pressed into the snow (Footprints.tsx), queued by the Runner as each foot
 *  lands: where (world, on the ground), which way the courier faces, and which foot. */
export const prints = {
  queue: [] as Step[],
  /** The same steps, for the puddles (Puddles.tsx: a splash where a foot comes down in one). */
  steps: [] as Step[],
};
type Step = { p: THREE.Vector3; fwd: THREE.Vector3; side: number };
