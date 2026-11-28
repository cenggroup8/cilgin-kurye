// What can run here: every module with its about tables and scenarios, and for each
// scenario whether it can start (ready), and with what (its adapter or its command).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commandAdapter, loadAdapter, type AdapterModule } from "./adapter.js";
import { MODULES, REPO_DIR, type ModuleInfo } from "./modules.js";
import { loadAbout, loadScenarios, type ModuleAbout, type Scenario } from "./scenario.js";

export type State = "ready" | "pr" | "missing" | "notool" | "noadapter";

export interface Entry {
  scenario: Scenario;
  state: State;
  why: string | null;
}
export interface ModuleEntry extends ModuleInfo {
  about: ModuleAbout | null;
  adapter: AdapterModule | null;
  adapterWhy: string | null; // why there is no adapter (only matters for adapter scenarios)
  entries: Entry[];
  error: string | null; // a scenario file that does not load
}

const tools = new Map<string, boolean>();
function hasTool(t: string): boolean {
  if (!tools.has(t)) tools.set(t, spawnSync(t, ["--version"], { shell: true, stdio: "ignore" }).status === 0);
  return tools.get(t)!;
}

function state(s: Scenario, adapter: AdapterModule | null, adapterWhy: string | null): Entry {
  const missing = s.needs.filter((p) => !existsSync(join(REPO_DIR, p)));
  if (missing.length) return { scenario: s, state: s.pr ? "pr" : "missing", why: s.pr ? `${s.pr} ile gelecek` : `dosya yok: ${missing.join(", ")}` };
  if (s.tool && !hasTool(s.tool)) return { scenario: s, state: "notool", why: `${s.tool} gerekiyor, bu bilgisayarda yok` };
  if (!s.run && !adapter) return { scenario: s, state: "noadapter", why: adapterWhy };
  return { scenario: s, state: "ready", why: null };
}

export async function catalog(): Promise<ModuleEntry[]> {
  return Promise.all(MODULES.map(moduleEntry));
}

export async function moduleEntry(m: ModuleInfo): Promise<ModuleEntry> {
  const a = await loadAdapter(m);
  const adapter = typeof a === "string" ? null : a;
  const adapterWhy = typeof a === "string" ? a : null;
  let scenarios: Scenario[] = [];
  let error: string | null = null;
  let about: ModuleAbout | null = null;
  try {
    about = loadAbout(m.id);
    scenarios = await loadScenarios(m.id);
  } catch (e) {
    error = (e as Error).message;
  }
  return { ...m, about, adapter, adapterWhy, entries: scenarios.map((s) => state(s, adapter, adapterWhy)), error };
}

/** The adapter that runs this scenario: its command, or the adapter of the module. */
export function adapterFor(m: ModuleEntry, s: Scenario): AdapterModule {
  if (s.run) {
    const run = s.run;
    return { create: () => commandAdapter({ cmd: run.cmd, cwd: join(REPO_DIR, run.cwd), install: s.install.map((d) => join(REPO_DIR, d)) }) };
  }
  if (!m.adapter) throw new Error(m.adapterWhy ?? `${m.mod} has no adapter`);
  return m.adapter;
}
