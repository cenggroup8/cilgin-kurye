import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { GameCode } from "./gameCode.js";
import { joinUrl, qrSvg } from "./joinInfo.js";

/** Where the files that the web server gives out are found. */
export interface StaticPaths {
  /** Folder with phone.html and admin.html. */
  pagesDir: string;
  /** Folder with the 3D models. Served under /models/. */
  modelsDir: string;
  /** The shared city plan file. Served as /city_plan.json. */
  cityPlanFile: string;
}

export interface HttpOptions {
  paths: StaticPaths;
  gameCode: GameCode;
  /** Address of the main computer that goes into the QR code. */
  publicHost: string;
  /** Port that goes into the QR code. Read when a request comes, so port 0 works. */
  publicPort: () => number;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".jpg": "image/jpeg",
};

const require = createRequire(import.meta.url);
const MSGPACK_BROWSER = join(
  resolve(require.resolve("@msgpack/msgpack"), "..", ".."),
  "dist.umd",
  "msgpack.min.js",
);

export function createHttpServer(opts: HttpOptions): Server {
  return createServer((req, res) => {
    handle(opts, req, res).catch(() => send(res, 500, "text/plain", "server error"));
  });
}

async function handle(opts: HttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "text/plain", "method not allowed");
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);
  const { paths, gameCode } = opts;
  const link = () => joinUrl(opts.publicHost, opts.publicPort(), gameCode.value);

  switch (path) {
    case "/":
    case "/index.html":
      return sendFile(res, join(paths.pagesDir, "phone.html"));
    case "/admin":
    case "/admin.html":
      return sendFile(res, join(paths.pagesDir, "admin.html"));
    case "/city_plan.json":
      return sendFile(res, paths.cityPlanFile);
    case "/vendor/msgpack.js":
      return sendFile(res, MSGPACK_BROWSER);
    case "/join":
      return send(res, 200, TYPES[".json"], JSON.stringify({ code: gameCode.value, url: link() }));
    case "/qr.svg":
      return send(res, 200, TYPES[".svg"], await qrSvg(link()));
  }

  if (path.startsWith("/models/")) {
    const file = insideFolder(paths.modelsDir, path.slice("/models/".length));
    if (file) return sendFile(res, file);
  }
  send(res, 404, "text/plain", "not found");
}

/** Gives the full path only if it stays inside the folder (no "../" tricks). */
function insideFolder(folder: string, relative: string): string | null {
  const root = resolve(folder);
  const full = resolve(root, normalize(relative));
  return full.startsWith(root + sep) ? full : null;
}

async function sendFile(res: ServerResponse, file: string): Promise<void> {
  try {
    const body = await readFile(file);
    send(res, 200, TYPES[extname(file)] ?? "application/octet-stream", body);
  } catch {
    send(res, 404, "text/plain", "not found");
  }
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
