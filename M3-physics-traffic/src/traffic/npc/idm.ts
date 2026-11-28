/**
 * Car following model: Intelligent Driver Model (Treiber, Hennecke, Helbing 2000).
 *
 * It gives the acceleration of a car from its own speed, its desired speed, the
 * gap to the thing in front of it and the speed of that thing. The car keeps a
 * safe gap, slows down smoothly when the gap gets small and speeds up again when
 * the road is free (issue #41, item 2).
 */

export interface IdmParams {
  /** Comfortable acceleration, m/s^2. */
  a: number;
  /** Comfortable braking, m/s^2. */
  b: number;
  /** Time headway, s. */
  T: number;
  /** Gap when standing, m. */
  s0: number;
  delta: number;
  /** Strongest braking allowed, m/s^2 (emergency). */
  maxBrake: number;
}

export const DEFAULT_IDM: IdmParams = {
  a: 1.6,
  b: 2.5,
  T: 1.2,
  s0: 2.0,
  delta: 4,
  maxBrake: 9,
};

/**
 * @param v       own speed, m/s
 * @param v0      desired speed, m/s
 * @param gap     bumper to bumper gap to the leader, m (Infinity = free road)
 * @param vLeader speed of the leader, m/s
 */
export function idmAcceleration(v: number, v0: number, gap: number, vLeader: number, p: IdmParams = DEFAULT_IDM): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), p.delta);
  if (!Number.isFinite(gap)) return clamp(p.a * free, -p.maxBrake, p.a);
  const dv = v - vLeader;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(gap, 0.05);
  return clamp(p.a * (free - (sStar / g) * (sStar / g)), -p.maxBrake, p.a);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
