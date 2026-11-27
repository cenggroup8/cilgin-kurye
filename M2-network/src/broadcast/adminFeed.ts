/**
 * Metrics, board data and the reconnect snapshot for the admin page (M2-3).
 *
 * M1 gives all metrics twice per second; M2-4 gives the board data. Both go on to the admin.
 * A short history is kept, so an admin page that connects again gets the full parameter list,
 * the current state and the recent history in one `snapshot` message (v2.1 section 9.5).
 *
 * The shapes are the ones the admin page of M5-1 (#73) reads. They are a draft until #35:
 *   {t:"metrics", samples:[{name, time, value}]}
 *   {t:"board", board:{connected, samples, quake?}}
 *   {t:"snapshot", state, params, metrics, board, events}
 */

export interface MetricSample {
  name: string;
  time: number;
  value: number;
}

export interface BoardData {
  connected: boolean;
  samples: MetricSample[];
  quake?: { mag: number; zone: number };
}

export interface LogEntry {
  time: number;
  message: string;
}

/** One row of the parameter list of M1-5 (`ParamInfo`). */
export interface ParamRow {
  name: string;
  value: number;
  [field: string]: unknown;
}

export interface AdminFeedOptions {
  /** How much history a reconnecting admin gets (ms). */
  historyMs?: number;
  maxEvents?: number;
  now?: () => number;
}

export class AdminFeed {
  private readonly historyMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly metrics: MetricSample[] = [];
  private readonly boardSamples: MetricSample[] = [];
  private readonly events: LogEntry[] = [];
  private board: Omit<BoardData, "samples"> = { connected: false };
  private params: ParamRow[] = [];
  private state: unknown = null;

  constructor(private readonly send: (msg: unknown) => void, opts: AdminFeedOptions = {}) {
    this.historyMs = opts.historyMs ?? 120_000;
    this.maxEvents = opts.maxEvents ?? 50;
    this.now = opts.now ?? Date.now;
  }

  /** The newest admin state, kept for the snapshot (the broadcaster sends it live). */
  setState(state: unknown): void {
    this.state = state;
  }

  /** The full list from M1 (`params_get` answer or after `param_reset`). */
  setParams(list: ParamRow[]): void {
    this.params = list.map((p) => ({ ...p }));
    this.send({ t: "params", list: this.params });
  }

  /** One changed value from M1. */
  paramChanged(name: string, value: number): void {
    const p = this.params.find((r) => r.name === name);
    if (p) p.value = value;
    this.send({ t: "param", name, value });
  }

  /** Metrics from M1 and the network measurements of M2. */
  addMetrics(samples: MetricSample[]): void {
    if (samples.length === 0) return;
    this.metrics.push(...samples);
    this.trim(this.metrics);
    this.send({ t: "metrics", samples });
  }

  /** Board data from M2-4: link state, sensor samples, an earthquake. */
  addBoard(data: Partial<BoardData>): void {
    if (data.connected !== undefined) this.board.connected = data.connected;
    if (data.quake) this.board.quake = data.quake;
    const samples = data.samples ?? [];
    this.boardSamples.push(...samples);
    this.trim(this.boardSamples);
    this.send({ t: "board", board: { ...this.board, samples } });
  }

  event(message: string): void {
    const entry = { time: this.now(), message };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.send({ t: "event", entry });
  }

  /** Everything a new or returning admin page needs, in one message. */
  snapshot(): unknown {
    this.trim(this.metrics);
    this.trim(this.boardSamples);
    return {
      t: "snapshot",
      state: this.state,
      params: this.params,
      metrics: [...this.metrics],
      board: { ...this.board, samples: [...this.boardSamples] },
      events: [...this.events],
    };
  }

  private trim(samples: MetricSample[]): void {
    const from = this.now() - this.historyMs;
    let i = 0;
    while (i < samples.length && samples[i]!.time < from) i++;
    if (i > 0) samples.splice(0, i);
  }
}
