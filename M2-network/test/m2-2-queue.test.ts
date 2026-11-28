// M2-2 (#35): input queue, limits and codec.
import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { Checker } from "../src/codec/checker.js";
import { Codec } from "../src/codec/codec.js";
import { LIMITS, Limiter } from "../src/codec/limits.js";
import { InputQueue } from "../src/queue/inputQueue.js";
import type { Session } from "../src/session/types.js";

function phone(playerNo: number): Session {
  return { connId: 10 + playerNo, role: "player", playerKey: `key-${playerNo}`, playerNo, name: "p", lastSeq: -1, msgsIn: 0, bytesIn: 0, openedAt: 0 };
}

describe("input queue", () => {
  it("two controls and a Find me of one tick all come out, in order", () => {
    const checker = new Checker();
    const q = new InputQueue();
    const s = phone(3);
    for (const m of [
      { t: "control", seq: 1, throttle: 1, brake: 0, steer: 0 },
      { t: "find_me" },
      { t: "control", seq: 2, throttle: 0, brake: 1, steer: -1 },
    ]) {
      const r = checker.check(s, m);
      expect(r.ok && q.push(r.msg)).toBe(true);
    }
    const input = q.take();
    expect(input.controls).toEqual([
      { player: 3, seq: 1, throttle: 1, brake: 0, steer: 0 },
      { player: 3, seq: 2, throttle: 0, brake: 1, steer: -1 },
    ]);
    // The newer control has no press, but the press of the tick is still there.
    expect(input.findMe).toEqual([{ player: 3 }]);
  });

  it("take() gives every input once and leaves the queue empty", () => {
    const q = new InputQueue();
    q.join({ playerKey: "k", playerNo: 0, name: "Ayşe", team: 2 });
    expect(q.size).toBe(1);
    expect(q.take().joins).toEqual([{ playerKey: "k", playerNo: 0, name: "Ayşe", team: 2 }]);
    expect(q.size).toBe(0);
    expect(q.take()).toEqual({ controls: [], findMe: [], joins: [], disconnects: [], reconnects: [], adminCommands: [], boardEvents: [] });
  });

  it("carries joins, lost and returning players, admin commands and board events to M1", () => {
    const checker = new Checker();
    const q = new InputQueue();
    q.lost({ playerKey: "k1", playerNo: 1 });
    q.returned({ playerKey: "k1", playerNo: 1 });
    q.boardEvent({ source: "hand", magnitude: 6.5, zone: 4, confidence: 0.9 });
    const admin: Session = { connId: 1, role: "admin", lastSeq: -1, msgsIn: 0, bytesIn: 0, openedAt: 0 };
    const r = checker.check(admin, { t: "cmd", id: 3, name: "quake", args: { mag: 5, zone: 2 } });
    expect(r.ok && q.push(r.msg)).toBe(true);
    const r2 = checker.check(admin, { t: "cmd", id: 4, name: "pause" });
    expect(r2.ok && q.push(r2.msg)).toBe(true);
    const input = q.take();
    expect(input.disconnects).toEqual([{ playerKey: "k1", playerNo: 1 }]);
    expect(input.reconnects).toEqual([{ playerKey: "k1", playerNo: 1 }]);
    expect(input.boardEvents).toEqual([{ source: "hand", magnitude: 6.5, zone: 4, confidence: 0.9 }]);
    expect(input.adminCommands).toEqual([{ id: 3, name: "quake", args: { mag: 5, zone: 2 } }, { id: 4, name: "pause" }]);
  });

  it("pong and requests are not tick inputs", () => {
    const checker = new Checker();
    const q = new InputQueue();
    const r = checker.check(phone(0), { t: "pong", id: 1, ct: 0, fps: 60, last: 3 });
    expect(r.ok && q.push(r.msg)).toBe(false);
    expect(q.size).toBe(0);
  });

  it("if M1 stops taking, only the oldest controls are cut, never a Find me", () => {
    const checker = new Checker();
    const q = new InputQueue();
    const s = phone(1);
    const fm = checker.check(s, { t: "find_me" });
    if (fm.ok) q.push(fm.msg);
    for (let seq = 1; seq <= 3000; seq++) {
      const r = checker.check(s, { t: "control", seq, throttle: 1, brake: 0, steer: 0 });
      if (r.ok) q.push(r.msg);
    }
    const input = q.take();
    expect(input.findMe).toHaveLength(1);
    expect(input.controls).toHaveLength(2048);
    expect(input.controls.at(-1)!.seq).toBe(3000);
    expect(q.totals.controlsCut).toBe(3000 - 2048);
  });
});

describe("limits", () => {
  it("refuses a message bigger than the limit of its link", () => {
    const l = new Limiter(() => 0);
    expect(l.admit(1, "player", LIMITS.player.maxBytes).ok).toBe(true);
    expect(l.admit(1, "player", LIMITS.player.maxBytes + 1)).toEqual({ ok: false, reason: "too_big", tell: true });
    expect(l.admit(2, "admin", 8 * 1024).ok).toBe(true);
  });

  it("counts messages per second, answers once per second, and lets the link in again", () => {
    let t = 0;
    const l = new Limiter(() => t);
    for (let i = 0; i < LIMITS.player.perSecond; i++) expect(l.admit(1, "player", 20).ok).toBe(true);
    expect(l.admit(1, "player", 20)).toEqual({ ok: false, reason: "too_many", tell: true });
    expect(l.admit(1, "player", 20)).toEqual({ ok: false, reason: "too_many", tell: false });
    // Another link is not touched.
    expect(l.admit(2, "player", 20).ok).toBe(true);
    t = 1000;
    expect(l.admit(1, "player", 20).ok).toBe(true);
    expect(l.stats).toEqual({ tooBig: 0, tooMany: 2 });
  });

  it("counts bytes per second", () => {
    const l = new Limiter(() => 0);
    for (let i = 0; i < 16; i++) expect(l.admit(1, "player", 1024).ok).toBe(true);
    expect(l.admit(1, "player", 1).ok).toBe(false);
  });
});

describe("codec", () => {
  it("decodes MessagePack and never throws on broken bytes", () => {
    const c = new Codec();
    expect(c.decode(encode({ t: "find_me" }))).toEqual({ ok: true, msg: { t: "find_me" }, format: "msgpack" });
    expect(c.decode(Uint8Array.from([0xc1, 0xff, 0x00]))).toEqual({ ok: false });
    expect(c.decode(new Uint8Array(0))).toEqual({ ok: false });
  });

  it("takes JSON text only in readable form", () => {
    const text = new TextEncoder().encode('{"t":"control","seq":1,"throttle":1,"brake":0,"steer":0}');
    expect(new Codec().decode(text, true)).toEqual({ ok: false });
    const r = new Codec({ readable: true }).decode(text, true);
    expect(r).toEqual({ ok: true, msg: { t: "control", seq: 1, throttle: 1, brake: 0, steer: 0 }, format: "json" });
    expect(new Codec({ readable: true }).decode(new TextEncoder().encode("{not json"), true)).toEqual({ ok: false });
    expect(new Codec().encode({ t: "x" }, "json")).toBe('{"t":"x"}');
  });

  it("refuses very deep nesting", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(new Codec().decode(encode(deep))).toEqual({ ok: false });
  });
});
