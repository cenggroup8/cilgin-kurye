import type { SessionRegistry } from "../session/registry.js";
import type { Session } from "../session/types.js";
import { PingMeter } from "../metrics/pingMeter.js";
import { AdminFeed, type BoardData, type MetricSample, type ParamRow } from "./adminFeed.js";
import { smallAdminState, StateBroadcaster, type BoardSink, type BroadcastStats, type FrozenTick } from "./stateBroadcaster.js";

/**
 * M2-3 in the server: state broadcaster, ping and measurements, admin feed.
 *
 *   M1 → publish(frozen)   every tick: same bytes to all phones, smaller state to the admin,
 *                          board state to the board link
 *   M2 → M1 (toM1)         twice per second: ping, jitter, clock offset, frame rate and the
 *                          last state of every phone
 *   M1 → metrics(samples)  twice per second: all metrics, on to the admin with a short history
 *   M2-4 → board(data)     board link state, sensor samples, earthquakes, on to the admin
 *   M1 → commandAccepted() an admin command that M1-5 accepted: a change mark for the snapshot
 *   M1-5 → netParam()      frame rate limit of one phone (`net.<p>.fps_limit`), sent to that
 *                          phone as `net {fps_limit}` when it changes and when the phone joins
 *                          or comes back (contracts/messages.md)
 */

/** One phone's measurements for M1 (plan #24 section 3.2, "Ağ ölçümleri"). */
export interface NetMeasure {
  playerNo: number;
  rttMs: number;
  jitterMs: number;
  offsetMs: number;
  fps: number;
  lastState: number;
  /** Ticks between the newest state and the last state the phone got. */
  lagTicks: number;
}

export interface HubServer {
  registry: SessionRegistry;
  send(connId: number, msg: unknown): void;
  sendRaw(connId: number, bytes: Uint8Array): void;
  buffered?(connId: number): number;
}

export interface HubOptions {
  server: HubServer;
  toM1?: (measures: NetMeasure[]) => void;
  board?: BoardSink;
  /** Ping period; the document says twice per second. */
  pingMs?: number;
  /** Turn off to drive `pingRound()` by hand in tests. */
  timers?: boolean;
  adminView?: (game: unknown) => unknown;
  historyMs?: number;
  now?: () => number;
}

export interface BroadcastHub {
  publish(frozen: FrozenTick): void;
  metrics(samples: MetricSample[]): void;
  /** `quake: null` ends an earthquake at once; otherwise it ends by itself (AdminFeed). */
  board(data: Partial<Omit<BoardData, "quake">> & { quake?: BoardData["quake"] | null }): void;
  params(list: ParamRow[]): void;
  paramChanged(name: string, value: number): void;
  /**
   * A frame rate limit for one phone, for the M4 sink of M1-5. Returns false for any other
   * parameter name. `paramChanged` and `params` take these names too.
   */
  netParam(name: string, value: number): boolean;
  event(message: string): void;
  /**
   * An admin command that M1-5 accepted (its `reply` has `ok: true`). The snapshot gives it
   * back as a change mark: the parameter's name for `param_set`, the command's name otherwise.
   */
  commandAccepted(name: string, args?: Record<string, unknown>): void;
  /** Gives the messages of M2-3 to this part. Returns false for messages of other parts. */
  onMessage(session: Session, msg: unknown): boolean;
  /** Sends a ping to every phone and gives the newest measurements to M1. */
  pingRound(): NetMeasure[];
  measures(): NetMeasure[];
  stats(): BroadcastStats;
  close(): void;
}

export function attachBroadcast(opts: HubOptions): BroadcastHub {
  const { server } = opts;
  const now = opts.now ?? Date.now;
  const adminView = opts.adminView ?? smallAdminState;
  const meter = new PingMeter(now);
  const sendAdmin = (msg: unknown) => {
    const admin = server.registry.adminConn;
    if (admin !== null) server.send(admin, msg);
  };
  const feed = new AdminFeed(sendAdmin, { historyMs: opts.historyMs, now });
  const broadcaster = new StateBroadcaster(
    {
      players: () => server.registry.playerConns().map((c) => c.connId),
      admin: () => server.registry.adminConn,
      sendBytes: (connId, bytes) => server.sendRaw(connId, bytes),
      backlog: server.buffered ? (connId) => server.buffered!(connId) : undefined,
    },
    { adminView, board: opts.board, now },
  );
  let lastTick = -1;
  let lastGame: unknown = null;
  // Frame rate limit of each player number, and the value each phone link last got.
  const fpsLimits = new Map<number, number>();
  const fpsSent = new Map<number, number>();

  function netParam(name: string, value: number): boolean {
    const m = /^net\.(\d+)\.fps_limit$/.exec(name);
    if (!m) return false;
    if (!Number.isInteger(value) || value < 0 || value > 120) return true; // not a contract value
    fpsLimits.set(Number(m[1]), value);
    syncNet();
    return true;
  }

  /** Sends `net` to every phone whose link has not got its current limit yet. */
  function syncNet(): void {
    if (fpsLimits.size === 0) return;
    const live = new Set<number>();
    for (const { connId, playerNo } of server.registry.playerConns()) {
      live.add(connId);
      const limit = fpsLimits.get(playerNo);
      if (limit === undefined || fpsSent.get(connId) === limit) continue;
      fpsSent.set(connId, limit);
      server.send(connId, { t: "net", fps_limit: limit });
    }
    for (const connId of fpsSent.keys()) if (!live.has(connId)) fpsSent.delete(connId);
  }

  function measures(): NetMeasure[] {
    const out: NetMeasure[] = [];
    for (const { connId, playerNo } of server.registry.playerConns()) {
      const s = meter.get(connId);
      if (!s) continue;
      out.push({
        playerNo,
        rttMs: s.rttMs,
        jitterMs: s.jitterMs,
        offsetMs: s.offsetMs,
        fps: s.fps,
        lastState: s.lastState,
        lagTicks: s.lastState < 0 ? 0 : Math.max(0, lastTick - s.lastState),
      });
    }
    return out.sort((a, b) => a.playerNo - b.playerNo);
  }

  function pingRound(): NetMeasure[] {
    const conns = server.registry.playerConns();
    meter.keep(conns.map((c) => c.connId));
    for (const { connId } of conns) server.send(connId, meter.ping(connId));
    const m = measures();
    if (m.length > 0) opts.toM1?.(m);
    return m;
  }

  const timer = opts.timers === false ? undefined : setInterval(pingRound, opts.pingMs ?? 500);

  return {
    publish(frozen) {
      lastTick = frozen.tick;
      lastGame = frozen.game;
      broadcaster.publish(frozen);
      // A phone that joined or came back since the last tick gets its limit here.
      syncNet();
    },
    metrics: (samples) => feed.addMetrics(samples),
    board: (data) => feed.addBoard(data),
    params(list) {
      feed.setParams(list);
      for (const row of list) netParam(row.name, row.value);
    },
    paramChanged(name, value) {
      feed.paramChanged(name, value);
      netParam(name, value);
    },
    netParam,
    event: (message) => feed.event(message),
    commandAccepted(name, args) {
      feed.addMark(name === "param_set" && typeof args?.name === "string" ? args.name : name);
    },
    onMessage(session, msg) {
      const t = typeof msg === "object" && msg !== null ? (msg as { t?: unknown }).t : undefined;
      if (session.role === "player" && t === "pong") {
        meter.pong(session.connId, msg);
        return true;
      }
      if (session.role === "admin" && t === "snapshot_get") {
        feed.setState(lastGame === null ? null : adminView(lastGame));
        server.send(session.connId, feed.snapshot());
        return true;
      }
      return false;
    },
    pingRound,
    measures,
    stats: () => broadcaster.stats(),
    close() {
      clearInterval(timer);
    },
  };
}
