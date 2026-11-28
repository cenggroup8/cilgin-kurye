// Network emulator (M2-4, v2.1 section 6.5).
// Each player and the board have an up queue (to the server) and a down queue
// (from the server). Each queue adds a delay, a jitter and a loss chance.
// Loss is used only on messages that may be lost; the others always arrive.

export interface Scheduler {
  now(): number;
  after(ms: number, fn: () => void): void;
}

export const realScheduler: Scheduler = {
  now: () => performance.now(),
  after: (ms, fn) => void setTimeout(fn, ms),
};

/** Small seeded random number generator (mulberry32), so tests repeat. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface QueueSettings {
  delayMs: number;
  jitterMs: number;
  lossPct: number;
}

export const NO_EFFECT: QueueSettings = { delayMs: 0, jitterMs: 0, lossPct: 0 };

export interface QueueStats {
  pushed: number;
  dropped: number;
  delivered: number;
}

export interface QueueOptions {
  scheduler?: Scheduler;
  random?: () => number;
  /**
   * Keep the order (TCP and WebSocket). Jitter then never lets a message pass
   * the one before it. UDP queues are not ordered.
   */
  ordered: boolean;
}

export class NetemQueue<T> {
  settings: QueueSettings = { ...NO_EFFECT };
  readonly stats: QueueStats = { pushed: 0, dropped: 0, delivered: 0 };
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private lastAt = -Infinity;
  private waiting = 0;

  constructor(
    private readonly deliver: (msg: T) => void,
    private readonly opts: QueueOptions,
  ) {
    this.scheduler = opts.scheduler ?? realScheduler;
    this.random = opts.random ?? Math.random;
  }

  /** `droppable`: this message may be lost. */
  push(msg: T, droppable: boolean): void {
    this.stats.pushed++;
    const s = this.settings;
    if (droppable && s.lossPct > 0 && this.random() * 100 < s.lossPct) {
      this.stats.dropped++;
      return;
    }
    const plain = s.delayMs <= 0 && s.jitterMs <= 0;
    if (plain && this.waiting === 0) {
      this.stats.delivered++;
      this.deliver(msg);
      return;
    }
    const jitter = s.jitterMs > 0 ? (this.random() * 2 - 1) * s.jitterMs : 0;
    const now = this.scheduler.now(); // read once, so the wait below is never negative
    let at = now + Math.max(0, s.delayMs + jitter);
    if (this.opts.ordered) at = Math.max(at, this.lastAt);
    this.lastAt = at;
    this.waiting++;
    this.scheduler.after(at - now, () => {
      this.waiting--;
      this.stats.delivered++;
      this.deliver(msg);
    });
  }
}

/** Name of a link: a player number (0–7) or the board. */
export type LinkName = number | "board";

/** The up and down queue of one link. The two may carry different message types. */
export interface LinkQueues {
  up: { settings: QueueSettings };
  down: { settings: QueueSettings };
}

const FIELDS: Record<string, keyof QueueSettings> = {
  delay_ms: "delayMs",
  jitter_ms: "jitterMs",
  loss_pct: "lossPct",
};

/**
 * Settings of all queues. The admin changes them with the parameters
 * `net.<p>.<up|down>.<delay_ms|jitter_ms|loss_pct>` and `board.<up|down>.<...>`
 * (M1-5 sends every parameter with owner M2 to `setParam`).
 */
export class NetemSettings {
  private readonly values = new Map<string, QueueSettings>();
  private readonly listeners = new Set<(link: LinkName, dir: "up" | "down", s: QueueSettings) => void>();

  get(link: LinkName, dir: "up" | "down"): QueueSettings {
    return this.values.get(`${link}.${dir}`) ?? { ...NO_EFFECT };
  }

  set(link: LinkName, dir: "up" | "down", patch: Partial<QueueSettings>): void {
    const s = { ...this.get(link, dir), ...patch };
    this.values.set(`${link}.${dir}`, s);
    for (const l of this.listeners) l(link, dir, s);
  }

  /** Follows the settings of one link: the queues read them at once. */
  bind(link: LinkName, q: LinkQueues): () => void {
    q.up.settings = this.get(link, "up");
    q.down.settings = this.get(link, "down");
    const l = (name: LinkName, dir: "up" | "down", s: QueueSettings) => {
      if (name === link) q[dir].settings = s;
    };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Takes an admin parameter. Returns false when the name is not a network queue value. */
  setParam(name: string, value: number): boolean {
    const m = /^(?:net\.([0-7])|board)\.(up|down)\.(delay_ms|jitter_ms|loss_pct)$/.exec(name);
    if (!m) return false;
    const link: LinkName = m[1] === undefined ? "board" : Number(m[1]);
    this.set(link, m[2] as "up" | "down", { [FIELDS[m[3]!]!]: value });
    return true;
  }
}
