/**
 * Stage 2 of a substep: grip and sliding, then the motorcycle moves.
 *
 * In this version the tyres always give the turn the rider wants. The grip
 * limit (sliding out of a turn, puddle, earthquake area) comes in the next
 * M3-1 step and only changes how the turn rate and the side speed are found.
 */
import type { Stage } from '../step';
import { G } from './tuning';

const TWO_PI = 2 * Math.PI;

/** Keeps a heading in (-PI, PI]. Plain arithmetic, so it is the same on every engine. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TWO_PI;
  while (a <= -Math.PI) a += TWO_PI;
  return a;
}

export const gripAndSliding: Stage = (ctx) => {
  const { world, h } = ctx;
  for (const bike of world.bikes.values()) {
    if (bike.fallen) continue;
    const turn = ctx.turn.get(bike.id) ?? 0;
    // Side acceleration of the turn; leaning right is positive, a right turn has turn < 0.
    const side = bike.speed * turn;
    const maxLean = world.tuning.maxLean;
    bike.lean = Math.min(maxLean, Math.max(-maxLean, Math.atan(-side / G)));
    bike.slip = 0;
    bike.sliding = false;

    bike.heading = wrapAngle(bike.heading + turn * h);
    bike.x += bike.speed * Math.cos(bike.heading) * h;
    bike.y += bike.speed * Math.sin(bike.heading) * h;
  }
};
