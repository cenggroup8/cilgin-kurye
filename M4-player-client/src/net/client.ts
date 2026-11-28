// Network client (M4-3, v2.1 section 8.4, plan #26 section 3.1).
//
// The only part of the page that talks to the server. It keeps one WebSocket to M2:
//   - hello with the saved player key, then join with the team
//   - controls of M4-2 and the "Find me" press go out
//   - every game state is checked and given to the other parts
//   - every ping gets a pong with the phone time, the frame rate and the last state
//   - a lost link (closed, or silent for 3 s on a dead Wi-Fi) is opened again with the
//     same key, so the server gives back the same player
//
// Message shapes: contracts/messages.md (#90).

import { decodeServerMessage, encodePhoneMessage } from "./decode.ts";
import { SeqOffset, browserStore, playerKey, type KeyValueStore } from "./storage.ts";
import {
  CLOSE, TEAM_COLORS,
  type ConnectionState, type Control, type GameStateUpdate, type PhoneMessage, type PlayerInfo, type Refusal, type ServerMessage,
} from "./types.ts";

/** What the client tells the other parts. */
export type NetEvent =
  | { t: "connection"; state: ConnectionState }
  | { t: "welcome"; player: PlayerInfo }
  | { t: "joined"; player: PlayerInfo }
  | { t: "refused"; reason: Refusal }
  | { t: "state"; update: GameStateUpdate }
  | { t: "net"; fpsLimit: number }
  | { t: "error"; reason: string; ref?: string };

export type NetListener = (e: NetEvent) => void;

/** The part of the browser WebSocket the client uses (tests give a fake one). */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface NetClientOptions {
  /** For example `ws://192.168.1.20:8080/ws`. Default: `/ws` on the page's own host. */
  url?: string;
  store?: KeyValueStore;
  openSocket?: (url: string) => SocketLike;
  now?: () => number;
  timers?: Timers;
  /** A link that brings nothing (no state, no ping) for this long is taken as lost. */
  silenceMs?: number;
  /** Waiting time before the next try: starts at `min`, doubles up to `max`. */
  retryMinMs?: number;
  retryMaxMs?: number;
}

const OPEN = 1;
const REFUSALS: readonly string[] = ["bad_code", "full", "bad_hello"];

export function defaultUrl(): string {
  const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
  if (!loc) return "ws://localhost:8080/ws";
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

export class NetClient {
  readonly key: string;
  readonly stats = { statesIn: 0, badMessages: 0, controlsSent: 0, controlsDropped: 0, links: 0 };

  private readonly url: string;
  private readonly openSocket: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly silenceMs: number;
  private readonly retryMinMs: number;
  private readonly retryMaxMs: number;
  private readonly seq: SeqOffset;
  private readonly listeners = new Set<NetListener>();

  private socket: SocketLike | null = null;
  private state: ConnectionState = "idle";
  private name = "";
  private code = "";
  private me: PlayerInfo | null = null;
  private refusal: Refusal | null = null;
  private lastState = -1;
  private lastHeard = 0;
  private fps = 0;
  private limit = 0;
  private retryMs: number;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;
  /** A "Find me" pressed while the link was down; it goes out after the next welcome. */
  private findMeWaiting = false;

  constructor(opts: NetClientOptions = {}) {
    const store = opts.store ?? browserStore();
    this.key = playerKey(store);
    this.seq = new SeqOffset(store, this.key);
    this.url = opts.url ?? defaultUrl();
    this.openSocket = opts.openSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.now = opts.now ?? (() => Date.now());
    this.timers = opts.timers ?? (globalThis as unknown as Timers);
    this.silenceMs = opts.silenceMs ?? 3000;
    this.retryMinMs = opts.retryMinMs ?? 500;
    this.retryMaxMs = opts.retryMaxMs ?? 5000;
    this.retryMs = this.retryMinMs;
  }

  // ---- what the other parts read ----

  get connection(): ConnectionState { return this.state; }
  get player(): PlayerInfo | null { return this.me; }
  get refusedWith(): Refusal | null { return this.refusal; }
  /** Frame rate limit from the admin (`net`), 0 = none. For M4-5. */
  get fpsLimit(): number { return this.limit; }
  /** Tick number of the last state that arrived, −1 for none. */
  get lastStateSeq(): number { return this.lastState; }

  /** Calls `listener` for every event. Returns a function that stops it. */
  subscribe(listener: NetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The number of the last control M1 used, as it is in the game state, turned back into
   * the numbering of M4-2 (see `SeqOffset`). For the prediction of M4-4.
   */
  toLocalSeq(wireSeq: number): number {
    return this.seq.toLocal(wireSeq);
  }

  // ---- what the other parts call ----

  /** The join screen: name and game code. Opens the link and says hello. */
  hello(name: string, code: string): void {
    this.name = name;
    this.code = code;
    this.refusal = null;
    this.retryMs = this.retryMinMs;
    this.clearRetry();
    this.dropSocket();
    this.setState("connecting");
    this.open();
  }

  /** The lobby: the team (0–3). Returns false when the link is not up. */
  join(team: number): boolean {
    if (!Number.isInteger(team) || team < 0 || team > 3) return false;
    return this.send({ t: "join", team });
  }

  /** A control record of M4-2. Values outside the contract ranges are not sent. */
  sendControl(c: Control): boolean {
    const ok = Number.isSafeInteger(c.seq) && c.seq >= 1 &&
      c.throttle >= 0 && c.throttle <= 1 && c.brake >= 0 && c.brake <= 1 && c.steer >= -1 && c.steer <= 1;
    if (!ok || this.state !== "connected") {
      this.stats.controlsDropped++;
      return false;
    }
    const sent = this.send({ t: "control", seq: this.seq.toWire(c.seq), throttle: c.throttle, brake: c.brake, steer: c.steer });
    if (sent) this.stats.controlsSent++;
    return sent;
  }

  /** The "Find me" button. A press while the link is down is sent after it comes back. */
  findMe(): void {
    if (this.state === "connected" && this.send({ t: "find_me" })) return;
    this.findMeWaiting = true;
  }

  /** The frame rate the scene (M4-5) measured; it goes into the next pong. */
  setFps(fps: number): void {
    if (Number.isFinite(fps)) this.fps = Math.min(1000, Math.max(0, fps));
  }

  /** Try again now, for example when the browser says it is online again. */
  wake(): void {
    if (this.state !== "reconnecting") return;
    this.clearRetry();
    this.open();
  }

  /** Leaves for good (for example the player leaves the page). */
  close(): void {
    this.clearRetry();
    this.dropSocket();
    this.setState("idle");
  }

  // ---- the link ----

  private open(): void {
    this.stats.links++;
    let socket: SocketLike;
    try {
      socket = this.openSocket(this.url);
    } catch {
      this.lost();
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    this.lastHeard = this.now();
    this.startWatchdog();
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.lastHeard = this.now();
      this.send({ t: "hello", key: this.key, name: this.name, code: this.code });
    };
    socket.onmessage = (ev) => {
      if (socket !== this.socket) return;
      this.lastHeard = this.now();
      const m = decodeServerMessage(ev.data);
      if (!m) {
        this.stats.badMessages++;
        return;
      }
      this.onMessage(m);
    };
    socket.onclose = (ev) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.onClosed(ev.code);
    };
    socket.onerror = () => {
      // A close event always follows; it decides.
    };
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case "welcome": {
        const knownTeam = this.me?.team ?? null;
        const team = this.me && this.me.player === m.player ? this.me.team : null;
        const color = this.me && this.me.player === m.player ? this.me.color : null;
        this.me = { player: m.player, returning: m.returning, team, color };
        this.retryMs = this.retryMinMs;
        // A new link: the server may have restarted, so the tick numbers can start again.
        this.lastState = -1;
        this.setState("connected");
        this.emit({ t: "welcome", player: { ...this.me } });
        // A server that does not know this player any more (it restarted) does not know its
        // team either: ask for it again. A server that knows it sends `joined` by itself (#94).
        if (!m.returning && knownTeam !== null) this.join(knownTeam);
        if (this.findMeWaiting && this.send({ t: "find_me" })) this.findMeWaiting = false;
        return;
      }
      case "joined":
        this.me = { player: m.player, returning: this.me?.returning ?? false, team: m.team, color: m.color || TEAM_COLORS[m.team] };
        this.emit({ t: "joined", player: { ...this.me } });
        return;
      case "state":
        if (this.state !== "connected" || m.seq <= this.lastState) return;
        this.lastState = m.seq;
        this.stats.statesIn++;
        this.emit({ t: "state", update: { seq: m.seq, state: m.s, receivedAt: this.now() } });
        return;
      case "ping":
        this.send({ t: "pong", id: m.id, ct: this.now(), fps: Math.round(this.fps * 10) / 10, last: this.lastState });
        return;
      case "net":
        this.limit = m.fps_limit;
        this.emit({ t: "net", fpsLimit: m.fps_limit });
        return;
      case "error":
        if (REFUSALS.includes(m.reason) && this.state !== "connected") this.refusal = m.reason as Refusal;
        this.emit(m.ref === undefined ? { t: "error", reason: m.reason } : { t: "error", reason: m.reason, ref: m.ref });
        return;
    }
  }

  private onClosed(code: number): void {
    this.stopWatchdog();
    if (code === CLOSE.rejected || this.refusal !== null) {
      const reason = this.refusal ?? "bad_hello";
      this.refusal = reason;
      this.setState("refused");
      this.emit({ t: "refused", reason });
      return;
    }
    if (code === CLOSE.playerReplaced) {
      this.setState("replaced");
      return;
    }
    if (this.state === "idle") return;
    this.lost();
  }

  /** The link is gone without a refusal: try again with the same key. */
  private lost(): void {
    this.stopWatchdog();
    this.setState("reconnecting");
    this.clearRetry();
    // A little randomness, so eight phones on one Wi-Fi do not all come back at the same moment.
    const wait = this.retryMs * (0.8 + Math.random() * 0.4);
    this.retryMs = Math.min(this.retryMaxMs, this.retryMs * 2);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.state === "reconnecting") this.open();
    }, wait);
  }

  /**
   * On a dead Wi-Fi the browser may not close the socket for a long time. The server sends
   * states 30 times and pings twice per second, so 3 s of silence means the link is gone.
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = this.timers.setInterval(() => {
      if (this.now() - this.lastHeard < this.silenceMs) return;
      this.dropSocket();
      this.lost();
    }, Math.max(100, Math.floor(this.silenceMs / 3)));
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) this.timers.clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Forgets the current socket; its late events are ignored. */
  private dropSocket(): void {
    this.stopWatchdog();
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close(1000, "client");
    } catch {
      // already closed
    }
  }

  private send(m: PhoneMessage): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return false;
    try {
      s.send(encodePhoneMessage(m));
      return true;
    } catch {
      return false;
    }
  }

  private setState(next: ConnectionState): void {
    if (next === this.state) return;
    this.state = next;
    this.emit({ t: "connection", state: next });
  }

  /** A listener that throws must not stop the client or the other listeners. */
  private emit(e: NetEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("net listener failed", err);
      }
    }
  }
}
