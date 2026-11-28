// What an adapter is (README "Adapter"), and a ready adapter for programs that print lines.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import type { Rec } from "./record.js";
import { parseLine } from "./record.js";
import type { Scenario } from "./scenario.js";
import { BENCH_DIR, type ModuleInfo } from "./modules.js";

/** A record without mod: the runner adds the module name (and t, if it is missing). */
type WithoutMod<R> = R extends Rec ? Omit<R, "mod"> & { mod?: string } : never;
export type Out = WithoutMod<Rec>;

export interface Ctx {
  /** Sends one record. */
  emit(r: Out): void;
  /** The adapter has finished before the time of the scenario is over. */
  done(): void;
  /** Seconds since the start of the scenario. */
  now(): number;
}

export interface Adapter {
  start(s: Scenario, ctx: Ctx): Promise<void> | void;
  /** A control on the page, or a script step. */
  input?(name: string, value: unknown): void;
  /** Stops everything and sends the last checks. Must end within 2 s. */
  stop(): Promise<void> | void;
}

/** adapters/<id>/index.ts exports this. */
export interface AdapterModule {
  create(): Adapter;
  /** null when the module can run; otherwise why not (shown grey on the page). */
  ready?(): string | null;
}

export async function loadAdapter(m: ModuleInfo): Promise<AdapterModule | string> {
  const file = join(BENCH_DIR, "adapters", m.id, "index.ts");
  if (!existsSync(file)) return `no adapter yet (adapters/${m.id}, ${m.owner})`;
  try {
    const a = (await import(pathToFileURL(file).href)) as AdapterModule;
    if (typeof a.create !== "function") return `adapters/${m.id}/index.ts does not export create()`;
    const why = a.ready?.() ?? null;
    return why ?? a;
  } catch (e) {
    return `adapter does not load: ${(e as Error).message.split("\n")[0]}`;
  }
}

export interface CommandOptions {
  cmd: string;
  args?: string[]; // without args, cmd is run by the shell ("npm run demo:match")
  cwd: string;
  /** Folders that need npm ci before the first run (done once, before the clock starts). */
  install?: string[];
  env?: Record<string, string>;
  /** Turns a page control into a line on the standard input of the program (optional). */
  inputLine?(name: string, value: unknown): string | null;
  /** Checks to add from the exit code (default: one check "program ends without error"). */
  exitCheck?: string | null;
}

/**
 * An adapter that starts a program and reads its output with parseLine:
 * JSON records, @metric / @event / @check lines, everything else as log.
 * The scenario params are given to the program as BENCH_<NAME> environment variables.
 */
export function commandAdapter(opts: CommandOptions): Adapter {
  let child: ChildProcess | null = null;
  let ended: Promise<void> = Promise.resolve();
  let ctx: Ctx;
  let stopping = false;
  return {
    async start(s, c) {
      ctx = c;
      for (const dir of opts.install ?? []) {
        if (existsSync(join(dir, "node_modules"))) continue;
        const ci = existsSync(join(dir, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"];
        ctx.emit({ kind: "log", text: `npm ${ci[0]} in ${dir} (first run only) …` });
        const r = spawnSync("npm", ci, { cwd: dir, shell: process.platform === "win32", encoding: "utf8" });
        if (r.status !== 0) throw new Error(`npm ${ci[0]} in ${dir} failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
      }
      const env: Record<string, string> = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } as Record<string, string>;
      // PORT is the setting of the bench page; demos (M2) read PORT too, so it must not reach them.
      delete env.PORT;
      Object.assign(env, opts.env);
      // A knob the demo already reads (for example STEP_SECONDS of demo:board) gets the param
      // value of this run (scenario env:, values changed on the page included).
      for (const [k, p] of Object.entries(s.env ?? {})) if (s.params[p] !== undefined) env[k] = String(s.params[p]);
      for (const [k, v] of Object.entries(s.params)) env[`BENCH_${k.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`] = String(v);
      if (s.seconds !== null) env.BENCH_SECONDS = String(s.seconds);
      const shell = opts.args === undefined;
      child = spawn(opts.cmd, opts.args ?? [], { cwd: opts.cwd, env, shell, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      const read = (stream: NodeJS.ReadableStream | null, err: boolean) => {
        if (!stream) return;
        createInterface({ input: stream }).on("line", (line) => {
          const r = parseLine(line, s.module);
          if (r.kind === "log" && err) r.text = `[stderr] ${r.text}`;
          ctx.emit(r);
        });
      };
      read(child.stdout, false);
      read(child.stderr, true);
      ended = new Promise((ok) => {
        child!.on("error", (e) => {
          ctx.emit({ kind: "check", name: "program starts", ok: false, detail: e.message });
          ok();
          ctx.done();
        });
        child!.on("exit", (code, signal) => {
          if (opts.exitCheck !== null && !stopping) {
            ctx.emit({ kind: "check", name: opts.exitCheck ?? "program ends without error", ok: code === 0, detail: code === 0 ? undefined : `exit ${code ?? signal}` });
          }
          ok();
          ctx.done();
        });
      });
    },
    input(name, value) {
      const line = opts.inputLine?.(name, value);
      if (line != null && child?.stdin?.writable) child.stdin.write(line + "\n");
    },
    async stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        stopping = true;
        // The program may start its own programs (make → server + board): stop the whole group.
        const kill = (sig: NodeJS.Signals) => {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/pid", String(child!.pid), "/T", "/F"], { stdio: "ignore" });
            return;
          }
          try {
            process.kill(-child!.pid!, sig);
          } catch {
            child?.kill(sig);
          }
        };
        kill("SIGTERM");
        const t = setTimeout(() => kill("SIGKILL"), 1500);
        await ended;
        clearTimeout(t);
      }
    },
  };
}
