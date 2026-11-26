// Admin commands (M1-5, plan #23).
// Checks every admin command, sends it to the package that does the work and
// gives one reply per command. It decides nothing about the game itself.
// No clock and no random numbers: it only runs inside step 2 of a tick.

import { MAX_LANE, OBSTACLE_TYPES, PLAYERS, type ObstacleType } from "./param-list.js";
import type { Owner, ParamInfo, ParamRegistry } from "./params.js";

/** Same phases as M1-2 (`src/match`). */
export type Phase = "lobby" | "countdown" | "playing" | "paused" | "ended";

export type Result = { ok: true } | { ok: false; error: string };

/**
 * M1-2: match and lobby. `end` has no scores on purpose: the admin does not know them.
 * M1-1 connects it, for example `end: () => match.end(game.scores())`.
 */
export interface MatchControl {
  readonly phase: Phase;
  start(botCount: number): Result;
  pause(): Result;
  resume(): Result;
  end(): Result;
  reset(): Result;
}

/** M1-4: obstacles and earthquake. M1-4 checks that the road and the player exist. */
export interface HazardControl {
  addObstacle(o: { type: ObstacleType; segment: number; lane: number; pos: number }): Result;
  removeObstacle(id: number): Result;
  closeRoad(segment: number): Result;
  obstacleAhead(player: number, type: ObstacleType): Result;
  /** `zone` 0–8, or −1 for the whole board. */
  quake(mag: number, zone: number): Result;
}

/** M2: the game code belongs to M2 (v2.1 section 6.4). M1 only passes the request on. */
export interface NetworkControl {
  newGameCode(): void;
}

/** Receives a checked parameter value for one owner module. */
export type ParamSink = (name: string, value: number) => void;

export type CommandName =
  | "start"
  | "pause"
  | "resume"
  | "end"
  | "reset"
  | "new_code"
  | "param_set"
  | "param_reset"
  | "obstacle_add"
  | "obstacle_remove"
  | "road_close"
  | "obstacle_ahead"
  | "quake";

/** `cmd` message from the admin page. M2 has already decoded it; the args are not trusted. */
export interface AdminCommand {
  id: number;
  name: string;
  args?: Record<string, unknown>;
}

export type Reply = { t: "reply"; id: number; ok: true } | { t: "reply"; id: number; ok: false; error: string };

/** A changed value. M2 sends it to the admin, which puts a mark on the graphs. */
export interface ParamNotice {
  t: "param";
  name: string;
  value: number;
}

export interface AdminOutput {
  reply: Reply;
  notice?: ParamNotice;
  /** After `param_reset`: the full list again, for the admin forms. */
  params?: ParamsMessage;
}

export interface ParamsMessage {
  t: "params";
  list: ParamInfo[];
}

const ALL: readonly Phase[] = ["lobby", "countdown", "playing", "paused", "ended"];
const IN_GAME: readonly Phase[] = ["playing", "paused"];

/** Which command is allowed in which phase. */
export const ALLOWED: Readonly<Record<CommandName, readonly Phase[]>> = {
  param_set: ALL,
  param_reset: ALL,
  new_code: ALL,
  reset: ALL,
  start: ["lobby"],
  pause: ["countdown", "playing"],
  resume: ["paused"],
  end: ["countdown", "playing", "paused"],
  obstacle_add: IN_GAME,
  obstacle_remove: IN_GAME,
  road_close: IN_GAME,
  obstacle_ahead: IN_GAME,
  quake: IN_GAME,
};

export interface AdminDeps {
  params: ParamRegistry;
  match: MatchControl;
  hazards: HazardControl;
  network: NetworkControl;
  /**
   * One sink per owner module. M1's own values are read from the registry, so M1 needs none.
   * A value for an owner without a sink is refused with `owner_not_connected`.
   */
  sinks: Partial<Record<Owner, ParamSink>>;
}

const BAD_ARGS = "bad_args";

function isCommand(name: string): name is CommandName {
  return Object.prototype.hasOwnProperty.call(ALLOWED, name);
}

function int(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

function obstacleType(v: unknown): ObstacleType | undefined {
  return (OBSTACLE_TYPES as readonly unknown[]).includes(v) ? (v as ObstacleType) : undefined;
}

export class AdminHandler {
  constructor(private readonly deps: AdminDeps) {}

  /** Answer to `params_get`: every parameter with its value and limits. */
  paramsMessage(): ParamsMessage {
    return { t: "params", list: this.deps.params.list() };
  }

  /**
   * Sends every current value to its owner module. The `start` command calls it itself;
   * M1-1 calls it once when the server starts. So no module keeps an old value.
   * Returns the owners that have values but no sink, for the log.
   */
  pushAll(): Owner[] {
    const missing = new Set<Owner>();
    for (const p of this.deps.params.list()) {
      if (p.owner === "M1") continue;
      const sink = this.deps.sinks[p.owner];
      if (sink) sink(p.name, p.value);
      else missing.add(p.owner);
    }
    return [...missing];
  }

  /** Owners that have parameters but no sink. */
  private missingOwners(): Owner[] {
    const missing = new Set<Owner>();
    for (const p of this.deps.params.list()) {
      if (p.owner !== "M1" && !this.deps.sinks[p.owner]) missing.add(p.owner);
    }
    return [...missing];
  }

  /** Step 2 of the tick: all admin commands of this tick, in the order they came. */
  applyAll(cmds: readonly AdminCommand[]): AdminOutput[] {
    return cmds.map((c) => this.apply(c));
  }

  apply(cmd: AdminCommand): AdminOutput {
    const fail = (error: string): AdminOutput => ({ reply: { t: "reply", id: cmd.id, ok: false, error } });
    const done = (r: Result): AdminOutput =>
      r.ok ? { reply: { t: "reply", id: cmd.id, ok: true } } : fail(r.error);

    if (!isCommand(cmd.name)) return fail("unknown_command");
    // The phase is read again for every command: a "start" earlier in the same tick counts.
    if (!ALLOWED[cmd.name].includes(this.deps.match.phase)) return fail("wrong_phase");

    const a = cmd.args ?? {};
    const { match, hazards } = this.deps;

    switch (cmd.name) {
      case "start":
        // Modules that connected after the last change get every value before the match.
        // A missing owner is only logged here (M1-1); it must not block the match.
        this.pushAll();
        return done(match.start(this.deps.params.get("game.bots")));
      case "pause":
        return done(match.pause());
      case "resume":
        return done(match.resume());
      case "end":
        return done(match.end());
      case "reset":
        // Parameters keep the values the admin set; only the match starts again.
        // `param_reset` brings the start values back.
        return done(match.reset());
      case "param_reset": {
        // Same rule as param_set: if an owner cannot be reached, nothing is changed.
        if (this.missingOwners().length > 0) return fail("owner_not_connected");
        this.deps.params.resetAll();
        this.pushAll();
        return { reply: { t: "reply", id: cmd.id, ok: true }, params: this.paramsMessage() };
      }
      case "new_code":
        this.deps.network.newGameCode();
        return done({ ok: true });
      case "param_set":
        return this.setParam(cmd.id, a);
      case "obstacle_add": {
        const type = obstacleType(a.type);
        const segment = int(a.segment, 0, Number.MAX_SAFE_INTEGER);
        const lane = int(a.lane, 0, MAX_LANE);
        const pos = num(a.pos, 0, 1);
        if (type === undefined || segment === undefined || lane === undefined || pos === undefined) {
          return fail(BAD_ARGS);
        }
        return done(hazards.addObstacle({ type, segment, lane, pos }));
      }
      case "obstacle_remove": {
        const id = int(a.id, 0, Number.MAX_SAFE_INTEGER);
        return id === undefined ? fail(BAD_ARGS) : done(hazards.removeObstacle(id));
      }
      case "road_close": {
        const segment = int(a.segment, 0, Number.MAX_SAFE_INTEGER);
        return segment === undefined ? fail(BAD_ARGS) : done(hazards.closeRoad(segment));
      }
      case "obstacle_ahead": {
        const player = int(a.player, 0, PLAYERS - 1);
        const type = obstacleType(a.type);
        return player === undefined || type === undefined
          ? fail(BAD_ARGS)
          : done(hazards.obstacleAhead(player, type));
      }
      case "quake": {
        const mag = num(a.mag, 0, 10);
        const zone = int(a.zone, -1, 8);
        return mag === undefined || zone === undefined ? fail(BAD_ARGS) : done(hazards.quake(mag, zone));
      }
    }
  }

  private setParam(id: number, a: Record<string, unknown>): AdminOutput {
    if (typeof a.name !== "string") return { reply: { t: "reply", id, ok: false, error: BAD_ARGS } };
    const r = this.deps.params.check(a.name, a.value);
    if (!r.ok) return { reply: { t: "reply", id, ok: false, error: r.error } };
    // A value that cannot reach its module is not saved, so the admin never sees a false "ok".
    const sink = r.owner === "M1" ? undefined : this.deps.sinks[r.owner];
    if (r.owner !== "M1" && !sink) return { reply: { t: "reply", id, ok: false, error: "owner_not_connected" } };
    this.deps.params.set(r.name, r.value);
    sink?.(r.name, r.value);
    return {
      reply: { t: "reply", id, ok: true },
      notice: { t: "param", name: r.name, value: r.value },
    };
  }
}
