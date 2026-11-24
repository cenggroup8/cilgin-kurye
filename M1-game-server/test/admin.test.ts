import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  AdminHandler,
  type AdminCommand,
  type CommandName,
  type HazardControl,
  type MatchControl,
  type Phase,
  type Result,
} from "../src/admin/admin.js";
import { PARAMS } from "../src/admin/param-list.js";
import { ParamRegistry, type ParamDef } from "../src/admin/params.js";

const OK: Result = { ok: true };

/** Fake M1-2: records calls and moves the phase like the real one. */
class FakeMatch implements MatchControl {
  phase: Phase = "lobby";
  calls: string[] = [];
  start(bots: number): Result {
    this.calls.push(`start ${bots}`);
    this.phase = "countdown";
    return OK;
  }
  pause(): Result {
    this.calls.push("pause");
    this.phase = "paused";
    return OK;
  }
  resume(): Result {
    this.calls.push("resume");
    this.phase = "playing";
    return OK;
  }
  end(): Result {
    this.calls.push("end");
    this.phase = "ended";
    return OK;
  }
  reset(): Result {
    this.calls.push("reset");
    this.phase = "lobby";
    return OK;
  }
}

/** Fake M1-4: segments 0–59 exist, players 0–7. */
class FakeHazards implements HazardControl {
  calls: string[] = [];
  addObstacle(o: { type: string; segment: number; lane: number; pos: number }): Result {
    if (o.segment >= 60) return { ok: false, error: "unknown_road" };
    this.calls.push(`add ${o.type} ${o.segment} ${o.lane} ${o.pos}`);
    return OK;
  }
  removeObstacle(id: number): Result {
    this.calls.push(`remove ${id}`);
    return OK;
  }
  closeRoad(segment: number): Result {
    if (segment >= 60) return { ok: false, error: "unknown_road" };
    this.calls.push(`close ${segment}`);
    return OK;
  }
  obstacleAhead(player: number, type: string): Result {
    this.calls.push(`ahead ${player} ${type}`);
    return OK;
  }
  quake(mag: number, zone: number): Result {
    this.calls.push(`quake ${mag} ${zone}`);
    return OK;
  }
}

function setup(phase: Phase = "lobby") {
  const params = new ParamRegistry(PARAMS);
  const match = new FakeMatch();
  match.phase = phase;
  const hazards = new FakeHazards();
  const sent: string[] = [];
  let codes = 0;
  const admin = new AdminHandler({
    params,
    match,
    hazards,
    network: { newGameCode: () => void codes++ },
    sinks: {
      M2: (n, v) => sent.push(`M2 ${n}=${v}`),
      M3: (n, v) => sent.push(`M3 ${n}=${v}`),
      M4: (n, v) => sent.push(`M4 ${n}=${v}`),
      M6: (n, v) => sent.push(`M6 ${n}=${v}`),
    },
  });
  return { params, match, hazards, sent, admin, codes: () => codes };
}

let nextId = 1;
const cmd = (name: string, args?: Record<string, unknown>): AdminCommand => ({ id: nextId++, name, args });

describe("parameter registry", () => {
  it("has unique names, start values inside the limits and a known owner", () => {
    expect(() => new ParamRegistry(PARAMS)).not.toThrow();
    const groups = new Set(PARAMS.map((p) => p.group));
    expect([...groups].sort()).toEqual(["board", "game", "net", "obstacles", "physics", "players", "quake"]);
    for (const p of PARAMS) expect(p.name.startsWith(`${p.group}.`)).toBe(true);
  });

  it("rejects a broken list", () => {
    const d: ParamDef = { name: "game.x", group: "game", min: 0, max: 1, start: 0, owner: "M1", label: "x" };
    expect(() => new ParamRegistry([d, d])).toThrow();
    expect(() => new ParamRegistry([{ ...d, start: 2 }])).toThrow();
    expect(() => new ParamRegistry([{ ...d, max: 5, start: 0.5, integer: true }])).toThrow();
  });

  it("the list alone is enough to build the forms", () => {
    const { admin } = setup();
    const msg = admin.paramsMessage();
    expect(msg.t).toBe("params");
    expect(msg.list).toHaveLength(PARAMS.length);
    for (const row of msg.list) {
      expect(row).toEqual({
        name: expect.any(String),
        group: expect.any(String),
        label: expect.any(String),
        value: expect.any(Number),
        min: expect.any(Number),
        max: expect.any(Number),
        integer: expect.any(Boolean),
        owner: expect.stringMatching(/^M[1-6]$/),
      });
      expect(row.min).toBeLessThanOrEqual(row.value);
      expect(row.value).toBeLessThanOrEqual(row.max);
    }
  });

  it("keeps the old value after a wrong value", () => {
    const p = new ParamRegistry(PARAMS);
    expect(p.set("physics.grip", 5)).toEqual({ ok: false, error: "out_of_range" });
    expect(p.set("physics.grip", "0.8")).toEqual({ ok: false, error: "bad_value" });
    expect(p.set("physics.grip", Number.NaN)).toEqual({ ok: false, error: "bad_value" });
    expect(p.set("game.bots", 2.5)).toEqual({ ok: false, error: "bad_value" });
    expect(p.set("no.such", 1)).toEqual({ ok: false, error: "unknown_param" });
    expect(p.get("physics.grip")).toBe(1);
    expect(p.set("physics.grip", 0.1).ok).toBe(true); // the limit itself is allowed
    expect(p.get("physics.grip")).toBe(0.1);
  });
});

describe("param_set", () => {
  it("saves, sends to the owner module and answers ok", () => {
    const { admin, params, sent } = setup("playing");
    const c = cmd("param_set", { name: "physics.grip", value: 0.8 });
    expect(admin.apply(c)).toEqual({
      reply: { t: "reply", id: c.id, ok: true },
      notice: { t: "param", name: "physics.grip", value: 0.8 },
    });
    expect(params.get("physics.grip")).toBe(0.8);
    admin.apply(cmd("param_set", { name: "board.brightness", value: 0.3 }));
    admin.apply(cmd("param_set", { name: "net.2.down.loss_pct", value: 10 }));
    admin.apply(cmd("param_set", { name: "net.2.fps_limit", value: 30 }));
    expect(sent).toEqual(["M3 physics.grip=0.8", "M6 board.brightness=0.3", "M2 net.2.down.loss_pct=10", "M4 net.2.fps_limit=30"]);
  });

  it("an M1 value is only saved; the M1 rules read it from the registry", () => {
    const { admin, params, sent } = setup();
    expect(admin.apply(cmd("param_set", { name: "game.penalty_s", value: 5 })).reply.ok).toBe(true);
    expect(params.get("game.penalty_s")).toBe(5);
    expect(sent).toEqual([]);
  });

  it("a wrong value gets an error, no notice, and nothing is sent", () => {
    const { admin, params, sent } = setup();
    for (const [args, error] of [
      [{ name: "physics.grip", value: 9 }, "out_of_range"],
      [{ name: "physics.grip", value: null }, "bad_value"],
      [{ name: "physics.nope", value: 1 }, "unknown_param"],
      [{ value: 1 }, "bad_args"],
    ] as const) {
      const out = admin.apply(cmd("param_set", args));
      expect(out.reply).toMatchObject({ ok: false, error });
      expect(out.notice).toBeUndefined();
    }
    expect(params.get("physics.grip")).toBe(1);
    expect(sent).toEqual([]);
  });
});

describe("game commands", () => {
  it("go to the match with the number of bots from the parameters", () => {
    const { admin, match } = setup();
    admin.apply(cmd("param_set", { name: "game.bots", value: 3 }));
    expect(admin.apply(cmd("start")).reply.ok).toBe(true);
    match.phase = "playing";
    admin.applyAll([cmd("pause"), cmd("resume"), cmd("end"), cmd("reset")]);
    expect(match.calls).toEqual(["start 3", "pause", "resume", "end", "reset"]);
  });

  it("pass on an error of the match", () => {
    const { admin, match } = setup();
    match.start = () => ({ ok: false, error: "no_players" });
    expect(admin.apply(cmd("start")).reply).toMatchObject({ ok: false, error: "no_players" });
  });

  it("new_code goes to M2 in every phase", () => {
    const { admin, match, codes } = setup();
    for (const ph of ["lobby", "countdown", "playing", "paused", "ended"] as Phase[]) {
      match.phase = ph;
      expect(admin.apply(cmd("new_code")).reply.ok).toBe(true);
    }
    expect(codes()).toBe(5);
  });

  it("an unknown command gets an error", () => {
    const { admin } = setup();
    expect(admin.apply(cmd("explode")).reply).toMatchObject({ ok: false, error: "unknown_command" });
    expect(admin.apply(cmd("toString")).reply).toMatchObject({ ok: false, error: "unknown_command" });
  });
});

describe("obstacles and earthquake", () => {
  it("go to M1-4 with checked arguments", () => {
    const { admin, hazards } = setup("playing");
    const outs = admin.applyAll([
      cmd("obstacle_add", { type: "road_work", segment: 12, lane: 1, pos: 0.5 }),
      cmd("obstacle_remove", { id: 7 }),
      cmd("road_close", { segment: 3 }),
      cmd("obstacle_ahead", { player: 2, type: "puddle" }),
      cmd("quake", { mag: 6.5, zone: 4 }),
      cmd("quake", { mag: 10, zone: -1 }),
    ]);
    expect(outs.every((o) => o.reply.ok)).toBe(true);
    expect(hazards.calls).toEqual([
      "add road_work 12 1 0.5",
      "remove 7",
      "close 3",
      "ahead 2 puddle",
      "quake 6.5 4",
      "quake 10 -1",
    ]);
  });

  it("wrong arguments get bad_args and do not reach M1-4", () => {
    const { admin, hazards } = setup("playing");
    const bad: AdminCommand[] = [
      cmd("obstacle_add", { type: "lava", segment: 1, lane: 0, pos: 0.5 }),
      cmd("obstacle_add", { type: "accident", segment: -1, lane: 0, pos: 0.5 }),
      cmd("obstacle_add", { type: "accident", segment: 1, lane: 0, pos: 2 }),
      cmd("obstacle_add", { type: "accident", segment: 1.5, lane: 0, pos: 0.5 }),
      cmd("obstacle_remove", {}),
      cmd("road_close", { segment: "3" }),
      cmd("obstacle_ahead", { player: 8, type: "puddle" }),
      cmd("quake", { mag: 11, zone: 0 }),
      cmd("quake", { mag: 5, zone: 9 }),
      cmd("quake"),
    ];
    for (const out of admin.applyAll(bad)) expect(out.reply).toMatchObject({ ok: false, error: "bad_args" });
    expect(hazards.calls).toEqual([]);
  });

  it("an unknown road is M1-4's answer", () => {
    const { admin } = setup("playing");
    expect(admin.apply(cmd("road_close", { segment: 99 })).reply).toMatchObject({ ok: false, error: "unknown_road" });
  });
});

describe("phase permissions", () => {
  const good: Record<CommandName, Record<string, unknown> | undefined> = {
    start: undefined,
    pause: undefined,
    resume: undefined,
    end: undefined,
    reset: undefined,
    new_code: undefined,
    param_set: { name: "physics.grip", value: 0.9 },
    obstacle_add: { type: "accident", segment: 1, lane: 0, pos: 0.2 },
    obstacle_remove: { id: 1 },
    road_close: { segment: 1 },
    obstacle_ahead: { player: 0, type: "accident" },
    quake: { mag: 5, zone: 0 },
  };
  const phases: Phase[] = ["lobby", "countdown", "playing", "paused", "ended"];

  for (const name of Object.keys(ALLOWED) as CommandName[]) {
    for (const ph of phases) {
      const allowed = ALLOWED[name].includes(ph);
      it(`${name} in ${ph}: ${allowed ? "ok" : "wrong_phase"}`, () => {
        const { admin } = setup(ph);
        const out = admin.apply(cmd(name, good[name]));
        expect(out.reply.ok).toBe(allowed);
        if (!allowed) expect(out.reply).toMatchObject({ error: "wrong_phase" });
      });
    }
  }

  it("the phase is read again for every command in the same tick", () => {
    const { admin } = setup("lobby");
    const outs = admin.applyAll([cmd("pause"), cmd("start"), cmd("pause")]);
    expect(outs.map((o) => o.reply.ok)).toEqual([false, true, true]);
  });
});

describe("timing", () => {
  it("a value changed during the game is used in the next tick", () => {
    // A tiny tick loop in the order of plan 3.1: step 2 admin commands, step 6 rules.
    const { admin, params } = setup("playing");
    const inbox: AdminCommand[] = [];
    const seen: number[] = [];
    const tick = () => {
      admin.applyAll(inbox.splice(0)); // step 2
      seen.push(params.get("game.penalty_s")); // step 6: a rule reads its value
    };
    tick();
    inbox.push(cmd("param_set", { name: "game.penalty_s", value: 7 })); // arrives between ticks
    tick();
    tick();
    expect(seen).toEqual([3, 7, 7]);
  });

  it("the same commands give the same replies and values", () => {
    const run = () => {
      const { admin, params } = setup("playing");
      nextId = 1;
      const outs = admin.applyAll([
        cmd("param_set", { name: "physics.grip", value: 0.7 }),
        cmd("param_set", { name: "physics.grip", value: 7 }),
        cmd("quake", { mag: 3, zone: 2 }),
        cmd("pause"),
      ]);
      return JSON.stringify({ outs, list: params.list() });
    };
    expect(run()).toBe(run());
  });
});
