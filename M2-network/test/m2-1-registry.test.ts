import { describe, expect, it } from "vitest";
import { GameCode } from "../src/http/gameCode.js";
import { SessionRegistry } from "../src/session/registry.js";
import { RecordingM1 } from "./helpers.js";

function setup() {
  const code = new GameCode("123456");
  const m1 = new RecordingM1();
  return { code, m1, reg: new SessionRegistry(code, m1) };
}

describe("game code", () => {
  it("is six digits and a new code is different", () => {
    const c = new GameCode();
    expect(c.value).toMatch(/^\d{6}$/);
    const old = c.value;
    expect(c.renew()).not.toBe(old);
    expect(c.value).toMatch(/^\d{6}$/);
  });
});

describe("sessions and access", () => {
  it("gives player numbers 0 to 7 and rejects the 9th player", () => {
    const { reg } = setup();
    for (let i = 0; i < 8; i++) {
      reg.open(i, "player");
      expect(reg.hello(i, { playerKey: `k${i}`, code: "123456" })).toMatchObject({ ok: true, playerNo: i });
    }
    reg.open(8, "player");
    expect(reg.hello(8, { playerKey: "k8", code: "123456" })).toEqual({ ok: false, reason: "full" });
  });

  it("rejects a wrong game code", () => {
    const { reg } = setup();
    reg.open(1, "player");
    expect(reg.hello(1, { playerKey: "a", code: "000000" })).toEqual({ ok: false, reason: "bad_code" });
  });

  it("keeps the same number after a reload and tells M1 lost and returned", () => {
    const { reg, m1 } = setup();
    reg.open(1, "player");
    reg.hello(1, { playerKey: "a", code: "123456" });
    reg.open(2, "player");
    reg.hello(2, { playerKey: "b", code: "123456" });
    reg.close(1);
    reg.open(3, "player");
    expect(reg.hello(3, { playerKey: "a", code: "123456" })).toMatchObject({ ok: true, playerNo: 0, returning: true });
    expect(m1.events).toEqual([
      { type: "lost", playerKey: "a", playerNo: 0 },
      { type: "returned", playerKey: "a", playerNo: 0 },
    ]);
  });

  it("lets a known player back after a new game code", () => {
    const { reg, code } = setup();
    reg.open(1, "player");
    reg.hello(1, { playerKey: "a", code: "123456" });
    reg.close(1);
    code.renew();
    reg.open(2, "player");
    expect(reg.hello(2, { playerKey: "a", code: "123456" })).toMatchObject({ ok: true, playerNo: 0 });
    reg.open(3, "player");
    expect(reg.hello(3, { playerKey: "new", code: "123456" })).toEqual({ ok: false, reason: "bad_code" });
  });

  it("a second page with the same key takes over without a lost event", () => {
    const { reg, m1 } = setup();
    reg.open(1, "player");
    reg.hello(1, { playerKey: "a", code: "123456" });
    reg.open(2, "player");
    expect(reg.hello(2, { playerKey: "a", code: "123456" })).toMatchObject({ ok: true, replacedConnId: 1, returning: false });
    reg.close(1);
    expect(m1.events).toEqual([]);
  });

  it("a new admin login replaces the old one", () => {
    const { reg } = setup();
    expect(reg.open(10, "admin")).toEqual({});
    expect(reg.open(11, "admin")).toEqual({ replacedAdmin: 10 });
    expect(reg.adminConn).toBe(11);
    reg.close(10);
    expect(reg.adminConn).toBe(11);
  });

  it("passes the team to M1 only after a hello", () => {
    const { reg, m1 } = setup();
    reg.open(1, "player");
    expect(reg.join(1, 2)).toBe(false);
    reg.hello(1, { playerKey: "a", name: "Ayşe", code: "123456" });
    expect(reg.join(1, "x")).toBe(false);
    expect(reg.join(1, 2)).toBe(true);
    expect(m1.events).toEqual([{ type: "join", playerKey: "a", playerNo: 0, name: "Ayşe", team: 2 }]);
  });

  it("a released place can be used by a new player", () => {
    const { reg } = setup();
    for (let i = 0; i < 8; i++) { reg.open(i, "player"); reg.hello(i, { playerKey: `k${i}`, code: "123456" }); }
    reg.release("k3");
    reg.open(9, "player");
    expect(reg.hello(9, { playerKey: "new", code: "123456" })).toMatchObject({ ok: true, playerNo: 3 });
  });
});
