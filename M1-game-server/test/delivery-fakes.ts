/// <reference types="node" />
// Small fake parts for the delivery tests: the parameters of M1-5, the seeded
// random numbers of M1-1, the city plan and the travel time table of M3.
import { readFileSync } from "node:fs";
import type { DeliveryCityPlan, ParamSource, RandomSource, TravelTimeTable } from "../src/delivery/index.js";

/**
 * Copy of contracts/city_plan.json (version 0.2.0, PR #62, commit 704997e).
 * When contracts/ is on main, read it from there and delete the copy.
 */
export const PLAN: DeliveryCityPlan = JSON.parse(readFileSync(new URL("./city_plan.json", import.meta.url), "utf8"));

/** Same start values as `param-list.ts` in PR #61 for the names the delivery code reads. */
export class FakeParams implements ParamSource {
  readonly values = new Map<string, number>([
    ["game.delivery_base", 100],
    ["game.delivery_bonus", 2],
    ["game.delivery_radius_m", 4],
    ...Array.from({ length: 8 }, (_, p) => [`players.${p}.far_chance`, 0.5] as [string, number]),
  ]);

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

/** Seeded random numbers (mulberry32), like the shared generator of M1-1. */
export class FakeRng implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * Fake M3 travel times: city block distance from the store to the point at
 * 10 m/s. The city is the same on all sides, so every team gets the same set
 * of times. `closed` points cannot be reached.
 */
export function fakeTravel(positions: Map<number, { x: number; z: number }>, closed: Set<number> = new Set()) {
  return (team: number): TravelTimeTable => {
    const store = PLAN.stores[team].pickup;
    const times_s: Record<string, number | null> = {};
    for (const [id, p] of positions) {
      times_s[String(id)] = closed.has(id) ? null : (Math.abs(p.x - store.x) + Math.abs(p.z - store.z)) / 10;
    }
    return { team, times_s };
  };
}
