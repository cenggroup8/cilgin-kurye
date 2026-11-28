// TAHMİN, M1-1 ve contracts gelince değişecek.
//
// Everything in this file is a guess. The other M1 parts and `contracts/` do not
// say these things yet, so the hazards code reads them from this one file and
// nowhere else. When M1-1 (world state, tick, seeded random numbers) and the
// M1-M3 physics messages in `contracts/` exist, replace this file.
//
// What is guessed, and where it comes from:
//   - Names of the four obstacle types and of the parameters: PR #61 (M1-5).
//   - `ClockSource` is the `clockRunning` getter of `Match` in PR #59 (M1-2).
//   - `ParamSource` is `get(name)` of `ParamRegistry` in PR #61.
//   - Segment count 60 and the player count 8: `contracts/` (PR #62) and v2.1.
//   - Lanes: contracts/README.md (PR #62, Lanes). 0 = the whole road; 1 and 2 drive in the direction of the segment (h_r_c east, v_r_c south), 3 and 4 the other way; 1 and 3 are next to the centre line. M3 (PR #65, contract.ts) converts at its own border.
//   - 30 ticks per second: v2.1 section 5.5 (M1-1 will own the constant).
//   - The fall event and the stand up request are only a player number. The real
//     physics messages are not written (issue #29).
//
// Files in `src/hazards/` import only from here for these things.

export const TICKS_PER_SECOND = 30;

export const PLAYER_COUNT = 8;

/** Road segments of the city plan, numbered 0-59 (`contracts/README.md`). */
export const SEGMENT_COUNT = 60;

/** Highest lane number (contracts/README.md, Lanes). 0 means the whole road. */
export const LANE_MAX = 4;

export const OBSTACLE_TYPES = ["heavy_traffic", "road_work", "accident", "puddle"] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];

/** Who made the obstacle: the admin, the random spawner, or an earthquake. */
export type ObstacleSource = "admin" | "random" | "quake";

/** One entry of the obstacle list. */
export interface Obstacle {
  readonly id: number;
  readonly type: ObstacleType;
  /** Road segment 0-59. */
  readonly segment: number;
  readonly lane: number;
  /** Position along the segment, 0-1. */
  readonly pos: number;
  readonly source: ObstacleSource;
  /**
   * End time in obstacle ticks: ticks of the running game clock, so a pause is
   * not counted. Compare with `ObstacleList.ticks`.
   */
  readonly endTick: number;
}

/** Same shape as `Result` in `src/admin/admin.ts` (PR #61). */
export type Result = { ok: true } | { ok: false; error: string };

/** A `Result` that also gives the id of the new obstacle. */
export type AddResult = { ok: true; id: number } | { ok: false; error: string };

/** The part of `ParamRegistry` (PR #61) that the hazards code needs. */
export interface ParamSource {
  get(name: string): number;
}

/** The part of `Match` (PR #59) that the hazards code needs. */
export interface ClockSource {
  /** False in a pause, in the lobby, in the countdown and at the end. */
  readonly clockRunning: boolean;
}

/**
 * Seeded random numbers from M1-1, a number from 0 up to but not including 1.
 * Not used in this step: the random obstacle spawner (next step) needs it.
 */
export interface Rng {
  next(): number;
}

/** Name of the parameter for how long a fallen player waits, in seconds. */
export const PENALTY_PARAM = "game.penalty_s";

/** Name of the parameter for how long an obstacle of this type stays, in seconds. */
export function durationParam(type: ObstacleType): string {
  return `obstacles.${type}.duration_s`;
}

/** The request M1 gives to M3 when a penalty is over. */
export interface StandUpRequest {
  readonly player: number;
}

/** Whole ticks for a time in seconds. Never negative. */
export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
}
