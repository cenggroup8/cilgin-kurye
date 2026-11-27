// M2-2 (#35) in the running server, with bot phones and an admin link.
// Done criteria: broken, out of range, other player's and too big messages never reach M1;
// two controls and a "Find me" of one tick come out of the queue complete.
import { encode } from "@msgpack/msgpack";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BROKEN_KINDS, BotPhone } from "./fakes/botPhone.js";
import { TestLink, waitFor } from "./helpers.js";
import { allTaken, startCheckedStack, type CheckedStack } from "./m2-2-stack.js";

let stack: CheckedStack | undefined;
afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

async function phoneLink(s: CheckedStack, key: string): Promise<TestLink> {
  const link = await TestLink.open(s.server.port);
  const w = await link.hello(key, s.server.gameCode.value);
  expect(w.t).toBe("welcome");
  return link;
}

const control = (seq: number, extra: Record<string, unknown> = {}) => ({ t: "control", seq, throttle: 1, brake: 0, steer: 0, ...extra });

describe("M2-2 in the server", () => {
  it("no broken message of a bot phone reaches M1, and the sender gets an error", async () => {
    stack = await startCheckedStack();
    const bot = await BotPhone.join(stack.server.port, "bad-bot", stack.server.gameCode.value, { controlHz: 0 });
    const good = await BotPhone.join(stack.server.port, "good-bot", stack.server.gameCode.value, { controlHz: 0 });
    await waitFor(() => (stack!.queue.size >= 2 ? true : undefined));
    stack.tick(); // the two joins
    for (const kind of BROKEN_KINDS) if (kind !== "huge") bot.sendBroken(kind);
    await waitFor(() => (bot.errors.length >= 4 ? true : undefined));
    expect(bot.errors).toEqual(["bad_message", "bad_message", "unknown_type", "out_of_range"]);
    stack.tick();
    const all = allTaken(stack.taken);
    expect(all.controls).toEqual([]);
    expect(all.findMe).toEqual([]);
    expect(all.joins.map((j) => j.playerKey).sort()).toEqual(["bad-bot", "good-bot"]);
    expect(good.errors).toEqual([]);
    bot.close();
    good.close();
  });

  it("a too big message is dropped before decoding and never reaches M1", async () => {
    stack = await startCheckedStack();
    const link = await phoneLink(stack, "big");
    // Bigger than the 1 KiB phone limit but smaller than the 64 KiB WebSocket limit.
    link.send({ ...control(1), pad: "x".repeat(4 * 1024) });
    expect((await link.next("error")).reason).toBe("too_big");
    stack.tick();
    expect(allTaken(stack.taken).controls).toEqual([]);
    expect(stack.inbound.limiter.stats.tooBig).toBe(1);
    // The link stays open and a good control still gets through.
    link.send(control(1));
    await waitFor(() => (stack!.queue.size > 0 ? true : undefined));
    expect(stack.tick().controls).toHaveLength(1);
    link.close();
  });

  it("a control for another player and out of range values never reach M1", async () => {
    stack = await startCheckedStack();
    const a = await phoneLink(stack, "a");
    const b = await phoneLink(stack, "b");
    const bNo = stack.server.registry.players().find((p) => p.playerKey === "b")!.playerNo;
    a.send(control(1, { player: bNo }));
    expect((await a.next("error")).reason).toBe("not_your_player");
    a.messages.length = 0;
    a.send(control(2, { steer: 1.5 }));
    expect(await a.next("error")).toEqual({ t: "error", reason: "out_of_range", ref: "control" });
    stack.tick();
    expect(allTaken(stack.taken).controls).toEqual([]);
    a.close();
    b.close();
  });

  it("two controls and a Find me in one tick come out of the queue complete", async () => {
    stack = await startCheckedStack();
    const link = await phoneLink(stack, "fm");
    const me = stack.server.registry.players()[0]!.playerNo;
    stack.tick();
    link.send(control(1, { steer: -1 }));
    link.send({ t: "find_me" });
    link.send(control(2, { throttle: 0, steer: 1 }));
    await waitFor(() => (stack!.queue.size >= 3 ? true : undefined));
    const input = stack.tick();
    expect(input.controls).toEqual([
      { player: me, seq: 1, throttle: 1, brake: 0, steer: -1 },
      { player: me, seq: 2, throttle: 0, brake: 0, steer: 1 },
    ]);
    expect(input.findMe).toEqual([{ player: me }]);
    link.close();
  });

  it("old and repeated controls are dropped without an answer", async () => {
    stack = await startCheckedStack();
    const link = await phoneLink(stack, "seq");
    for (const seq of [5, 5, 4, 6]) link.send(control(seq));
    await waitFor(() => (stack!.inbound.checker.stats.stale >= 2 && stack!.queue.size >= 2 ? true : undefined));
    expect(stack.tick().controls.map((c) => c.seq)).toEqual([5, 6]);
    expect(link.messages.filter((m) => m.t === "error")).toEqual([]);
    link.close();
  });

  it("a phone that floods is cut at its limit and told once; other phones go on", async () => {
    stack = await startCheckedStack();
    const flood = await phoneLink(stack, "flood");
    const calm = await phoneLink(stack, "calm");
    for (let seq = 1; seq <= 200; seq++) flood.send(control(seq));
    calm.send(control(1));
    await waitFor(() => (stack!.inbound.limiter.stats.tooMany > 0 && stack!.queue.size >= 2 ? true : undefined));
    await new Promise((ok) => setTimeout(ok, 100));
    const input = stack.tick();
    const floodNo = stack.server.registry.players().find((p) => p.playerKey === "flood")!.playerNo;
    const fromFlood = input.controls.filter((c) => c.player === floodNo).length;
    // The hello counts too, so at most 59 controls in the first second.
    expect(fromFlood).toBeLessThanOrEqual(59);
    expect(fromFlood).toBeGreaterThan(0);
    expect(input.controls.filter((c) => c.player !== floodNo)).toHaveLength(1);
    expect(flood.messages.filter((m) => m.t === "error" && m.reason === "too_many")).toHaveLength(1);
    flood.close();
    calm.close();
  });

  it("admin commands go to M1; a bad one gets a reply with its id and does not", async () => {
    stack = await startCheckedStack();
    const admin = await TestLink.open(stack.server.port, "/ws/admin");
    admin.send({ t: "cmd", id: 1, name: "obstacle_add", args: { type: "road_work", segment: 12, lane: 1, pos: 0.25 } });
    admin.send({ t: "cmd", id: 2, name: "quake", args: { mag: 99, zone: 4 } });
    admin.send({ t: "cmd", id: 3, name: "make_me_win" });
    admin.send({ t: "params_get" });
    expect(await admin.next("params")).toMatchObject({ t: "params" });
    await waitFor(() => (admin.messages.filter((m) => m.t === "reply").length >= 2 ? true : undefined));
    expect(admin.messages.filter((m) => m.t === "reply")).toEqual([
      { t: "reply", id: 2, ok: false, error: "out_of_range" },
      { t: "reply", id: 3, ok: false, error: "unknown_command" },
    ]);
    expect(stack.tick().adminCommands).toEqual([{ id: 1, name: "obstacle_add", args: { type: "road_work", segment: 12, lane: 1, pos: 0.25 } }]);
    admin.close();
  });

  it("M2-3 still gets its messages: pong from phones and snapshot_get from the admin", async () => {
    stack = await startCheckedStack({ pingMs: 50 });
    const bot = await BotPhone.join(stack.server.port, "ping-bot", stack.server.gameCode.value, { controlHz: 0 });
    await waitFor(() => (stack!.hub.measures().length > 0 ? true : undefined));
    const admin = await TestLink.open(stack.server.port, "/ws/admin");
    admin.send({ t: "snapshot_get" });
    expect((await admin.next("snapshot")).t).toBe("snapshot");
    bot.close();
    admin.close();
  });

  it("join, lost and returning players go to M1 through the queue", async () => {
    stack = await startCheckedStack();
    const first = await phoneLink(stack, "again");
    first.send({ t: "join", team: 1 });
    first.send({ t: "join", team: 9 });
    expect((await first.next("error")).reason).toBe("bad_join");
    first.close();
    await waitFor(() => (stack!.queue.size >= 2 ? true : undefined));
    const second = await phoneLink(stack, "again");
    await waitFor(() => (stack!.queue.size >= 3 ? true : undefined));
    const input = stack.tick();
    expect(input.joins).toEqual([{ playerKey: "again", name: "bot", team: 1, playerNo: 0 }]);
    expect(input.disconnects).toEqual([{ playerKey: "again", playerNo: 0 }]);
    expect(input.reconnects).toEqual([{ playerKey: "again", playerNo: 0 }]);
    second.close();
  });

  it("readable form: a link may speak JSON text and gets JSON text back", async () => {
    stack = await startCheckedStack({ readable: true });
    const ws = new WebSocket(`ws://127.0.0.1:${stack.server.port}/ws`);
    const got: unknown[] = [];
    ws.on("message", (d, isBinary) => {
      if (!isBinary) got.push(JSON.parse(d.toString()));
    });
    await new Promise<void>((ok) => ws.once("open", () => ok()));
    ws.send(JSON.stringify({ t: "hello", key: "json", name: "j", code: stack.server.gameCode.value }));
    await waitFor(() => (got.length > 0 ? true : undefined));
    expect(got[0]).toMatchObject({ t: "welcome" });
    ws.send(JSON.stringify(control(1)));
    ws.send(JSON.stringify(control(2, { steer: 3 })));
    await waitFor(() => (got.length > 1 ? true : undefined));
    expect(got[1]).toEqual({ t: "error", reason: "out_of_range", ref: "control" });
    expect(stack.tick().controls).toHaveLength(1);
    ws.close();
  });

  it("JSON text is refused when the readable form is off", async () => {
    stack = await startCheckedStack({ readable: false });
    const link = await phoneLink(stack, "nojson");
    // TestLink sends binary; send a text frame by hand.
    (link as unknown as { ws: WebSocket }).ws.send(JSON.stringify(control(1)));
    expect((await link.next("error")).reason).toBe("bad_message");
    link.sendRaw(Buffer.from(encode(control(1))));
    await waitFor(() => (stack!.queue.size > 0 ? true : undefined));
    link.close();
  });
});
