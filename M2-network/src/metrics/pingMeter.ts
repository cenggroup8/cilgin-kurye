/**
 * Ping and measurements (M2-3, v2.1 section 6.5 "Measuring the network").
 *
 * Twice per second the server sends a ping with its own time. The phone answers with its
 * own time, its frame rate and the number of the last state it got. From this come the round
 * trip time, the jitter and the clock offset of the phone.
 *
 * On WebSocket a lost Wi-Fi packet is sent again by TCP, so it shows as a jump in the delay,
 * not as a missing message. So for phones M2 reports ping and jitter, not loss.
 *
 * Draft messages until #35:
 *   server → phone  {t:"ping", id, st}             st = server time (ms)
 *   phone → server  {t:"pong", id, ct, fps, last}  ct = phone time (ms), last = last state seq
 */

export interface PingMessage {
  t: "ping";
  id: number;
  st: number;
}

export interface NetSample {
  /** Round trip time of the last ping (ms). */
  rttMs: number;
  /** Smoothed change of the round trip time (RFC 3550 style, ms). */
  jitterMs: number;
  /** Phone clock minus server clock (ms), from the middle of the round trip. */
  offsetMs: number;
  /** Frame rate that the phone reports. */
  fps: number;
  /** Number of the last state the phone got. */
  lastState: number;
  /** Server time of the last answer. */
  at: number;
  /** Pings sent and answered, for a rough check. */
  sent: number;
  answered: number;
}

const KEEP_PINGS = 8;

interface Link {
  pending: Map<number, number>;
  sample?: NetSample;
  sent: number;
  answered: number;
}

export class PingMeter {
  private readonly links = new Map<number, Link>();
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now) {}

  /** A new ping for this link. The caller sends it. */
  ping(connId: number): PingMessage {
    const link = this.link(connId);
    const id = this.nextId++;
    const st = this.now();
    link.pending.set(id, st);
    link.sent++;
    // An unanswered ping is forgotten after a while, so the map stays small.
    if (link.pending.size > KEEP_PINGS) link.pending.delete(link.pending.keys().next().value!);
    return { t: "ping", id, st };
  }

  /** An answer from the phone. Returns the new sample, or undefined for a bad or unknown answer. */
  pong(connId: number, msg: unknown): NetSample | undefined {
    const link = this.links.get(connId);
    if (!link || typeof msg !== "object" || msg === null) return undefined;
    const m = msg as { id?: unknown; ct?: unknown; fps?: unknown; last?: unknown };
    if (typeof m.id !== "number") return undefined;
    const sentAt = link.pending.get(m.id);
    if (sentAt === undefined) return undefined;
    if (!finite(m.ct) || !finite(m.fps) || m.fps < 0 || m.fps > 1000) return undefined;
    if (!Number.isInteger(m.last) || (m.last as number) < -1) return undefined;
    link.pending.delete(m.id);
    // Older pings that were not answered are lost; a newer answer replaces them.
    for (const id of link.pending.keys()) if (id < m.id) link.pending.delete(id);

    const at = this.now();
    const rttMs = Math.max(0, at - sentAt);
    const prev = link.sample;
    const jitterMs = prev ? prev.jitterMs + (Math.abs(rttMs - prev.rttMs) - prev.jitterMs) / 16 : 0;
    link.answered++;
    link.sample = {
      rttMs,
      jitterMs,
      offsetMs: m.ct - (sentAt + rttMs / 2),
      fps: m.fps,
      lastState: m.last as number,
      at,
      sent: link.sent,
      answered: link.answered,
    };
    return link.sample;
  }

  get(connId: number): NetSample | undefined {
    return this.links.get(connId)?.sample;
  }

  /** Keeps only these links; the others closed. */
  keep(connIds: Iterable<number>): void {
    const alive = new Set(connIds);
    for (const id of this.links.keys()) if (!alive.has(id)) this.links.delete(id);
  }

  private link(connId: number): Link {
    let l = this.links.get(connId);
    if (!l) this.links.set(connId, (l = { pending: new Map(), sent: 0, answered: 0 }));
    return l;
  }
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
