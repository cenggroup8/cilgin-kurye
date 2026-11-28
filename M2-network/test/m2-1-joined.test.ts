// M2-1: the answer to a join. M1 decides whether the team is free; M2-1 tells the phone
// with `joined` or `bad_join` (contracts/messages.md) and keeps the accepted team.
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameCode } from "../src/http/gameCode.js";
import { SessionRegistry } from "../src/session/registry.js";
import { startM2Server, type M2Server } from "../src/server.js";
import { RecordingM1, TestLink, waitFor } from "./helpers.js";

describe("registry keeps the accepted team", () => {
  it("gives the open link, keeps the team, and gives it back on the next hello", () => {
    const reg = new SessionRegistry(new GameCode("123456"), new RecordingM1());
    reg.open(1, "player");
    reg.hello(1, { playerKey: "k", code: "123456" });
    expect(reg.answerJoin({ playerKey: "k", ok: true, team: 2 })).toEqual({ connId: 1, playerNo: 0 });
    reg.close(1);
    // Link down: nothing to send now, but the team is kept.
    expect(reg.answerJoin({ playerKey: "k", ok: false })).toBeUndefined();
    reg.open(2, "player");
    expect(reg.hello(2, { playerKey: "k" })).toMatchObject({ ok: true, playerNo: 0, returning: true, team: 2 });
  });

  it("an unknown or released key gives nothing", () => {
    const reg = new SessionRegistry(new GameCode("123456"), new RecordingM1());
    expect(reg.answerJoin({ playerKey: "nobody", ok: true, team: 0 })).toBeUndefined();
    reg.open(1, "player");
    reg.hello(1, { playerKey: "k", code: "123456" });
    reg.answerJoin({ playerKey: "k", ok: true, team: 1 });
    reg.release("k");
    reg.open(2, "player");
    const r = reg.hello(2, { playerKey: "k", code: "123456" });
    expect(r).toMatchObject({ ok: true, returning: false });
    expect(r.ok && r.team).toBeUndefined();
  });
});

let server: M2Server;
let m1: RecordingM1;
let links: TestLink[] = [];

async function phone(): Promise<TestLink> {
  const l = await TestLink.open(server.port);
  links.push(l);
  return l;
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-1-joined-"));
  mkdirSync(join(dir, "models"));
  writeFileSync(join(dir, "city_plan.json"), "{}");
  m1 = new RecordingM1();
  server = await startM2Server({
    port: 0,
    publicHost: "127.0.0.1",
    events: m1,
    paths: { modelsDir: join(dir, "models"), cityPlanFile: join(dir, "city_plan.json") },
  });
});

afterEach(async () => {
  links.forEach((l) => l.close());
  links = [];
  await server.close();
});

describe("joined and bad_join on the phone", () => {
  it("M1 accepts the team: the phone gets joined with the team colour", async () => {
    const p = await phone();
    await p.hello("key-a", server.gameCode.value);
    p.send({ t: "join", team: 2 });
    await waitFor(() => m1.events.find((e) => e.type === "join"));
    // Nothing is sent before M1 answers.
    expect(p.messages.find((m) => m.t === "joined")).toBeUndefined();
    expect(server.answerJoin({ playerKey: "key-a", ok: true, team: 2 })).toBe(true);
    expect(await p.next("joined")).toEqual({ t: "joined", player: 0, team: 2, color: "purple" });
  });

  it("M1 refuses the team: the phone gets bad_join for its join", async () => {
    const p = await phone();
    await p.hello("key-a", server.gameCode.value);
    p.send({ t: "join", team: 0 });
    await waitFor(() => m1.events.find((e) => e.type === "join"));
    expect(server.answerJoin({ playerKey: "key-a", ok: false })).toBe(true);
    expect(await p.next("error")).toEqual({ t: "error", reason: "bad_join", ref: "join" });
  });

  it("after a reload the phone gets its team again right after the welcome", async () => {
    const code = server.gameCode.value;
    const p = await phone();
    await p.hello("key-a", code);
    server.answerJoin({ playerKey: "key-a", ok: true, team: 1 });
    await p.next("joined");
    p.close();
    await waitFor(() => m1.events.find((e) => e.type === "lost"));
    const again = await phone();
    expect(await again.hello("key-a", code)).toEqual({ t: "welcome", player: 0, returning: true });
    expect(await again.next("joined")).toEqual({ t: "joined", player: 0, team: 1, color: "green" });
    // Only after the welcome, and without a new join to M1.
    expect(again.messages.map((m) => m.t)).toEqual(["welcome", "joined"]);
    expect(m1.events.filter((e) => e.type === "join")).toEqual([]);
  });

  it("a team accepted while the link is down is given on the return", async () => {
    const code = server.gameCode.value;
    const p = await phone();
    await p.hello("key-a", code);
    p.close();
    await waitFor(() => m1.events.find((e) => e.type === "lost"));
    expect(server.answerJoin({ playerKey: "key-a", ok: true, team: 3 })).toBe(false);
    const again = await phone();
    await again.hello("key-a", code);
    expect(await again.next("joined")).toEqual({ t: "joined", player: 0, team: 3, color: "yellow" });
  });

  it("a player without a team gets no joined after the welcome", async () => {
    const code = server.gameCode.value;
    const p = await phone();
    await p.hello("key-a", code);
    p.close();
    await waitFor(() => m1.events.find((e) => e.type === "lost"));
    const again = await phone();
    await again.hello("key-a", code);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(again.messages.map((m) => m.t)).toEqual(["welcome"]);
  });

  it("a team outside 0–3 from M1 is not sent and not kept", async () => {
    const code = server.gameCode.value;
    const p = await phone();
    await p.hello("key-a", code);
    expect(server.answerJoin({ playerKey: "key-a", ok: true, team: 4 })).toBe(false);
    expect(server.answerJoin({ playerKey: "nobody", ok: true, team: 0 })).toBe(false);
    p.close();
    await waitFor(() => m1.events.find((e) => e.type === "lost"));
    const again = await phone();
    await again.hello("key-a", code);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(again.messages.map((m) => m.t)).toEqual(["welcome"]);
  });
});
