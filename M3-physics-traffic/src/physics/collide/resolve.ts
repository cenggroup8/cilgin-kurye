/**
 * What a contact does to a motorcycle (M3-2): it is pushed out, and the part of
 * its speed that goes into the shape is taken away. The part along the shape
 * (a scrape) stays.
 *
 * The motorcycle model keeps the speed as two numbers: `speed` forward along
 * the heading (negative while reversing) and `slip` sideways, positive to the rider's
 * LEFT (`types.ts` of the physics part, `bike/motion.ts`: the bike moves by
 * `speed * (cos, sin) + slip * (-sin, cos)`). So the velocity is
 *   v = speed * (cos h, sin h) + slip * (-sin h, cos h).
 *
 * Nothing here changes its input. Every function gives back new objects.
 */
import type { Contact } from './shapes';

export interface BikeMotion {
  x: number;
  y: number;
  /** Radians, 0 = +x, counter clockwise. */
  heading: number;
  /** Forward speed, m/s. */
  speed: number;
  /** Side speed, m/s, positive to the left of the rider. */
  slip: number;
}

/**
 * The push is a little longer than the depth. Without it, a rounding error can
 * leave the circle a hair inside the shape, and the same contact is found
 * again in the next substep.
 */
export const PUSH_MARGIN_M = 1e-6;

const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

function validBike(b: BikeMotion): boolean {
  return !!b && finite(b.x) && finite(b.y) && finite(b.heading) && finite(b.speed) && finite(b.slip);
}

function validContact(c: Contact): boolean {
  return !!c && finite(c.depth) && finite(c.normalX) && finite(c.normalY);
}

/** The velocity of the motorcycle as x and y speed, m/s. */
export function velocityOf(bike: BikeMotion): { vx: number; vy: number } {
  const cos = Math.cos(bike.heading);
  const sin = Math.sin(bike.heading);
  return { vx: bike.speed * cos - bike.slip * sin, vy: bike.speed * sin + bike.slip * cos };
}

/**
 * How fast the motorcycle drives into the shape, m/s: max(0, -v.n). The normal
 * points from the shape to the motorcycle, so driving into the shape gives
 * v.n below 0. Moving away or along the shape gives 0. A value that is not
 * finite gives 0.
 */
export function impactSpeedOf(bike: BikeMotion, contact: Contact): number {
  if (!validBike(bike) || !validContact(contact)) return 0;
  const { vx, vy } = velocityOf(bike);
  return Math.max(0, -(vx * contact.normalX + vy * contact.normalY));
}

/**
 * The motorcycle after the contact: moved out by the depth along the normal,
 * with the speed into the shape taken away (v.n < 0 only). Compute the impact
 * speed BEFORE this, with `impactSpeedOf`, because afterwards it is gone.
 * Reversing works the same: backing into a wall gives a positive impact speed
 * and the forward speed becomes 0. The new forward speed is not clamped, because
 * a scrape along a wall can keep a backwards part.
 */
export function resolveContact(bike: BikeMotion, contact: Contact): BikeMotion {
  if (!validBike(bike) || !validContact(contact)) return { ...bike };
  const { vx, vy } = velocityOf(bike);
  const into = vx * contact.normalX + vy * contact.normalY;
  const keepX = into < 0 ? vx - into * contact.normalX : vx;
  const keepY = into < 0 ? vy - into * contact.normalY : vy;

  const cos = Math.cos(bike.heading);
  const sin = Math.sin(bike.heading);
  const push = contact.depth + PUSH_MARGIN_M;
  return {
    x: bike.x + contact.normalX * push,
    y: bike.y + contact.normalY * push,
    heading: bike.heading,
    speed: keepX * cos + keepY * sin,
    slip: -keepX * sin + keepY * cos,
  };
}

/**
 * Like `resolveContact`, but the other thing moves too (an NPC car, another
 * motorcycle). The speed that is taken away is the part of the RELATIVE velocity
 * into the other thing: after the contact the motorcycle moves with the other
 * thing along the normal. `other` is its velocity (m/s). The normal points from
 * the other thing to this motorcycle.
 *
 * `pushShare` is the part of the depth that this motorcycle moves (1 for a car
 * that does not move, 0.5 for two equal motorcycles); `velocityShare` is the part
 * of the closing speed that it loses (1 for a car, 0.5 for two equal motorcycles).
 * Compute the hit speed BEFORE this, with `relativeNormalSpeed`.
 */
export function resolveContactMoving(
  bike: BikeMotion,
  contact: Contact,
  other: { vx: number; vy: number },
  pushShare = 1,
  velocityShare = 1,
): BikeMotion {
  if (!validBike(bike) || !validContact(contact) || !other || !finite(other.vx) || !finite(other.vy)) return { ...bike };
  const { vx, vy } = velocityOf(bike);
  const into = (vx - other.vx) * contact.normalX + (vy - other.vy) * contact.normalY;
  const keepX = into < 0 ? vx - velocityShare * into * contact.normalX : vx;
  const keepY = into < 0 ? vy - velocityShare * into * contact.normalY : vy;

  const cos = Math.cos(bike.heading);
  const sin = Math.sin(bike.heading);
  const push = contact.depth * pushShare + PUSH_MARGIN_M;
  return {
    x: bike.x + contact.normalX * push,
    y: bike.y + contact.normalY * push,
    heading: bike.heading,
    speed: keepX * cos + keepY * sin,
    slip: -keepX * sin + keepY * cos,
  };
}
