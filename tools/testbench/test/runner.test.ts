import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandAdapter, type Adapter } from "../src/adapter.js";
import { BENCH_DIR } from "../src/modules.js";
import type { Rec } from "../src/record.js";
import { Run } from "../src/runner.js";
import type { Scenario } from "../src/scenario.js";

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  module: "M9", id: "m9", name: "t", title: "t", seconds: 0.3, params: {}, inputs: [], script: [], expect: [], views: [], file: "", ...over,
});

function fake(onInput?: (n: string, v: unknown) => void): Adapter {
  let emit: (r: never) => void = () => {};
  return {
    start(_s, ctx) {
      emit = ctx.emit as never;
      ctx.emit({ kind: "metric", name: "x", value: 1 });
    },
    input(n, v) {
      onInput?.(n, v);
    },
    stop() {
      (emit as (r: object) => void)({ kind: "check", name: "a", ok: true });
    },
  };
}

describe("Run", () => {
  it("stamps records, plays the script, passes when every check is ok", async () => {
    const got: Rec[] = [];
    const inputs: unknown[] = [];
    const run = new Run(scenario({ script: [{ at: 0.1, input: "go", value: 3 }], expect: ["a"] }), fake((n, v) => inputs.push([n, v])), { save: false, onRec: (r) => got.push(r) });
    await run.start();
    const r = await run.result;
    expect(r.passed).toBe(true);
    expect(inputs).toEqual([["go", 3]]);
    expect(got.every((x) => x.mod === "M9" && typeof x.t === "number")).toBe(true);
  });
  it("fails when an expected check never comes", async () => {
    const run = new Run(scenario({ expect: ["a", "b"] }), fake(), { save: false });
    await run.start();
    const r = await run.result;
    expect(r.passed).toBe(false);
    expect(r.missing).toEqual(["b"]);
  });
  it("fails without any check, and turns a bad record into a log", async () => {
    const got: Rec[] = [];
    const a: Adapter = { start: (_s, c) => c.emit({ kind: "metric", name: "x", value: "1" } as never), stop() {} };
    const run = new Run(scenario(), a, { save: false, onRec: (r) => got.push(r) });
    await run.start();
    const r = await run.result;
    expect(r.passed).toBe(false);
    expect(got[0].kind).toBe("log");
  });
});

describe("commandAdapter", () => {
  const printer = (env: Record<string, string> = {}) =>
    commandAdapter({ cmd: process.execPath, args: [join(BENCH_DIR, "test", "fixtures", "printer.mjs")], cwd: BENCH_DIR, env, inputLine: (n, v) => `${n}=${v}` });

  it("reads the output of a program, gives params as BENCH_ variables, ends with the program", async () => {
    const got: Rec[] = [];
    const run = new Run(scenario({ seconds: null, params: { speed: 7 } }), printer(), { save: false, onRec: (r) => got.push(r) });
    await run.start();
    run.input("zone", 4);
    const r = await run.result;
    const kinds = got.map((x) => x.kind);
    expect(kinds.filter((k) => k === "log").length).toBe(2); // the plain line and the broken metric
    expect(got.find((x) => x.kind === "metric" && x.name === "speed")).toMatchObject({ value: 7 });
    expect(got.some((x) => x.kind === "event" && x.name === "got")).toBe(true);
    expect(r.checks.map((c) => [c.name, c.ok])).toEqual([
      ["quiet table, no false event", true],
      ["json check", false],
      ["program ends without error", true],
    ]);
  });
  it("a failing exit code is a failed check", async () => {
    const run = new Run(scenario({ seconds: null }), printer({ BENCH_FAIL: "1" }), { save: false });
    await run.start();
    const r = await run.result;
    expect(r.checks.find((c) => c.name === "program ends without error")).toMatchObject({ ok: false, detail: "exit 3" });
  });
  it("stops a program that runs longer than the scenario", async () => {
    const run = new Run(scenario({ seconds: 0.2 }), commandAdapter({ cmd: process.execPath, args: ["-e", "setInterval(() => console.log('@metric a 1'), 50)"], cwd: BENCH_DIR }), { save: false });
    await run.start();
    const r = await run.result;
    expect(r.error).toBeNull();
    expect(r.seconds).toBeLessThan(2);
  });
});
