// Small fake parts for the hazards tests: the clock of M1-2 and the parameters of M1-5.
import type { ClockSource, ParamSource } from "../src/hazards/estimates.ts";

/** Same start values as `param-list.ts` in PR #61 for the names the hazards code reads. */
const START: Record<string, number> = {
  "game.penalty_s": 3,
  "obstacles.heavy_traffic.duration_s": 30,
  "obstacles.road_work.duration_s": 30,
  "obstacles.accident.duration_s": 30,
  "obstacles.puddle.duration_s": 30,
};

export class FakeParams implements ParamSource {
  readonly values = new Map<string, number>(Object.entries(START));

  /** Like `ParamRegistry.get`: an unknown name is a bug, so it throws. */
  get(name: string): number {
    const v = this.values.get(name);
    if (v === undefined) throw new Error(`unknown parameter: ${name}`);
    return v;
  }

  set(name: string, value: number): void {
    this.values.set(name, value);
  }
}

export class FakeClock implements ClockSource {
  clockRunning = true;
}

export const TPS = 30;
