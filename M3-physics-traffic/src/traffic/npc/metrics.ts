/**
 * Traffic metrics for the admin graphs (issue #41, item 9).
 * M1 passes them on to M5 with the other live values.
 */
import type { TrafficMetrics } from './types.js';

export class TrafficMetricsCounter {
  private stuckRemovals = 0;
  private botRouteChanges = 0;

  countStuckRemoval(): void {
    this.stuckRemovals++;
  }

  /** Called by the bot drivers (M3-5) when a bot asks for a new route. */
  countBotRouteChange(n = 1): void {
    this.botRouteChanges += n;
  }

  snapshot(speeds: readonly number[]): TrafficMetrics {
    let sum = 0;
    for (const v of speeds) sum += v;
    return {
      carCount: speeds.length,
      meanSpeed: speeds.length > 0 ? sum / speeds.length : 0,
      stuckRemovals: this.stuckRemovals,
      botRouteChanges: this.botRouteChanges,
    };
  }
}
