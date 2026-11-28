// Graph engine, data part (M5-4, #51). No DOM: everything here runs in a test.
//
// It takes the updates of the communication manager (M5-1, `AdminConnection.subscribe`)
// and keeps:
//   - every metric and board sample as a time series (server time, ms)
//   - change marks: one for every accepted command, with the parameter or command name
//   - earthquake marks: strength, zone and source, from the board data
// The view (`view.ts`) draws from it, and the CSV file (`csv.ts`) is written from it, so the
// file holds exactly the values that the graphs show.

import type { AdminUpdate } from '../comm/connection.ts';
import type { BoardData, MetricSample } from '../comm/protocol.ts';

export interface Point { time: number; value: number }

export interface Mark {
  /** Server time (ms). */
  time: number;
  kind: 'change' | 'quake';
  /** Change: the parameter or command name. Quake: a short text such as "M6.0 · bölge 4 · el". */
  label: string;
  /** Quake only. */
  mag?: number;
  zone?: number;
  source?: QuakeSource;
}

/** Where an earthquake came from. The board data may not say it yet (#51, open point). */
export type QuakeSource = 'hand' | 'motors' | 'admin' | 'unknown';

export interface ModelOptions {
  /** How long samples are kept (ms). The CSV file and the "all" window go this far back. */
  keepMs?: number;
  /** Most points kept per series; the oldest go first (the seismic signal is the fast one). */
  maxPoints?: number;
  now?: () => number;
}

/** Board samples that are events and not a signal: they become quake marks, not a line. */
const QUAKE_SAMPLE = /^quake\.mag$/;
/** Two quake reports closer than this are the same earthquake. */
const SAME_QUAKE_MS = 2000;
/** Two marks of the same change closer than this are one. */
const SAME_CHANGE_MS = 1500;

const ZONES = ['kuzeybatı', 'kuzey', 'kuzeydoğu', 'batı', 'merkez', 'doğu', 'güneybatı', 'güney', 'güneydoğu'];
const SOURCES: Record<QuakeSource, string> = { hand: 'el', motors: 'motor', admin: 'yönetici', unknown: '' };

/** For example "M6.0 · merkez · el". `zone` −1 is the whole board; undefined: not known. */
export function quakeLabel(mag: number, zone: number | undefined, source: QuakeSource): string {
  const where = zone === undefined ? '' : zone < 0 ? 'tüm tahta' : ZONES[zone] ?? `bölge ${zone}`;
  const from = SOURCES[source];
  return [`M${mag.toFixed(1)}`, where, from].filter(Boolean).join(' · ');
}

function sourceOf(v: unknown): QuakeSource {
  switch (v) {
    case 'hand': case 'hit': return 'hand';
    case 'motors': case 'motor': return 'motors';
    case 'admin': return 'admin';
    default: return 'unknown';
  }
}

/**
 * Admin clock to server clock. A change mark is made in the admin's browser (`Date.now()`),
 * but the samples carry the server's time; on another laptop the two clocks differ.
 * Every batch of samples gives "server time − local time" plus the network delay; the
 * largest of the last ones is the best guess, because a delay only makes it smaller.
 */
export class ServerClock {
  private readonly recent: number[] = [];
  private offset = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  observe(serverTime: number): void {
    if (!Number.isFinite(serverTime)) return;
    this.recent.push(serverTime - this.now());
    if (this.recent.length > 20) this.recent.shift();
    this.offset = Math.max(...this.recent);
  }

  /** Local time (ms) to server time (ms). */
  toServer(localTime: number): number {
    return localTime + this.offset;
  }

  /** Server time now. */
  serverNow(): number {
    return this.toServer(this.now());
  }
}

export class GraphModel {
  /** Goes up on every change, so the view redraws only when it must. */
  version = 0;
  boardConnected: boolean | null = null;
  connection: string = 'connecting';

  private readonly series = new Map<string, Point[]>();
  private readonly marks: Mark[] = [];
  private readonly keepMs: number;
  private readonly maxPoints: number;
  readonly clock: ServerClock;
  private lastQuake: { mag: number; zone: number } | undefined;

  constructor(options: ModelOptions = {}) {
    this.keepMs = options.keepMs ?? 15 * 60_000;
    this.maxPoints = options.maxPoints ?? 30_000;
    this.clock = new ServerClock(options.now ?? Date.now);
  }

  /** Every update of the communication manager. Returns true when something changed. */
  apply(update: AdminUpdate): boolean {
    switch (update.t) {
      case 'snapshot':
        // The recent history after a (re)connect. Series are merged, not cleared, so what the
        // page already had stays, and marks made on this page are kept.
        this.addSamples(update.metrics);
        this.addBoard(update.board);
        this.addSnapshotMarks((update as { marks?: unknown }).marks);
        return this.bump();
      case 'metrics':
        this.addSamples(update.samples);
        return this.bump();
      case 'board':
        this.addBoard(update.board);
        return this.bump();
      case 'mark':
        this.addMark({ time: this.clock.toServer(update.mark.time), kind: 'change', label: update.mark.name });
        return this.bump();
      case 'connection':
        this.connection = update.status;
        return this.bump();
      default:
        return false;
    }
  }

  /** Names of all series, sorted. */
  names(): string[] {
    return [...this.series.keys()].sort();
  }

  /** Points of one series, oldest first. */
  points(name: string): readonly Point[] {
    return this.series.get(name) ?? [];
  }

  /** All marks, oldest first. */
  allMarks(): readonly Mark[] {
    return this.marks;
  }

  /** Time of the newest sample (server ms), or the server time now when there is none. */
  latestTime(): number {
    let t = -Infinity;
    for (const pts of this.series.values()) if (pts.length) t = Math.max(t, pts[pts.length - 1]!.time);
    return Number.isFinite(t) ? t : this.clock.serverNow();
  }

  /** Time of the oldest kept sample. */
  earliestTime(): number {
    let t = Infinity;
    for (const pts of this.series.values()) if (pts.length) t = Math.min(t, pts[0]!.time);
    return Number.isFinite(t) ? t : this.latestTime();
  }

  // ---- inside ----

  private addBoard(board: BoardData): void {
    this.boardConnected = board.connected;
    this.addSamples(board.samples);
    const q = board.quake as (BoardData['quake'] & { source?: unknown }) | undefined;
    if (q && Number.isFinite(q.mag) && Number.isFinite(q.zone)) {
      const changed = !this.lastQuake || this.lastQuake.mag !== q.mag || this.lastQuake.zone !== q.zone;
      if (changed) {
        const time = board.samples.length ? Math.max(...board.samples.map((s) => s.time)) : this.clock.serverNow();
        this.addQuake(time, q.mag, q.zone, sourceOf(q.source));
      }
    }
    this.lastQuake = q ? { mag: q.mag, zone: q.zone } : undefined;
  }

  /**
   * `snapshot.marks` (contracts/messages.md, optional): the commands accepted in the last two
   * minutes, already at server time, so the lines come back after a page reload.
   */
  private addSnapshotMarks(marks: unknown): void {
    if (!Array.isArray(marks)) return;
    for (const m of marks) {
      const { time, name } = (m ?? {}) as { time?: unknown; name?: unknown };
      if (typeof name === 'string' && name && typeof time === 'number' && Number.isFinite(time)) {
        this.addMark({ time, kind: 'change', label: name });
      }
    }
  }

  private addSamples(samples: readonly MetricSample[]): void {
    let newest = -Infinity;
    for (const s of samples) {
      if (typeof s?.name !== 'string' || !Number.isFinite(s.time) || !Number.isFinite(s.value)) continue;
      newest = Math.max(newest, s.time);
      if (QUAKE_SAMPLE.test(s.name)) {
        // The fake server (and the history after a reconnect) gives an earthquake as a sample.
        this.addQuake(s.time, s.value, undefined, 'unknown');
        continue;
      }
      this.addPoint(s.name, { time: s.time, value: s.value });
    }
    if (Number.isFinite(newest)) this.clock.observe(newest);
    this.trim();
  }

  private addPoint(name: string, p: Point): void {
    let pts = this.series.get(name);
    if (!pts) this.series.set(name, (pts = []));
    const last = pts[pts.length - 1];
    if (!last || p.time > last.time) {
      pts.push(p);
      return;
    }
    // Older or the same time: history after a reconnect. Keep one point per time.
    let lo = 0;
    let hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.time < p.time) lo = mid + 1;
      else hi = mid;
    }
    if (pts[lo]?.time === p.time) pts[lo] = p;
    else pts.splice(lo, 0, p);
  }

  private addQuake(time: number, mag: number, zone: number | undefined, source: QuakeSource): void {
    // The same earthquake can come as board data and as a sample: keep one mark, with the most detail.
    const same = this.marks.find((m) => m.kind === 'quake' && Math.abs(m.time - time) < SAME_QUAKE_MS && m.mag === mag);
    if (same) {
      if (same.zone === undefined) same.zone = zone;
      if (same.source === 'unknown') same.source = source;
      same.label = quakeLabel(mag, same.zone, same.source ?? 'unknown');
      return;
    }
    this.addMark({ time, kind: 'quake', label: quakeLabel(mag, zone, source), mag, zone, source });
  }

  private addMark(m: Mark): void {
    // The same change twice within a moment (a form that sends on Enter and on change) is one line.
    if (m.kind === 'change' && this.marks.some((x) => x.kind === 'change' && x.label === m.label && Math.abs(x.time - m.time) < SAME_CHANGE_MS)) return;
    const at = this.marks.findIndex((x) => x.time > m.time);
    if (at < 0) this.marks.push(m);
    else this.marks.splice(at, 0, m);
  }

  private trim(): void {
    const from = this.latestTime() - this.keepMs;
    for (const [name, pts] of this.series) {
      let cut = 0;
      while (cut < pts.length && pts[cut]!.time < from) cut++;
      // Cut in steps, so a long run does not move the array on every sample.
      const over = pts.length - this.maxPoints;
      if (over > 0) cut = Math.max(cut, over + Math.floor(this.maxPoints / 10));
      if (cut > 0) pts.splice(0, cut);
      if (pts.length === 0) this.series.delete(name);
    }
    while (this.marks.length && this.marks[0]!.time < from) this.marks.shift();
  }

  private bump(): true {
    this.version++;
    return true;
  }
}
