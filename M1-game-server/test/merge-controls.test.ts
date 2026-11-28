import { describe, expect, it } from "vitest";
import { mergeControls } from "../src/loop/merge-controls.js";
import type { ControlInput, FindMeInput, MergedControl } from "../src/loop/types.js";
import { defaultControl } from "../src/state/world.js";

function controls(n: number): MergedControl[] {
  return Array.from({ length: n }, (_, i) => defaultControl(i));
}

describe("mergeControls", () => {
  it("uses the highest seq when multiple controls arrive for one player", () => {
    const cur = controls(2);
    const incoming: ControlInput[] = [
      { player: 0, seq: 2, throttle: 0.5, brake: 0, steer: 0 },
      { player: 0, seq: 5, throttle: 1, brake: 0, steer: -0.3 },
      { player: 0, seq: 3, throttle: 0.7, brake: 0.1, steer: 0.2 },
    ];
    mergeControls(cur, incoming, []);
    expect(cur[0]!.seq).toBe(5);
    expect(cur[0]!.throttle).toBe(1);
    expect(cur[0]!.steer).toBe(-0.3);
  });

  it("keeps previous control when no input arrives", () => {
    const cur = controls(2);
    cur[1]!.throttle = 0.8;
    cur[1]!.seq = 10;
    mergeControls(cur, [], []);
    expect(cur[1]!.throttle).toBe(0.8);
    expect(cur[1]!.seq).toBe(10);
  });

  it("does not update if incoming seq is not higher", () => {
    const cur = controls(2);
    cur[0]!.seq = 10;
    cur[0]!.throttle = 0.5;
    mergeControls(cur, [{ player: 0, seq: 10, throttle: 1, brake: 0, steer: 0 }], []);
    expect(cur[0]!.throttle).toBe(0.5); // unchanged
  });

  it("returns find-me players from any message in the tick", () => {
    const cur = controls(4);
    const findMe: FindMeInput[] = [{ player: 1 }, { player: 3 }, { player: 1 }];
    const result = mergeControls(cur, [], findMe);
    expect(result).toEqual(new Set([1, 3]));
  });

  it("handles multiple players in one tick", () => {
    const cur = controls(4);
    const incoming: ControlInput[] = [
      { player: 0, seq: 1, throttle: 1, brake: 0, steer: 0 },
      { player: 2, seq: 1, throttle: 0.5, brake: 0.5, steer: 1 },
    ];
    mergeControls(cur, incoming, []);
    expect(cur[0]!.throttle).toBe(1);
    expect(cur[2]!.throttle).toBe(0.5);
    expect(cur[1]!.throttle).toBe(0); // untouched
  });
});
