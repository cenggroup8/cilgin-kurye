// Penalties after a fall (M1-4, plan #23).
//
// M3 reports a fall. M1 makes the player wait `game.penalty_s`, then asks M3 to
// stand the motorcycle up again (v2.1 sections 5.4 and 7.5). The time counts only
// while the game clock runs, so a pause stops every penalty.
//
// The package is not touched here: it belongs to M1-3 (delivery), and this class
// has no access to it. A fall only makes the player wait, it never loses the package.
//
// One fall gives one penalty: a second fall report for a player who is already
// waiting (for example the same fall reported by M1 and by M3) is ignored.

import { PENALTY_PARAM, PLAYER_COUNT, secondsToTicks } from "./estimates.ts";
import type { ClockSource, ParamSource, StandUpRequest } from "./estimates.ts";

export interface PenaltiesDeps {
  params: ParamSource;
  clock: ClockSource;
}

export class Penalties {
  private readonly deps: PenaltiesDeps;
  /** Player number -> ticks of the running clock that are still to wait. */
  private waiting = new Map<number, number>();

  constructor(deps: PenaltiesDeps) {
    this.deps = deps;
  }

  /**
   * A fall of one player. Starts the penalty with the value of `game.penalty_s`
   * at this moment. Returns false when nothing started: the player is already
   * waiting, or the player number is wrong.
   */
  onFall(player: number): boolean {
    if (!Number.isInteger(player) || player < 0 || player >= PLAYER_COUNT) return false;
    if (this.waiting.has(player)) return false;
    this.waiting.set(player, secondsToTicks(this.deps.params.get(PENALTY_PARAM)));
    return true;
  }

  /** The fall events of one tick. Returns the players whose penalty started, in order. */
  onFalls(events: readonly { player: number }[]): number[] {
    const started: number[] = [];
    for (const e of events) if (this.onFall(e.player)) started.push(e.player);
    return started;
  }

  /**
   * Step 6 of the tick. While the game clock does not run nothing counts down.
   * Returns the stand up requests for the players whose penalty is over, once
   * each, sorted by player number. A penalty of 0 s ends in the first running tick.
   */
  tick(): StandUpRequest[] {
    if (!this.deps.clock.clockRunning) return [];
    const requests: StandUpRequest[] = [];
    for (const [player, left] of [...this.waiting]) {
      if (left - 1 <= 0) {
        this.waiting.delete(player);
        requests.push({ player });
      } else {
        this.waiting.set(player, left - 1);
      }
    }
    return requests.sort((a, b) => a.player - b.player);
  }

  /** Ticks this player still has to wait. 0 when the player is not waiting. */
  remainingTicks(player: number): number {
    return this.waiting.get(player) ?? 0;
  }

  /** The players who are waiting now, sorted. */
  players(): number[] {
    return [...this.waiting.keys()].sort((a, b) => a - b);
  }

  /** For a new game: nobody waits. */
  clear(): void {
    this.waiting.clear();
  }
}
