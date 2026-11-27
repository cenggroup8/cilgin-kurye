/**
 * Stage 1 of a substep: speed and steering (module document 7.5, "Driving").
 *
 * The throttle adds speed up to the top speed, the brake and air drag take
 * speed away. A standing motorcycle that is braked goes backwards slowly
 * (a small reverse speed, see reverse* in tuning.ts). The steering gives the turn rate the
 * rider wants: tight at low speed (a U turn fits on the road), wide at high
 * speed. The next stage (grip and sliding) decides how much of this turn the
 * tyres can really give, and moves the motorcycle.
 */
import type { Stage } from '../step.js';
import type { BikeTuning } from './tuning.js';

/** Largest front wheel angle at this speed, radians. */
export function maxWheelAngle(speed: number, tuning: BikeTuning): number {
  const r = speed / tuning.steerRefSpeed;
  return tuning.steerLow / (1 + r * r);
}

/**
 * Turn rate in radians per second for a steer value from -1 (left) to 1
 * (right). Counter clockwise is positive, so steering right gives a negative
 * value. A standing motorcycle does not turn. Reversing (negative speed) turns
 * the other way for the same steer, like a real vehicle: the same formula, the
 * sign of the speed does it.
 */
export function wantedTurnRate(speed: number, steer: number, tuning: BikeTuning): number {
  const wheel = -steer * maxWheelAngle(speed, tuning);
  return (speed * Math.tan(wheel)) / tuning.wheelbase;
}

/** A speed closer to 0 than this (m/s) is rounding noise, not a reverse (a hit can leave -1e-16). */
const REVERSE_NOISE_MPS = 1e-9;

/** Sums of h (for example 30 x 1/60) can end a hair below the wait, so the wait is compared with this slack (s). */
const WAIT_SLACK_S = 1e-9;

/**
 * New forward speed after h seconds, m/s. Negative while reversing.
 * `stoppedS` is how long the motorcycle has stood still with the brake held
 * (see `nextStoppedS`), in seconds, before this substep.
 *
 * - Brake held, no throttle, speed at or below reverseEnterSpeed, and the
 *   motorcycle has stood for reverseWaitS (or is already reversing): the speed goes
 *   down by reverseAccel x brake, at most to -reverseMax. Before the wait is over
 *   it stays at 0. Braking from a higher speed only stops (the speed is cut at 0,
 *   it never jumps to reverse).
 * - Reversing without that (brake released or throttle given): the speed goes
 *   back to 0 with the brake deceleration and does not pass 0.
 * - The accident speed cap is for forward speed only.
 */
export function nextSpeed(
  speed: number,
  throttle: number,
  brake: number,
  topSpeed: number,
  speedCap: number | null,
  h: number,
  tuning: BikeTuning,
  stoppedS: number,
): number {
  const reversing = speed < -REVERSE_NOISE_MPS;
  const waited = stoppedS >= tuning.reverseWaitS - WAIT_SLACK_S;
  if (brake > 0 && throttle === 0 && speed <= tuning.reverseEnterSpeed && (reversing || waited)) {
    return Math.max(-tuning.reverseMax, speed - tuning.reverseAccel * brake * h);
  }
  if (reversing) return Math.min(0, speed + tuning.brake * h);

  const drive = throttle * tuning.accel * Math.max(0, 1 - speed / topSpeed);
  // Full throttle holds the top speed against the drag; the drag is felt when
  // the rider lets go of the throttle, and always above the top speed.
  const dragShare = speed > topSpeed ? 1 : 1 - throttle;
  const accel = drive - brake * tuning.brake - dragShare * tuning.drag * speed;
  let v = Math.max(0, speed + accel * h);
  // In an accident slow zone the motorcycle brakes down to the cap.
  if (speedCap !== null && v > speedCap) v = Math.max(speedCap, v - tuning.brake * h);
  return v;
}

/**
 * Seconds that the motorcycle has stood still with the brake held, after this substep:
 * `stoppedS + h` while the brake is held, there is no throttle and the speed is at or below
 * reverseEnterSpeed (either way), otherwise 0. Give it the speed AFTER `nextSpeed`.
 */
export function nextStoppedS(
  stoppedS: number,
  speed: number,
  throttle: number,
  brake: number,
  h: number,
  tuning: BikeTuning,
): number {
  return brake > 0 && throttle === 0 && Math.abs(speed) <= tuning.reverseEnterSpeed ? stoppedS + h : 0;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const speedAndSteering: Stage = (ctx) => {
  const { world, h } = ctx;
  for (const bike of world.bikes.values()) {
    if (bike.fallen) {
      world.stoppedS.set(bike.id, 0); // a fallen motorcycle starts the wait again after it stands up
      continue;
    }
    const input = ctx.controls.get(bike.id);
    const throttle = clamp(input?.control.throttle ?? 0, 0, 1);
    const brake = clamp(input?.control.brake ?? 0, 0, 1);
    const steer = clamp(input?.control.steer ?? 0, -1, 1);
    const topSpeed = world.params.topSpeed * (input?.speedFactor ?? 1);
    const surface = world.surfaceAt(bike.x, bike.y, world.params, ctx.input);

    const stopped = world.stoppedS.get(bike.id) ?? 0;
    bike.speed = nextSpeed(bike.speed, throttle, brake, topSpeed, surface.speedCap, h, world.tuning, stopped);
    // The counter uses the NEW speed: the time counts from the first substep in which the
    // motorcycle really stands (after the brake has stopped it, or after a hit), not from the
    // substep in which it was still rolling. The speed of the next substep then sees a full wait.
    world.stoppedS.set(bike.id, nextStoppedS(stopped, bike.speed, throttle, brake, h, world.tuning));
    ctx.turn.set(bike.id, wantedTurnRate(bike.speed, steer, world.tuning));
  }
};
