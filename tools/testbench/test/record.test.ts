import { describe, expect, it } from "vitest";
import { parseLine, validate, words } from "../src/record.js";

describe("parseLine", () => {
  it("reads @metric with and without unit", () => {
    expect(parseLine("@metric delay_ms 2.1 ms", "M6")).toEqual({ kind: "metric", mod: "M6", name: "delay_ms", value: 2.1, unit: "ms" });
    expect(parseLine("@metric resends 3", "M2")).toEqual({ kind: "metric", mod: "M2", name: "resends", value: 3 });
  });
  it("reads @event with key=value data", () => {
    expect(parseLine("@event hit zone=4 strength=6 src=hand ok=true", "M6")).toEqual({ kind: "event", mod: "M6", name: "hit", data: { zone: 4, strength: 6, src: "hand", ok: true } });
    expect(parseLine("@event motor", "M6")).toEqual({ kind: "event", mod: "M6", name: "motor" });
  });
  it("reads @check with a quoted name and a detail", () => {
    expect(parseLine('@check "zone right or next to it" fail 352/360', "M6")).toEqual({ kind: "check", mod: "M6", name: "zone right or next to it", ok: false, detail: "352/360" });
    expect(parseLine("@check boots ok", "M6")).toEqual({ kind: "check", mod: "M6", name: "boots", ok: true });
  });
  it("reads JSON records and adds mod", () => {
    expect(parseLine('{"kind":"metric","name":"x","value":1}', "M3")).toEqual({ kind: "metric", name: "x", value: 1, mod: "M3" });
  });
  it("reads the ✓ / ✗ lines of a demo as checks", () => {
    expect(parseLine("  ✓ sunucu deprem olayını bir kez aldı", "M6")).toEqual({ kind: "check", mod: "M6", name: "sunucu deprem olayını bir kez aldı", ok: true });
    expect(parseLine("  ✘ 30 % loss both ways: state loss 12 %", "M2")).toEqual({ kind: "check", mod: "M2", name: "30 % loss both ways", ok: false, detail: "state loss 12 %" });
    expect(parseLine("\x1b[32m✔\x1b[0m clean", "M2")).toMatchObject({ kind: "check", ok: true, name: "clean" });
  });
  it("keeps other lines and broken lines as log", () => {
    expect(parseLine("plain text", "M1")).toEqual({ kind: "log", mod: "M1", text: "plain text" });
    expect(parseLine("@metric x abc", "M1").kind).toBe("log");
    expect(parseLine("@check x maybe", "M1").kind).toBe("log");
    expect(parseLine('{"kind":"metric","name":"x","value":"1"}', "M1").kind).toBe("log");
    expect(parseLine("{not json", "M1").kind).toBe("log");
  });
});

describe("validate", () => {
  it("refuses bad records", () => {
    expect(validate({ kind: "metric", mod: "M1", name: "x", value: NaN })).toBeTypeOf("string");
    expect(validate({ kind: "check", mod: "M1", name: "x", ok: "yes" })).toBeTypeOf("string");
    expect(validate({ kind: "other", mod: "M1" })).toBeTypeOf("string");
    expect(validate({ kind: "event", name: "x" })).toBeTypeOf("string");
    expect(validate({ kind: "event", mod: "M1", name: "x", t: -1 })).toBeTypeOf("string");
  });
  it("splits words with quotes", () => {
    expect(words('@check "a \\"b\\" c" ok')).toEqual(["@check", 'a "b" c', "ok"]);
  });
});
