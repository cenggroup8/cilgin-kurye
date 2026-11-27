import { resolve } from "node:path";
import { defineConfig } from "vite";

const m3 = resolve(process.env.M3_DIR ?? "../M3-physics-traffic");

export default defineConfig({
  root: "dev",
  resolve: { alias: { "@m3": m3 } },
  server: { fs: { allow: [resolve("."), m3] } },
});
