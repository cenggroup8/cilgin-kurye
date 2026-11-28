// Module demo page: pick M1–M6, read what the module takes and gives, and run its
// fake-data demos and tests from the browser.
//   cd tools/module-demo && npm start      → http://localhost:8099
//
// The server only runs the commands written in modules.json, only on this computer
// (127.0.0.1), and streams their output to the page. Node.js 20 or newer, no packages.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const PORT = Number(process.env.PORT ?? 8099);
const TIMEOUT_MS = 5 * 60 * 1000;

const loadModules = () => JSON.parse(readFileSync(join(here, "modules.json"), "utf8")).modules;

const toolCache = new Map();
function hasTool(tool) {
  if (!toolCache.has(tool)) {
    const r = spawnSync(tool, ["--version"], { shell: true, stdio: "ignore" });
    toolCache.set(tool, r.status === 0);
  }
  return toolCache.get(tool);
}

/** Can this run start here? ready | pr | missing | notool, and the folders that need npm install first. */
function status(run) {
  const needsOk = (run.needs ?? []).every((p) => existsSync(join(root, p)));
  if (!needsOk) return { state: run.pr ? "pr" : "missing" };
  if (run.tool && !hasTool(run.tool)) return { state: "notool" };
  const install = (run.install ?? []).filter((d) => !existsSync(join(root, d, "node_modules")));
  return { state: "ready", install };
}

function withStatus() {
  return loadModules().map((m) => ({ ...m, runs: m.runs.map((r) => ({ ...r, status: status(r) })) }));
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function stream(res, run) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const st = status(run);
  if (st.state !== "ready") {
    send({ t: "end", code: -1, ms: 0, why: st.state });
    return res.end();
  }
  const steps = [
    ...st.install.map((d) => ({
      title: `npm ${existsSync(join(root, d, "package-lock.json")) ? "ci" : "install"} (${d}, ilk çalıştırmada bir kez)`,
      cmd: existsSync(join(root, d, "package-lock.json")) ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund",
      cwd: d,
    })),
    { title: `${run.cwd === "." ? "" : run.cwd + " $ "}${run.cmd}`, cmd: run.cmd, cwd: run.cwd },
  ];
  const t0 = Date.now();
  let child = null;
  let closed = false;
  res.on("close", () => {
    closed = true;
    kill(child);
  });

  const next = (i) => {
    if (closed) return;
    if (i >= steps.length) return;
    const s = steps[i];
    send({ t: "phase", s: s.title });
    // PORT is this page's own setting; demos like M2's read PORT too, so it must not leak into them.
    const env = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" };
    delete env.PORT;
    child = spawn(s.cmd, { cwd: join(root, s.cwd), shell: true, env });
    const timer = setTimeout(() => {
      send({ t: "line", s: "… süre doldu (5 dk), durduruluyor" });
      kill(child);
    }, TIMEOUT_MS);
    let buf = "";
    const onData = (d) => {
      buf += d.toString("utf8").replace(ANSI, "");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) send({ t: "line", s: l });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf) send({ t: "line", s: buf });
      if (code !== 0 || i === steps.length - 1) {
        send({ t: "end", code: code ?? -1, ms: Date.now() - t0 });
        res.end();
      } else next(i + 1);
    });
  };
  next(0);
}

function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(readFileSync(join(here, "index.html")));
  }
  if (url.pathname === "/api/modules") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(withStatus()));
  }
  if (url.pathname === "/api/run") {
    const m = loadModules().find((x) => x.id === url.searchParams.get("m"));
    const run = m?.runs[Number(url.searchParams.get("r"))];
    if (!run) {
      res.writeHead(404);
      return res.end("no such run");
    }
    return stream(res, run);
  }
  res.writeHead(404);
  res.end("not found");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Modül demo sayfası: http://localhost:${PORT}  (durdurmak için Ctrl+C)`);
});
