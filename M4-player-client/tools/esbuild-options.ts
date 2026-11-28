// The same esbuild settings for `npm run dev` and `npm run build` (K14 in #22: M4 and M5 use esbuild).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BUILD_OPTIONS: BuildOptions = {
  entryPoints: { main: join(ROOT, "src", "main.ts") },
  bundle: true,
  format: "esm",
  // Phones from about 2020 (iOS 14, Chrome 87) understand ES2020.
  target: "es2020",
  logLevel: "warning",
};
