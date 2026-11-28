// Rule 1 of the README: a module runs without the other modules.
// An adapter may import only: its own module folder, contracts/, tools/testbench/fakes/,
// tools/testbench/src/ (the bench itself), its own adapter folder, Node and the packages of the bench.
// A fake may import only: contracts/, tools/testbench/src/, other fakes, Node and the packages.
//   npm run check-imports         exit code 1 if an import breaks the rule
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BENCH_DIR, MODULES, REPO_DIR } from "./modules.js";

export interface Problem {
  file: string; // relative to the repository
  line: number;
  spec: string;
  why: string;
}

const CODE = /\.(m?[jt]sx?|cjs)$/;
// import x from "a" · import "a" · export … from "a" · import("a") · require("a")
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules") return [];
    return statSync(p).isDirectory() ? files(p) : CODE.test(f) ? [p] : [];
  });
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);

function packages(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(BENCH_DIR, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
}

/** Checks the imports of one file. `allowed` are folders the file may import from. */
function checkFile(file: string, allowed: string[], pkgs: Set<string>, what: string): Problem[] {
  const out: Problem[] = [];
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // comment lines
    for (const m of line.matchAll(IMPORT)) {
      const spec = m[2];
      const at = { file: relative(REPO_DIR, file), line: i + 1, spec };
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const target = resolve(dirname(file), spec);
        if (!allowed.some((d) => inside(target, d))) {
          const mod = MODULES.find((x) => inside(target, join(REPO_DIR, x.folder)));
          out.push({ ...at, why: mod ? `${what} may not use ${mod.mod} (${mod.folder})` : `${what} may not import ${relative(REPO_DIR, target)}` });
        }
      } else {
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        if (spec.startsWith("node:") || builtinModules.includes(name)) continue;
        if (!pkgs.has(name)) out.push({ ...at, why: `package ${name} is not in tools/testbench/package.json` });
      }
    }
  });
  return out;
}

export function checkImports(): Problem[] {
  const pkgs = packages();
  const src = join(BENCH_DIR, "src");
  const fakes = join(BENCH_DIR, "fakes");
  const contracts = join(REPO_DIR, "contracts");
  const problems: Problem[] = [];

  const adapters = join(BENCH_DIR, "adapters");
  const known = new Set(MODULES.map((m) => m.id));
  for (const d of existsSync(adapters) ? readdirSync(adapters) : []) {
    const dir = join(adapters, d);
    if (!statSync(dir).isDirectory()) continue;
    if (!known.has(d)) {
      problems.push({ file: relative(REPO_DIR, dir), line: 0, spec: "", why: `adapter folder must be one of ${[...known].join(", ")}` });
      continue;
    }
    const own = join(REPO_DIR, MODULES.find((m) => m.id === d)!.folder);
    for (const f of files(dir)) problems.push(...checkFile(f, [dir, own, contracts, fakes, src], pkgs, `adapter ${d}`));
  }
  for (const f of files(fakes)) problems.push(...checkFile(f, [fakes, contracts, src], pkgs, "a fake"));
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const p = checkImports();
  for (const x of p) console.log(`✘ ${x.file}:${x.line}  ${x.spec}  — ${x.why}`);
  console.log(p.length ? `${p.length} import(s) break the rule (README, rule 1)` : "✔ every adapter uses only its own module, contracts/ and the fakes");
  process.exit(p.length ? 1 : 0);
}
