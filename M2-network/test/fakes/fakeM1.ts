// Fake M1 for the M2 tests and demos (M2-3).
// It makes a moving test state 30 times per second, in the shape of M1-1's
// `buildGameState` and `buildBoardState` (#78), gives metrics twice per second,
// and writes down every input that M2 gives it.
import type { NetMeasure } from "../../src/broadcast/broadcastHub.js";
import type { MetricSample } from "../../src/broadcast/adminFeed.js";
import type { FrozenTick } from "../../src/broadcast/stateBroadcaster.js";
import type { PlayerEvents, Session } from "../../src/session/types.js";

export type M1Input =
  | { tick: number; type: "join"; playerKey: string; playerNo: number; name: string; team: number }
  | { tick: number; type: "lost" | "returned"; playerKey: string; playerNo: number }
  | { tick: number; type: "message"; connId: number; role: Session["role"]; playerNo?: number; msg: unknown };

export interface FakeM1Options {
  tickHz?: number;
  players?: number;
  now?: () => number;
}

const CITY_M = 500;

export class FakeM1 implements PlayerEvents {
  readonly inputs: M1Input[] = [];
  /** What M2 measured, as M1 got it (twice per second). */
  readonly measures: NetMeasure[][] = [];
  tick = 0;
  private readonly tickHz: number;
  private readonly players: number;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private latestMeasures: NetMeasure[] = [];

  constructor(opts: FakeM1Options = {}) {
    this.tickHz = opts.tickHz ?? 30;
    this.players = opts.players ?? 8;
    this.now = opts.now ?? Date.now;
  }

  join(e: { playerKey: string; playerNo: number; name: string; team: number }): void {
    this.inputs.push({ tick: this.tick, type: "join", ...e });
  }
  lost(e: { playerKey: string; playerNo: number }): void {
    this.inputs.push({ tick: this.tick, type: "lost", ...e });
  }
  returned(e: { playerKey: string; playerNo: number }): void {
    this.inputs.push({ tick: this.tick, type: "returned", ...e });
  }

  /** Any other checked message that M2 gives to M1 (controls, "Find me", admin commands). */
  input(session: Session, msg: unknown): void {
    this.inputs.push({ tick: this.tick, type: "message", connId: session.connId, role: session.role, playerNo: session.playerNo, msg });
  }

  /** M2's network measurements (`toM1`). */
  net(measures: NetMeasure[]): void {
    this.latestMeasures = measures;
    this.measures.push(measures);
  }

  /** One tick forward. The players ride around the city at different speeds. */
  frame(): FrozenTick {
    this.tick++;
    const t = this.tick / this.tickHz;
    const players = Array.from({ length: this.players }, (_, i) => {
      const angle = t * (0.05 + i * 0.01) + (i * Math.PI) / 4;
      const x = CITY_M / 2 + Math.cos(angle) * (60 + i * 20);
      const y = CITY_M / 2 + Math.sin(angle) * (60 + i * 20);
      return {
        index: i,
        team: i % 4,
        name: `bot ${i}`,
        isBot: false,
        connected: true,
        pose: { x, y, heading: ((angle * 180) / Math.PI + 90) % 360, speed: 8 + i, fallen: false },
        control: { throttle: 1, brake: 0, steer: 0.1, seq: this.tick },
        delivery: { hasPackage: i % 2 === 0, targetPoint: i, compassX: 100 * (i % 5), compassY: 100 * Math.floor(i / 2), findMeCooldown: 0 },
        penaltySeconds: 0,
      };
    });
    const game = {
      tick: this.tick,
      phase: "playing",
      gameTimeSeconds: t,
      remainingSeconds: Math.max(0, 300 - t),
      players,
      scores: [0, 1, 2, 3].map((team) => ({ team, score: Math.floor(t / (5 + team)) * 100 })),
      obstacles: [{ id: 1, type: "road_work", segment: 12, lane: 0, pos: 0.5 }],
      obstacleVersion: 1,
      quake: null,
      npcCars: Array.from({ length: 20 }, (_, i) => ({ id: i, x: (t * 10 + i * 25) % CITY_M, y: 100 * (i % 6), heading: 90, speed: 10 })),
    };
    const board = {
      ph: "playing",
      tl: Math.round(game.remainingSeconds),
      p: players.map((p) => ({ team: p.team, color: p.index % 2, x: p.pose.x, y: p.pose.y, fallen: false, findMe: false })),
      dp: players.map((p) => ({ team: p.team, x: p.delivery.compassX, y: p.delivery.compassY })),
      ob: [{ type: "road_work", segment: 12, lane: 0, pos: 0.5 }],
      eq: null,
    };
    return { tick: this.tick, game, board };
  }

  /** All metrics, as M1 gives them twice per second. The network values come from M2. */
  metrics(): MetricSample[] {
    const time = this.now();
    const out: MetricSample[] = [0, 1, 2, 3].map((team) => ({ name: `score.${team}`, time, value: Math.floor(this.tick / 30 / (5 + team)) * 100 }));
    for (const m of this.latestMeasures) {
      out.push(
        { name: `net.${m.playerNo}.ping_ms`, time, value: m.rttMs },
        { name: `net.${m.playerNo}.jitter_ms`, time, value: m.jitterMs },
        { name: `net.${m.playerNo}.fps`, time, value: m.fps },
      );
    }
    return out;
  }

  /**
   * Runs the loop: a state every tick, metrics every half second.
   * Fixed step like M1-1: the timer only wakes the loop, and the loop makes as many ticks as
   * the clock asks for, so the rate stays at 30 per second even with coarse timers (Windows).
   */
  run(out: { publish(f: FrozenTick): void; metrics(s: MetricSample[]): void }): void {
    const every = Math.round(this.tickHz / 2);
    const start = performance.now();
    const firstTick = this.tick;
    this.timer = setInterval(() => {
      const due = firstTick + Math.floor(((performance.now() - start) * this.tickHz) / 1000);
      while (this.tick < due) {
        out.publish(this.frame());
        if (this.tick % every === 0) out.metrics(this.metrics());
      }
    }, 4);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
