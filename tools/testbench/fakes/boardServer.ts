// A fake server for the LED board, written only from contracts/board_protocol.md
// (no M2 code), so the board program (M6-1) can be tested without M2.
// It speaks the server side: answers the search, takes the TCP channel, sends config,
// board states and delay probes, answers earthquake events, sends vibrate commands.
// It works in board units (u, v from 0 to 1): turning metres into u and v is M2's job.
import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";
import { createServer, type Server, type Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { decode, encode } from "@msgpack/msgpack";

export type Msg = { t: string; v: number; sid?: number; seq: number; ts: number; ack?: boolean; d: Record<string, unknown> };

/** Encoding rule of the protocol: MessagePack, string keys, floats as float32, keys in this order. */
export function pack(m: Msg): Uint8Array {
  const o: Record<string, unknown> = { t: m.t, v: m.v };
  if (m.sid !== undefined) o.sid = m.sid;
  o.seq = m.seq;
  o.ts = m.ts;
  if (m.ack) o.ack = true;
  o.d = m.d;
  return encode(o, { forceFloat32: true });
}
export function unpack(b: Uint8Array): Msg | null {
  try {
    const m = decode(b) as Msg;
    return m && typeof m === "object" && typeof m.t === "string" && m.v === 1 ? m : null;
  } catch {
    return null;
  }
}
/** TCP frame: 2 bytes length, high byte first, then the message. */
export function frame(body: Uint8Array): Buffer {
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  out.set(body, 2);
  return out;
}

export interface Player { no: number; team: number; tone: number; flags: number; u: number; v: number; heading: number; speed: number }
export interface World {
  ph: number; // 0 lobby, 1 countdown, 2 game, 3 pause, 4 end
  tl: number;
  players: Player[];
  dp: [number, number, number, number][];
  ob: [number, number, number][];
  eq: [number, number, number, number, number] | [];
}
export interface Vibrate { mask: number; duty: number; ms: number; ramp_ms: number }
export interface QuakeIn { id: number; src: string; mag: number; zone: number; conf: number; peak_g: number; u: number; v: number }

export interface FakeBoardServerOptions {
  port?: number; // 0: a free port (TCP and UDP use the same number)
  stateHz?: number;
  probeHz?: number;
  lossPct?: number; // board states that are not sent (UDP loss)
  config?: Record<string, unknown>;
  world?: (seconds: number) => World;
  on?: {
    link?(up: boolean): void;
    quake?(q: QuakeIn, again: boolean): void;
    status?(d: Record<string, unknown>): void;
    rtt?(ms: number): void;
    answer?(of: string, seq: number): void;
    bad?(why: string): void;
  };
}

const DEFAULT_CONFIG = {
  plan: "0.3.0",
  bright: 0.5,
  max_ma: 2000,
  tones: [[80, 160, 255], [0, 60, 220], [90, 255, 90], [0, 150, 40], [200, 110, 255], [110, 0, 200], [255, 230, 80], [210, 140, 0]],
  anim: { tail: 2, dp_blink_hz: 1.5 },
};
const RESEND_MS = 1000;
const LOST_MS = 3000;

export class FakeBoardServer {
  port = 0;
  sid = 1 + Math.floor(Math.random() * 0xfffffffe);
  stateHz: number;
  lossPct: number;
  readonly stats = { statesSent: 0, statesDropped: 0, quakes: 0, quakeRepeats: 0, bad: 0, connects: 0, lastRtt: null as number | null };

  private tcp?: Server;
  private udp?: UdpSocket;
  private conn: Socket | null = null;
  private boardUdp: RemoteInfo | null = null;
  private rx = Buffer.alloc(0);
  private seq: Record<string, number> = {};
  private quakeSeen = new Set<number>();
  private pending = new Map<string, { msg: Msg; at: number }>();
  private timers: NodeJS.Timeout[] = [];
  private stateTimer: NodeJS.Timeout | null = null;
  private lastIn = 0;
  private connected = false;
  private t0 = performance.now();

  constructor(private o: FakeBoardServerOptions = {}) {
    this.stateHz = o.stateHz ?? 30;
    this.lossPct = o.lossPct ?? 0;
  }

  private now(): number {
    return Math.round(performance.now() - this.t0);
  }
  private next(t: string): number {
    return (this.seq[t] = (this.seq[t] ?? 0) + 1);
  }
  private msg(t: string, d: Record<string, unknown>, ack = false): Msg {
    return { t, v: 1, sid: this.sid, seq: this.next(t), ts: this.now(), ack, d };
  }

  async start(): Promise<number> {
    for (let tries = 0; ; tries++) {
      try {
        await this.bind(tries === 0 ? (this.o.port ?? 0) : 0);
        break;
      } catch (e) {
        await this.unbind();
        if (tries >= 5) throw e;
      }
    }
    const probeMs = 1000 / (this.o.probeHz ?? 2);
    this.timers.push(setInterval(() => this.probe(), probeMs));
    this.timers.push(setInterval(() => this.resend(), 200));
    this.setStateHz(this.stateHz);
    return this.port;
  }

  private async bind(port: number): Promise<void> {
    this.tcp = createServer((s) => this.accept(s));
    await new Promise<void>((ok, no) => {
      this.tcp!.once("error", no);
      this.tcp!.listen(port, "127.0.0.1", () => ok());
    });
    this.port = (this.tcp.address() as { port: number }).port;
    this.udp = createSocket("udp4");
    this.udp.on("message", (b, r) => this.onUdp(b, r));
    await new Promise<void>((ok, no) => {
      this.udp!.once("error", no);
      this.udp!.bind(this.port, "127.0.0.1", () => ok());
    });
  }

  private async unbind(): Promise<void> {
    await new Promise<void>((ok) => (this.tcp ? this.tcp.close(() => ok()) : ok()));
    await new Promise<void>((ok) => {
      try {
        this.udp ? this.udp.close(() => ok()) : ok();
      } catch {
        ok();
      }
    });
    this.tcp = undefined;
    this.udp = undefined;
  }

  setStateHz(hz: number): void {
    this.stateHz = Math.max(1, Math.min(60, hz));
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = setInterval(() => this.sendState(), 1000 / this.stateHz);
  }

  /** A server restart as the board sees it: TCP closes, new session number, order numbers from 1. */
  restart(): void {
    this.conn?.destroy();
    this.conn = null;
    this.pending.clear();
    this.sid = 1 + Math.floor(Math.random() * 0xfffffffe);
    this.seq = {};
    this.quakeSeen.clear();
    this.setLink(false);
  }

  vibrate(v: Vibrate): boolean {
    return this.sendTcp(this.msg("V", { mask: v.mask, duty: v.duty, ms: v.ms, ramp_ms: v.ramp_ms }, true));
  }

  config(c: Record<string, unknown>): boolean {
    this.o.config = { ...(this.o.config ?? DEFAULT_CONFIG), ...c };
    return this.sendTcp(this.msg("C", this.o.config, true));
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private setLink(up: boolean): void {
    if (up === this.connected) return;
    this.connected = up;
    if (up) this.stats.connects++;
    this.o.on?.link?.(up);
  }

  private bad(why: string): void {
    this.stats.bad++;
    this.o.on?.bad?.(why);
  }

  // --- UDP: search answer, board state, probes, delay replies, sensor samples ---

  private onUdp(b: Buffer, r: RemoteInfo): void {
    const m = unpack(b);
    if (!m) return this.bad("UDP message does not decode");
    this.lastIn = performance.now();
    if (m.t === "H") {
      // The search (or the backup address): answer with a delay probe to the board.
      this.boardUdp = r;
      this.sendUdp(this.msg("P", {}));
    } else if (m.t === "O") {
      const rtt = this.now() - Number(m.d.ping_ts);
      this.stats.lastRtt = rtt;
      this.o.on?.rtt?.(rtt);
    } else if (m.t !== "N") this.bad(`unexpected ${m.t} on UDP`);
  }

  private sendUdp(m: Msg): void {
    if (!this.udp || !this.boardUdp) return;
    this.udp.send(pack(m), this.boardUdp.port, this.boardUdp.address);
  }

  private probe(): void {
    if (this.conn) this.sendUdp(this.msg("P", {}));
    if (this.connected && performance.now() - this.lastIn > LOST_MS) this.setLink(false);
  }

  private sendState(): void {
    if (!this.conn || !this.boardUdp) return;
    const w = (this.o.world ?? idleWorld)(this.now() / 1000);
    const m = this.msg("S", {
      ph: w.ph,
      tl: Math.max(0, Math.round(w.tl)),
      p: w.players.map((p) => [p.no, p.team, p.tone, p.flags, p.u, p.v, Math.round(p.heading) % 360, p.speed]),
      dp: w.dp,
      ob: w.ob,
      eq: w.eq,
    });
    if (Math.random() * 100 < this.lossPct) {
      this.stats.statesDropped++; // lost on the way: the seq is used, so the board sees a gap
      return;
    }
    this.stats.statesSent++;
    this.sendUdp(m);
  }

  // --- TCP: hello, config, vibrate, earthquake events, status, answers ---

  private accept(s: Socket): void {
    if (this.conn) this.conn.destroy(); // one board
    this.conn = s;
    this.rx = Buffer.alloc(0);
    s.setNoDelay(true);
    s.on("data", (d: Buffer) => {
      this.rx = Buffer.concat([this.rx, d]);
      while (this.rx.length >= 2) {
        const n = this.rx.readUInt16BE(0);
        if (this.rx.length < 2 + n) break;
        const body = this.rx.subarray(2, 2 + n);
        this.rx = this.rx.subarray(2 + n);
        this.onTcp(body);
      }
    });
    const gone = () => {
      if (this.conn === s) {
        this.conn = null;
        this.setLink(false);
      }
    };
    s.on("close", gone);
    s.on("error", gone);
  }

  private onTcp(b: Uint8Array): void {
    const m = unpack(b);
    if (!m) return this.bad("TCP message does not decode");
    this.lastIn = performance.now();
    switch (m.t) {
      case "H":
        this.setLink(true);
        this.pending.clear();
        this.sendTcp(this.msg("C", this.o.config ?? DEFAULT_CONFIG, true));
        break;
      case "Q": {
        // Answer every copy (same seq), use it once.
        this.sendTcp({ t: "A", v: 1, sid: this.sid, seq: m.seq, ts: this.now(), d: { of: "Q" } });
        const again = this.quakeSeen.has(m.seq);
        this.quakeSeen.add(m.seq);
        if (again) this.stats.quakeRepeats++;
        else this.stats.quakes++;
        this.o.on?.quake?.(m.d as unknown as QuakeIn, again);
        break;
      }
      case "T":
        this.o.on?.status?.(m.d);
        break;
      case "A": {
        const of = String(m.d.of ?? "");
        this.pending.delete(`${of}:${m.seq}`);
        this.o.on?.answer?.(of, m.seq);
        break;
      }
      default:
        this.bad(`unexpected ${m.t} on TCP`);
    }
  }

  private sendTcp(m: Msg): boolean {
    if (!this.conn || this.conn.destroyed) return false;
    if (m.ack) this.pending.set(`${m.t}:${m.seq}`, { msg: m, at: performance.now() });
    this.conn.write(frame(pack(m)));
    return true;
  }

  private resend(): void {
    if (!this.conn) return;
    const now = performance.now();
    for (const p of this.pending.values()) {
      if (now - p.at >= RESEND_MS) {
        p.at = now;
        this.conn.write(frame(pack(p.msg))); // same seq: the board uses it once
      }
    }
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.conn?.destroy();
    await this.unbind();
  }
}

function idleWorld(): World {
  return { ph: 0, tl: 0, players: [], dp: [], ob: [], eq: [] };
}
