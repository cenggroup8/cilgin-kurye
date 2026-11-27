import { describe, expect, it } from "vitest";
import { GameRecorder, parseRecording } from "../src/state/recorder.js";
import { createInitialWorld, TICK_RATE } from "../src/state/world.js";
import { emptyTickInput, type TickInput } from "../src/loop/types.js";

describe("GameRecorder", () => {
  it("produces valid NDJSON with header and entries", () => {
    const rec = new GameRecorder(42);
    const world = createInitialWorld();

    // Simulate 3 ticks
    for (let i = 0; i < 3; i++) {
      world.tick = i + 1;
      rec.afterTick(world, emptyTickInput());
    }

    const ndjson = rec.toNdjson();
    const lines = ndjson.trim().split("\n");
    expect(lines).toHaveLength(4); // 1 header + 3 entries

    const header = JSON.parse(lines[0]!);
    expect(header).toEqual({ type: "header", seed: 42, tickRate: TICK_RATE, version: 1 });

    const entry1 = JSON.parse(lines[1]!);
    expect(entry1.type).toBe("tick");
    expect(entry1.tick).toBe(1);
  });

  it("records input data in each entry", () => {
    const rec = new GameRecorder(99);
    const world = createInitialWorld();
    world.tick = 1;

    const input: TickInput = {
      ...emptyTickInput(),
      controls: [{ player: 0, seq: 5, throttle: 1, brake: 0, steer: -0.5 }],
    };
    rec.afterTick(world, input);

    const ndjson = rec.toNdjson();
    const { entries } = parseRecording(ndjson);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.input.controls).toHaveLength(1);
    expect(entries[0]!.input.controls[0]!.throttle).toBe(1);
  });
});

describe("parseRecording", () => {
  it("roundtrips header and entries", () => {
    const rec = new GameRecorder(123);
    const world = createInitialWorld();

    for (let i = 0; i < 5; i++) {
      world.tick = i + 1;
      rec.afterTick(world, emptyTickInput());
    }

    const { header, entries } = parseRecording(rec.toNdjson());
    expect(header.seed).toBe(123);
    expect(entries).toHaveLength(5);
    expect(entries[4]!.tick).toBe(5);
  });

  it("throws on empty input", () => {
    expect(() => parseRecording("")).toThrow();
  });

  it("throws when first line is not a header", () => {
    expect(() => parseRecording('{"type":"tick","tick":1,"input":{}}')).toThrow("header");
  });
});
