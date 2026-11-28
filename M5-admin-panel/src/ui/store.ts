import type { AdminUpdate, ConnectionStatus } from '../comm/connection.ts';
import type { AdminState, BoardData, ChangeMark, LogEntry, MetricSample } from '../comm/protocol.ts';

// What the admin page knows, built only from the messages of the communication manager (M5-1).
// Pages read from here and redraw when it changes; nothing here is made up: a value that the
// server has not sent is `undefined`, and the page shows a dash for it.

export interface MetricSeries {
  name: string;
  /** Oldest first, at most `HISTORY` samples. */
  samples: MetricSample[];
  latest: MetricSample;
}

const HISTORY = 240; // two minutes at two samples per second
const EVENTS = 200;

export class AdminStore {
  status: ConnectionStatus = 'connecting';
  state?: AdminState;
  board?: BoardData;
  lastMark?: ChangeMark;
  /** A full snapshot has come since the page opened. */
  synced = false;
  /**
   * Grows by one each time that part of the data changes, so a view can skip a redraw when
   * its own data is the same (a state comes 10 times per second, metrics only twice).
   */
  readonly versions = { status: 0, state: 0, metrics: 0, board: 0, events: 0, mark: 0 };
  readonly metrics = new Map<string, MetricSeries>();
  readonly events: LogEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private scheduled = false;

  private readonly schedule: (run: () => void) => void;

  constructor(schedule: (run: () => void) => void = (run) => queueMicrotask(run)) {
    this.schedule = schedule;
  }

  /** Feeds one update of `AdminConnection.subscribe()`. */
  apply(update: AdminUpdate): void {
    switch (update.t) {
      case 'connection':
        this.status = update.status;
        this.versions.status++;
        break;
      case 'snapshot':
        this.state = update.state;
        this.board = update.board;
        this.metrics.clear();
        this.addSamples(update.metrics);
        this.addSamples(update.board.samples);
        this.events.length = 0;
        this.addEvents(update.events);
        this.synced = true;
        this.versions.state++;
        this.versions.metrics++;
        this.versions.board++;
        this.versions.events++;
        break;
      case 'state':
        this.state = update.state;
        this.versions.state++;
        break;
      case 'metrics':
        this.addSamples(update.samples);
        this.versions.metrics++;
        break;
      case 'board':
        this.board = update.board;
        this.addSamples(update.board.samples);
        this.versions.board++;
        this.versions.metrics++;
        break;
      case 'event':
        this.addEvents([update.entry]);
        this.versions.events++;
        break;
      case 'mark':
        this.lastMark = update.mark;
        this.versions.mark++;
        break;
      default:
        return; // params and param belong to the parameter manager
    }
    this.changed();
  }

  /** A log line made on this page (for example the answer to a command). */
  log(entry: LogEntry): void {
    this.addEvents([entry]);
    this.versions.events++;
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  value(name: string): number | undefined {
    return this.metrics.get(name)?.latest.value;
  }

  /** Values of every metric whose name matches, for example `net.<p>.ping_ms`. */
  matching(pattern: RegExp): Array<{ name: string; match: RegExpExecArray; value: number }> {
    const out: Array<{ name: string; match: RegExpExecArray; value: number }> = [];
    for (const [name, series] of this.metrics) {
      const match = pattern.exec(name);
      if (match) out.push({ name, match, value: series.latest.value });
    }
    return out;
  }

  private addSamples(samples: readonly MetricSample[]): void {
    for (const sample of samples) {
      let series = this.metrics.get(sample.name);
      if (!series) {
        series = { name: sample.name, samples: [], latest: sample };
        this.metrics.set(sample.name, series);
      }
      // Samples can come twice (a snapshot after a reconnect repeats the history).
      const last = series.samples.at(-1);
      if (last && sample.time < last.time) continue;
      if (last && sample.time === last.time) {
        series.samples[series.samples.length - 1] = sample;
      } else {
        series.samples.push(sample);
        if (series.samples.length > HISTORY) series.samples.splice(0, series.samples.length - HISTORY);
      }
      series.latest = series.samples.at(-1)!;
    }
  }

  private addEvents(entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      if (!this.events.some((e) => e.time === entry.time && e.message === entry.message)) this.events.push(entry);
    }
    this.events.sort((a, b) => b.time - a.time);
    if (this.events.length > EVENTS) this.events.length = EVENTS;
  }

  /** Many messages in one moment cause one redraw. */
  private changed(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      for (const listener of this.listeners) listener();
    });
  }
}

// ── Values the pages show, all derived from the store ─────────────────────────

export const TEAMS = 4;

export interface TeamRow {
  team: number;
  score?: number;
  players: number;
  fallen: number;
}

export function teamRows(store: AdminStore): TeamRow[] {
  const rows: TeamRow[] = Array.from({ length: TEAMS }, (_, team) => ({
    team, score: store.value(`score.${team}`), players: 0, fallen: 0,
  }));
  for (const p of store.state?.players ?? []) {
    const row = rows[p.team];
    if (!row) continue;
    row.players++;
    if (p.fallen) row.fallen++;
  }
  return rows;
}

export interface PlayerNet {
  player: number;
  pingMs?: number;
  jitterMs?: number;
  lossPct?: number;
  fps?: number;
}

/** Measured network values per player (`net.<p>.ping_ms|jitter_ms|loss_pct|fps`). */
export function playerNet(store: AdminStore): PlayerNet[] {
  const rows = new Map<number, PlayerNet>();
  for (const { match, value } of store.matching(/^net\.(\d+)\.(ping_ms|jitter_ms|loss_pct|fps)$/)) {
    const player = Number(match[1]);
    const row = rows.get(player) ?? { player };
    if (match[2] === 'ping_ms') row.pingMs = value;
    else if (match[2] === 'jitter_ms') row.jitterMs = value;
    else if (match[2] === 'loss_pct') row.lossPct = value;
    else row.fps = value;
    rows.set(player, row);
  }
  return [...rows.values()].sort((a, b) => a.player - b.player);
}

export function average(values: readonly (number | undefined)[]): number | undefined {
  const real = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  return real.length === 0 ? undefined : real.reduce((a, b) => a + b, 0) / real.length;
}

/**
 * The mean of several series at each moment they were all measured, for example the mean
 * ping of all phones. The server sends them together twice per second, so equal times match.
 */
export function averageSeries(store: AdminStore, pattern: RegExp): MetricSample[] {
  const byTime = new Map<number, number[]>();
  for (const [name, series] of store.metrics) {
    if (!pattern.test(name)) continue;
    for (const s of series.samples) {
      const list = byTime.get(s.time) ?? [];
      list.push(s.value);
      byTime.set(s.time, list);
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, values]) => ({ name: 'average', time, value: values.reduce((a, b) => a + b, 0) / values.length }));
}

export interface Couriers {
  total: number;
  riding: number;
  fallen: number;
  points: number;
  obstacles: Map<string, number>;
}

/** Couriers, delivery points and obstacles in the newest state; undefined before the first state. */
export function couriers(store: AdminStore): Couriers | undefined {
  const state = store.state;
  if (!state) return undefined;
  const fallen = state.players.filter((p) => p.fallen).length;
  const obstacles = new Map<string, number>();
  for (const o of state.obstacles) obstacles.set(o.type, (obstacles.get(o.type) ?? 0) + 1);
  return { total: state.players.length, riding: state.players.length - fallen, fallen, points: state.deliveryPoints.length, obstacles };
}

/**
 * Runs `draw` only when `key()` gives something new. Views use it with the store versions,
 * so a table is not rebuilt (and does not lose hover or focus) when its data did not change.
 */
export function whenChanged(key: () => string, draw: () => void): (force?: boolean) => void {
  let last: string | undefined;
  return (force = false) => {
    const next = key();
    if (!force && next === last) return;
    last = next;
    draw();
  };
}
