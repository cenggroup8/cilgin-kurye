// Small stand-ins used only by the M2-1 tests and demo.
// The full fake M1 and bot phones are M2-3's work (test/fakes/).
import { decode, encode } from "@msgpack/msgpack";
import WebSocket from "ws";
import type { PlayerEvents } from "../src/session/types.js";

export type RecordedEvent =
  | { type: "join"; playerKey: string; playerNo: number; name: string; team: number }
  | { type: "lost"; playerKey: string; playerNo: number }
  | { type: "returned"; playerKey: string; playerNo: number };

/** Plays M1: writes down every player event that M2 gives it. */
export class RecordingM1 implements PlayerEvents {
  readonly events: RecordedEvent[] = [];
  onEvent?: (e: RecordedEvent) => void;
  join(e: Omit<Extract<RecordedEvent, { type: "join" }>, "type">) { this.push({ type: "join", ...e }); }
  lost(e: { playerKey: string; playerNo: number }) { this.push({ type: "lost", ...e }); }
  returned(e: { playerKey: string; playerNo: number }) { this.push({ type: "returned", ...e }); }
  private push(e: RecordedEvent) { this.events.push(e); this.onEvent?.(e); }
}

/** A tiny phone or admin link that speaks MessagePack. */
export class TestLink {
  readonly messages: any[] = [];
  closeCode: number | null = null;
  private ws: WebSocket;
  private waiters: Array<() => void> = [];

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d) => { this.messages.push(decode(d as Buffer)); this.wake(); });
    this.ws.on("close", (code) => { this.closeCode = code; this.wake(); });
  }

  static async open(port: number, path = "/ws"): Promise<TestLink> {
    const link = new TestLink(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((ok, fail) => { link.ws.once("open", () => ok()); link.ws.once("error", fail); });
    return link;
  }

  send(msg: unknown): void { this.ws.send(encode(msg)); }
  sendRaw(bytes: Buffer): void { this.ws.send(bytes); }
  close(): void { this.ws.close(); }

  /** Waits until a message with this type arrives (or the link closes). */
  async next(t: string, ms = 2000): Promise<any> {
    return this.until(() => this.messages.find((m) => m.t === t), ms);
  }

  async closed(ms = 2000): Promise<number> {
    return this.until(() => this.closeCode ?? undefined, ms);
  }

  async hello(key: string, code: string, name = "bot"): Promise<any> {
    this.send({ t: "hello", key, name, code });
    return this.until(() => this.messages.find((m) => m.t === "welcome" || m.t === "error"), 2000);
  }

  private async until<T>(get: () => T | undefined, ms: number): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = get();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("timed out");
      await new Promise<void>((ok) => { this.waiters.push(ok); setTimeout(ok, 50); });
    }
  }

  private wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
}

export async function waitFor<T>(get: () => T | undefined, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((ok) => setTimeout(ok, 20));
  }
}
