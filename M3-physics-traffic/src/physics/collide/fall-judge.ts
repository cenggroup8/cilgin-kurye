/**
 * The fall judge (M3-2): a hit that is faster than the fall speed that the
 * admin set (`physics.fall_speed_mps`) makes the motorcycle fall. Anything
 * slower, and exactly the fall speed, is only a bump.
 */

export type Judgement = 'fall' | 'bump';

/**
 * `impactSpeed` above `fallSpeed` is a fall. A speed or limit that is not
 * finite (NaN, Infinity) or an impact below 0 is a bump: a bad number must
 * never make a motorcycle fall.
 */
export function judgeImpact(impactSpeed: number, fallSpeed: number): Judgement {
  if (!Number.isFinite(impactSpeed) || !Number.isFinite(fallSpeed) || impactSpeed < 0) return 'bump';
  return impactSpeed > fallSpeed ? 'fall' : 'bump';
}

/**
 * How fast two moving things drive into each other, m/s: max(0, -(velA - velB).n).
 * The normal is a unit vector that points from B to A (the direction that
 * pushes A away from B). Moving apart, or side by side, gives 0.
 */
export function relativeNormalSpeed(
  velA: { vx: number; vy: number },
  velB: { vx: number; vy: number },
  normal: { x: number; y: number },
): number {
  const values = [velA?.vx, velA?.vy, velB?.vx, velB?.vy, normal?.x, normal?.y];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return 0;
  return Math.max(0, -((velA.vx - velB.vx) * normal.x + (velA.vy - velB.vy) * normal.y));
}
