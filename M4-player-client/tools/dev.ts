// Development server for a real phone (M4-3 skeleton, #45).
//
//   npm run dev                                   page on port 5173, server at localhost:8080 (M2)
//   npm run dev -- --server http://localhost:5174  the fake server of M4-2 instead
//   npm run dev -- --port 5000
//   npm run dev -- --fake                         no game server needed: a small server that follows
//                                                 contracts/messages.md answers (game code 123456)
//
// The page is built again on every load, so a change shows after a reload. Everything the
// page does not have itself (the WebSocket `/ws`, `/city_plan.json`, `/models/`) goes on to
// the server, so the phone talks to one address like in the real game.
import { readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { context } from "esbuild";
import { BUILD_OPTIONS, ROOT } from "./esbuild-options.ts";
import { ContractServer } from "../test/net/contract-server.ts";

const { values } = parseArgs({ options: {
  port: { type: "string", default: "5173" },
  server: { type: "string", default: "http://localhost:8080" },
  fake: { type: "boolean", default: false },
} });
const port = Number(values.port);
// --fake: a small server that speaks the contract, for trying the page on a phone alone.
const fake = values.fake ? await ContractServer.start() : null;
const target = new URL(fake ? `http://127.0.0.1:${fake.port}` : values.server!);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("--port must be 1–65535");
const targetPort = Number(target.port || 80);

const ctx = await context({ ...BUILD_OPTIONS, outdir: "out", write: false, sourcemap: "inline" });
let files = new Map<string, { type: string; body: Uint8Array | string }>();
async function rebuild(): Promise<void> {
  const r = await ctx.rebuild();
  const next = new Map<string, { type: string; body: Uint8Array | string }>();
  next.set("/", { type: "text/html; charset=utf-8", body: await readFile(join(ROOT, "index.html"), "utf8") });
  for (const f of r.outputFiles ?? []) {
    const name = "/" + f.path.split(/[\\/]/).pop();
    next.set(name, { type: name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8", body: f.contents });
  }
  files = next;
}
await rebuild();

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0]!;
  try {
    if (path === "/" || path === "/index.html") await rebuild();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(String(err));
    return;
  }
  const file = files.get(path === "/index.html" ? "/" : path);
  if (file) {
    res.writeHead(200, { "Content-Type": file.type, "Cache-Control": "no-store" }).end(file.body);
    return;
  }
  // Anything else comes from the game server.
  const up = request({ host: target.hostname, port: targetPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => res.writeHead(502).end("game server not reachable"));
  req.pipe(up);
});

// WebSocket: the upgrade request and then both directions go through unchanged.
server.on("upgrade", (req, socket, head) => {
  const up = connect(targetPort, target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const end = () => { socket.destroy(); up.destroy(); };
  up.on("error", end);
  socket.on("error", end);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Phone page: http://localhost:${port}  (game server: ${fake ? "the small test server" : target.origin})`);
  if (fake) console.log(`  game code: ${fake.code}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  on a phone in the same Wi-Fi: http://${a.address}:${port}`);
  }
});
