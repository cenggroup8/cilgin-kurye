/**
 * Stage 2 of a substep: grip and sliding, then the motorcycle moves
 * (module document 7.5, "Grip and sliding").
 *
 * In a turn the motorcycle needs a side force. If the side acceleration of the
 * wanted turn is below the grip limit, the motorcycle follows the turn. If it is
 * above, the motorcycle turns only as much as the grip allows and the rest
 * becomes side speed out of the turn. Only the size is compared, so a left and
 * a right turn act the same. The grip of the ground comes from the colliders
 * (M3-2): low on a water puddle, lower in the earthquake area. The slide does not
 * take speed away, so on a puddle the motorcycle slides but does not slow down.
 * When there is grip to spare, the side speed fades away. The speed can be
 * negative (small reverse): the sizes use |speed|, and the slide goes to the
 * outside of the real path, so it flips with the sign of the speed.
 */
import type { Stage } from '../step.js';
import { G } from './tuning.js';

const TWO_PI = 2 * Math.PI;

/** Side speed below this counts as no slide, m/s. */
const SLIDE_LIMIT = 0.3;

/** Keeps a heading in (-PI, PI]. Plain arithmetic, so it is the same on every engine. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TWO_PI;
  while (a <= -Math.PI) a += TWO_PI;
  return a;
}

/**
 * The turn the tyres can give and the change of side speed in one substep.
 * `slip` is positive to the rider's left. Returns the real turn rate and the
 * new side speed.
 */
export function applyGrip(
  speed: number,
  wantedTurn: number,
  slip: number,
  grip: number,
  h: number,
): { turn: number; slip: number } {
  const limit = grip * G;
  const needed = Math.abs(speed) * Math.abs(wantedTurn);
  if (needed > limit && Math.abs(speed) > 0) {
    const turn = Math.sign(wantedTurn) * (limit / Math.abs(speed));
    // The rest pushes the motorcycle out of the turn: to the right in a left turn
    // when driving forward, to the other side when reversing.
    const outward = -Math.sign(wantedTurn) * Math.sign(speed);
    return { turn, slip: slip + outward * (needed - limit) * h };
  }
  // Grip to spare pulls the side speed back to zero.
  const spare = (limit - needed) * h;
  const next = Math.abs(slip) <= spare ? 0 : slip - Math.sign(slip) * spare;
  return { turn: wantedTurn, slip: next };
}

export const gripAndSliding: Stage = (ctx) => {
  const { world, h } = ctx;
  for (const bike of world.bikes.values()) {
    if (bike.fallen) continue;
    const surface = world.surfaceAt(bike.x, bike.y, world.params, ctx.input);
    const wanted = ctx.turn.get(bike.id) ?? 0;
    const { turn, slip } = applyGrip(bike.speed, wanted, bike.slip, surface.grip, h);
    bike.slip = slip;
    bike.sliding = Math.abs(slip) > SLIDE_LIMIT;

    // Lean follows the real side acceleration (speed x turn, also right when reversing); leaning right is positive and a right turn has turn < 0.
    const maxLean = world.tuning.maxLean;
    bike.lean = Math.min(maxLean, Math.max(-maxLean, Math.atan((-bike.speed * turn) / G)));

    bike.heading = wrapAngle(bike.heading + turn * h);
    const cos = Math.cos(bike.heading);
    const sin = Math.sin(bike.heading);
    // Forward along the heading, side speed along the left side (-sin, cos).
    bike.x += (bike.speed * cos - slip * sin) * h;
    bike.y += (bike.speed * sin + slip * cos) * h;
  }
};
