// Board emulator (M6-5): plays the LED board on the PC, so the server side
// (M2-4) can be built and tested without the real board.
// It follows the board side of contracts/board_protocol.md:
//   - search: Hello on UDP once per second (broadcast first, then the backup
//     address after 5 s), the server answers with a delay probe (section 7)
//   - TCP with a 2 byte length in front; Hello on TCP, then config and states
//   - answers to every `ack` message, used once even when sent again
//   - drops late UDP packets; a new session number starts the numbers again
//   - no board state for 1 s: motors stop, back to "searching" (section 8)
//   - sends delay replies, sensor samples (10 × 10 per second), status (1 per
//     second) and earthquake events for hand hits and for the motors

import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";
import { connect, type Socket } from "node:net";
import { MOTOR_ZONES, clamp01, seededRandom, zoneCentre } from "../common/cityPlan.js";
import { DEFAULT_PORT, Deframer, MAX_FRAME, MessageFactory, decode, encode, frame, type BoardMsg } from "../common/protocol.js";

export type LinkState = "searching" | "connected";

export interface BoardEmulatorEvents {
  link?(state: LinkState): void;
  state?(d: Record<string, unknown>, seq: number): void;
  config?(d: Record<string, unknown>): void;
  vibrate?(d: VibrateCommand): void;
  quakeSent?(e: QuakeOut): void;
  quakeAnswered?(id: number): void;
}

export interface BoardEmulatorOptions {
  /** Server address; used as the backup address after the broadcast search. */
  host?: string;
  port?: number;
  /** Search with a UDP broadcast first, like the real board. Off in tests. */
  broadcast?: boolean;
  board?: string;
  fw?: string;
  /** Version of the city plan in the board (compared with `C.plan`). */
  plan?: string;
  /** No board state for this long: back to searching (proposal: 1 s). */
  searchAfterMs?: number;
  /** Broadcast for this long before the backup address (proposal: 5 s). */
  backupAfterMs?: number;
  /** A sent earthquake event without answer is sent again after this (proposal: 1 s). */
  resendMs?: number;
  /** Peak of the standard calibration hit; strength 5 (M6-2: 5 + 2·log2(peak / standard)). */
  standardPeakG?: number;
  seed?: number;
  events?: BoardEmulatorEvents;
}

export interface VibrateCommand {
  mask: number;
  duty: number;
  ms: number;
  ramp_ms: number;
}

/** Earthquake event as the board sends it (board_protocol.md, `Q`). */
export interface QuakeOut {
  id: number;
  src: "hit" | "motor";
  peak_g: number;
  mag: number;
  u: number;
  v: number;
  zone: number;
  conf: number;
}

export interface BoardStats {
  statesReceived: number;
  statesDropped: number;
  badMessages: number;
  configs: number;
  vibrates: number;
  repeatsIgnored: number;
  quakesSent: number;
  quakesAnswered: number;
  resends: number;
  sidChanges: number;
  connects: number;
}

const SAMPLE_HZ = 100;
const SAMPLES_PER_MSG = 10;
const DEFAULTS = {
  host: "127.0.0.1",
  port: DEFAULT_PORT,
  broadcast: false,
  board: "board-emu",
  fw: "emu-0.1.0",
  plan: "0.1.0",
  searchAfterMs: 1000,
  backupAfterMs: 5000,
  resendMs: 1000,
  standardPeakG: 2.0,
  seed: 1,
};

interface Shake {
  peakG: number;
  start: number;
  /** Decay time for a hit, or the end of the motor run. */
  decayS?: number;
  until?: number;
}

export class BoardEmulator {
  readonly stats: BoardStats = {
    statesReceived: 0,
    statesDropped: 0,
    badMessages: 0,
    configs: 0,
    vibrates: 0,
    repeatsIgnored: 0,
    quakesSent: 0,
    quakesAnswered: 0,
    resends: 0,
    sidChanges: 0,
    connects: 0,
  };
  linkState: LinkState = "searching";
  /** Newest board state and when it came (ms on this side). */
  latestState?: { seq: number; d: Record<string, unknown>; at: number };
  config?: Record<string, unknown>;
  /** The last sensor values that were sent, for the screen. */
  readonly lastSamples: number[] = [];

  private readonly o: typeof DEFAULTS;
  private readonly events: BoardEmulatorEvents;
  private readonly msg = new MessageFactory();
  private readonly random: () => number;
  private udp?: UdpSocket;
  private sock?: Socket;
  private tcpOpen = false;
  private serverAddr?: string;
  private sid?: number;
  private readonly lastIn = new Map<string, number>();
  private readonly pendingQuakes = new Map<number, { msg: BoardMsg; sentAt: number }>();
  private quakeId = 0;
  private searchStart = 0;
  private lastStateAt = 0;
  private wifi = true;
  private closed = false;
  private readonly timers: NodeJS.Timeout[] = [];

  private motor?: VibrateCommand & { start: number; eventSent: boolean };
  private readonly shakes: Shake[] = [];
  private sampleClock = 0;

  constructor(options: BoardEmulatorOptions = {}) {
    this.o = { ...DEFAULTS, ...options } as typeof DEFAULTS;
    this.events = options.events ?? {};
    this.random = seededRandom(this.o.seed);
  }

  get connected(): boolean {
    return this.linkState === "connected";
  }

  async start(): Promise<void> {
    const udp = createSocket({ type: "udp4", reuseAddr: true });
    this.udp = udp;
    udp.on("message", (b, from) => this.onUdp(b, from));
    udp.on("error", () => undefined);
    await new Promise<void>((ok) => udp.bind(0, () => ok()));
    if (this.o.broadcast) udp.setBroadcast(true);
    this.searchStart = this.msg.now();
    this.searchStep();
    this.every(1000, () => this.searchStep());
    this.every(100, () => this.checkLink());
    this.every(1000 / (SAMPLE_HZ / SAMPLES_PER_MSG), () => this.sendSamples());
    this.every(1000, () => this.sendStatus());
    this.every(this.o.resendMs / 4, () => this.resendQuakes());
    this.every(20, () => this.runMotors());
  }

  /**
   * A hand hit in zone 0–8 with strength 0–10. Returns the event id, or -1
   * when no event is made (no link, or the motors run: then all shaking is one
   * motor event, doc 10.5).
   */
  hit(zone: number, mag: number): number {
    if (!Number.isInteger(zone) || zone < 0 || zone > 8) throw new RangeError(`zone ${zone}`);
    const m = Math.min(10, Math.max(0, mag));
    const peakG = this.peakForMag(m);
    this.shakes.push({ peakG, start: this.msg.now(), decayS: 0.15 });
    if (this.motor) return -1;
    const c = zoneCentre(zone);
    // The measured place is near the zone centre, not exactly on it.
    const u = clamp01(c.u + (this.random() - 0.5) * 0.12);
    const v = clamp01(c.v + (this.random() - 0.5) * 0.12);
    return this.sendQuake({ src: "hit", peak_g: round(peakG, 2), mag: round(m, 1), u: round(u, 3), v: round(v, 3), zone, conf: round(0.6 + this.random() * 0.3, 2) });
  }

  /** Turns the Wi-Fi off (all packets lost, TCP closed) or on again. */
  setWifi(on: boolean): void {
    this.wifi = on;
    if (!on) this.toSearching();
  }

  /** Motor power 0–1 of the four motors now (soft start), for the screen. */
  motorPower(): number[] {
    const m = this.motor;
    if (!m) return [0, 0, 0, 0];
    const t = this.msg.now() - m.start;
    const ramp = m.ramp_ms > 0 ? Math.min(1, t / m.ramp_ms) : 1;
    return MOTOR_ZONES.map((_, i) => ((m.mask >> i) & 1 ? m.duty * ramp : 0));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.sock?.destroy();
    try {
      this.udp?.close();
    } catch {
      // already closed
    }
  }

  // --- search and link -------------------------------------------------------

  private searchStep(): void {
    if (this.closed || !this.wifi || this.sock) return;
    const hello = this.msg.make("H", this.helloContent());
    const useBroadcast = this.o.broadcast && this.msg.now() - this.searchStart < this.o.backupAfterMs;
    this.udp?.send(encode(hello), this.o.port, useBroadcast ? "255.255.255.255" : this.o.host);
  }

  private openTcp(address: string): void {
    this.serverAddr = address;
    const s = connect(this.o.port, address);
    this.sock = s;
    s.setNoDelay(true);
    const deframer = new Deframer();
    s.on("connect", () => {
      if (this.sock !== s) return;
      this.tcpOpen = true;
      this.stats.connects++;
      this.lastStateAt = this.msg.now();
      this.sendTcp(this.msg.make("H", this.helloContent()));
    });
    s.on("data", (chunk: Buffer) => {
      for (const b of deframer.push(chunk)) this.onTcp(b);
      if (deframer.pending > MAX_FRAME + 2) s.destroy();
    });
    s.on("error", () => undefined);
    s.on("close", () => {
      if (this.sock === s) this.toSearching();
    });
  }

  private checkLink(): void {
    if (this.connected && this.msg.now() - this.lastStateAt > this.o.searchAfterMs) this.toSearching();
  }

  private toSearching(): void {
    const s = this.sock;
    this.sock = undefined;
    this.tcpOpen = false;
    this.serverAddr = undefined;
    s?.destroy();
    this.motor = undefined; // the motors stop at once (doc 10.5)
    if (this.linkState !== "searching") {
      this.linkState = "searching";
      this.searchStart = this.msg.now();
      this.events.link?.("searching");
    }
  }

  private helloContent() {
    return { fw: this.o.fw, plan: this.o.plan, board: this.o.board };
  }

  // --- in ----------------------------------------------------------------------

  private checkSid(m: BoardMsg): void {
    if (m.sid !== undefined && m.sid !== this.sid) {
      if (this.sid !== undefined) this.stats.sidChanges++;
      this.sid = m.sid;
      this.lastIn.clear(); // a new server start: its numbers start again (section 6)
    }
  }

  private onUdp(b: Buffer, from: RemoteInfo): void {
    if (!this.wifi) return;
    const r = decode(b);
    if (!r.ok) {
      this.stats.badMessages++;
      return;
    }
    const m = r.msg;
    this.checkSid(m);
    if (m.t === "P" && !this.sock) {
      this.openTcp(from.address); // the answer to the search: now we know the server
      return;
    }
    const last = this.lastIn.get(m.t);
    if (last !== undefined && m.seq <= last) {
      if (m.t === "S") this.stats.statesDropped++;
      return; // late UDP packet
    }
    this.lastIn.set(m.t, m.seq);
    if (m.t === "S") {
      this.stats.statesReceived++;
      this.lastStateAt = this.msg.now();
      this.latestState = { seq: m.seq, d: m.d, at: this.lastStateAt };
      if (this.tcpOpen && this.linkState !== "connected") {
        this.linkState = "connected";
        this.events.link?.("connected");
      }
      this.events.state?.(m.d, m.seq);
    } else if (m.t === "P" && this.tcpOpen) {
      const st = this.latestState;
      const age = st ? this.msg.now() - st.at : 0;
      this.sendUdp(this.msg.raw("O", m.seq, { ping_ts: m.ts, state_seq: st?.seq ?? 0, state_age_ms: age }));
    } else if (m.t !== "P") {
      this.stats.badMessages++;
    }
  }

  private onTcp(b: Buffer): void {
    const r = decode(b);
    if (!r.ok) {
      this.stats.badMessages++;
      return;
    }
    const m = r.msg;
    this.checkSid(m);
    if (m.t === "A") {
      if (m.d.of === undefined || m.d.of === "Q") {
        const p = this.pendingQuakes.get(m.seq);
        if (p) {
          this.pendingQuakes.delete(m.seq);
          this.stats.quakesAnswered++;
          this.events.quakeAnswered?.(p.msg.d.id as number);
        }
      }
      return;
    }
    if (m.t !== "C" && m.t !== "V") {
      this.stats.badMessages++;
      return;
    }
    if (m.ack) this.sendTcp(this.msg.raw("A", m.seq, { of: m.t }));
    const key = `tcp:${m.t}`;
    const last = this.lastIn.get(key);
    if (last !== undefined && m.seq <= last) {
      this.stats.repeatsIgnored++; // sent again: answered, used once
      return;
    }
    this.lastIn.set(key, m.seq);
    if (m.t === "C") {
      this.stats.configs++;
      this.config = m.d;
      this.events.config?.(m.d);
    } else {
      const cmd = vibrateCommand(m.d);
      if (!cmd) {
        this.stats.badMessages++;
        return;
      }
      this.stats.vibrates++;
      this.motor = { ...cmd, start: this.msg.now(), eventSent: false };
      this.events.vibrate?.(cmd);
    }
  }

  // --- motors and sensor -----------------------------------------------------

  /** The whole motor run gives one "motor" earthquake event, when the ramp is over. */
  private runMotors(): void {
    const m = this.motor;
    if (!m) return;
    const t = this.msg.now() - m.start;
    if (!m.eventSent && t >= m.ramp_ms) {
      m.eventSent = true;
      const peakG = 0.4 + 2.6 * m.duty;
      this.shakes.push({ peakG, start: this.msg.now(), until: m.start + m.ms });
      const zones = MOTOR_ZONES.filter((_, i) => (m.mask >> i) & 1);
      if (zones.length > 0) {
        const cs = zones.map(zoneCentre);
        const u = cs.reduce((s, c) => s + c.u, 0) / cs.length;
        const v = cs.reduce((s, c) => s + c.v, 0) / cs.length;
        const zone = 3 * Math.min(2, Math.floor(v * 3)) + Math.min(2, Math.floor(u * 3));
        this.sendQuake({ src: "motor", peak_g: round(peakG, 2), mag: round(this.magForPeak(peakG), 1), u: round(u, 3), v: round(v, 3), zone, conf: 0.9 });
      }
    }
    if (t >= m.ms) this.motor = undefined;
  }

  private peakForMag(mag: number): number {
    return this.o.standardPeakG * Math.pow(2, (mag - 5) / 2);
  }

  private magForPeak(peak: number): number {
    return Math.min(10, Math.max(0, 5 + 2 * Math.log2(peak / this.o.standardPeakG)));
  }

  /** Size of the shaking in g at one moment: room noise, hits and motors. */
  private shakeAt(ms: number): number {
    let g = 0.01 + this.random() * 0.02;
    for (const s of this.shakes) {
      const dt = (ms - s.start) / 1000;
      if (dt < 0) continue;
      if (s.decayS !== undefined) g += s.peakG * Math.exp(-dt / s.decayS) * (0.6 + 0.4 * this.random());
      else if (s.until !== undefined && ms <= s.until) g += s.peakG * (0.5 + 0.5 * this.random());
    }
    // Forget finished shakes.
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      const over = s.decayS !== undefined ? ms - s.start > s.decayS * 8000 : ms > (s.until ?? 0);
      if (over) this.shakes.splice(i, 1);
    }
    return g;
  }

  private sendSamples(): void {
    const now = this.msg.now();
    if (this.sampleClock === 0) this.sampleClock = now - 100;
    const a: number[] = [];
    for (let i = 0; i < SAMPLES_PER_MSG; i++) {
      this.sampleClock += 1000 / SAMPLE_HZ;
      a.push(round(this.shakeAt(this.sampleClock), 3));
    }
    this.lastSamples.push(...a);
    if (this.lastSamples.length > 300) this.lastSamples.splice(0, this.lastSamples.length - 300);
    if (this.connected) this.sendUdp(this.msg.make("N", { hz: SAMPLE_HZ, a }));
  }

  private sendStatus(): void {
    if (!this.connected) return;
    this.sendTcp(
      this.msg.make("T", {
        fw: this.o.fw,
        plan: this.o.plan,
        last_seq: this.latestState?.seq ?? 0,
        fps: 60,
        rssi: -45 - Math.round(this.random() * 10),
        ma_est: this.powerEstimate(),
        heap: 180000 - Math.round(this.random() * 4000),
        err: this.config && this.config.plan !== this.o.plan ? ["plan_mismatch"] : [],
      }),
    );
  }

  /** Rough LED power: lit road LEDs and dots, at the configured brightness. */
  private powerEstimate(): number {
    const d = this.latestState?.d;
    const bright = typeof this.config?.bright === "number" ? this.config.bright : 0.5;
    const n = (k: string) => (Array.isArray(d?.[k]) ? (d![k] as unknown[]).length : 0);
    const leds = 340 * 0.15 + n("p") * 3 + n("dp") * 2 + n("ob") * 6 + 8 * 4;
    const ma = Math.round(150 + leds * 20 * bright);
    const max = typeof this.config?.max_ma === "number" ? this.config.max_ma : 4000;
    return Math.min(ma, max);
  }

  // --- out -------------------------------------------------------------------

  private sendQuake(d: Omit<QuakeOut, "id">): number {
    if (!this.connected) return -1;
    const e: QuakeOut = { id: ++this.quakeId, ...d };
    // Field order of the vectors: id, src, peak_g, mag, u, v, zone, conf.
    const msg = this.msg.make("Q", { id: e.id, src: e.src, peak_g: e.peak_g, mag: e.mag, u: e.u, v: e.v, zone: e.zone, conf: e.conf }, true);
    this.pendingQuakes.set(msg.seq, { msg, sentAt: this.msg.now() });
    this.stats.quakesSent++;
    this.sendTcp(msg);
    this.events.quakeSent?.(e);
    return e.id;
  }

  private resendQuakes(): void {
    if (!this.tcpOpen) return;
    const now = this.msg.now();
    for (const p of this.pendingQuakes.values()) {
      if (now - p.sentAt >= this.o.resendMs) {
        p.sentAt = now;
        this.stats.resends++;
        this.sendTcp(p.msg); // same seq: the server answers again but uses it once
      }
    }
  }

  private sendUdp(m: BoardMsg): void {
    if (this.wifi && this.serverAddr) this.udp?.send(encode(m), this.o.port, this.serverAddr);
  }

  private sendTcp(m: BoardMsg): void {
    if (this.wifi && this.tcpOpen && this.sock && !this.sock.destroyed) this.sock.write(frame(encode(m)));
  }

  private every(ms: number, fn: () => void): void {
    this.timers.push(setInterval(fn, ms));
  }
}

function vibrateCommand(d: Record<string, unknown>): VibrateCommand | undefined {
  const num = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  if (!Number.isInteger(d.mask) || !num(d.mask, 0, 15)) return undefined;
  if (!num(d.duty, 0, 1) || !num(d.ms, 0, 60000) || !num(d.ramp_ms, 0, 60000)) return undefined;
  return { mask: d.mask as number, duty: d.duty as number, ms: d.ms as number, ramp_ms: d.ramp_ms as number };
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
