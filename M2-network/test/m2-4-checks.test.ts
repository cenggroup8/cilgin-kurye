// Config and vibrate commands are checked with the limits of the board program before they are sent.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BoardLink } from "../src/board/boardLink.js";
import { checkConfig, checkVibrate } from "../src/board/checks.js";
import { BoardEmu } from "./fakes/boardEmu.js";

const VECTORS = JSON.parse(readFileSync(new URL("../../contracts/board_protocol_vectors.json", import.meta.url), "utf8")).vectors as {
  name: string;
  json: { d: any };
}[];
const CONFIG = VECTORS.find((v) => v.name === "config")!.json.d as Record<string, unknown>;
const VIBRATE = VECTORS.find((v) => v.name === "vibrate")!.json.d as { mask: number; duty: number; ms: number; ramp_ms: number };

describe("checkConfig", () => {
  it("the contract vector is fine, also without anim", () => {
    expect(checkConfig(CONFIG)).toBeNull();
    const { anim: _anim, ...noAnim } = CONFIG;
    expect(checkConfig(noAnim)).toBeNull();
  });

  const bad: [string, Record<string, unknown>][] = [
    ["no plan", { ...CONFIG, plan: undefined }],
    ["bright too low", { ...CONFIG, bright: 0.05 }],
    ["bright as text", { ...CONFIG, bright: "0.6" }],
    ["max_ma too big", { ...CONFIG, max_ma: 70000 }],
    ["empty tones (the demo mistake)", { ...CONFIG, tones: [] }],
    ["7 tones", { ...CONFIG, tones: (CONFIG.tones as number[][]).slice(0, 7) }],
    ["a colour above 255", { ...CONFIG, tones: [[256, 0, 0], ...(CONFIG.tones as number[][]).slice(1)] }],
    ["a colour not whole", { ...CONFIG, tones: [[1.5, 0, 0], ...(CONFIG.tones as number[][]).slice(1)] }],
    ["a colour with 2 parts", { ...CONFIG, tones: [[1, 2], ...(CONFIG.tones as number[][]).slice(1)] }],
    ["anim not a map", { ...CONFIG, anim: [2, 1.5] }],
    ["tail too long", { ...CONFIG, anim: { tail: 21, dp_blink_hz: 1.5 } }],
    ["blink missing", { ...CONFIG, anim: { tail: 2 } }],
  ];
  for (const [name, d] of bad) it(`refuses: ${name}`, () => expect(checkConfig(d)).not.toBeNull());
});

describe("checkVibrate", () => {
  it("the contract vector is fine", () => expect(checkVibrate(VIBRATE)).toBeNull());
  for (const [name, d] of [
    ["mask 16", { ...VIBRATE, mask: 16 }],
    ["mask not whole", { ...VIBRATE, mask: 1.5 }],
    ["duty above 1", { ...VIBRATE, duty: 1.2 }],
    ["ms too long", { ...VIBRATE, ms: 70000 }],
    ["negative ramp", { ...VIBRATE, ramp_ms: -1 }],
  ] as const) {
    it(`refuses: ${name}`, () => expect(checkVibrate(d)).not.toBeNull());
  }
});

describe("BoardLink sends only what the board takes", () => {
  const open: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const x of open.splice(0)) await x.close();
  });

  it("a bad config is not sent and the good one stays; a bad vibrate is not sent", async () => {
    const link = new BoardLink({ port: 0, host: "127.0.0.1", resendMs: 300 });
    const port = await link.start();
    open.push(link);
    expect(link.setConfig(CONFIG)).toBe(true);
    const emu = new BoardEmu({ host: "127.0.0.1", port });
    open.push(emu);
    await emu.start();
    const end = Date.now() + 5000;
    while ((!emu.connected || emu.configs.length === 0) && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
    expect(emu.configs.length).toBe(1);

    expect(link.setConfig({ ...CONFIG, tones: [] })).toBe(false);
    expect(link.lastError).toMatch(/tones/);
    expect(link.vibrate({ ...VIBRATE, duty: 2 })).toBe(false);
    expect(link.lastError).toMatch(/duty/);
    expect(link.vibrate(VIBRATE)).toBe(true);
    await new Promise((ok) => setTimeout(ok, 300));
    expect(emu.configs.length).toBe(1); // the bad config never went out
    expect(new Set(emu.vibrates.map((m) => m.seq)).size).toBe(1); // only the good command
  });
});
