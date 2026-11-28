// Board link, server side (M2-4). Protocol: contracts/board_protocol.md.
//
// One TCP channel (config, vibrate, earthquake events, status, answers) and one
// UDP stream (board state, delay probes and replies, sensor samples) to the
// LED board. TCP and UDP use the same port number.
//
// Every message in and out goes through the network emulator queues of the
// board, so the admin can add delay, jitter and loss. Only UDP messages may be lost.

import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";
import { createServer, type Server, type Socket } from "node:net";
import { type BoardMsg, Deframer, MAX_FRAME, type MsgType, PROTOCOL_VERSION, decode, encode, frame } from "./codec.js";
import { SeqTracker } from "./seq.js";
import { NetemQueue, NetemSettings } from "../netem/netem.js";
import { type WorldBoardState, WORLD_SIZE_M, toBoardState } from "./worldState.js";
import { type VibrateCommand, checkConfig, checkVibrate } from "./checks.js";

/** Earthquake event for M1 (board_protocol.md, `Q`). */
export interface QuakeEvent {
  id: number;
  src: "hit" | "motor";
  mag: number;
  zone: number;
  conf: number;
  u: number;
  v: number;
  peak_g: number;
}

export interface BoardEvents {
  /** To M1: a hand hit or the motors shook the board. Each event comes once. */
  quake?(e: QuakeEvent): void;
  /** To the admin: sensor samples for the seismic graph. */
  sensor?(e: { hz: number; a: number[] }): void;
  /** To the admin: the status report of the board, once per second. */
  status?(e: Record<string, unknown>): void;
  /** The board came or went. */
  link?(connected: boolean): void;
}

export interface BoardLinkOptions {
  /** TCP and UDP port. 0 picks a free one (tests). */
  port?: number;
  host?: string;
  /** Session number; a new random one when left out. */
  sid?: number;
  /** Board states per second (admin parameter `board.state_hz`, 10–30). */
  stateHz?: number;
  probeHz?: number;
  /** No status and no delay reply for this long: the board is lost. */
  lostAfterMs?: number;
  /** A message with `ack` is sent again when no answer comes in this time. */
  resendMs?: number;
  netem?: NetemSettings;
  random?: () => number;
  events?: BoardEvents;
  /** Side of the city in metres, for `setWorldState` (city_plan.json `world.size_m`). */
  worldSizeM?: number;
}

export interface BoardMetrics {
  connected: boolean;
  /** Round trip time of the last delay probe. */
  delayMs: number | null;
  /** Real loss on the UDP stream from the board, from gaps in the order numbers. */
  lossPct: number;
  statesSent: number;
  badMessages: number;
  resends: number;
}

type Out = { udp: true; bytes: Uint8Array } | { udp: false; bytes: Buffer; sock: Socket };
type In = { bytes: Uint8Array; from: RemoteInfo } | { bytes: Uint8Array; sock: Socket };

interface Pending {
  msg: BoardMsg;
  sentAt: number;
}

const DEFAULTS = { port: 47100, host: "0.0.0.0", stateHz: 30, probeHz: 2, lostAfterMs: 3000, resendMs: 1000 };

export class BoardLink {
  readonly sid: number;
  private readonly opts: typeof DEFAULTS & BoardLinkOptions;
  private readonly events: BoardEvents;
  private readonly t0 = performance.now();

  private tcp?: Server;
  private udp?: UdpSocket;
  private port = 0;
  private sock?: Socket;
  private boardUdp?: { address: string; port: number };
  private connected = false;
  private lastHeard = 0;

  private readonly seqOut = new Map<MsgType, number>();
  private readonly udpIn = new SeqTracker();
  private readonly tcpIn = new SeqTracker();
  private readonly pending = new Map<string, Pending>();

  private state?: Record<string, unknown>;
  private config?: Record<string, unknown>;
  private stateTimer?: NodeJS.Timeout;
  private readonly timers: NodeJS.Timeout[] = [];

  private readonly downTcp: NetemQueue<Out>;
  private readonly downUdp: NetemQueue<Out>;
  private readonly upTcp: NetemQueue<In>;
  private readonly upUdp: NetemQueue<In>;
  private readonly unbind: (() => void)[] = [];

  private delayMs: number | null = null;
  /** What was wrong with the last refused config or vibrate command. */
  lastError: string | null = null;
  private statesSent = 0;
  private badMessages = 0;
  private resends = 0;

  constructor(options: BoardLinkOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.events = options.events ?? {};
    const random = options.random ?? Math.random;
    this.sid = options.sid ?? 1 + Math.floor(random() * 0xfffffffe);

    const send = (o: Out) => this.write(o);
    const recv = (i: In) => this.receive(i);
    this.downTcp = new NetemQueue<Out>(send, { ordered: true, random });
    this.downUdp = new NetemQueue<Out>(send, { ordered: false, random });
    this.upTcp = new NetemQueue<In>(recv, { ordered: true, random });
    this.upUdp = new NetemQueue<In>(recv, { ordered: false, random });
    const netem = options.netem ?? new NetemSettings();
    this.unbind.push(netem.bind("board", { up: this.upTcp, down: this.downTcp }));
    this.unbind.push(netem.bind("board", { up: this.upUdp, down: this.downUdp }));
  }

  /** Opens the TCP and UDP ports. Returns the port number. */
  async start(): Promise<number> {
    for (let tries = 0; ; tries++) {
      try {
        await this.open(this.opts.port);
        break;
      } catch (e) {
        this.closeSockets();
        if (this.opts.port !== 0 || tries >= 5) throw e;
      }
    }
    this.every(this.opts.resendMs / 2, () => this.resendDue());
    this.every(250, () => this.checkLost());
    this.every(1000 / this.opts.probeHz, () => {
      if (this.connected) this.sendUdp(this.make("P", {}));
    });
    this.setStateHz(this.opts.stateHz);
    return this.port;
  }

  /** Newest board state, already in the lists of the `S` message. The link sends it at the board state rate. */
  setState(d: Record<string, unknown>): void {
    this.state = d;
  }

  /**
   * Newest board state from M1 in world coordinates (metres, degrees). It is turned into
   * the `S` lists here (board_protocol.md section 4). A state with an unknown phase or
   * obstacle type is not used: the old state stays and the answer is false.
   */
  setWorldState(w: WorldBoardState): boolean {
    try {
      this.state = toBoardState(w, this.opts.worldSizeM ?? WORLD_SIZE_M);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Config for the board (colours, brightness, power limit). Sent on every Hello and on change.
   * A config the board would throw away (checks.ts) is not sent: the old one stays and the
   * answer is false. `lastError` says what was wrong.
   */
  setConfig(d: Record<string, unknown>): boolean {
    const err = checkConfig(d);
    if (err) {
      this.lastError = `config: ${err}`;
      return false;
    }
    this.config = d;
    if (this.connected) this.sendAcked(this.make("C", d, true));
    return true;
  }

  /** Vibrate command from M1. False when no board is connected or the command is out of range. */
  vibrate(d: VibrateCommand): boolean {
    const err = checkVibrate(d);
    if (err) {
      this.lastError = `vibrate: ${err}`;
      return false;
    }
    if (!this.connected) return false;
    this.sendAcked(this.make("V", d, true));
    return true;
  }

  setStateHz(hz: number): void {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    // Each state has a fixed due time (start + k × period). A plain setInterval of 33 ms
    // runs every ~47 ms on Windows (15.6 ms timer steps), which gave ~21 states per second.
    const period = 1000 / hz;
    let due = performance.now() + period;
    const step = () => {
      const now = performance.now();
      if (now >= due) {
        if (this.connected && this.state) {
          this.statesSent++;
          this.sendUdp(this.make("S", this.state));
        }
        due += period;
        if (now - due > period) due = now + period; // far behind (the computer slept): no burst
      }
      this.stateTimer = setTimeout(step, Math.max(0, due - performance.now()));
    };
    this.stateTimer = setTimeout(step, period);
  }

  /** Admin parameters of the board link that are not queue values. */
  setParam(name: string, value: number): boolean {
    if (name !== "board.state_hz") return false;
    this.setStateHz(value);
    return true;
  }

  metrics(): BoardMetrics {
    return {
      connected: this.connected,
      delayMs: this.delayMs,
      lossPct: this.udpIn.lossPct(),
      statesSent: this.statesSent,
      badMessages: this.badMessages,
      resends: this.resends,
    };
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    for (const u of this.unbind) u();
    this.sock?.destroy();
    this.closeSockets();
  }

  // --- sockets ---------------------------------------------------------------

  private async open(port: number): Promise<void> {
    const tcp = createServer((s) => this.accept(s));
    this.tcp = tcp;
    await new Promise<void>((ok, fail) => {
      tcp.once("error", fail);
      tcp.listen(port, this.opts.host, () => ok());
    });
    this.port = (tcp.address() as { port: number }).port;
    const udp = createSocket({ type: "udp4", reuseAddr: false });
    this.udp = udp;
    udp.on("message", (bytes, from) => this.upUdp.push({ bytes, from }, true));
    udp.on("error", () => undefined);
    await new Promise<void>((ok, fail) => {
      udp.once("error", fail);
      udp.bind(this.port, this.opts.host, () => ok());
    });
  }

  private closeSockets(): void {
    try {
      this.udp?.close();
    } catch {
      // already closed
    }
    this.tcp?.close();
    this.udp = undefined;
    this.tcp = undefined;
  }

  private accept(s: Socket): void {
    // A new connection takes the place of the old one (the board started again).
    if (this.sock) this.drop();
    this.sock = s;
    s.setNoDelay(true); // small messages go at once
    const deframer = new Deframer();
    s.on("data", (chunk: Buffer) => {
      for (const bytes of deframer.push(chunk)) this.upTcp.push({ bytes, sock: s }, false);
      if (deframer.pending > MAX_FRAME + 2) s.destroy();
    });
    s.on("error", () => undefined);
    s.on("close", () => {
      if (this.sock === s) this.drop();
    });
  }

  private drop(): void {
    const s = this.sock;
    this.sock = undefined;
    this.pending.clear();
    s?.destroy();
    if (this.connected) {
      this.connected = false;
      this.events.link?.(false);
    }
  }

  private write(o: Out): void {
    if (o.udp) {
      if (this.udp && this.boardUdp) this.udp.send(o.bytes, this.boardUdp.port, this.boardUdp.address);
    } else if (!o.sock.destroyed) {
      o.sock.write(o.bytes);
    }
  }

  // --- out -------------------------------------------------------------------

  private now(): number {
    return Math.floor(performance.now() - this.t0);
  }

  private make(t: MsgType, d: Record<string, unknown>, ack = false): BoardMsg {
    const seq = (this.seqOut.get(t) ?? 0) + 1;
    this.seqOut.set(t, seq);
    const msg: BoardMsg = { t, v: PROTOCOL_VERSION, sid: this.sid, seq, ts: this.now(), d };
    if (ack) msg.ack = true;
    return msg;
  }

  private sendUdp(msg: BoardMsg): void {
    this.downUdp.push({ udp: true, bytes: encode(msg) }, true);
  }

  private sendTcp(msg: BoardMsg): void {
    if (this.sock) this.downTcp.push({ udp: false, bytes: frame(encode(msg)), sock: this.sock }, false);
  }

  private sendAcked(msg: BoardMsg): void {
    this.pending.set(`${msg.t}:${msg.seq}`, { msg, sentAt: performance.now() });
    this.sendTcp(msg);
  }

  private resendDue(): void {
    const now = performance.now();
    for (const p of this.pending.values()) {
      if (now - p.sentAt >= this.opts.resendMs) {
        p.sentAt = now;
        this.resends++;
        this.sendTcp(p.msg); // same seq: the board answers again but uses it once
      }
    }
  }

  private checkLost(): void {
    if (this.connected && performance.now() - this.lastHeard > this.opts.lostAfterMs) this.drop();
  }

  private every(ms: number, fn: () => void): void {
    this.timers.push(setInterval(fn, ms));
  }

  // --- in --------------------------------------------------------------------

  private receive(i: In): void {
    const r = decode(i.bytes);
    if (!r.ok) {
      this.badMessages++;
      return;
    }
    if ("from" in i) this.onUdp(r.msg, i.from);
    else if (i.sock === this.sock) this.onTcp(r.msg);
  }

  private onUdp(m: BoardMsg, from: RemoteInfo): void {
    switch (m.t) {
      case "H":
        // Search of the board: answer with a delay probe, so it learns our address.
        this.boardUdp = { address: from.address, port: from.port };
        this.sendUdp(this.make("P", {}));
        return;
      case "N":
      case "O": {
        this.boardUdp = { address: from.address, port: from.port };
        if (!this.udpIn.accept(m.t, m.seq)) return; // late UDP packet
        if (m.t === "O") {
          const sent = m.d.ping_ts;
          if (typeof sent === "number") this.delayMs = this.now() - sent;
          this.lastHeard = performance.now();
        } else if (typeof m.d.hz === "number" && Array.isArray(m.d.a)) {
          this.events.sensor?.({ hz: m.d.hz, a: m.d.a as number[] });
        } else {
          this.badMessages++;
        }
        return;
      }
      default:
        this.badMessages++;
    }
  }

  private onTcp(m: BoardMsg): void {
    this.lastHeard = performance.now();
    switch (m.t) {
      case "H":
        // The board starts its numbers again (board_protocol.md section 6).
        this.udpIn.reset();
        this.tcpIn.reset();
        if (!this.connected) {
          this.connected = true;
          this.events.link?.(true);
        }
        if (this.config) this.sendAcked(this.make("C", this.config, true));
        return;
      case "Q": {
        // `A` does not count: it copies the seq of the message it answers.
        if (m.ack) this.sendTcp({ t: "A", v: PROTOCOL_VERSION, sid: this.sid, seq: m.seq, ts: this.now(), d: { of: "Q" } });
        if (!this.tcpIn.accept("Q", m.seq)) return; // sent again: used only once
        const e = quakeEvent(m.d);
        if (e) this.events.quake?.(e);
        else this.badMessages++;
        return;
      }
      case "T":
        this.events.status?.(m.d);
        return;
      case "A":
        this.answered(m);
        return;
      default:
        this.badMessages++;
    }
  }

  private answered(m: BoardMsg): void {
    // `A` copies the seq of the message it answers and names its type in `d.of`
    // (C and V count by themselves, so both can have the same seq). An answer
    // without `of` is still taken: it clears the oldest message with that seq.
    const of = typeof m.d.of === "string" ? m.d.of : undefined;
    for (const key of [...this.pending.keys()]) {
      const [t, seq] = key.split(":");
      if (Number(seq) === m.seq && (of === undefined || of === t)) {
        this.pending.delete(key);
        if (of === undefined) return; // without `d.of`: the oldest one with this seq
      }
    }
  }
}

function quakeEvent(d: Record<string, unknown>): QuakeEvent | undefined {
  const n = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  if (d.src !== "hit" && d.src !== "motor") return undefined;
  if (!n(d.mag, 0, 10) || !Number.isInteger(d.zone) || !n(d.zone, 0, 8) || !n(d.conf, 0, 1)) return undefined;
  if (!n(d.u, 0, 1) || !n(d.v, 0, 1) || !n(d.peak_g, 0, 100) || !Number.isInteger(d.id)) return undefined;
  return d as unknown as QuakeEvent;
}
