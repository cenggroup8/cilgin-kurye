// Scenario files: scenarios/<module>/<name>.yaml (README "Scenario").
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { BENCH_DIR, REPO_DIR, moduleById } from "./modules.js";

export interface SliderInput {
  type: "slider";
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  start: number;
}
export interface ButtonInput {
  type: "button";
  name: string;
  label: string;
  value?: unknown; // sent with the press
  options?: (string | number)[]; // one button for each value, for example the 9 zones of a hit
}
export interface SelectInput {
  type: "select";
  name: string;
  label: string;
  options: (string | number)[];
  start: string | number;
}
export type Input = SliderInput | ButtonInput | SelectInput;

/** A timed input: at `at` seconds the runner calls input(name, value). */
export interface Step {
  at: number;
  input: string;
  value?: unknown;
}

/** A scenario that only runs a command (an existing demo or test): no adapter needed. */
export interface RunCmd {
  cwd: string; // folder, from the repository root
  cmd: string; // shell command; must end by itself
}

export interface Scenario {
  module: string; // "M2"
  id: string; // "m2"
  name: string; // file name without .yaml
  title: string;
  seconds: number | null; // null: runs until the adapter says it is done (or Stop)
  params: Record<string, unknown>;
  inputs: Input[];
  script: Step[];
  expect: string[];
  views: string[];
  file: string;
  run: RunCmd | null;
  install: string[]; // folders that need npm ci before the first run
  needs: string[]; // files that must be there (else: not on this branch yet)
  pr: string | null; // the PR the files come in
  tool: string | null; // a program that must be there (make)
  files: string[]; // the files the demo uses (shown on the page)
  fake: string | null; // what the module gets instead of the other modules
  result: string | null; // what a person must see when it works
  untilExit: boolean; // runs until the command ends (seconds is only a time limit)
  sources: Source[]; // where the data comes from (shown on the page, saved with the run)
}

/** A file the run uses. role: code (the tested code), fake (fake input), contract, data, test. */
export interface Source {
  file: string; // from the repository root
  role: "code" | "fake" | "contract" | "data" | "test";
  note?: string;
}
export const ROLES = ["code", "fake", "contract", "data", "test"] as const;

/** What the module takes and gives (scenarios/<module>/module.yaml), shown on the page. */
export interface ModuleAbout {
  name?: string;
  team?: string;
  doc?: string;
  summary?: string;
  inputs: { data: string; from?: string; content?: string }[];
  outputs: { data: string; to?: string; content?: string }[];
}

export const SCENARIO_DIR = join(BENCH_DIR, "scenarios");

interface ParamDef {
  name: string;
  min: number;
  max: number;
  start: number;
  integer?: boolean;
  label?: string;
}
let paramList: readonly ParamDef[] | null | undefined;

/** The M1-5 parameter list, read only for slider ranges. null when M1 is not there. */
export async function m1Params(): Promise<readonly ParamDef[] | null> {
  if (paramList !== undefined) return paramList;
  const file = join(REPO_DIR, "M1-game-server", "src", "admin", "param-list.ts");
  try {
    paramList = existsSync(file) ? ((await import(file)) as { PARAMS: readonly ParamDef[] }).PARAMS : null;
  } catch {
    paramList = null;
  }
  return paramList;
}

const fail = (file: string, why: string): never => {
  throw new Error(`${file}: ${why}`);
};

function num(x: unknown, file: string, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) fail(file, `${what} must be a number`);
  return x as number;
}

async function input(x: unknown, file: string): Promise<Input> {
  if (typeof x !== "object" || x === null) return fail(file, "every input must be an object");
  const o = x as Record<string, unknown>;
  if (typeof o.param === "string") {
    const list = await m1Params();
    const p = list?.find((d) => d.name === o.param);
    if (!p) return fail(file, `parameter ${o.param} is not in the M1-5 list`);
    const step = typeof o.step === "number" ? o.step : p.integer ? 1 : (p.max - p.min) / 100;
    return { type: "slider", name: typeof o.name === "string" ? o.name : p.name, label: String(o.label ?? p.label ?? p.name), min: p.min, max: p.max, step, start: p.start };
  }
  if (typeof o.name !== "string" || !o.name) return fail(file, "input without name");
  const label = String(o.label ?? o.name);
  switch (o.type) {
    case "slider": {
      const min = num(o.min, file, `${o.name}.min`);
      const max = num(o.max, file, `${o.name}.max`);
      if (max <= min) fail(file, `${o.name}: max must be bigger than min`);
      const step = o.step === undefined ? (max - min) / 100 : num(o.step, file, `${o.name}.step`);
      const start = o.start === undefined ? min : num(o.start, file, `${o.name}.start`);
      return { type: "slider", name: o.name, label, min, max, step, start };
    }
    case "button": {
      const b: ButtonInput = { type: "button", name: o.name, label };
      if (o.value !== undefined) b.value = o.value;
      if (o.options !== undefined) {
        if (!Array.isArray(o.options) || !o.options.length) return fail(file, `${o.name}: options must be a list`);
        b.options = o.options as (string | number)[];
      }
      return b;
    }
    case "select": {
      if (!Array.isArray(o.options) || !o.options.length) return fail(file, `${o.name}: options missing`);
      const options = o.options as (string | number)[];
      return { type: "select", name: o.name, label, options, start: (o.start as string | number) ?? options[0] };
    }
    default:
      return fail(file, `${o.name}: type must be slider, button or select (or give param:)`);
  }
}

export async function loadScenario(file: string, id: string, name: string): Promise<Scenario> {
  const m = moduleById(id);
  if (!m) return fail(file, `no module ${id}`);
  let doc: Record<string, unknown>;
  try {
    doc = (parse(readFileSync(file, "utf8")) ?? {}) as Record<string, unknown>;
  } catch (e) {
    return fail(file, (e as Error).message);
  }
  if (doc.module !== undefined && String(doc.module).toUpperCase() !== m.mod) fail(file, `module is ${doc.module}, but the file is in scenarios/${id}`);
  let run: RunCmd | null = null;
  if (doc.run !== undefined) {
    const r = doc.run as Record<string, unknown>;
    if (typeof r?.cmd !== "string" || typeof r?.cwd !== "string") fail(file, "run needs cwd and cmd");
    run = { cwd: r.cwd as string, cmd: r.cmd as string };
  }
  // A command scenario runs until the command ends; 5 minutes at most.
  const seconds = doc.seconds === undefined || doc.seconds === null ? (run ? 300 : null) : num(doc.seconds, file, "seconds");
  if (seconds !== null && (seconds <= 0 || seconds > 3600)) fail(file, "seconds must be between 0 and 3600");
  const params = (doc.params ?? {}) as Record<string, unknown>;
  const inputs = await Promise.all(((doc.inputs ?? []) as unknown[]).map((x) => input(x, file)));
  const script = ((doc.script ?? []) as Record<string, unknown>[]).map((s) => {
    if (typeof s?.input !== "string") return fail(file, "every script step needs input:");
    return { at: num(s.at, file, "script at"), input: s.input, value: s.value };
  });
  script.sort((a, b) => a.at - b.at);
  const list = (x: unknown, what: string) => {
    if (x === undefined) return [];
    if (!Array.isArray(x) || x.some((v) => typeof v !== "string")) fail(file, `${what} must be a list of names`);
    return x as string[];
  };
  return {
    module: m.mod,
    id: m.id,
    name,
    title: String(doc.title ?? name),
    seconds,
    params,
    inputs,
    script,
    expect: list(doc.expect, "expect"),
    views: list(doc.views, "views"),
    file,
    run,
    install: list(doc.install, "install"),
    needs: list(doc.needs, "needs"),
    pr: doc.pr === undefined || doc.pr === null ? null : String(doc.pr),
    tool: typeof doc.tool === "string" ? doc.tool : null,
    files: list(doc.files, "files"),
    fake: typeof doc.fake === "string" ? doc.fake : null,
    result: typeof doc.result === "string" ? doc.result : null,
    untilExit: run !== null && (doc.seconds === undefined || doc.seconds === null),
    sources: ((doc.sources ?? []) as Record<string, unknown>[]).map((x) => {
      if (typeof x?.file !== "string") return fail(file, "every source needs file:");
      const role = String(x.role ?? "code") as Source["role"];
      if (!ROLES.includes(role)) fail(file, `source role must be one of ${ROLES.join(", ")}`);
      return typeof x.note === "string" ? { file: x.file, role, note: x.note } : { file: x.file, role };
    }),
  };
}

/** All scenarios of one module, sorted by name. */
export async function loadScenarios(id: string): Promise<Scenario[]> {
  const dir = join(SCENARIO_DIR, id);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !/^module\.ya?ml$/.test(f)).sort();
  const all = await Promise.all(files.map((f) => loadScenario(join(dir, f), id, f.replace(/\.ya?ml$/, ""))));
  // Scenarios with graphs (adapter) first, then the existing demos run as commands.
  return all.sort((a, b) => Number(a.run !== null) - Number(b.run !== null) || a.name.localeCompare(b.name));
}

export function loadAbout(id: string): ModuleAbout | null {
  const file = join(SCENARIO_DIR, id, "module.yaml");
  if (!existsSync(file)) return null;
  const doc = (parse(readFileSync(file, "utf8")) ?? {}) as Partial<ModuleAbout>;
  return { ...doc, inputs: doc.inputs ?? [], outputs: doc.outputs ?? [] };
}
