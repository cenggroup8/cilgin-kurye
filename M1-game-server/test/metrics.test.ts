import { describe, expect, it } from "vitest";
import { MetricsCollector } from "../src/state/metrics.js";
import { createInitialWorld, TICK_RATE } from "../src/state/world.js";
import { emptyTickInput } from "../src/loop/types.js";

describe("MetricsCollector", () => {
  it("collects a sample every 15 ticks", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    const mc = new MetricsCollector(8);

    for (let i = 0; i < 30; i++) {
      world.tick = i + 1;
      world.gameTimeTicks = i + 1;
      mc.afterTick(world, emptyTickInput());
    }

    // 30 ticks / 15 interval = 2 samples
    expect(mc.history).toHaveLength(2);
  });

  it("records game time in seconds", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    const mc = new MetricsCollector(8);

    for (let i = 0; i < 15; i++) {
      world.tick = i + 1;
      world.gameTimeTicks = i + 1;
      mc.afterTick(world, emptyTickInput());
    }

    expect(mc.latest()!.gameTimeSeconds).toBeCloseTo(15 / TICK_RATE);
  });

  it("tracks cumulative falls", () => {
    const world = createInitialWorld();
    const mc = new MetricsCollector(8);

    mc.recordFall(0);
    mc.recordFall(0);
    mc.recordFall(3);

    // Trigger a sample
    for (let i = 0; i < 15; i++) {
      world.tick = i + 1;
      mc.afterTick(world, emptyTickInput());
    }

    const sample = mc.latest()!;
    expect(sample.falls[0]).toBe(2);
    expect(sample.falls[3]).toBe(1);
    expect(sample.falls[1]).toBe(0);
  });

  it("caps history at 60 samples", () => {
    const world = createInitialWorld();
    const mc = new MetricsCollector(8);

    // Generate 70 samples (70 × 15 = 1050 ticks)
    for (let i = 0; i < 1050; i++) {
      world.tick = i + 1;
      mc.afterTick(world, emptyTickInput());
    }

    expect(mc.history.length).toBeLessThanOrEqual(60);
  });

  it("latest returns null when no samples yet", () => {
    const mc = new MetricsCollector(8);
    expect(mc.latest()).toBeNull();
  });
});
