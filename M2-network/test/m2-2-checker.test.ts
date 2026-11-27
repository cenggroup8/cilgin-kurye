// M2-2 (#35): type and field checks, ranges, own player only, old order numbers.
import { describe, expect, it } from "vitest";
import { Checker } from "../src/codec/checker.js";
import { isDroppable } from "../src/codec/schema.js";
import type { Session } from "../src/session/types.js";

function phone(playerNo = 2): Session {
  return { connId: 10 + playerNo, role: "player", playerKey: `key-${playerNo}`, playerNo, name: "p", lastSeq: -1, msgsIn: 0, bytesIn: 0, openedAt: 0 };
}
function admin(): Session {
  return { connId: 99, role: "admin", lastSeq: -1, msgsIn: 0, bytesIn: 0, openedAt: 0 };
}
const control = (seq: number, extra: Record<string, unknown> = {}) => ({ t: "control", seq, throttle: 1, brake: 0, steer: 0.5, ...extra });

describe("good messages", () => {
  it("passes every phone message of the contract with only its fields", () => {
    const c = new Checker();
    const s = phone();
    const r1 = c.check(s, control(1, { x: 100, score: 9999 }));
    expect(r1).toEqual({
      ok: true,
      msg: { t: "control", connId: s.connId, role: "player", playerNo: 2, playerKey: "key-2", droppable: true, fields: { seq: 1, throttle: 1, brake: 0, steer: 0.5, player: 2 } },
    });
    const r2 = c.check(s, { t: "find_me", now: true });
    expect(r2.ok && r2.msg.fields).toEqual({});
    expect(r2.ok && r2.msg.droppable).toBe(false);
    const r3 = c.check(s, { t: "pong", id: 3, ct: 1700000000000, fps: 59.5, last: -1 });
    expect(r3.ok && r3.msg.fields).toEqual({ id: 3, ct: 1700000000000, fps: 59.5, last: -1 });
  });

  it("takes the edges of every range", () => {
    const c = new Checker();
    const s = phone();
    expect(c.check(s, { t: "control", seq: 1, throttle: 0, brake: 1, steer: -1 }).ok).toBe(true);
    expect(c.check(s, { t: "control", seq: 2, throttle: 1, brake: 0, steer: 1 }).ok).toBe(true);
  });

  it("passes admin requests and commands, args rebuilt with only their fields", () => {
    const c = new Checker();
    const a = admin();
    for (const t of ["snapshot_get", "params_get"]) expect(c.check(a, { t }).ok).toBe(true);
    expect(c.check(a, { t: "log_get", since: 12 }).ok).toBe(true);
    const r = c.check(a, { t: "cmd", id: 7, name: "obstacle_add", args: { type: "puddle", segment: 12, lane: 0, pos: 0.5, evil: 1 } });
    expect(r.ok && r.msg.fields).toEqual({ id: 7, name: "obstacle_add", args: { type: "puddle", segment: 12, lane: 0, pos: 0.5 } });
    expect(c.check(a, { t: "cmd", id: 8, name: "start" }).ok).toBe(true);
    expect(c.check(a, { t: "cmd", id: 9, name: "quake", args: { mag: 7.5, zone: -1 } }).ok).toBe(true);
    expect(c.check(a, { t: "cmd", id: 10, name: "param_set", args: { name: "physics.grip", value: 0.8 } }).ok).toBe(true);
  });
});

describe("broken messages are refused", () => {
  const cases: Array<[string, unknown, string]> = [
    ["not a map", [1, 2, 3], "bad_message"],
    ["a plain number", 42, "bad_message"],
    ["no type", { seq: 1, throttle: 1 }, "bad_message"],
    ["type is not a string", { t: 5 }, "bad_message"],
    ["unknown type", { t: "teleport", x: 0, z: 0 }, "unknown_type"],
    ["admin message on a phone link", { t: "cmd", id: 1, name: "start" }, "unknown_type"],
    ["a position from a phone", { t: "pose", x: 1, z: 2 }, "unknown_type"],
    ["missing field", { t: "control", seq: 1, throttle: 1, brake: 0 }, "bad_field"],
    ["string instead of number", control(1, { steer: "left" }), "bad_field"],
    ["NaN", control(1, { brake: Number.NaN }), "bad_field"],
    ["Infinity", control(1, { throttle: Number.POSITIVE_INFINITY }), "bad_field"],
    ["seq not whole", control(1.5), "bad_field"],
    ["seq zero", control(0), "out_of_range"],
    ["seq negative", control(-5), "out_of_range"],
    ["steer above 1", control(1, { steer: 1.01 }), "out_of_range"],
    ["steer below -1", control(1, { steer: -7 }), "out_of_range"],
    ["throttle above 1", control(1, { throttle: 7 }), "out_of_range"],
    ["throttle below 0", control(1, { throttle: -0.1 }), "out_of_range"],
    ["player not whole", control(1, { player: 2.5 }), "bad_field"],
    ["pong fps too high", { t: "pong", id: 1, ct: 0, fps: 5000, last: 0 }, "out_of_range"],
    ["second hello", { t: "hello", key: "k", name: "n", code: "123456" }, "unexpected"],
  ];
  for (const [name, msg, reason] of cases) {
    it(`${name} → ${reason}`, () => {
      const r = new Checker().check(phone(), msg);
      expect(r.ok).toBe(false);
      expect(!r.ok && "reason" in r && r.reason).toBe(reason);
    });
  }

  it("a control for another player is refused, even with good values", () => {
    const r = new Checker().check(phone(2), control(1, { player: 3 }));
    expect(!r.ok && "reason" in r && r.reason).toBe("not_your_player");
  });

  it("a refused control does not move the order number", () => {
    const c = new Checker();
    const s = phone();
    c.check(s, control(50, { steer: 9 }));
    expect(s.lastSeq).toBe(-1);
    expect(c.check(s, control(1)).ok).toBe(true);
  });

  it("does not let __proto__ or other keys through", () => {
    const raw = JSON.parse('{"t":"control","seq":1,"throttle":1,"brake":0,"steer":0,"__proto__":{"admin":true},"score":5}');
    const r = new Checker().check(phone(), raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.msg.fields).sort()).toEqual(["brake", "player", "seq", "steer", "throttle"]);
      expect((r.msg.fields as { admin?: unknown }).admin).toBeUndefined();
    }
  });
});

describe("order numbers", () => {
  it("drops old and repeated controls without an answer", () => {
    const c = new Checker();
    const s = phone();
    expect(c.check(s, control(5)).ok).toBe(true);
    expect(c.check(s, control(5))).toEqual({ ok: false, stale: true, ref: "control" });
    expect(c.check(s, control(3))).toEqual({ ok: false, stale: true, ref: "control" });
    expect(c.check(s, control(6)).ok).toBe(true);
    expect(c.stats).toMatchObject({ passed: 2, stale: 2, refused: 0 });
  });

  it("a new link (reload) starts again at the first seq it sends", () => {
    const c = new Checker();
    const before = phone();
    c.check(before, control(900));
    const after = phone(); // same player, new session after the reload
    expect(c.check(after, control(1)).ok).toBe(true);
  });
});

describe("admin commands", () => {
  it("an unknown command or bad args get a reply with the id", () => {
    const c = new Checker();
    expect(c.check(admin(), { t: "cmd", id: 4, name: "give_points" })).toEqual({ ok: false, reason: "unknown_command", ref: "cmd", replyId: 4 });
    expect(c.check(admin(), { t: "cmd", id: 5, name: "quake", args: { mag: 11, zone: 0 } })).toEqual({ ok: false, reason: "out_of_range", ref: "cmd", replyId: 5 });
    expect(c.check(admin(), { t: "cmd", id: 6, name: "obstacle_add", args: { type: "lava", segment: 1, lane: 0, pos: 0 } })).toMatchObject({ reason: "out_of_range", replyId: 6 });
    expect(c.check(admin(), { t: "cmd", id: 7, name: "road_close", args: { segment: 60 } })).toMatchObject({ reason: "out_of_range", replyId: 7 });
    expect(c.check(admin(), { t: "cmd", id: 8, name: "param_set", args: { name: "x" } })).toMatchObject({ reason: "bad_field", replyId: 8 });
  });

  it("a cmd without a usable id gets an error, not a reply", () => {
    const r = new Checker().check(admin(), { t: "cmd", id: -1, name: "start" });
    expect(r).toEqual({ ok: false, reason: "out_of_range", ref: "cmd", replyId: undefined });
    const r2 = new Checker().check(admin(), { t: "cmd", name: "start" });
    expect(!r2.ok && "replyId" in r2 && r2.replyId).toBeUndefined();
  });

  it("phone messages on the admin link are refused", () => {
    const r = new Checker().check(admin(), control(1));
    expect(!r.ok && "reason" in r && r.reason).toBe("unknown_type");
  });
});

describe("droppable mark", () => {
  it("only state and control may be lost", () => {
    expect(isDroppable("state")).toBe(true);
    expect(isDroppable("control")).toBe(true);
    for (const t of ["hello", "join", "joined", "welcome", "find_me", "ping", "pong", "cmd", "reply", "snapshot", "params", "error"]) {
      expect(isDroppable(t), t).toBe(false);
    }
  });
});
