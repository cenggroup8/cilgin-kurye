// The one obstacle list of the game (M1-4, plan #23).
//
// M3, M4, M5 and M6 all read this list. Every change makes `version` one higher,
// so a reader sees that the list changed with one number. No clock and no random
// numbers: time comes from `tick()`, which counts only while the game clock runs,
// so a pause stops every end time. The outside face (`addObstacle`,
// `removeObstacle`, `closeRoad`) fits `HazardControl` of PR #61; `obstacleAhead`
// and `quake` of that interface come in the next steps.

import {
  durationParam,
  LANE_MAX,
  OBSTACLE_TYPES,
  SEGMENT_COUNT,
  secondsToTicks,
} from "./estimates.js";
import type {
  AddResult,
  ClockSource,
  Obstacle,
  ObstacleSource,
  ObstacleType,
  ParamSource,
  Result,
} from "./estimates.js";

export interface ObstacleListDeps {
  params: ParamSource;
  clock: ClockSource;
}

/** What the random spawner and the earthquake give to `add`. */
export interface NewObstacle {
  type: ObstacleType;
  segment: number;
  lane: number;
  pos: number;
  source?: ObstacleSource;
  /** How long it stays, in ticks. Without it, the parameter of its type is used. */
  durationTicks?: number;
}

function validSegment(segment: number): boolean {
  return Number.isInteger(segment) && segment >= 0 && segment < SEGMENT_COUNT;
}

export class ObstacleList {
  private readonly deps: ObstacleListDeps;
  private list: Obstacle[] = [];
  private nextId = 0;
  private versionNumber = 0;
  private tickCount = 0;

  constructor(deps: ObstacleListDeps) {
    this.deps = deps;
  }

  /** Goes up by one on every change of the list. Never goes down. */
  get version(): number {
    return this.versionNumber;
  }

  /** Ticks of the running game clock since the start (or the last `clear`). */
  get ticks(): number {
    return this.tickCount;
  }

  /** The obstacles now, oldest first. The entries cannot be changed. */
  get items(): readonly Obstacle[] {
    return this.list.slice();
  }

  /** Ticks left of an obstacle, or undefined when it is not in the list. */
  ticksLeft(id: number): number | undefined {
    const o = this.list.find((x) => x.id === id);
    return o === undefined ? undefined : o.endTick - this.tickCount;
  }

  // ---- the face that PR #61 (`HazardControl`) calls ----

  addObstacle(o: { type: ObstacleType; segment: number; lane: number; pos: number }): AddResult {
    return this.add({ type: o.type, segment: o.segment, lane: o.lane, pos: o.pos, source: "admin" });
  }

  removeObstacle(id: number): Result {
    const index = this.list.findIndex((x) => x.id === id);
    if (index < 0) return { ok: false, error: "unknown_obstacle" };
    this.list.splice(index, 1);
    this.versionNumber++;
    return { ok: true };
  }

  /**
   * Road work on a whole segment. A segment that is already closed this way
   * keeps its road work: the call answers with its id and changes nothing.
   */
  closeRoad(segment: number): AddResult {
    if (!validSegment(segment)) return { ok: false, error: "unknown_road" };
    const closed = this.list.find((x) => x.type === "road_work" && x.segment === segment && x.lane === 0);
    if (closed !== undefined) return { ok: true, id: closed.id };
    return this.add({ type: "road_work", segment, lane: 0, pos: 0.5, source: "admin" });
  }

  // ---- for the random spawner and the earthquake (next steps) ----

  add(o: NewObstacle): AddResult {
    if (!(OBSTACLE_TYPES as readonly unknown[]).includes(o.type)) return { ok: false, error: "bad_type" };
    if (!validSegment(o.segment)) return { ok: false, error: "unknown_road" };
    if (!Number.isInteger(o.lane) || o.lane < 0 || o.lane > LANE_MAX) return { ok: false, error: "unknown_lane" };
    if (!Number.isFinite(o.pos) || o.pos < 0 || o.pos > 1) return { ok: false, error: "bad_pos" };
    if (o.durationTicks !== undefined && !(Number.isFinite(o.durationTicks) && o.durationTicks > 0)) {
      return { ok: false, error: "bad_duration" };
    }

    const duration =
      o.durationTicks !== undefined
        ? Math.round(o.durationTicks)
        : secondsToTicks(this.deps.params.get(durationParam(o.type)));
    const item: Obstacle = Object.freeze({
      id: this.nextId++,
      type: o.type,
      segment: o.segment,
      lane: o.lane,
      pos: o.pos,
      source: o.source ?? "admin",
      endTick: this.tickCount + Math.max(1, duration),
    });
    this.list.push(item);
    this.versionNumber++;
    return { ok: true, id: item.id };
  }

  /**
   * Step 6 of the tick. While the game clock does not run (pause, countdown,
   * lobby, end) nothing happens: no time passes and nothing ends. Returns the
   * obstacles that ended in this tick; the version goes up once for all of them.
   */
  tick(): Obstacle[] {
    if (!this.deps.clock.clockRunning) return [];
    this.tickCount++;
    const ended = this.list.filter((x) => x.endTick <= this.tickCount);
    if (ended.length > 0) {
      this.list = this.list.filter((x) => x.endTick > this.tickCount);
      this.versionNumber++;
    }
    return ended;
  }

  /**
   * For a new game (reset to the lobby): empty list, ids and time start again.
   * The version only goes up, so a reader never sees it go back.
   */
  clear(): void {
    if (this.list.length > 0) this.versionNumber++;
    this.list = [];
    this.nextId = 0;
    this.tickCount = 0;
  }
}
