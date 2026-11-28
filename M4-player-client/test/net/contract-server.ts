// A small server for the M4-3 tests (and `npm run dev -- --fake`) that speaks the phone messages of contracts/messages.md
// like M2 does (hello, player key, close codes 4002 and 4003, join, state, ping, net).
// It can also misbehave on purpose: broken messages, a dropped link, a silent link, a restart.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decode, encode } from "@msgpack/msgpack";
import { WebSocketServer, type WebSocket } from "ws";

export interface Received { player: number; msg: Record<string, unknown> }

const COLORS = ["blue", "green", "purple", "yellow"];

interface Slot { key: string; player: number; link: WebSocket | null; team?: number }

export class ContractServer {
  readonly received: Received[] = [];
  code = "123456";
  port = 0;
  /** When false the server sends nothing (a link that looks alive but is dead). */
  talking = true;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private slots = new Map<string, Slot>();
  private links = new Map<WebSocket, Slot | null>();
  private tick = 0;
  /** Last control number of each player, given back in the state like M1 does. */
  private readonly lastControl = new Map<number, number>();
  private timers: ReturnType<typeof setInterval>[] = [];

  static async start(port = 0): Promise<ContractServer> {
    const s = new ContractServer();
    await s.listen(port);
    return s;
  }

  async listen(port = this.port): Promise<void> {
    this.http = createServer((_req, res) => res.writeHead(404).end());
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (ws) => this.accept(ws));
    await new Promise<void>((ok) => this.http!.listen(port, "127.0.0.1", () => ok()));
    this.port = (this.http.address() as AddressInfo).port;
    // Fixed step like M1: the timer only wakes the loop, and the loop sends as many states as the
    // clock asks for. On Windows a timer of 33 ms often runs every 47 ms (15.6 ms steps), which
    // gave about 23 states per second on a real phone.
    const start = performance.now();
    let sent = 0;
    this.timers.push(setInterval(() => {
      const due = Math.floor(((performance.now() - start) * 30) / 1000);
      while (sent < due) {
        sent++;
        this.broadcastState();
      }
    }, 5));
    this.timers.push(setInterval(() => this.pingAll(), 500));
  }

  /** Stops like a crashed server: all links close, all places are forgotten. */
  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    for (const ws of this.links.keys()) ws.terminate();
    this.links.clear();
    this.slots.clear();
    await new Promise<void>((ok) => this.wss!.close(() => ok()));
    await new Promise<void>((ok) => this.http!.close(() => ok()));
    this.http?.closeAllConnections();
  }

  /** Between tests: forgets every place (M2 has only 8) and every message. */
  reset(): void {
    for (const ws of this.links.keys()) ws.terminate();
    this.links.clear();
    this.slots.clear();
    this.lastControl.clear();
    this.received.length = 0;
    this.talking = true;
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}/ws`;
  }

  /** Links of a player key that are open now. */
  linksOf(key: string): number {
    return [...this.links.entries()].filter(([, s]) => s?.key === key).length;
  }

  /** Closes the link of a key from the server side, like a Wi-Fi that drops. */
  drop(key: string): void {
    for (const [ws, s] of this.links) if (s?.key === key) ws.terminate();
  }

  sendTo(key: string, data: Uint8Array | string): void {
    for (const [ws, s] of this.links) if (s?.key === key) ws.send(data);
  }

  messages(t: string): Received[] {
    return this.received.filter((r) => r.msg.t === t);
  }

  private accept(ws: WebSocket): void {
    this.links.set(ws, null);
    ws.on("close", () => {
      const s = this.links.get(ws);
      this.links.delete(ws);
      if (s && s.link === ws) s.link = null;
    });
    ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = decode(data as Buffer) as Record<string, unknown>;
      } catch {
        return this.send(ws, { t: "error", reason: "bad_message" });
      }
      const slot = this.links.get(ws);
      if (!slot) return this.hello(ws, msg);
      this.received.push({ player: slot.player, msg });
      if (msg.t === "control" && typeof msg.seq === "number") this.lastControl.set(slot.player, msg.seq);
      if (msg.t === "join") {
        const team = msg.team as number;
        slot.team = team;
        this.send(ws, { t: "joined", player: slot.player, team, color: COLORS[team] });
      }
    });
  }

  private hello(ws: WebSocket, msg: Record<string, unknown>): void {
    const key = msg.key;
    if (msg.t !== "hello" || typeof key !== "string") {
      this.send(ws, { t: "error", reason: "bad_hello" });
      return void ws.close(4003, "bad_hello");
    }
    const known = this.slots.get(key);
    if (!known && msg.code !== this.code) {
      this.send(ws, { t: "error", reason: "bad_code" });
      return void ws.close(4003, "bad_code");
    }
    if (!known && this.slots.size >= 8) {
      this.send(ws, { t: "error", reason: "full" });
      return void ws.close(4003, "full");
    }
    const slot = known ?? { key, player: this.slots.size, link: null };
    const returning = known !== undefined && known.link === null;
    if (slot.link) slot.link.close(4002, "same player opened elsewhere");
    slot.link = ws;
    this.slots.set(key, slot);
    this.links.set(ws, slot);
    this.received.push({ player: slot.player, msg });
    this.send(ws, { t: "welcome", player: slot.player, returning });
    // Like M2-1 (#94): a returning player with a team hears it again right after the welcome.
    if (slot.team !== undefined) this.send(ws, { t: "joined", player: slot.player, team: slot.team, color: COLORS[slot.team] });
  }

  private broadcastState(): void {
    this.tick++;
    if (!this.talking) return;
    const players = [...this.slots.values()].map((sl) => ({ index: sl.player, connected: sl.link !== null, control: { seq: this.lastControl.get(sl.player) ?? 0 } }));
    const bytes = encode({ t: "state", seq: this.tick, s: { phase: "playing", players } });
    for (const [ws, s] of this.links) if (s && ws.readyState === ws.OPEN) ws.send(bytes);
  }

  private pingAll(): void {
    if (!this.talking) return;
    for (const [ws, s] of this.links) if (s) this.send(ws, { t: "ping", id: this.tick + 1, st: Date.now() });
  }

  private send(ws: WebSocket, m: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(encode(m));
  }
}

export async function waitFor<T>(get: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined && v !== false) return v as T;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((ok) => setTimeout(ok, 20));
  }
}
