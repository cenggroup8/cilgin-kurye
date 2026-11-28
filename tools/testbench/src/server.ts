// The page: npm run bench:ui  →  http://localhost:5173  (PORT=… for another port).
// Listens on this computer only. One run at a time; every open page sees the same run.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { adapterFor, catalog, moduleEntry } from "./catalog.js";
import { BENCH_DIR, MODULES } from "./modules.js";
import { provenance } from "./provenance.js";
import type { Rec } from "./record.js";
import { RUN_DIR, Run, type Result } from "./runner.js";
import type { Scenario } from "./scenario.js";

const PORT = Number(process.env.PORT ?? 5173);
const WEB = join(BENCH_DIR, "web");
const FILES: Record<string, string> = {
  "/vendor/uPlot.js": join(BENCH_DIR, "node_modules", "uplot", "dist", "uPlot.esm.js"),
  "/vendor/uPlot.css": join(BENCH_DIR, "node_modules", "uplot", "dist", "uPlot.min.css"),
};
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = FILES[url.pathname];
  if (!file) {
    const p = normalize(join(WEB, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (p.startsWith(WEB + sep)) file = p;
  }
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
type Msg = Record<string, unknown>;
const send = (ws: WebSocket, m: Msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
const all = (m: Msg) => wss.clients.forEach((ws) => send(ws, m));

// Records go out in small batches (a scenario can send hundreds per second).
let batch: Rec[] = [];
setInterval(() => {
  if (batch.length) all({ op: "recs", recs: batch });
  batch = [];
}, 50);

interface Current {
  run: Run | null;
  replay: NodeJS.Timeout[] | null;
  scenario: Scenario | null;
  head: Msg | null;
  history: Rec[]; // so a page opened later sees the whole run
}
const cur: Current = { run: null, replay: null, scenario: null, head: null, history: [] };

async function listModules(): Promise<Msg[]> {
  return (await catalog()).map(({ adapter, entries, ...m }) => ({
    ...m,
    hasAdapter: adapter !== null,
    scenarios: entries.map((e) => ({ ...e.scenario, file: undefined, state: e.state, why: e.why })),
  }));
}

function listRuns(): string[] {
  if (!existsSync(RUN_DIR)) return [];
  return readdirSync(RUN_DIR).filter((f) => f.endsWith(".ndjson")).sort().reverse();
}

function busy(): boolean {
  return cur.run !== null || cur.replay !== null;
}

function begin(head: Msg, scenario: Scenario | null): void {
  cur.scenario = scenario;
  cur.head = head;
  cur.history = [];
  batch = [];
  all({ op: "started", ...head });
}

function ended(result: Result | Msg): void {
  setTimeout(() => all({ op: "ended", result, runs: listRuns() }), 60); // after the last batch
}

async function start(id: string, name: string): Promise<string | null> {
  if (busy()) return "a run is going on: stop it first";
  const info = MODULES.find((x) => x.id === id);
  if (!info) return `no module ${id}`;
  const m = await moduleEntry(info);
  const e = m.entries.find((x) => x.scenario.name === name);
  if (!e) return `no scenario ${name}`;
  if (e.state !== "ready") return `${m.mod} ${name}: ${e.why}`;
  const s = e.scenario;
  const run = new Run(s, adapterFor(m, s).create(), {
    onRec: (r) => {
      cur.history.push(r);
      batch.push(r);
    },
  });
  cur.run = run;
  begin({ module: s.module, id: s.id, scenario: s.name, title: s.title, seconds: s.untilExit ? null : s.seconds, inputs: s.inputs, expect: s.expect, views: s.views, replay: false, run: s.run, fake: s.fake, result: s.result, provenance: provenance(s) }, s);
  run.result.then((r) => {
    cur.run = null;
    ended(r);
  });
  await run.start();
  return null;
}

function replay(file: string, speed: number): string | null {
  if (busy()) return "a run is going on: stop it first";
  if (!/^[\w.-]+\.ndjson$/.test(file) || !existsSync(join(RUN_DIR, file))) return `no saved run ${file}`;
  const lines = readFileSync(join(RUN_DIR, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Msg);
  const head = lines.find((l) => l.kind === "run") ?? {};
  const result = lines.find((l) => l.kind === "result") ?? { passed: false, checks: [], missing: [], error: "the saved run has no result" };
  const recs = lines.filter((l) => l.kind !== "run" && l.kind !== "result") as unknown as Rec[];
  const id = String(head.module ?? "").toLowerCase();
  begin({ module: head.module, id, scenario: head.scenario, title: head.title, seconds: head.seconds ?? null, inputs: [], expect: head.expect ?? [], views: head.views ?? [], replay: file, run: head.run ?? null, fake: head.fake ?? null, result: head.result ?? null, provenance: head.provenance ?? null, started: head.started ?? null }, null);
  const k = speed > 0 ? 1000 / speed : 0;
  const timers = recs.map((r) =>
    setTimeout(() => {
      cur.history.push(r);
      batch.push(r);
    }, (r.t ?? 0) * k),
  );
  const last = recs.length ? (recs[recs.length - 1].t ?? 0) * k : 0;
  timers.push(
    setTimeout(() => {
      cur.replay = null;
      ended({ ...result, replay: file });
    }, last + 100),
  );
  cur.replay = timers;
  return null;
}

function stop(): void {
  if (cur.run) cur.run.stop();
  else if (cur.replay) {
    cur.replay.forEach(clearTimeout);
    cur.replay = null;
    ended({ passed: false, checks: [], missing: [], error: "replay stopped" });
  }
}

wss.on("connection", async (ws) => {
  send(ws, { op: "modules", modules: await listModules(), runs: listRuns() });
  if (busy() && cur.head) {
    send(ws, { op: "started", ...cur.head });
    send(ws, { op: "recs", recs: cur.history });
  }
  ws.on("message", async (raw) => {
    let m: Msg;
    try {
      m = JSON.parse(String(raw)) as Msg;
    } catch {
      return;
    }
    let err: string | null = null;
    try {
      switch (m.op) {
        case "modules":
          send(ws, { op: "modules", modules: await listModules(), runs: listRuns() });
          break;
        case "about": {
          // What the page shows before a run: the module tables, the scenario and where its data comes from.
          const info = MODULES.find((x) => x.id === String(m.id));
          const me = info && (await moduleEntry(info));
          const e = me?.entries.find((x) => x.scenario.name === String(m.scenario));
          if (!me || !e) err = "no such scenario";
          else send(ws, { op: "about", id: me.id, scenario: e.scenario.name, provenance: provenance(e.scenario) });
          break;
        }
        case "start":
          err = await start(String(m.id), String(m.scenario));
          break;
        case "input":
          if (cur.run) cur.run.input(String(m.name), m.value);
          break;
        case "stop":
          stop();
          break;
        case "replay":
          err = replay(String(m.file), Number(m.speed ?? 1));
          break;
      }
    } catch (e) {
      err = (e as Error).message;
    }
    if (err) send(ws, { op: "error", text: err });
  });
});

http.listen(PORT, "127.0.0.1", () => console.log(`Test bench: http://localhost:${PORT}   (Ctrl-C to stop)`));
process.on("SIGINT", () => {
  stop();
  setTimeout(() => process.exit(0), cur.run ? 2500 : 0);
});
