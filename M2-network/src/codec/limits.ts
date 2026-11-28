import type { Role } from "../session/types.js";

/**
 * Limits for each link (M2-2, v2.1 section 6.5: "Each session also has a limit on the
 * number and size of its messages, so one phone cannot flood the server").
 *
 * It runs on the raw bytes, before the message is decoded, so a flood costs the server
 * almost nothing. Numbers: contracts/messages.md, "Limits for each link".
 */
export interface LinkLimits {
  /** Largest single message in bytes. */
  maxBytes: number;
  /** Messages in one second. */
  perSecond: number;
  /** Bytes in one second. */
  bytesPerSecond: number;
}

export const LIMITS: Readonly<Record<Role, LinkLimits>> = {
  player: { maxBytes: 1024, perSecond: 60, bytesPerSecond: 16 * 1024 },
  admin: { maxBytes: 16 * 1024, perSecond: 50, bytesPerSecond: 128 * 1024 },
};

export type Admit = { ok: true } | { ok: false; reason: "too_big" | "too_many"; /** Answer the link (at most once per second for too_many). */ tell: boolean };

interface Window {
  start: number;
  msgs: number;
  bytes: number;
  told: boolean;
}

export interface LimiterStats {
  tooBig: number;
  tooMany: number;
}

/**
 * Counts the messages and bytes of each link in a one second window.
 * A message over a limit is refused; it is not counted, so a link that slows down
 * gets through again in the next second.
 */
export class Limiter {
  readonly stats: LimiterStats = { tooBig: 0, tooMany: 0 };
  private readonly windows = new Map<number, Window>();
  private calls = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limits: Readonly<Record<Role, LinkLimits>> = LIMITS,
  ) {}

  admit(connId: number, role: Role, bytes: number): Admit {
    const lim = this.limits[role];
    if (bytes > lim.maxBytes) {
      this.stats.tooBig++;
      return { ok: false, reason: "too_big", tell: true };
    }
    const t = this.now();
    if (++this.calls % 512 === 0) this.prune(t);
    let w = this.windows.get(connId);
    if (!w || t - w.start >= 1000) {
      w = { start: t, msgs: 0, bytes: 0, told: false };
      this.windows.set(connId, w);
    }
    if (w.msgs + 1 > lim.perSecond || w.bytes + bytes > lim.bytesPerSecond) {
      this.stats.tooMany++;
      const tell = !w.told;
      w.told = true;
      return { ok: false, reason: "too_many", tell };
    }
    w.msgs++;
    w.bytes += bytes;
    return { ok: true };
  }

  /** The link closed. */
  forget(connId: number): void {
    this.windows.delete(connId);
  }

  /** Windows of links that sent nothing for a while go away, so closed links are not kept. */
  private prune(t: number): void {
    for (const [id, w] of this.windows) if (t - w.start > 5000) this.windows.delete(id);
  }
}
