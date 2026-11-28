// Board emulator: plays the LED board on the PC for the M2-4 tests.
// It follows the board side of contracts/board_protocol.md:
// search with Hello on UDP, TCP with a length in front, answers to `ack`,
// drop of late UDP packets, a new session number starts the order numbers again,
// and "searching" again when no board state comes for a short time.

import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { connect, type Socket } from "node:net";
import { type BoardMsg, Deframer, type MsgType, PROTOCOL_VERSION, decode, encode, frame } from "../../src/board/codec.js";

export interface BoardEmuOptions {
  /** Address of the server (the backup address; tests have no broadcast). */
  host: string;
  port: number;
  sensorHz?: number;
  statusHz?: number;
  /** No board state for this long: back to searching (board_protocol.md section 8). */
  searchAfterMs?: number;
  /** Do not answer the first N vibrate commands (to test sending again). */
  ignoreVibrate?: number;
  /** Do not answer the first N configs. */
  ignoreConfig?: number;
}

export class BoardEmu {
  // what the tests look at
  states: BoardMsg[] = [];
  oldStatesDropped = 0;
  configs: BoardMsg[] = [];
  vibrates: BoardMsg[] = [];
  vibrateRepeats = 0;
  sidChanges = 0;
  quakesAnswered = new Set<number>();
  connects = 0;

  private readonly o: Required<BoardEmuOptions>;
  private readonly t0 = performance.now();
  private udp?: UdpSocket;
  private sock?: Socket;
  private serverAddr?: string;
  private sid?: number;
  private readonly lastIn = new Map<string, number>();
  private readonly seqOut = new Map<MsgType, number>();
  private readonly pendingQuakes = new Map<number, BoardMsg>();
  private lastStateAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private ignoreLeft: number;
  private ignoreConfigLeft: number;
  private closed = false;

  constructor(opts: BoardEmuOptions) {
    this.o = { sensorHz: 10, statusHz: 1, searchAfterMs: 1000, ignoreVibrate: 0, ignoreConfig: 0, ...opts };
    this.ignoreLeft = this.o.ignoreVibrate;
    this.ignoreConfigLeft = this.o.ignoreConfig;
  }

  get connected(): boolean {
    return !!this.sock && !this.sock.destroyed && !this.sock.connecting;
  }

  async start(): Promise<void> {
    const udp = createSocket("udp4");
    this.udp = udp;
    udp.on("message", (b) => this.onUdp(b));
    udp.on("error", () => undefined);
    await new Promise<void>((ok) => udp.bind(0, "127.0.0.1", () => ok()));
    this.every(200, () => this.searchStep());
    this.every(1000 / this.o.sensorHz, () => {
      if (this.connected) this.sendUdp(this.make("N", { hz: 100, a: [0.01, 0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01] }));
    });
    this.every(1000 / this.o.statusHz, () => {
      if (this.connected) this.sendTcp(this.make("T", { fw: "emu", plan: "0.3.0", last_seq: this.states.at(-1)?.seq ?? 0, fps: 60, rssi: -50, ma_est: 1200, heap: 100000, err: [] }));
    });
    this.every(250, () => {
      for (const q of this.pendingQuakes.values()) this.sendTcp(q); // no answer yet: same seq again
    });
  }

  /** A hand hit on the board. */
  hit(mag: number, zone: number): number {
    const msg = this.make("Q", { id: this.next("id" as MsgType), src: "hit", peak_g: 2.5, mag, u: 0.5, v: 0.5, zone, conf: 0.8 }, true);
    this.pendingQuakes.set(msg.seq, msg);
    this.sendTcp(msg);
    return msg.seq;
  }

  /** Sends raw bytes, for the bad packet tests. */
  sendRawUdp(bytes: Uint8Array): void {
    this.udp?.send(bytes, this.o.port, this.o.host);
  }

  sendRawTcp(bytes: Uint8Array): void {
    this.sock?.write(bytes);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.sock?.destroy();
    this.udp?.close();
  }

  // --- search and connect ----------------------------------------------------

  private searchStep(): void {
    if (this.closed) return;
    if (this.connected && performance.now() - this.lastStateAt > this.o.searchAfterMs) {
      this.sock?.destroy(); // no state for a short time: search again
      this.sock = undefined;
    }
    if (!this.sock) {
      this.serverAddr = undefined;
      // Hello as a search (a broadcast on the real board; here the backup address).
      this.sendUdpTo(this.make("H", { fw: "emu", plan: "0.3.0", board: "emu" }), this.o.host);
    }
  }

  private openTcp(address: string): void {
    const s = connect(this.o.port, address);
    this.sock = s;
    s.setNoDelay(true);
    const deframer = new Deframer();
    s.on("connect", () => {
      this.connects++;
      this.lastStateAt = performance.now();
      this.lastIn.clear();
      this.sendTcp(this.make("H", { fw: "emu", plan: "0.3.0", board: "emu" }));
    });
    s.on("data", (chunk: Buffer) => {
      for (const b of deframer.push(chunk)) this.onTcp(b);
    });
    s.on("error", () => undefined);
    s.on("close", () => {
      if (this.sock === s) this.sock = undefined;
    });
  }

  // --- in --------------------------------------------------------------------

  private checkSid(m: BoardMsg): void {
    if (m.sid !== undefined && m.sid !== this.sid) {
      if (this.sid !== undefined) this.sidChanges++;
      this.sid = m.sid;
      this.lastIn.clear(); // a new server: its numbers start again
    }
  }

  private onUdp(b: Buffer): void {
    const r = decode(b);
    if (!r.ok) return;
    const m = r.msg;
    this.checkSid(m);
    if (m.t === "P" && !this.sock) {
      // The answer to the search: now we know the server.
      this.serverAddr = this.o.host;
      this.openTcp(this.serverAddr);
    }
    const last = this.lastIn.get(m.t);
    if (last !== undefined && m.seq <= last) {
      if (m.t === "S") this.oldStatesDropped++;
      return;
    }
    this.lastIn.set(m.t, m.seq);
    if (m.t === "S") {
      this.lastStateAt = performance.now();
      this.states.push(m);
    } else if (m.t === "P" && this.connected) {
      const last = this.states.at(-1);
      this.sendUdp({ t: "O", v: PROTOCOL_VERSION, seq: m.seq, ts: this.now(), d: { ping_ts: m.ts, state_seq: last?.seq ?? 0, state_age_ms: 0 } });
    }
  }

  private onTcp(b: Buffer): void {
    const r = decode(b);
    if (!r.ok) return;
    const m = r.msg;
    this.checkSid(m);
    if (m.t === "A") {
      this.quakesAnswered.add(m.seq);
      this.pendingQuakes.delete(m.seq);
      return;
    }
    if (m.t === "V" && this.ignoreLeft > 0) {
      this.ignoreLeft--;
      return;
    }
    if (m.t === "C" && this.ignoreConfigLeft > 0) {
      this.ignoreConfigLeft--;
      return;
    }
    if (m.ack) this.sendTcp({ t: "A", v: PROTOCOL_VERSION, seq: m.seq, ts: this.now(), d: { of: m.t } });
    const key = `tcp:${m.t}`;
    const last = this.lastIn.get(key);
    if (last !== undefined && m.seq <= last) {
      if (m.t === "V") this.vibrateRepeats++;
      return; // sent again: answered, not used twice
    }
    this.lastIn.set(key, m.seq);
    if (m.t === "C") this.configs.push(m);
    if (m.t === "V") this.vibrates.push(m);
  }

  // --- out -------------------------------------------------------------------

  private now(): number {
    return Math.floor(performance.now() - this.t0);
  }

  private next(t: MsgType): number {
    const n = (this.seqOut.get(t) ?? 0) + 1;
    this.seqOut.set(t, n);
    return n;
  }

  private make(t: MsgType, d: Record<string, unknown>, ack = false): BoardMsg {
    const m: BoardMsg = { t, v: PROTOCOL_VERSION, seq: this.next(t), ts: this.now(), d };
    if (ack) m.ack = true;
    return m;
  }

  private sendUdp(m: BoardMsg): void {
    if (this.serverAddr) this.sendUdpTo(m, this.serverAddr);
  }

  private sendUdpTo(m: BoardMsg, host: string): void {
    this.udp?.send(encode(m), this.o.port, host);
  }

  private sendTcp(m: BoardMsg): void {
    if (this.connected) this.sock!.write(frame(encode(m)));
  }

  private every(ms: number, fn: () => void): void {
    this.timers.push(setInterval(fn, ms));
  }
}
