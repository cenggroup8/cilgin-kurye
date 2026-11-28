// Board data for the admin page (M2-4 → M2-3).
//
// The board link gives what the board sends (board_protocol.md): the link coming and
// going, `N {hz, a}` sensor samples and `Q` earthquake events, and its own measurements
// (`link.metrics()`). The admin page (M5) reads them from M2-3 as board data
// (contracts/messages.md, `board`) under these names:
//
//   board.delay_ms   delay of the board link, once per second (missing while it is down)
//   board.loss_pct   loss of the UDP stream from the board, once per second
//   board.accel_g    sensor samples for the seismic graph, each with its own time
//   quake            {mag, zone, source: "hand" | "motors"} of a board earthquake
//
// Wiring, next to M1's own handlers:
//
//   const feed = new BoardFeed(hub);
//   const link = new BoardLink({ events: feed.events({ quake: (e) => queue.boardEvent(toBoardEvent(e)) }) });
//   feed.start(link);   // board.delay_ms and board.loss_pct once per second
//   ...
//   feed.stop();

import type { BoardEvents, BoardMetrics, QuakeEvent } from "./boardLink.js";

/** One board sample, as M2-3 keeps it (`MetricSample` in broadcast/adminFeed.ts). */
export interface BoardSample {
  name: string;
  /** Server time (ms). */
  time: number;
  value: number;
}

/** Where a board earthquake came from, with the names of the admin page. */
export type BoardQuakeSource = "hand" | "motors";

/** The part of M2-3's hub that takes board data (`BroadcastHub.board`). */
export interface BoardSink {
  board(data: {
    connected?: boolean;
    samples?: BoardSample[];
    quake?: { mag: number; zone: number; source: BoardQuakeSource } | null;
  }): void;
}

export interface BoardFeedOptions {
  /** Server clock (ms). Default `Date.now`. */
  now?: () => number;
  /** How often the link measurements go to the admin (ms). Default 1000. */
  metricsEveryMs?: number;
  /**
   * A handler that throws. The board link calls the events inside its socket listener,
   * so a thrown error would stop the whole server; it is written down instead.
   * Default `console.error`.
   */
  onError?: (err: unknown, where: string) => void;
}

export const BOARD_SAMPLE = {
  delay: "board.delay_ms",
  loss: "board.loss_pct",
  accel: "board.accel_g",
} as const;

export class BoardFeed {
  private readonly now: () => number;
  private readonly everyMs: number;
  private readonly onError: (err: unknown, where: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sink: BoardSink,
    options: BoardFeedOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.everyMs = options.metricsEveryMs ?? 1000;
    this.onError = options.onError ?? ((err, where) => console.error(`board feed: ${where} failed`, err));
  }

  /**
   * Board link events that give the board data to the admin and then call `next`
   * (for example M1's earthquake handler). Both always run; an error of either one goes
   * to `onError` and is not thrown, so one broken handler does not end the game.
   */
  events(next: BoardEvents = {}): BoardEvents {
    return {
      link: (connected) => {
        this.guard("admin link", () => this.link(connected));
        this.guard("M1 link", () => next.link?.(connected));
      },
      sensor: (e) => {
        this.guard("admin sensor", () => this.sensor(e));
        this.guard("M1 sensor", () => next.sensor?.(e));
      },
      quake: (e) => {
        this.guard("admin quake", () => this.quake(e));
        this.guard("M1 quake", () => next.quake?.(e));
      },
      status: (e) => this.guard("M1 status", () => next.status?.(e)),
    };
  }

  /** The board came or went. */
  link(connected: boolean): void {
    this.sink.board({ connected });
  }

  /**
   * `N {hz, a}`: the samples were measured one after the other at `hz`, the last one
   * just now, so each gets its own time `1000 / hz` ms before the next one.
   */
  sensor(e: { hz: number; a: readonly number[] }): void {
    if (!(e.hz > 0) || e.a.length === 0) return;
    const now = this.now();
    const step = 1000 / e.hz;
    const last = e.a.length - 1;
    const samples: BoardSample[] = [];
    e.a.forEach((value, i) => {
      if (Number.isFinite(value)) samples.push({ name: BOARD_SAMPLE.accel, time: Math.round(now - (last - i) * step), value });
    });
    if (samples.length > 0) this.sink.board({ samples });
  }

  /** `Q`: a hand hit or the motors shook the board. */
  quake(e: QuakeEvent): void {
    this.sink.board({ quake: { mag: e.mag, zone: e.zone, source: e.src === "hit" ? "hand" : "motors" } });
  }

  /** The link measurements as samples. The delay is left out while the board is not connected. */
  metrics(m: BoardMetrics): void {
    const time = this.now();
    const samples: BoardSample[] = [];
    if (m.connected && m.delayMs !== null && Number.isFinite(m.delayMs)) {
      samples.push({ name: BOARD_SAMPLE.delay, time, value: m.delayMs });
    }
    if (Number.isFinite(m.lossPct)) samples.push({ name: BOARD_SAMPLE.loss, time, value: m.lossPct });
    this.sink.board({ connected: m.connected, samples });
  }

  /** Sends `link.metrics()` every `metricsEveryMs`. */
  start(link: { metrics(): BoardMetrics }): void {
    this.stop();
    this.timer = setInterval(() => this.guard("admin metrics", () => this.metrics(link.metrics())), this.everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private guard(where: string, run: () => void): void {
    try {
      run();
    } catch (err) {
      this.onError(err, where);
    }
  }
}
