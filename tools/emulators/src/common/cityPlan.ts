// The shared city plan (contracts/city_plan.json) and board positions u, v.
// contracts/README.md: x to the east, z to the south, u = x / size_m, v = z / size_m.

import { readFileSync } from "node:fs";

export interface CityPlan {
  version: string;
  world: { size_m: number };
  grid: { lines: number; pitch_m: number; lanes_per_direction: number; lane_width_m: number };
  nodes: { id: number; name: string; x: number; z: number }[];
  segments: { id: number; name: string; a: number; b: number; dir: "EW" | "NS"; length_m: number }[];
  stores: { team: number; color: string; corner: string; node: number; pickup: { x: number; z: number; radius_m: number } }[];
  delivery_candidates: { id: number; segment: number; t: number; side: string }[];
}

export function loadCityPlan(file = new URL("../../../../contracts/city_plan.json", import.meta.url)): CityPlan {
  return JSON.parse(readFileSync(file, "utf8")) as CityPlan;
}

/** Point on a segment: t = 0 at node a, 1 at node b. */
export function pointOnSegment(plan: CityPlan, segment: number, t: number): { x: number; z: number } {
  const s = plan.segments[segment];
  const a = plan.nodes[s.a];
  const b = plan.nodes[s.b];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function toUV(plan: CityPlan, p: { x: number; z: number }): { u: number; v: number } {
  const size = plan.world.size_m;
  return { u: clamp01(p.x / size), v: clamp01(p.z / size) };
}

/** Centre of zone 0–8 (zone = 3 × row + column, row 0 north, column 0 west). */
export function zoneCentre(zone: number): { u: number; v: number } {
  return { u: ((zone % 3) + 0.5) / 3, v: (Math.floor(zone / 3) + 0.5) / 3 };
}

/** Zones of the four motors: mask bit 0 → zone 0, bit 1 → 2, bit 2 → 6, bit 3 → 8. */
export const MOTOR_ZONES = [0, 2, 6, 8] as const;

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Small seeded random numbers (mulberry32), so a scenario repeats. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
