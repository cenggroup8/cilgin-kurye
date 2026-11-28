/**
 * Placeholder bike physics.
 *
 * This will be replaced by the real M3 physics code once it is ready.
 * It models a simple 2-D motorcycle: throttle accelerates, brake
 * decelerates, steer turns, and the bike moves along its facing direction.
 */

import type { BikeState, Control } from "./types.js";

const MAX_SPEED = 12;        // units / s
const ACCELERATION = 18;     // units / s^2
const BRAKE_DECEL = 24;      // units / s^2
const FRICTION = 4;          // passive drag, units / s^2
const TURN_RATE = 3.0;       // radians / s at full steer

/** Advance a bike state by dt seconds under the given control. */
export function stepBike(state: BikeState, control: Control, dt: number): BikeState {
  if (state.fallen || state.paused) {
    return state;
  }

  let speed = state.speed;

  // acceleration / braking
  speed += control.throttle * ACCELERATION * dt;
  speed -= control.brake * BRAKE_DECEL * dt;
  speed -= Math.sign(speed) * FRICTION * dt;

  // clamp
  if (Math.abs(speed) < FRICTION * dt) speed = 0;
  speed = Math.max(-MAX_SPEED * 0.3, Math.min(MAX_SPEED, speed));

  // steering (only when moving)
  let angle = state.angle;
  if (Math.abs(speed) > 0.1) {
    angle += control.steer * TURN_RATE * dt;
  }

  // position
  const x = state.x + Math.sin(angle) * speed * dt;
  const z = state.z + Math.cos(angle) * speed * dt;

  return { x, z, angle, speed, fallen: false, paused: false };
}

/** Create a default bike state at the origin. */
export function defaultBikeState(): BikeState {
  return { x: 0, z: 0, angle: 0, speed: 0, fallen: false, paused: false };
}
