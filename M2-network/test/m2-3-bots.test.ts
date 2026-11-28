import { afterEach, describe, expect, it } from "vitest";
import { joinBots, type BotPhone } from "./fakes/botPhone.js";
import { startStack, type Stack } from "./fakes/stack.js";
import { TestLink, waitFor } from "./helpers.js";

// LONG_RUN_MS=600000 npx vitest run test/m2-3-bots.test.ts   a long run of 10 minutes
const RUN_MS = Number(process.env.LONG_RUN_MS ?? 4000);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describe("M2-3 with a fake M1 and bot phones", () => {
  let stack: Stack | undefined;
  let bots: BotPhone[] = [];
  afterEach(async () => {
    bots.forEach((b) => b.close());
    bots = [];
    await stack?.close();
    stack = undefined;
  });

  it("every one of 8 phones gets the state of every tick", { timeout: RUN_MS + 20_000 }, async () => {
    stack = await startStack();
    const { m1, hub, server } = stack;
    bots = await joinBots(server.port, server.gameCode.value, 8);
    await waitFor(() => (m1.inputs.filter((i) => i.type === "join").length === 8 ? true : undefined));
    const firstTick = m1.tick + 1;
    m1.run(hub);
    await sleep(RUN_MS);
    m1.stop();
    const lastTick = m1.tick;
    await waitFor(() => (bots.every((b) => b.lastSeq === lastTick) ? true : undefined));

    for (const b of bots) {
      expect(b.firstSeq).toBe(firstTick);
      expect(b.missed).toBe(0);
      expect(b.repeated).toBe(0);
      expect(b.states).toBe(lastTick - firstTick + 1);
    }
    // M1 got the controls of every phone.
    const fromPlayers = new Set(m1.inputs.flatMap((i) => (i.type === "message" && i.role === "player" ? [i.playerNo] : [])));
    expect(fromPlayers.size).toBe(8);

    const s = hub.stats();
    const seconds = (lastTick - firstTick + 1) / 30;
    console.log(
      `M2-3 run: ${lastTick - firstTick + 1} ticks in ${seconds.toFixed(1)} s game time, 8 phones, ` +
        `state ${s.stateBytes} B, ${Math.round(s.bytesOut / seconds / 1024)} KiB/s to all phones, encode ${s.encodeMs.toFixed(3)} ms`,
    );
    expect(s.phoneSends).toBe(8 * (lastTick - firstTick + 1));
  });

  it("the measured ping matches a known delay, and M1 gets the measurements", { timeout: 20_000 }, async () => {
    stack = await startStack({ pingMs: 200 });
    const { m1, hub, server } = stack;
    const DELAY = 80;
    bots = await joinBots(server.port, server.gameCode.value, 2, { pingDelayMs: DELAY, fps: 42, controlHz: 0 });
    m1.run(hub);
    await waitFor(() => (m1.measures.filter((m) => m.length === 2).length >= 5 ? true : undefined), 5000);
    const last = m1.measures.at(-1)!;
    for (const m of last) {
      expect(m.rttMs).toBeGreaterThanOrEqual(DELAY);
      expect(m.rttMs).toBeLessThan(DELAY + 40);
      expect(m.fps).toBe(42);
      // The bot answers at the end of its delay, so the offset is about half of it.
      expect(Math.abs(m.offsetMs)).toBeLessThan(DELAY / 2 + 20);
      expect(m.lagTicks).toBeLessThan(10);
    }
  });

  it("the admin gets the state 10 times per second, and the full snapshot after a reconnect", { timeout: 20_000 }, async () => {
    stack = await startStack();
    const { m1, hub, server } = stack;
    m1.run(hub);
    const admin = await TestLink.open(server.port, "/ws/admin");
    await sleep(1000);
    const states = admin.messages.filter((m) => m.t === "state").length;
    expect(states).toBeGreaterThanOrEqual(7);
    expect(states).toBeLessThanOrEqual(12);
    await waitFor(() => admin.messages.find((m) => m.t === "metrics"));
    hub.board({ connected: true, samples: [{ name: "board.accel_g", time: Date.now(), value: 1.02 }] });
    admin.close();

    const again = await TestLink.open(server.port, "/ws/admin");
    again.send({ t: "snapshot_get" });
    const snap = await again.next("snapshot");
    expect(snap.params.map((p: { name: string }) => p.name)).toEqual(["board.state_hz", "net.0.up.delay_ms"]);
    expect(snap.state.tick).toBeGreaterThan(0);
    expect(snap.metrics.length).toBeGreaterThan(0);
    expect(snap.board).toMatchObject({ connected: true });
    expect(snap.board.samples).toHaveLength(1);
    again.close();
  });

  it("broken messages on purpose do not stop the server; \"Find me\" reaches M1", { timeout: 20_000 }, async () => {
    stack = await startStack();
    const { m1, hub, server } = stack;
    bots = await joinBots(server.port, server.gameCode.value, 3, { controlHz: 0 });
    const [bad, good, huge] = bots as [BotPhone, BotPhone, BotPhone];
    m1.run(hub);
    for (const kind of ["not_msgpack", "no_type", "unknown_type", "bad_control"] as const) bad.sendBroken(kind);
    await waitFor(() => (bad.errors.includes("bad_message") ? true : undefined));
    huge.sendBroken("huge");
    await waitFor(() => huge.closeCode ?? undefined);
    expect(huge.closeCode).toBe(1009); // the 64 KiB limit of M2-1 closes only this link

    good.findMe();
    await waitFor(() => m1.inputs.find((i) => i.type === "message" && (i.msg as { t?: string }).t === "find_me"));
    const before = good.states;
    await sleep(500);
    expect(good.states).toBeGreaterThan(before + 10); // the others still get every state
    expect(bad.closeCode).toBeNull(); // a decodable but wrong message does not close the link
    expect(bad.states).toBeGreaterThan(0);
    // Until M2-2's checker is in, M1 sees the decodable wrong messages: the fake M1 lists them.
    const fromBad = m1.inputs.filter((i) => i.type === "message" && i.playerNo === bad.player);
    expect(fromBad.length).toBe(3);
  });
});
