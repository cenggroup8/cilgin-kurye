// Builds the phone page into dist/ (M4-3 skeleton). M2 serves these files in the real game.
//   npm run build
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { BUILD_OPTIONS, ROOT } from "./esbuild-options.ts";

const out = join(ROOT, "dist");
await mkdir(out, { recursive: true });
await build({ ...BUILD_OPTIONS, outdir: out, minify: true, sourcemap: true });
await copyFile(join(ROOT, "index.html"), join(out, "index.html"));
console.log(`Built the phone page into ${out}`);
