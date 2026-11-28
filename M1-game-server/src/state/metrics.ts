// Metrikler (M1-1, plan 3.5).
// Saniyede 2 kez (her 15 tick'te) toplanır, kısa geçmiş tutulur.

import type { WorldState } from "./world.js";
import { TICK_RATE } from "./world.js";
import type { PostTickHook } from "../loop/tick.js";
import type { TickInput } from "../loop/types.js";

const METRIC_INTERVAL = TICK_RATE / 2; // 15 ticks = 0.5s
const HISTORY_SIZE = 60; // 30 seconds of history

export interface MetricsSample {
  tick: number;
  gameTimeSeconds: number;
  scores: number[];
  speeds: number[];
  falls: number[];     // cumulative per player
  npcCount: number;
  meanNpcSpeed: number;
}

export class MetricsCollector implements PostTickHook {
  readonly history: MetricsSample[] = [];
  private fallCounts: number[];
  private ticksSinceLastSample = 0;

  constructor(playerCount: number) {
    this.fallCounts = Array.from({ length: playerCount }, () => 0);
  }

  /** Called when M3 reports a fall. */
  recordFall(player: number): void {
    if (player >= 0 && player < this.fallCounts.length) {
      this.fallCounts[player]!++;
    }
  }

  afterTick(world: Readonly<WorldState>, _input: TickInput): void {
    this.ticksSinceLastSample++;
    if (this.ticksSinceLastSample < METRIC_INTERVAL) return;
    this.ticksSinceLastSample = 0;

    const sample: MetricsSample = {
      tick: world.tick,
      gameTimeSeconds: world.gameTimeTicks / TICK_RATE,
      scores: world.scores.map((s) => s.score),
      speeds: world.poses.map((p) => p.speed),
      falls: [...this.fallCounts],
      npcCount: world.npcCars.length,
      meanNpcSpeed:
        world.npcCars.length > 0
          ? world.npcCars.reduce((sum, c) => sum + c.speed, 0) / world.npcCars.length
          : 0,
    };

    this.history.push(sample);
    if (this.history.length > HISTORY_SIZE) {
      this.history.splice(0, this.history.length - HISTORY_SIZE);
    }
  }

  /** Returns the full history for reconnecting admin. */
  getHistory(): readonly MetricsSample[] {
    return this.history;
  }

  /** Returns the latest sample, or null if none yet. */
  latest(): MetricsSample | null {
    return this.history.length > 0 ? this.history[this.history.length - 1]! : null;
  }
}
