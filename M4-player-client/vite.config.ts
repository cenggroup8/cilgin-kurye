import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const m3 = resolve(process.env.M3_DIR ?? "../M3-physics-traffic");
const cityPlan = resolve(process.env.CITY_PLAN ?? "../contracts/city_plan.json");

function servePlan(): Plugin {
  return {
    name: "city-plan",
    configureServer(server) {
      server.middlewares.use("/city_plan.json", (_req, res) => {
        try {
          res.setHeader("content-type", "application/json");
          res.end(readFileSync(cityPlan));
        } catch {
          res.statusCode = 404;
          res.end(`city plan not found at ${cityPlan}`);
        }
      });
    },
  };
}

export default defineConfig({
  root: "dev",
  publicDir: resolve("assets"),
  plugins: [servePlan()],
  build: { target: "es2022" },
  resolve: { alias: { "@m3": m3 } },
  server: { fs: { allow: [resolve("."), m3] } },
});
