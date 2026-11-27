// Bot phones for the M2 tests and demos (M2-3).
// Each bot joins like a phone, sends controls 10 times per second, answers pings and
// counts the states it gets. A bot can answer pings late on purpose, so a test can check
// that the measured ping matches a known delay. It sends every message a real phone sends
// (hello, join, control, "Find me", pong) and, if asked, broken messages on purpose
// (plan #24, "Sahte komşular").
import { decode, encode } from "@msgpack/msgpack";
import WebSocket from "ws";

export interface BotOptions {
  team?: number;
  /** Extra time before a ping is answered (ms). */
  pingDelayMs?: number;
  /** Frame rate that the bot reports. */
  fps?: number;
  /** Controls per second; 0 sends none. */
  controlHz?: number;
}

/** Kinds of broken message a bot can send on purpose. */
export type BrokenKind =
  | "not_msgpack" // bytes that are not MessagePack at all
  | "no_type" // valid MessagePack, but no `t`
  | "unknown_type" // a type nobody knows
  | "bad_control" // a control with values out of range and the wrong player
  | "huge"; // bigger than the 64 KiB limit of the server

export const BROKEN_KINDS: readonly BrokenKind[] = ["not_msgpack", "no_type", "unknown_type", "bad_control", "huge"];

export class BotPhone {
  player = -1;
  states = 0;
  firstSeq = -1;
  lastSeq = -1;
  /** Ticks that were skipped between two states. */
  missed = 0;
  /** States that came again or out of order. */
  repeated = 0;
  stateBytes = 0;
  bytesIn = 0;
  pings = 0;
  controlsSent = 0;
  findMeSent = 0;
  brokenSent = 0;
  /** Error answers of the server, for example `bad_message`. */
  readonly errors: string[] = [];
  closeCode: number | null = null;
  private timer?: ReturnType<typeof setInterval>;

  private constructor(private readonly ws: WebSocket, private readonly opts: BotOptions) {
    ws.on("message", (data) => this.onMessage(data as Buffer));
    ws.on("close", (code) => {
      this.closeCode = code;
      clearInterval(this.timer);
    });
  }

  /** Opens a link, says hello with the game code and joins a team. */
  static async join(port: number, key: string, code: string, opts: BotOptions = {}): Promise<BotPhone> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((ok, fail) => { ws.once("open", () => ok()); ws.once("error", fail); });
    const bot = new BotPhone(ws, opts);
    const welcome = new Promise<{ t: string; player?: number; reason?: string }>((ok) => {
      const on = (data: Buffer) => {
        const m = decode(data) as { t: string; player?: number; reason?: string };
        if (m.t === "welcome" || m.t === "error") { ws.off("message", on); ok(m); }
      };
      ws.on("message", on);
    });
    ws.send(encode({ t: "hello", key, name: key, code }));
    const w = await welcome;
    if (w.t !== "welcome") throw new Error(`bot ${key} rejected: ${w.reason}`);
    bot.player = w.player!;
    ws.send(encode({ t: "join", team: opts.team ?? bot.player % 4 }));
    bot.startControls();
    return bot;
  }

  /** The "Find me" button: an event with no content (plan #24 section 3.3). */
  findMe(): void {
    this.ws.send(encode({ t: "find_me" }));
    this.findMeSent++;
  }

  /** Sends a broken message on purpose, to test the checks of the server. */
  sendBroken(kind: BrokenKind): void {
    let bytes: Uint8Array;
    switch (kind) {
      case "not_msgpack":
        bytes = Uint8Array.from([0xc1, 0xff, 0x00, 0x13]); // 0xc1 is never used in MessagePack
        break;
      case "no_type":
        bytes = encode({ seq: 1, throttle: 1 });
        break;
      case "unknown_type":
        bytes = encode({ t: "teleport", x: 0, z: 0 });
        break;
      case "bad_control":
        bytes = encode({ t: "control", player: (this.player + 1) % 8, seq: -5, throttle: 7, brake: Number.NaN, steer: "left" });
        break;
      case "huge":
        bytes = encode({ t: "control", pad: "x".repeat(70 * 1024) });
        break;
    }
    this.ws.send(bytes);
    this.brokenSent++;
  }

  close(): void {
    clearInterval(this.timer);
    this.ws.close();
  }

  private startControls(): void {
    const hz = this.opts.controlHz ?? 10;
    if (hz <= 0) return;
    let seq = 0;
    this.timer = setInterval(() => {
      if (this.ws.readyState !== this.ws.OPEN) return;
      // Draft control message: contracts/messages.md before the restart (d9aa2ab).
      this.ws.send(encode({ t: "control", player: this.player, seq: ++seq, throttle: 1, brake: 0, steer: Math.sin(seq / 10) }));
      this.controlsSent++;
    }, 1000 / hz);
  }

  private onMessage(data: Buffer): void {
    this.bytesIn += data.length;
    const m = decode(data) as { t?: string; seq?: number; id?: number };
    if (m.t === "state" && typeof m.seq === "number") {
      this.states++;
      this.stateBytes = data.length;
      if (this.firstSeq < 0) this.firstSeq = m.seq;
      else if (m.seq <= this.lastSeq) this.repeated++;
      else this.missed += m.seq - this.lastSeq - 1;
      if (m.seq > this.lastSeq) this.lastSeq = m.seq;
    } else if (m.t === "error") {
      this.errors.push(String((m as { reason?: unknown }).reason));
    } else if (m.t === "ping" && typeof m.id === "number") {
      this.pings++;
      const answer = () => {
        if (this.ws.readyState !== this.ws.OPEN) return;
        this.ws.send(encode({ t: "pong", id: m.id, ct: Date.now(), fps: this.opts.fps ?? 60, last: this.lastSeq }));
      };
      const delay = this.opts.pingDelayMs ?? 0;
      if (delay > 0) setTimeout(answer, delay);
      else answer();
    }
  }
}

/** Joins `count` bots (at most 8) to a running M2 server. */
export async function joinBots(port: number, code: string, count: number, opts: BotOptions = {}): Promise<BotPhone[]> {
  const bots: BotPhone[] = [];
  for (let i = 0; i < count; i++) bots.push(await BotPhone.join(port, `bot-${i}`, code, opts));
  return bots;
}
