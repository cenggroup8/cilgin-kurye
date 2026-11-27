// Board link against the board emulator, on real sockets on this computer.

import { createSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import { BoardLink, type QuakeEvent } from "../src/board/boardLink.js";
import { NetemSettings } from "../src/netem/netem.js";
import { BoardEmu } from "./fakes/boardEmu.js";

const STATE = { ph: 2, tl: 200, p: [[2, 1, 0, 13, 0.4248, 0.1962, 88, 11.2]], dp: [], ob: [[12, 2, 0]], eq: [] };
const CONFIG = { plan: "0.2.0", bright: 0.6, max_ma: 4000, tones: [], anim: { tail: 2, dp_blink_hz: 1.5 } };

const round = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(7)) : v)));
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const x of open.splice(0)) await x.close();
});

async function setup(opts: { netem?: NetemSettings; port?: number; sid?: number; emu?: Partial<ConstructorParameters<typeof BoardEmu>[0]> } = {}) {
  const quakes: QuakeEvent[] = [];
  const sensors: number[] = [];
  const statuses: unknown[] = [];
  const links: boolean[] = [];
  const link = new BoardLink({
    port: opts.port ?? 0,
    host: "127.0.0.1",
    sid: opts.sid,
    netem: opts.netem,
    resendMs: 300,
    events: {
      quake: (e) => quakes.push(e),
      sensor: (e) => sensors.push(e.a.length),
      status: (e) => statuses.push(e),
      link: (up) => links.push(up),
    },
  });
  const port = await link.start();
  open.push(link);
  link.setConfig(CONFIG);
  link.setState(STATE);
  const emu = new BoardEmu({ host: "127.0.0.1", port, ...opts.emu });
  open.push(emu);
  await emu.start();
  return { link, emu, port, quakes, sensors, statuses, links };
}

describe("board link with the board emulator", () => {
  it("finds the board, sends the config and the state, and measures the delay", async () => {
    const { link, emu, sensors, statuses, links } = await setup();
    await until(() => emu.states.length >= 10 && link.metrics().delayMs !== null && statuses.length > 0);
    expect(links).toEqual([true]);
    expect(emu.configs).toHaveLength(1);
    expect(round(emu.configs[0]!.d)).toEqual(round(CONFIG)); // floats travel as float32
    expect(emu.states.every((s) => s.sid === link.sid)).toBe(true);
    expect(emu.states.at(-1)!.d.tl).toBe(200);
    expect(sensors.length).toBeGreaterThan(0);
    const m = link.metrics();
    expect(m.connected).toBe(true);
    expect(m.delayMs).toBeLessThan(50);
    expect(m.lossPct).toBe(0);
    expect(m.badMessages).toBe(0);
  });

  it("an earthquake event goes to M1 once and gets an answer", async () => {
    const { emu, quakes } = await setup();
    await until(() => emu.connected && emu.configs.length > 0);
    const seq = emu.hit(6.5, 4);
    await until(() => emu.quakesAnswered.has(seq) && quakes.length === 1);
    await wait(400);
    expect(quakes).toHaveLength(1);
    expect(quakes[0]).toMatchObject({ src: "hit", mag: 6.5, zone: 4 });
  });

  it("a vibrate command without an answer is sent again with the same seq and used once", async () => {
    const { link, emu } = await setup({ emu: { ignoreVibrate: 2 } });
    await until(() => emu.connected && emu.configs.length > 0);
    expect(link.vibrate({ mask: 15, duty: 0.8, ms: 1500, ramp_ms: 200 })).toBe(true);
    await until(() => emu.vibrates.length === 1);
    await wait(800);
    expect(emu.vibrates).toHaveLength(1);
    expect(link.metrics().resends).toBeGreaterThanOrEqual(2);
  });

  it("an answer clears only the type it names, when config and vibrate have the same seq", async () => {
    const { link, emu } = await setup({ emu: { ignoreConfig: 1 } });
    await until(() => emu.connected && link.metrics().connected);
    // config 1 waits for its answer; vibrate 1 gets one at once
    expect(link.vibrate({ mask: 1, duty: 0.5, ms: 300, ramp_ms: 0 })).toBe(true);
    await until(() => emu.vibrates.length === 1);
    expect(emu.vibrates[0]!.seq).toBe(1);
    await until(() => emu.configs.length === 1); // config sent again and used
    expect(emu.configs[0]!.seq).toBe(1);
    expect(emu.vibrateRepeats).toBe(0);
  });

  it("30 states per second really come (not ~21 from the Windows timer steps)", async () => {
    const { emu } = await setup();
    await until(() => emu.states.length > 0);
    const a = emu.states.length;
    await wait(2000);
    const perSecond = (emu.states.length - a) / 2;
    expect(perSecond).toBeGreaterThanOrEqual(28);
    expect(perSecond).toBeLessThanOrEqual(32);
  });

  it("the admin changes the board state rate", async () => {
    const { link, emu } = await setup();
    await until(() => emu.states.length > 0);
    link.setParam("board.state_hz", 10);
    await wait(150);
    const a = emu.states.length;
    await wait(1000);
    const perSecond = emu.states.length - a;
    expect(perSecond).toBeGreaterThanOrEqual(7);
    expect(perSecond).toBeLessThanOrEqual(12);
  });

  it("bad packets do not stop the link", async () => {
    const { link, emu, quakes } = await setup();
    await until(() => emu.connected && emu.configs.length > 0);
    emu.sendRawUdp(Uint8Array.from([0xc1, 0xc1, 0xc1]));
    emu.sendRawUdp(new Uint8Array(0));
    emu.sendRawTcp(Uint8Array.from([0, 3, 0xc1, 0xc1, 0xc1])); // a frame with garbage inside
    const stranger = createSocket("udp4");
    stranger.send(Uint8Array.from([1, 2, 3]), (link as unknown as { port: number }).port, "127.0.0.1", () => stranger.close());
    await until(() => link.metrics().badMessages >= 3);
    const seq = emu.hit(3, 0);
    await until(() => emu.quakesAnswered.has(seq));
    expect(quakes).toHaveLength(1);
    expect(link.metrics().connected).toBe(true);
  });
});

describe("hard cases", () => {
  it("heavy loss: the link stays, events still arrive and the loss is measured", async () => {
    const netem = new NetemSettings();
    netem.set("board", "down", { lossPct: 50 });
    netem.set("board", "up", { lossPct: 50 });
    // 50 sensor messages per second, so the loss is measured on about 200 packets
    const { link, emu, quakes } = await setup({ netem, emu: { searchAfterMs: 2000, sensorHz: 50 } });
    await until(() => emu.connected && emu.configs.length > 0);
    const seqs = [emu.hit(2, 1), emu.hit(4, 7), emu.hit(9, 8)];
    await wait(4000);
    expect(quakes.map((q) => q.mag).sort()).toEqual([2, 4, 9]);
    expect(seqs.every((s) => emu.quakesAnswered.has(s))).toBe(true);
    expect(emu.connects).toBe(1);
    // Mostly sensor samples (50 % up loss); the few delay replies also lose their probe
    // on the way down (75 %). Expected about 51 %; the bounds are 4 standard deviations.
    const loss = link.metrics().lossPct;
    expect(loss).toBeGreaterThan(36);
    expect(loss).toBeLessThan(66);
  }, 10_000);

  it("added delay and jitter are measured on the link as set", async () => {
    const netem = new NetemSettings();
    netem.set("board", "down", { delayMs: 60, jitterMs: 20 });
    const { link, emu } = await setup({ netem });
    const delays: number[] = [];
    await until(() => emu.connected);
    for (let i = 0; i < 12; i++) {
      await wait(500);
      const d = link.metrics().delayMs;
      if (d !== null) delays.push(d);
    }
    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(38);
    expect(Math.max(...delays)).toBeLessThanOrEqual(110);
    expect(mean).toBeGreaterThan(45);
    expect(mean).toBeLessThan(90);
  }, 10_000);

  it("server restart: the board finds the new server and takes its states", async () => {
    const first = await setup({ sid: 111 });
    await until(() => first.emu.states.length > 20);
    const seqBefore = first.emu.states.at(-1)!.seq;
    const port = first.port;
    await first.link.close();

    // The new server starts its numbers at 1, far below the old ones.
    const second = new BoardLink({ port, host: "127.0.0.1", sid: 222 });
    open.push(second);
    await second.start();
    second.setConfig(CONFIG);
    second.setState({ ...STATE, tl: 299 });
    await until(() => first.emu.states.some((s) => s.sid === 222) && first.emu.states.at(-1)!.d.tl === 299, 8000);
    expect(first.emu.sidChanges).toBe(1);
    expect(first.emu.connects).toBe(2);
    const fresh = first.emu.states.filter((s) => s.sid === 222);
    expect(fresh[0]!.seq).toBeLessThan(seqBefore);
    expect(second.metrics().connected).toBe(true);
  }, 12_000);

  it("the server marks a silent board as lost", async () => {
    const { links, emu } = await setup();
    await until(() => links.length === 1);
    await emu.close();
    await until(() => links.length === 2, 5000);
    expect(links).toEqual([true, false]);
  }, 8000);

  it("long run: steady states, no loss, no bad message", async () => {
    const { link, emu } = await setup();
    await until(() => emu.connected);
    await wait(Number(process.env.LONG_RUN_MS ?? 5000));
    const m = link.metrics();
    expect(emu.connects).toBe(1);
    expect(m.connected).toBe(true);
    expect(m.lossPct).toBe(0);
    expect(m.badMessages).toBe(0);
    expect(emu.oldStatesDropped).toBe(0);
    expect(m.statesSent).toBeGreaterThan(100);
  }, Number(process.env.LONG_RUN_MS ?? 5000) + 10_000);
});
