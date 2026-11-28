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
 *   {t:"snapshot", state, params, metrics, board, events, marks}
 *
 * `marks` (contracts/messages.md, #101): the commands accepted in the history time, at server
 * time, so the graphs of the admin page draw their change marks again after a page reload.
 */

export interface MetricSample {
  name: string;
  time: number;
  value: number;
}

export interface BoardData {
  connected: boolean;
  samples: MetricSample[];
  /** `source` is "hand" or "motors" for a board earthquake (M2-4, `BoardFeed`). */
  quake?: { mag: number; zone: number; source?: string };
}

export interface LogEntry {
  time: number;
  message: string;
}

/** One accepted command: the parameter's name for `param_set`, the command's name otherwise. */
export interface ChangeMark {
  time: number;
  name: string;
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
  /**
   * How long an earthquake stays in the board data (ms). Without an end the admin that
   * connects again would see a finished earthquake as the current one (review of #84).
   * Default 20 s, the longest `quake.duration_s` of M1-5.
   */
  quakeHoldMs?: number;
  now?: () => number;
}

export class AdminFeed {
  private readonly historyMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly metrics: MetricSample[] = [];
  private readonly boardSamples: MetricSample[] = [];
  private readonly events: LogEntry[] = [];
  private connected = false;
  private quake?: BoardData["quake"];
  private quakeAt = 0;
  private readonly quakeHoldMs: number;
  private params: ParamRow[] = [];
  private state: unknown = null;
  private readonly marks: ChangeMark[] = [];

  constructor(private readonly send: (msg: unknown) => void, opts: AdminFeedOptions = {}) {
    this.historyMs = opts.historyMs ?? 120_000;
    this.maxEvents = opts.maxEvents ?? 50;
    this.quakeHoldMs = opts.quakeHoldMs ?? 20_000;
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

  /**
   * Board data from M2-4: link state, sensor samples, an earthquake. `quake: null` ends an
   * earthquake at once; otherwise it ends by itself after `quakeHoldMs`.
   */
  addBoard(data: Partial<Omit<BoardData, "quake">> & { quake?: BoardData["quake"] | null }): void {
    if (data.connected !== undefined) this.connected = data.connected;
    if (data.quake === null) this.quake = undefined;
    else if (data.quake) {
      this.quake = data.quake;
      this.quakeAt = this.now();
    }
    const samples = data.samples ?? [];
    this.boardSamples.push(...samples);
    this.trim(this.boardSamples);
    this.send({ t: "board", board: { ...this.boardState(), samples } });
  }

  /** Link state and the earthquake, if it is still going on. */
  private boardState(): Omit<BoardData, "samples"> {
    if (this.quake && this.now() - this.quakeAt > this.quakeHoldMs) this.quake = undefined;
    return this.quake ? { connected: this.connected, quake: this.quake } : { connected: this.connected };
  }

  /** An accepted command, for the change marks of the snapshot. Kept as long as the metrics. */
  addMark(name: string): void {
    this.marks.push({ time: this.now(), name });
    this.trim(this.marks);
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
    this.trim(this.marks);
    return {
      t: "snapshot",
      state: this.state,
      params: this.params,
      metrics: [...this.metrics],
      board: { ...this.boardState(), samples: [...this.boardSamples] },
      events: [...this.events],
      marks: [...this.marks],
    };
  }

  private trim(samples: { time: number }[]): void {
    const from = this.now() - this.historyMs;
    let i = 0;
    while (i < samples.length && samples[i]!.time < from) i++;
    if (i > 0) samples.splice(0, i);
  }
}
