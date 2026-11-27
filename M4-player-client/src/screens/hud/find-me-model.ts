// The "Find me" button: ready, or grey with the seconds that are left. No DOM.

import { TICKS_PER_SECOND } from "../placeholder-types.ts";

export interface FindMeState {
  ready: boolean;
  /** Whole seconds to wait, rounded up. 0 when the button is ready. */
  secondsLeft: number;
}

/**
 * The state of the button from the ticks that M1 says are left. A value that
 * is not a number, not finite or not above 0 means ready: a bad value must
 * never lock the button.
 */
export function findMeState(cooldownTicks: number): FindMeState {
  if (typeof cooldownTicks !== "number" || !Number.isFinite(cooldownTicks) || cooldownTicks <= 0) {
    return { ready: true, secondsLeft: 0 };
  }
  return { ready: false, secondsLeft: Math.ceil(cooldownTicks / TICKS_PER_SECOND) };
}
