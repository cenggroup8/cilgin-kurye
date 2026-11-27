// Short messages on the game screen, one after the other. No DOM, no timer:
// the time comes from an injected clock, so a test can set it.

import type { TeamId, TeamScores } from "../placeholder-types.ts";
import { TEXT } from "../texts.ts";

/** The time in milliseconds. In the browser: `{ now: () => performance.now() }`. */
export interface Clock {
  now(): number;
}

export interface ToastModel {
  /** Adds a message at the end. The same text twice in a row is added once. */
  push(message: string): void;
  /**
   * The message to show now, or null. A message is shown for `durationMs`,
   * counted from the moment it comes to the front; then the next one follows.
   * Asking again gives the same message until its time is over.
   */
  pull(): string | null;
  /** Moves on to the next message when the time of the shown one is over. */
  tick(): void;
}

export interface ToastOptions {
  durationMs: number;
}

export function createToastModel(clock: Clock, options: ToastOptions): ToastModel {
  const { durationMs } = options;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`Bad toast duration: ${durationMs}`);
  }
  const waiting: string[] = [];
  let current: { message: string; until: number } | null = null;

  function advance(): void {
    const now = clock.now();
    if (current !== null && now >= current.until) current = null;
    if (current === null && waiting.length > 0) {
      current = { message: waiting.shift()!, until: now + durationMs };
    }
  }

  return {
    push(message) {
      advance();
      const last = waiting.length > 0 ? waiting[waiting.length - 1] : current?.message;
      if (message === last) return;
      waiting.push(message);
      advance();
    },
    pull() {
      advance();
      return current === null ? null : current.message;
    },
    tick: advance,
  };
}

function cleanScore(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * "+N" when the score of this phone's team went up, otherwise null: no team,
 * the first frame (no earlier scores), the same score, a lower score, or the
 * points of another team.
 */
export function scoreToast(
  previous: TeamScores | null | undefined,
  next: TeamScores,
  myTeam: TeamId | null,
): string | null {
  if (myTeam === null || previous === null || previous === undefined) return null;
  const gained = cleanScore(next[myTeam]) - cleanScore(previous[myTeam]);
  return gained > 0 ? TEXT.hud.scoreToast(gained) : null;
}
