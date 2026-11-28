// M2-4 → M2-3: board data for the admin page (BoardFeed).

import { afterEach, describe, expect, it } from "vitest";
import { BoardLink, type BoardMetrics, type QuakeEvent } from "../src/board/boardLink.js";
import { BOARD_SAMPLE, BoardFeed, type BoardSink } from "../src/board/boardFeed.js";
import { AdminFeed } from "../src/broadcast/adminFeed.js";
import type { BroadcastHub } from "../src/broadcast/broadcastHub.js";
import { BoardEmu } from "./fakes/boardEmu.js";

type BoardCall = Parameters<BoardSink["board"]>[0];

function recorder(): { sink: BoardSink; calls: BoardCall[] } {
  const calls: BoardCall[] = [];
  return { sink: { board: (d) => calls.push(d) }, calls };
}

const quake = (src: QuakeEvent["src"]): QuakeEvent => ({ id: 1, src, mag: 6.5, zone: 4, conf: 0.8, u: 0.5, v: 0.5, peak_g: 1.2 });
const metrics = (m: Partial<BoardMetrics>): BoardMetrics => ({
  connected: true, delayMs: 12, lossPct: 3, statesSent: 0, badMessages: 0, resends: 0, ...m,
});

describe("M2-4 BoardFeed", () => {
  it("sensor samples get their own times, 1000 / hz apart, the last one now", () => {
    const { sink, calls } = recorder();
    new BoardFeed(sink, { now: () => 10_000 }).sensor({ hz: 50, a: [0.1, -0.2, 0.3] });
    expect(calls).toEqual([{
      samples: [
        { name: "board.accel_g", time: 9_960, value: 0.1 },
        { name: "board.accel_g", time: 9_980, value: -0.2 },
        { name: "board.accel_g", time: 10_000, value: 0.3 },
      ],
    }]);
  });

  it("a broken sensor message gives nothing, a broken value is left out", () => {
    const { sink, calls } = recorder();
    const feed = new BoardFeed(sink, { now: () => 1_000 });
    feed.sensor({ hz: 0, a: [1] });
    feed.sensor({ hz: 50, a: [] });
    expect(calls).toEqual([]);
    feed.sensor({ hz: 100, a: [Number.NaN, 0.5] });
    expect(calls).toEqual([{ samples: [{ name: BOARD_SAMPLE.accel, time: 1_000, value: 0.5 }] }]);
  });

  it("a board earthquake goes on with its source: a hand hit is hand, the motors are motors", () => {
    const { sink, calls } = recorder();
    const feed = new BoardFeed(sink);
    feed.quake(quake("hit"));
    feed.quake(quake("motor"));
    expect(calls).toEqual([
      { quake: { mag: 6.5, zone: 4, source: "hand" } },
      { quake: { mag: 6.5, zone: 4, source: "motors" } },
    ]);
  });

  it("the link measurements become board.delay_ms and board.loss_pct; no delay while the board is away", () => {
    const { sink, calls } = recorder();
    const feed = new BoardFeed(sink, { now: () => 5_000 });
    feed.metrics(metrics({}));
    feed.metrics(metrics({ connected: false, delayMs: null, lossPct: 0 }));
    expect(calls).toEqual([
      { connected: true, samples: [
        { name: "board.delay_ms", time: 5_000, value: 12 },
        { name: "board.loss_pct", time: 5_000, value: 3 },
      ] },
      { connected: false, samples: [{ name: "board.loss_pct", time: 5_000, value: 0 }] },
    ]);
  });

  it("the events also go to the next handler (M1), and one that throws does not stop the other", () => {
    const { sink, calls } = recorder();
    const seen: string[] = [];
    const events = new BoardFeed(sink).events({
      quake: (e) => seen.push(`quake ${e.src}`),
      link: (up) => seen.push(`link ${up}`),
      status: () => seen.push("status"),
    });
    events.link?.(true);
    events.quake?.(quake("hit"));
    events.status?.({});
    expect(seen).toEqual(["link true", "quake hit", "status"]);
    expect(calls).toEqual([{ connected: true }, { quake: { mag: 6.5, zone: 4, source: "hand" } }]);

    // The admin side fails: M1 still gets the earthquake.
    const toM1: string[] = [];
    const broken = new BoardFeed({ board: () => { throw new Error("admin away"); } }).events({ quake: (e) => toM1.push(e.src) });
    expect(() => broken.quake?.(quake("motor"))).toThrow("admin away");
    expect(toM1).toEqual(["motor"]);
    // M1 fails: the admin still gets it.
    const r = recorder();
    const m1Broken = new BoardFeed(r.sink).events({ quake: () => { throw new Error("m1"); } });
    expect(() => m1Broken.quake?.(quake("hit"))).toThrow("m1");
    expect(r.calls).toEqual([{ quake: { mag: 6.5, zone: 4, source: "hand" } }]);
  });

  it("M2-3's hub takes the board data as it is", () => {
    // Compile time check: the hub of M2-3 is a BoardSink.
    const asSink = (hub: BroadcastHub): BoardSink => hub;
    expect(asSink).toBeTypeOf("function");
  });

  it("through M2-3 the admin page gets the source, the samples and the snapshot", () => {
    const sent: any[] = [];
    const admin = new AdminFeed((m) => sent.push(m), { now: () => 2_000 });
    const feed = new BoardFeed({ board: (d) => admin.addBoard(d) }, { now: () => 2_000 });
    feed.link(true);
    feed.sensor({ hz: 50, a: [0.4] });
    feed.quake(quake("motor"));
    expect(sent.at(-1)).toEqual({ t: "board", board: { connected: true, quake: { mag: 6.5, zone: 4, source: "motors" }, samples: [] } });
    const snap = admin.snapshot() as any;
    expect(snap.board.samples).toEqual([{ name: "board.accel_g", time: 2_000, value: 0.4 }]);
    expect(snap.board.quake.source).toBe("motors");
  });
});

describe("M2-4 BoardFeed with the board link and the board emulator", () => {
  const open: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    for (const x of open.splice(0)) await x.close();
  });

  it("the admin gets the link, the delay, the sensor samples and a hand hit with its source", async () => {
    const { sink, calls } = recorder();
    const feed = new BoardFeed(sink, { metricsEveryMs: 100 });
    const m1: QuakeEvent[] = [];
    const link = new BoardLink({ port: 0, host: "127.0.0.1", events: feed.events({ quake: (e) => m1.push(e) }) });
    const port = await link.start();
    open.push(link, { close: async () => feed.stop() });
    link.setConfig({ plan: "0.3.0", bright: 0.5, max_ma: 8000, tones: Array.from({ length: 8 }, () => [0, 0, 255]) });
    link.setState({ ph: 2, tl: 200, p: [], dp: [], ob: [], eq: [] });
    feed.start(link);
    const emu = new BoardEmu({ host: "127.0.0.1", port });
    open.push(emu);
    await emu.start();

    const samples = () => calls.flatMap((c) => c.samples ?? []);
    const until = async (cond: () => boolean) => {
      for (const end = Date.now() + 5000; !cond(); ) {
        if (Date.now() > end) throw new Error("timeout");
        await new Promise((ok) => setTimeout(ok, 20));
      }
    };
    await until(() => samples().some((s) => s.name === "board.delay_ms") && samples().some((s) => s.name === "board.accel_g"));
    emu.hit(6.5, 4);
    await until(() => calls.some((c) => c.quake) && m1.length > 0);

    expect(calls.some((c) => c.connected === true)).toBe(true);
    expect(calls.find((c) => c.quake)?.quake).toEqual({ mag: 6.5, zone: 4, source: "hand" });
    expect(m1[0]?.src).toBe("hit");
    const accel = samples().filter((s) => s.name === "board.accel_g");
    expect(accel.every((s, i) => i === 0 || s.time >= accel[i - 1]!.time)).toBe(true);
  }, 15_000);
});
