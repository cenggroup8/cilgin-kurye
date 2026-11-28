// The bench without the page.
//   npm run bench -- list                     modules and scenarios
//   npm run bench -- m2                       every timed scenario of M2
//   npm run bench -- m2 loss30                one scenario (name or a part of it)
//   npm run bench -- all                      every timed scenario of every ready module
//   npm run bench -- replay runs/<file>       the checks of a saved run
// Options: --seconds N (also runs a live scenario), --no-save, --verbose (logs and every metric).
// Exit code 0 only when every scenario that ran has passed.
import { readFileSync } from "node:fs";
import { loadAdapter, type AdapterModule } from "./adapter.js";
import { MODULES, moduleById, type ModuleInfo } from "./modules.js";
import type { Rec } from "./record.js";
import { Run, type Result } from "./runner.js";
import { loadScenarios, type Scenario } from "./scenario.js";

const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("32");
const red = c("31");
const grey = c("90");
const bold = c("1");
const OK = green("✔");
const NO = red("✘");

function args() {
  const a = process.argv.slice(2);
  const flags = { save: true, verbose: false, seconds: undefined as number | undefined };
  const rest: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--no-save") flags.save = false;
    else if (a[i] === "--verbose" || a[i] === "-v") flags.verbose = true;
    else if (a[i] === "--seconds") flags.seconds = Number(a[++i]);
    else rest.push(a[i]);
  }
  if (flags.seconds !== undefined && !(flags.seconds > 0)) throw new Error("--seconds needs a number > 0");
  return { flags, rest };
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}

async function list(): Promise<void> {
  for (const m of MODULES) {
    const a = await loadAdapter(m);
    const sc = await loadScenarios(m.id).catch((e: Error) => e);
    const state = typeof a === "string" ? grey(`not ready: ${a}`) : green("ready");
    console.log(`${bold(`${m.mod} ${m.title}`)}  ${state}`);
    if (sc instanceof Error) console.log(`   ${red(sc.message)}`);
    else for (const s of sc) console.log(`   ${s.name.padEnd(14)} ${s.title}${s.seconds === null ? grey("  (live)") : grey(`  (${s.seconds} s)`)}`);
  }
}

async function runOne(a: AdapterModule, s: Scenario, flags: ReturnType<typeof args>["flags"]): Promise<Result> {
  console.log(`\n${bold(`${s.module} ${s.name}`)}  ${s.title}`);
  const latest = new Map<string, { value: number; unit?: string }>();
  const onRec = (r: Rec) => {
    const t = grey(`${(r.t ?? 0).toFixed(1).padStart(5)}s`);
    if (r.kind === "check") console.log(`${t} ${r.ok ? OK : NO} ${r.name}${r.detail ? grey(`  ${r.detail}`) : ""}`);
    else if (r.kind === "event") console.log(`${t} • ${r.name}${r.data ? grey(` ${JSON.stringify(r.data)}`) : ""}`);
    else if (r.kind === "metric") {
      latest.set(r.name, { value: r.value, unit: r.unit });
      if (flags.verbose) console.log(`${t}   ${r.name} = ${fmt(r.value)}${r.unit ? ` ${r.unit}` : ""}`);
    } else if (flags.verbose || r.text.startsWith("bench:")) console.log(`${t} ${grey(r.text)}`);
  };
  const run = new Run(s, a.create(), { onRec, save: flags.save, seconds: flags.seconds });
  const show = flags.verbose
    ? null
    : setInterval(() => {
        if (!latest.size) return;
        const line = [...latest].map(([k, v]) => `${k} ${fmt(v.value)}${v.unit ? v.unit : ""}`).join("  ");
        console.log(grey(`${run.now().toFixed(1).padStart(5)}s   ${line}`));
      }, 1000);
  const onInt = () => run.stop();
  process.once("SIGINT", onInt);
  await run.start();
  const r = await run.result;
  process.off("SIGINT", onInt);
  if (show) clearInterval(show);
  for (const m of r.missing) console.log(`      ${NO} ${m} ${grey("(expected, never came)")}`);
  if (r.error) console.log(`      ${NO} ${r.error}`);
  console.log(`${r.passed ? green("PASSED") : red("FAILED")}  ${s.module} ${s.name}  ${r.seconds} s${r.file ? grey(`  → ${r.file.replace(/^.*\/tools\/testbench\//, "")}`) : ""}`);
  return r;
}

function replay(file: string): boolean {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const head = lines.find((l) => l.kind === "run");
  const res = lines.find((l) => l.kind === "result") as unknown as Result | undefined;
  console.log(`${bold(`${head?.module} ${head?.scenario}`)}  ${head?.title ?? ""}  ${grey(String(head?.started ?? ""))}`);
  console.log(grey(`${lines.length} records`));
  if (!res) {
    console.log(red("no result: the run did not end"));
    return false;
  }
  for (const ch of res.checks) console.log(`  ${ch.ok ? OK : NO} ${ch.name}${ch.detail ? grey(`  ${ch.detail}`) : ""}`);
  for (const m of res.missing) console.log(`  ${NO} ${m} ${grey("(expected, never came)")}`);
  console.log(res.passed ? green("PASSED") : red("FAILED"));
  return res.passed;
}

async function main(): Promise<number> {
  const { flags, rest } = args();
  const [what, ...names] = rest;
  if (!what || what === "list") {
    await list();
    return 0;
  }
  if (what === "replay") {
    if (!names[0]) throw new Error("replay needs a file: npm run bench:replay -- runs/<file>.ndjson");
    return replay(names[0]) ? 0 : 1;
  }

  const mods: ModuleInfo[] = what === "all" ? [...MODULES] : [moduleById(what) ?? (() => { throw new Error(`no module ${what} (m1 … m6)`); })()];
  const results: Result[] = [];
  const skipped: string[] = [];
  for (const m of mods) {
    const a = await loadAdapter(m);
    if (typeof a === "string") {
      if (what !== "all") throw new Error(`${m.mod}: ${a}`);
      skipped.push(`${m.mod}: ${a}`);
      continue;
    }
    let sc = await loadScenarios(m.id);
    if (names.length) {
      sc = names.map((n) => {
        const hit = sc.filter((s) => s.name === n || s.name.includes(n));
        if (hit.length !== 1) throw new Error(`${m.mod}: ${hit.length ? "more than one" : "no"} scenario matches "${n}" (${sc.map((s) => s.name).join(", ")})`);
        return hit[0];
      });
    } else sc = sc.filter((s) => s.seconds !== null || flags.seconds !== undefined);
    if (!sc.length) skipped.push(`${m.mod}: no timed scenario`);
    for (const s of sc) {
      if (s.seconds === null && flags.seconds === undefined) console.log(grey(`${s.module} ${s.name} is live: it runs until Ctrl-C (or give --seconds)`));
      results.push(await runOne(a, s, flags));
    }
  }

  console.log(`\n${bold("Summary")}`);
  for (const r of results) console.log(`  ${r.passed ? OK : NO} ${r.module} ${r.scenario}`);
  for (const s of skipped) console.log(`  ${grey(`– ${s}`)}`);
  const passed = results.length > 0 && results.every((r) => r.passed);
  console.log(passed ? green(`all ${results.length} passed`) : red(`${results.filter((r) => !r.passed).length} of ${results.length} failed`));
  return passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(red(e.message));
    process.exit(2);
  },
);
