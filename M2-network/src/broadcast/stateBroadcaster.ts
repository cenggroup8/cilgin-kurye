import { encode } from "@msgpack/msgpack";

/**
 * State broadcaster (M2-3, plan #24 section 3.2, "Kodlanmış durum").
 *
 * After every tick M1 gives one frozen state. It is encoded once, and every phone gets
 * the same bytes. The admin gets a smaller state 10 times per second. The board state goes
 * to the board link (M2-4), which sends it at the `board.state_hz` rate of the admin.
 *
 * Message shapes are a draft until M2-2 writes the phone and admin messages into
 * contracts/ (#35):
 *   to phones  {t:"state", seq, s}   seq = tick number, s = the frozen game state of M1
 *   to admin   {t:"state", state}    the shape that M5-1 (#73) reads
 */

/** What M1 gives at the end of a tick (M1-1 `buildGameState` and `buildBoardState`). */
export interface FrozenTick {
  tick: number;
  game: unknown;
  board?: unknown;
}

/** Where the bytes go. In the server these are the WebSocket links of M2-1. */
export interface BroadcastLinks {
  /** Links of admitted phones. */
  players(): number[];
  /** Link of the admin page, if one is open. */
  admin(): number | null;
  sendBytes(connId: number, bytes: Uint8Array): void;
  /** Bytes still waiting on a link. Optional: without it no phone is ever skipped. */
  backlog?(connId: number): number;
}

/** The board link of M2-4 (`BoardLink.setState`). It keeps only the newest state. */
export interface BoardSink {
  setState(state: unknown): void;
}

export interface BroadcasterOptions {
  tickHz?: number;
  adminHz?: number;
  /** Makes the smaller admin state. Default: the game state without the per-player controls. */
  adminView?: (game: unknown) => unknown;
  board?: BoardSink;
  now?: () => number;
  /**
   * A phone whose link still holds more than this many unsent bytes skips the state of this
   * tick (review of #84): on a bad Wi-Fi its queue would otherwise grow and it would see old
   * states late. The phone sees the gap in `seq`. Default 64 KiB, about 20 states.
   */
  maxBacklogBytes?: number;
}

export interface BroadcastStats {
  ticks: number;
  /** Size of the last encoded phone state. */
  stateBytes: number;
  /** Size of the last encoded admin state. */
  adminStateBytes: number;
  /** Phone state messages handed to the links. */
  phoneSends: number;
  adminSends: number;
  /** Bytes to all links since the start. */
  bytesOut: number;
  /** Bytes to all links in the last full second. */
  bytesPerSecond: number;
  /** Time to encode the last phone state, in milliseconds. */
  encodeMs: number;
  /** States not sent to a phone because its link was too far behind. */
  skippedSlow: number;
}

export class StateBroadcaster {
  private readonly tickHz: number;
  private readonly adminEvery: number;
  private readonly adminView: (game: unknown) => unknown;
  private readonly now: () => number;
  private sinceAdmin = Number.POSITIVE_INFINITY;
  private windowStart: number;
  private windowBytes = 0;
  private readonly s: BroadcastStats = {
    ticks: 0, stateBytes: 0, adminStateBytes: 0, phoneSends: 0, adminSends: 0,
    bytesOut: 0, bytesPerSecond: 0, encodeMs: 0, skippedSlow: 0,
  };
  private readonly maxBacklog: number;

  constructor(private readonly links: BroadcastLinks, private readonly opts: BroadcasterOptions = {}) {
    this.tickHz = opts.tickHz ?? 30;
    const adminHz = opts.adminHz ?? 10;
    this.adminEvery = Math.max(1, Math.round(this.tickHz / adminHz));
    this.adminView = opts.adminView ?? smallAdminState;
    this.now = opts.now ?? Date.now;
    this.maxBacklog = opts.maxBacklogBytes ?? 64 * 1024;
    this.windowStart = this.now();
  }

  /** Called once per tick with the frozen state of M1. */
  publish(frozen: FrozenTick): void {
    this.s.ticks++;
    const t0 = performance.now();
    const bytes = encode({ t: "state", seq: frozen.tick, s: frozen.game });
    this.s.encodeMs = performance.now() - t0;
    this.s.stateBytes = bytes.byteLength;
    for (const connId of this.links.players()) {
      if ((this.links.backlog?.(connId) ?? 0) > this.maxBacklog) {
        this.s.skippedSlow++;
        continue;
      }
      this.links.sendBytes(connId, bytes);
      this.s.phoneSends++;
      this.count(bytes.byteLength);
    }

    this.sinceAdmin++;
    const admin = this.links.admin();
    if (admin !== null && this.sinceAdmin >= this.adminEvery) {
      this.sinceAdmin = 0;
      const adminBytes = encode({ t: "state", state: this.adminView(frozen.game) });
      this.s.adminStateBytes = adminBytes.byteLength;
      this.links.sendBytes(admin, adminBytes);
      this.s.adminSends++;
      this.count(adminBytes.byteLength);
    }

    if (frozen.board !== undefined) this.opts.board?.setState(frozen.board);
  }

  stats(): BroadcastStats {
    this.roll();
    return { ...this.s };
  }

  private count(n: number): void {
    this.roll();
    this.s.bytesOut += n;
    this.windowBytes += n;
  }

  private roll(): void {
    const t = this.now();
    if (t - this.windowStart < 1000) return;
    // A gap of more than one second means nothing was sent in the last second.
    this.s.bytesPerSecond = t - this.windowStart < 2000 ? this.windowBytes : 0;
    this.windowBytes = 0;
    this.windowStart = t - ((t - this.windowStart) % 1000);
  }
}

/**
 * The admin does not need the controls of every player 10 times per second (they are in
 * the game log), so they are left out. Everything else of the state stays.
 */
export function smallAdminState(game: unknown): unknown {
  if (typeof game !== "object" || game === null) return game;
  const g = game as { players?: unknown };
  if (!Array.isArray(g.players)) return game;
  return {
    ...g,
    players: g.players.map((p) => {
      if (typeof p !== "object" || p === null) return p;
      const { control: _control, ...rest } = p as Record<string, unknown>;
      return rest;
    }),
  };
}
