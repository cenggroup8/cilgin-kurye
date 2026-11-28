// Runs one scenario with one adapter: times it, plays the script, stamps and saves the records,
// and decides passed / failed.
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Adapter, Out } from "./adapter.js";
import { validate, type CheckRec, type Rec } from "./record.js";
import type { Scenario } from "./scenario.js";
import { BENCH_DIR } from "./modules.js";

export interface Result {
  module: string;
  scenario: string;
  passed: boolean;
  seconds: number;
  checks: CheckRec[]; // the last check of every name
  missing: string[]; // expected checks that never came
  error: string | null;
  file: string | null;
}

export interface RunOptions {
  /** Every record, as soon as it is there. */
  onRec?(r: Rec): void;
  /** Save to runs/ (default true). */
  save?: boolean;
  /** Overrides seconds of the scenario. */
  seconds?: number | null;
}

export const RUN_DIR = join(BENCH_DIR, "runs");

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Run {
  readonly result: Promise<Result>;
  private t0 = 0;
  private starting = true;
  private finished = false;
  private timers: NodeJS.Timeout[] = [];
  private checks = new Map<string, CheckRec>();
  private out: WriteStream | null = null;
  private file: string | null = null;
  private error: string | null = null;
  private finish!: () => void;

  constructor(
    readonly scenario: Scenario,
    private adapter: Adapter,
    private opts: RunOptions = {},
  ) {
    this.result = new Promise<void>((ok) => (this.finish = ok)).then(() => this.end());
  }

  /** Seconds of the scenario. The clock starts when start() of the adapter is over
   *  (a build before the start does not eat the time of the script). */
  now(): number {
    return this.starting ? 0 : (performance.now() - this.t0) / 1000;
  }

  private write(x: object): void {
    this.out?.write(JSON.stringify(x) + "\n");
  }

  private take(r: Out): void {
    if (this.finished) return;
    const full = { ...r, mod: r.mod ?? this.scenario.module, t: r.t ?? Math.round(this.now() * 1000) / 1000 };
    const v = validate(full);
    const rec: Rec = typeof v === "string" ? { kind: "log", mod: this.scenario.module, t: full.t, text: `bench: bad record (${v}): ${JSON.stringify(r)}` } : v;
    if (rec.kind === "check") this.checks.set(rec.name, rec);
    this.write(rec);
    this.opts.onRec?.(rec);
  }

  async start(): Promise<void> {
    const s = this.scenario;
    if (this.opts.save !== false) {
      mkdirSync(RUN_DIR, { recursive: true });
      this.file = join(RUN_DIR, `${s.id}-${s.name}-${stamp(new Date())}.ndjson`);
      this.out = createWriteStream(this.file);
      this.write({ kind: "run", module: s.module, scenario: s.name, title: s.title, started: new Date().toISOString(), params: s.params, inputs: s.inputs, expect: s.expect, views: s.views });
    }
    const seconds = this.opts.seconds !== undefined ? this.opts.seconds : s.seconds;
    try {
      await this.adapter.start(s, { emit: (r) => this.take(r), done: () => this.finish(), now: () => this.now() });
    } catch (e) {
      this.error = `start: ${(e as Error).message}`;
      this.starting = false;
      this.finish();
      return;
    }
    this.t0 = performance.now();
    this.starting = false;
    for (const step of s.script) {
      this.timers.push(setTimeout(() => this.input(step.input, step.value), Math.max(0, step.at * 1000 - this.now() * 1000)));
    }
    if (seconds !== null) this.timers.push(setTimeout(() => this.finish(), Math.max(0, seconds * 1000 - this.now() * 1000)));
  }

  input(name: string, value: unknown): void {
    if (this.finished) return;
    this.take({ kind: "event", name: "input", data: { name, value: value ?? null } });
    try {
      this.adapter.input?.(name, value);
    } catch (e) {
      this.take({ kind: "log", text: `bench: input ${name} failed: ${(e as Error).message}` });
    }
  }

  /** Stop before the time is over (Stop button, Ctrl-C). */
  stop(): void {
    this.finish();
  }

  private async end(): Promise<Result> {
    for (const t of this.timers) clearTimeout(t);
    try {
      await Promise.race([this.adapter.stop(), new Promise((_, no) => setTimeout(() => no(new Error("stop took more than 3 s")), 3000))]);
    } catch (e) {
      this.error ??= `stop: ${(e as Error).message}`;
    }
    this.finished = true;
    const checks = [...this.checks.values()];
    const missing = this.scenario.expect.filter((n) => !this.checks.has(n));
    const result: Result = {
      module: this.scenario.module,
      scenario: this.scenario.name,
      passed: !this.error && checks.length > 0 && checks.every((c) => c.ok) && missing.length === 0,
      seconds: Math.round(this.now() * 10) / 10,
      checks,
      missing,
      error: this.error,
      file: this.file,
    };
    this.write({ kind: "result", ...result });
    await new Promise<void>((ok) => (this.out ? this.out.end(ok) : ok()));
    return result;
  }
}
