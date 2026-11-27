import { describe, expect, it } from "vitest";
import { SeededRng } from "../src/loop/rng.js";

describe("SeededRng", () => {
  it("same seed produces the same sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
    }
  });

  it("different seeds produce different sequences", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const same = Array.from({ length: 100 }, () => a.nextFloat() === b.nextFloat());
    expect(same.every(Boolean)).toBe(false);
  });

  it("nextFloat returns values in [0, 1)", () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt returns values in [min, max]", () => {
    const rng = new SeededRng(999);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it("pick returns elements from the array", () => {
    const rng = new SeededRng(77);
    const items = ["a", "b", "c"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(rng.pick(items));
    expect(seen.size).toBe(3);
  });

  it("chance respects probability bounds", () => {
    const rng = new SeededRng(55);
    let trueCount = 0;
    for (let i = 0; i < 10_000; i++) if (rng.chance(0.5)) trueCount++;
    expect(trueCount).toBeGreaterThan(4000);
    expect(trueCount).toBeLessThan(6000);
  });
});
