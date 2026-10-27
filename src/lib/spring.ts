/**
 * A critically damped spring: like THREE.MathUtils.damp, but it carries a velocity, so when what it
 * follows jumps (the camera making room for someone, the walker turning round) it gathers speed and
 * settles, instead of leaping off at full speed in the first frame. No overshoot. `omega` sets how
 * quick it is (about 2x a damp's lambda for the same feel; it is moving fastest 1/omega s in).
 *
 * The velocity lives in `vel[key]` (one plain object of velocities per owner, no garbage per frame).
 */
export function spring(x: number, to: number, vel: Record<string, number>, key: string, omega: number, dt: number) {
  const v = vel[key] ?? 0;
  const c = x - to;
  const e = Math.exp(-omega * dt);
  const k = (v + omega * c) * dt;
  vel[key] = (v - omega * k) * e;
  return to + (c + k) * e;
}

/**
 * Two springs in a row: the first follows `to`, the second follows the first. Where a single spring
 * still sets off with a kick (its acceleration jumps in the first frame), this one eases into its
 * acceleration too, an S-shaped glide: for the camera's bigger moves.
 */
export function spring2(x: number, to: number, vel: Record<string, number>, key: string, omega: number, dt: number) {
  const mid = key + ":mid";
  vel[mid] = spring(vel[mid] ?? x, to, vel, mid + "v", omega, dt);
  return spring(x, vel[mid], vel, key, omega, dt);
}
