import type { Server } from "node:http";
import { decode, encode } from "@msgpack/msgpack";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { SessionRegistry } from "./registry.js";
import type { Session } from "./types.js";

/**
 * Accepts WebSocket links and keeps the session record (M2-1).
 *
 *   /ws        phones: the first message must be a hello
 *   /ws/admin  admin page: a new link takes the place of the old one
 *
 * Message shapes here are a draft until M2-2 writes the phone and admin
 * messages into contracts/. Messages after the hello go to onMessage,
 * where M2-2's codec and checker take over.
 */
export const CLOSE = {
  adminReplaced: 4001,
  playerReplaced: 4002,
  rejected: 4003,
} as const;

export interface WsOptions {
  registry: SessionRegistry;
  onMessage?: (session: Session, msg: unknown, bytes: number) => void;
}

export interface WsHandle {
  send(connId: number, msg: unknown): void;
  /** Bytes that are already encoded, so one state is encoded once for all phones (M2-3). */
  sendRaw(connId: number, bytes: Uint8Array): void;
  close(): void;
}

export function attachWebSockets(http: Server, opts: WsOptions): WsHandle {
  const { registry } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const links = new Map<number, WebSocket>();
  let nextId = 1;

  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const role = path === "/ws" ? "player" : path === "/ws/admin" ? "admin" : null;
    if (!role) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, role));
  });

  function send(connId: number, msg: unknown): void {
    const ws = links.get(connId);
    if (ws && ws.readyState === ws.OPEN) ws.send(encode(msg));
  }

  function sendRaw(connId: number, bytes: Uint8Array): void {
    const ws = links.get(connId);
    if (ws && ws.readyState === ws.OPEN) ws.send(bytes);
  }

  function drop(connId: number, code: number, reason: string): void {
    const ws = links.get(connId);
    links.delete(connId);
    ws?.close(code, reason);
  }

  function accept(ws: WebSocket, role: "player" | "admin"): void {
    const connId = nextId++;
    links.set(connId, ws);
    const { replacedAdmin } = registry.open(connId, role);
    if (replacedAdmin !== undefined) drop(replacedAdmin, CLOSE.adminReplaced, "replaced by a new admin login");

    ws.on("message", (data: RawData) => {
      const bytes = Buffer.isBuffer(data) ? data.length : Buffer.concat(data as Buffer[]).length;
      let msg: unknown;
      try {
        msg = decode(data as Buffer);
      } catch {
        send(connId, { t: "error", reason: "bad_message" });
        return;
      }
      const session = registry.get(connId);
      if (!session) return;
      session.msgsIn++;
      session.bytesIn += bytes;

      if (role === "player" && session.playerKey === undefined) return onHello(connId, msg);
      if (role === "player" && isType(msg, "join")) {
        if (!registry.join(connId, (msg as { team?: unknown }).team)) {
          send(connId, { t: "error", reason: "bad_join" });
        }
        return;
      }
      opts.onMessage?.(session, msg, bytes);
    });

    ws.on("close", () => {
      if (links.get(connId) === ws) links.delete(connId);
      registry.close(connId);
    });
  }

  function onHello(connId: number, msg: unknown): void {
    if (!isType(msg, "hello")) {
      send(connId, { t: "error", reason: "bad_hello" });
      return drop(connId, CLOSE.rejected, "bad_hello");
    }
    const m = msg as { key?: unknown; name?: unknown; code?: unknown };
    const r = registry.hello(connId, { playerKey: m.key, name: m.name, code: m.code });
    if (!r.ok) {
      send(connId, { t: "error", reason: r.reason });
      return drop(connId, CLOSE.rejected, r.reason);
    }
    if (r.replacedConnId !== undefined) drop(r.replacedConnId, CLOSE.playerReplaced, "same player opened elsewhere");
    send(connId, { t: "welcome", player: r.playerNo, returning: r.returning });
  }

  return {
    send,
    sendRaw,
    close() {
      for (const ws of links.values()) ws.terminate();
      links.clear();
      wss.close();
    },
  };
}

function isType(msg: unknown, t: string): boolean {
  return typeof msg === "object" && msg !== null && (msg as { t?: unknown }).t === t;
}
