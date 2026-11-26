// What the countdown screen shows. No DOM.

import {
  COUNTDOWN_SECONDS,
  TICKS_PER_SECOND,
  type CountdownTicksLeft,
} from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

/**
 * The number to show: 3, 2 or 1 while the countdown runs, 0 when no tick is left,
 * and null when the value is not known. A number changes every full second:
 * 90 to 61 ticks show 3, 60 to 31 show 2, 30 to 1 show 1.
 */
export function countdownNumber(ticksLeft: CountdownTicksLeft): number | null {
  if (ticksLeft === undefined || !Number.isFinite(ticksLeft)) return null;
  if (ticksLeft <= 0) return 0;
  return Math.min(COUNTDOWN_SECONDS, Math.ceil(ticksLeft / TICKS_PER_SECOND));
}

export function countdownText(ticksLeft: CountdownTicksLeft): string {
  const n = countdownNumber(ticksLeft);
  if (n === null) return TEXT.countdown.unknown;
  return n === 0 ? TEXT.countdown.go : String(n);
}
