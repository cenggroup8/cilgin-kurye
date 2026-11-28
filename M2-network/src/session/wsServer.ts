import type { Server } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { Codec } from "../codec/codec.js";
import { PHONE_IN, checkFields } from "../codec/schema.js";
import type { SessionRegistry } from "./registry.js";
import type { Session } from "./types.js";

/**
 * Accepts WebSocket links and keeps the session record (M2-1).
 *
 *   /ws        phones: the first message must be a hello
 *   /ws/admin  admin page: a new link takes the place of the old one
 *
 * Message shapes: contracts/messages.md (M2-2). Every message first goes through
 * `admit` (M2-2 limits, on the raw bytes), then it is decoded with the M2-2 codec.
 * Messages after the hello and the join go to onMessage, where the M2-2 checker takes over.
 */
export const CLOSE = {
  adminReplaced: 4001,
  playerReplaced: 4002,
  rejected: 4003,
} as const;

export interface WsOptions {
  registry: SessionRegistry;
  onMessage?: (session: Session, msg: unknown, bytes: number) => void;
  /**
   * M2-2 limits: called with the size of every message before it is decoded, also the
   * hello. False drops the message (the limiter answers the link itself).
   */
  admit?: (session: Session, bytes: number) => boolean;
  /** M2-2 codec. Default: MessagePack only. With `readable` a link may also speak JSON text. */
  codec?: Codec;
}

export interface WsHandle {
  send(connId: number, msg: unknown): void;
  /** Bytes that are already encoded, so one state is encoded once for all phones (M2-3). */
  sendRaw(connId: number, bytes: Uint8Array): void;
  /** Bytes queued on this link and not sent yet (0 for an unknown link). M2-3 skips a slow phone with it. */
  buffered(connId: number): number;
  close(): void;
}

export function attachWebSockets(http: Server, opts: WsOptions): WsHandle {
  const { registry } = opts;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const links = new Map<number, WebSocket>();
  const codec = opts.codec ?? new Codec();
  /** Links that sent JSON text (readable form) get their answers as JSON text too. */
  const jsonLinks = new Set<number>();
  let nextId = 1;

  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const role = path === "/ws" ? "player" : path === "/ws/admin" ? "admin" : null;
    if (!role) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, role));
  });

  function send(connId: number, msg: unknown): void {
    const ws = links.get(connId);
    if (ws && ws.readyState === ws.OPEN) ws.send(codec.encode(msg, jsonLinks.has(connId) ? "json" : "msgpack"));
  }

  function sendRaw(connId: number, bytes: Uint8Array): void {
    const ws = links.get(connId);
    if (ws && ws.readyState === ws.OPEN) ws.send(bytes);
  }

  function buffered(connId: number): number {
    return links.get(connId)?.bufferedAmount ?? 0;
  }

  function drop(connId: number, code: number, reason: string): void {
    const ws = links.get(connId);
    links.delete(connId);
    jsonLinks.delete(connId);
    ws?.close(code, reason);
  }

  function accept(ws: WebSocket, role: "player" | "admin"): void {
    const connId = nextId++;
    links.set(connId, ws);
    // A message over maxPayload or a broken frame makes ws emit "error" and then close the
    // link itself (1009, 1002). Without a listener Node throws the error and the whole server
    // stops, so one bad phone could end the game for everybody.
    ws.on("error", () => {});
    const { replacedAdmin } = registry.open(connId, role);
    if (replacedAdmin !== undefined) drop(replacedAdmin, CLOSE.adminReplaced, "replaced by a new admin login");

    ws.on("message", (data: RawData, isBinary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      const bytes = buf.length;
      const session = registry.get(connId);
      if (!session) return;
      // M2-2: too big or too many messages are dropped before they are decoded.
      if (opts.admit && !opts.admit(session, bytes)) return;
      const d = codec.decode(buf, !isBinary);
      if (!d.ok) {
        send(connId, { t: "error", reason: "bad_message" });
        return;
      }
      if (d.format === "json") jsonLinks.add(connId);
      const msg = d.msg;
      session.msgsIn++;
      session.bytesIn += bytes;

      if (role === "player" && session.playerKey === undefined) return onHello(connId, msg);
      if (role === "player" && isType(msg, "join")) {
        // M2-2: the team must be 0–3 (contract); which team is free is M1's decision.
        if (checkFields(msg as Record<string, unknown>, PHONE_IN.join!.fields) || !registry.join(connId, (msg as { team?: unknown }).team)) {
          send(connId, { t: "error", reason: "bad_join" });
        }
        return;
      }
      opts.onMessage?.(session, msg, bytes);
    });

    ws.on("close", () => {
      if (links.get(connId) === ws) {
        links.delete(connId);
        jsonLinks.delete(connId);
      }
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
    buffered,
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
