// Where the data of a run comes from: the files it uses, each with its role, the last commit
// that changed it, a short hash of its content and a link to it on GitHub. Shown on the page
// ("Veriler nereden geliyor?") and saved at the top of every run file, so anyone can check
// that the input and the code were the ones in the repository.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BENCH_DIR, REPO_DIR } from "./modules.js";
import type { Scenario, Source } from "./scenario.js";

export interface SourceInfo extends Omit<Source, "role"> {
  role: Source["role"] | "scenario" | "adapter";
  exists: boolean;
  lines: number | null;
  sha256: string | null; // first 12 hex digits of the content hash
  commit: string | null; // last commit that changed the file: "abc1234 2026-11-28 Name"
  changed: boolean; // has changes that are not committed
  url: string | null;
}
export interface Provenance {
  commit: string | null; // HEAD of the repository
  branch: string | null;
  dirty: boolean;
  repo: string | null;
  sources: SourceInfo[];
}

const git = (args: string[]) => {
  const r = spawnSync("git", args, { cwd: REPO_DIR, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

function repoUrl(): string | null {
  const u = git(["remote", "get-url", "origin"]);
  if (!u) return null;
  const m = u.match(/github\.com[:/](.+?)(\.git)?$/);
  return m ? `https://github.com/${m[1]}` : null;
}

/** The files of a scenario: its own sources, its files list, the scenario file and the adapter. */
export function sourcesOf(s: Scenario): { file: string; role: SourceInfo["role"]; note?: string }[] {
  const list: { file: string; role: SourceInfo["role"]; note?: string }[] = [...s.sources];
  for (const f of s.files) list.push({ file: f, role: "code" });
  list.push({ file: relative(REPO_DIR, s.file), role: "scenario" });
  if (!s.run) {
    const a = join(BENCH_DIR, "adapters", s.id);
    for (const f of ["index.ts", ...(existsSync(join(a, "link.ts")) && s.params.part === "link" ? ["link.ts"] : [])]) {
      if (existsSync(join(a, f))) list.push({ file: relative(REPO_DIR, join(a, f)), role: "adapter" });
    }
  }
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.file) ? false : (seen.add(x.file), true)));
}

export function provenance(s: Scenario): Provenance {
  const head = git(["rev-parse", "HEAD"]);
  const repo = repoUrl();
  const status = git(["status", "--porcelain"]) ?? "";
  const changedFiles = new Set(status.split("\n").filter(Boolean).map((l) => l.slice(3)));
  const changedPrefix = [...changedFiles].filter((f) => f.endsWith("/"));
  const sources: SourceInfo[] = sourcesOf(s).map((x) => {
    const p = join(REPO_DIR, x.file);
    const exists = existsSync(p);
    const isDir = exists && statSync(p).isDirectory();
    const body = exists && !isDir ? readFileSync(p) : null;
    const commit = exists ? git(["log", "-1", "--format=%h %as %an", "--", x.file]) || null : null;
    const changed = changedFiles.has(x.file) || changedPrefix.some((d) => x.file.startsWith(d));
    return {
      ...x,
      exists,
      lines: body ? body.toString("utf8").split("\n").length : null,
      sha256: body ? createHash("sha256").update(body).digest("hex").slice(0, 12) : isDir ? git(["rev-parse", "--short=12", `HEAD:${x.file.replace(/\/$/, "")}`]) : null,
      commit,
      changed,
      url: exists && repo && head && commit && !changed ? `${repo}/${isDir ? "tree" : "blob"}/${head}/${x.file.split("/").map(encodeURIComponent).join("/")}` : null,
    };
  });
  return { commit: head ? head.slice(0, 7) : null, branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: status.length > 0, repo, sources };
}
