// Test game for the server emulator: makes board states (`S`) without M1.
// Riders drive along the roads of the city plan, delivery points come and go,
// obstacles appear and end, the phases follow the game (doc 5.5) and an
// earthquake makes a shock wave. Seeded, so the same seed gives the same game.
//
// Field meanings: contracts/board_protocol.md, section 4 (`S`).

import { clamp01, pointOnSegment, seededRandom, type CityPlan } from "../common/cityPlan.js";

export const PHASE = { lobby: 0, countdown: 1, game: 2, pause: 3, end: 4 } as const;

export const FLAG = { inGame: 1, fallen: 2, package: 4, bot: 8, findMe: 16 } as const;

export interface ScenarioOptions {
  seed?: number;
  /** Seconds of each phase. */
  lobbyS?: number;
  countdownS?: number;
  gameS?: number;
  endS?: number;
  players?: number;
  /** A new obstacle every this many seconds during the game. */
  obstacleEveryS?: number;
  obstacleLifeS?: number;
  maxObstacles?: number;
  quakeS?: number;
}

interface Rider {
  id: number;
  team: number;
  tone: number;
  bot: boolean;
  segment: number;
  /** 0 at node a, 1 at node b. */
  t: number;
  /** +1 toward node b, -1 toward node a. */
  dir: 1 | -1;
  speed: number;
  fallenUntil: number;
  findMeUntil: number;
  carrying: boolean;
  dp: { candidate: number; deliveredUntil: number };
}

interface ObstacleNow {
  segment: number;
  type: 1 | 2 | 3 | 4;
  lane: number;
  until: number;
}

const DEFAULTS: Required<ScenarioOptions> = {
  seed: 1,
  lobbyS: 6,
  countdownS: 3,
  gameS: 120,
  endS: 6,
  players: 8,
  obstacleEveryS: 8,
  obstacleLifeS: 25,
  maxObstacles: 5,
  quakeS: 5,
};

export class Scenario {
  phase: number = PHASE.lobby;
  /** Seconds since the start of the scenario (stops in the pause). */
  time = 0;
  private phaseTime = 0;
  private paused = false;
  private readonly o: Required<ScenarioOptions>;
  private readonly random: () => number;
  private readonly riders: Rider[] = [];
  private obstacles: ObstacleNow[] = [];
  private nextObstacleAt = 0;
  private quake?: { u: number; v: number; mag: number; start: number };
  /** Segments that meet at each node. */
  private readonly atNode: number[][];

  constructor(
    private readonly plan: CityPlan,
    options: ScenarioOptions = {},
  ) {
    this.o = { ...DEFAULTS, ...options };
    this.random = seededRandom(this.o.seed);
    this.atNode = plan.nodes.map(() => []);
    for (const s of plan.segments) {
      this.atNode[s.a].push(s.id);
      this.atNode[s.b].push(s.id);
    }
    for (let id = 0; id < this.o.players; id++) {
      const team = Math.floor(id / 2) % 4;
      const store = plan.stores[team];
      const segment = this.atNode[store.node][0];
      const seg = plan.segments[segment];
      this.riders.push({
        id,
        team,
        tone: id % 2,
        bot: id >= 4,
        segment,
        t: seg.a === store.node ? 0 : 1,
        dir: seg.a === store.node ? 1 : -1,
        speed: 8 + this.random() * 6,
        fallenUntil: 0,
        findMeUntil: 0,
        carrying: true,
        dp: { candidate: this.randomCandidate(), deliveredUntil: 0 },
      });
    }
  }

  /** Moves the game forward by dt seconds. */
  step(dt: number): void {
    if (this.paused) return;
    this.time += dt;
    this.phaseTime += dt;
    const o = this.o;
    if (this.phase === PHASE.lobby && this.phaseTime >= o.lobbyS) this.setPhase(PHASE.countdown);
    else if (this.phase === PHASE.countdown && this.phaseTime >= o.countdownS) {
      this.setPhase(PHASE.game);
      this.nextObstacleAt = this.time + 2;
    } else if (this.phase === PHASE.game && this.phaseTime >= o.gameS) this.setPhase(PHASE.end);
    else if (this.phase === PHASE.end && this.phaseTime >= o.endS) this.restart();

    if (this.phase !== PHASE.game) return;
    for (const r of this.riders) this.moveRider(r, dt);
    this.obstacles = this.obstacles.filter((ob) => ob.until > this.time);
    if (this.time >= this.nextObstacleAt) {
      this.nextObstacleAt = this.time + o.obstacleEveryS;
      if (this.obstacles.length < o.maxObstacles) this.addObstacle();
    }
    if (this.quake && this.time - this.quake.start > o.quakeS) this.quake = undefined;
  }

  /** Pause or resume (only during the game). */
  togglePause(): void {
    if (this.phase === PHASE.game) {
      this.phase = PHASE.pause;
      this.paused = true;
    } else if (this.phase === PHASE.pause) {
      this.phase = PHASE.game;
      this.paused = false;
    }
  }

  /** Jumps to the next phase (for the demo). */
  nextPhase(): void {
    if (this.paused) this.togglePause();
    const next = [PHASE.countdown, PHASE.game, PHASE.end, PHASE.end, PHASE.lobby][this.phase];
    if (next === PHASE.lobby) this.restart();
    else this.setPhase(next);
  }

  /** "Find me": the dot of the player is white for 1 s. */
  findMe(player: number): void {
    const r = this.riders[player];
    if (r) r.findMeUntil = this.time + 1;
  }

  /** An earthquake at u, v (M1 uses the centre of the zone, doc 5.5). */
  startQuake(u: number, v: number, mag: number): void {
    this.quake = { u: clamp01(u), v: clamp01(v), mag: Math.min(10, Math.max(0, mag)), start: this.time };
  }

  /** Puts an obstacle on a segment now (for the demo keys). */
  addObstacle(type?: 1 | 2 | 3 | 4, segment?: number): void {
    const ty = type ?? ((1 + Math.floor(this.random() * 4)) as 1 | 2 | 3 | 4);
    const seg = segment ?? Math.floor(this.random() * this.plan.segments.length);
    const lane = ty === 2 ? 0 : Math.floor(this.random() * 5); // road work closes the whole road
    this.obstacles.push({ segment: seg, type: ty, lane, until: this.time + this.o.obstacleLifeS });
  }

  /** Content of the board state message (`S.d`). */
  boardState(): Record<string, unknown> {
    const size = this.plan.world.size_m;
    const tl = this.phase === PHASE.game || this.phase === PHASE.pause ? Math.max(0, Math.ceil(this.o.gameS - this.phaseTime)) : this.phase === PHASE.countdown ? Math.max(0, Math.ceil(this.o.countdownS - this.phaseTime)) : 0;
    const p = this.riders.map((r) => {
      const pos = pointOnSegment(this.plan, r.segment, r.t);
      let flags = 0;
      if (this.phase !== PHASE.lobby) flags |= FLAG.inGame;
      if (r.fallenUntil > this.time) flags |= FLAG.fallen;
      if (r.carrying) flags |= FLAG.package;
      if (r.bot) flags |= FLAG.bot;
      if (r.findMeUntil > this.time) flags |= FLAG.findMe;
      return [r.id, r.team, r.tone, flags, round4(pos.x / size), round4(pos.z / size), this.heading(r), round1(this.phase === PHASE.game ? r.speed : 0)];
    });
    const dp = this.phase === PHASE.game || this.phase === PHASE.pause
      ? this.riders.map((r) => {
          const c = this.plan.delivery_candidates[r.dp.candidate];
          const pos = pointOnSegment(this.plan, c.segment, c.t);
          return [r.id, round4(pos.x / size), round4(pos.z / size), r.dp.deliveredUntil > this.time ? 1 : 0];
        })
      : [];
    const ob = this.obstacles.map((o) => [o.segment, o.type, o.lane]);
    const q = this.quake;
    const eq = q ? [1, round4(q.u), round4(q.v), round1(q.mag), Math.round((this.time - q.start) * 1000)] : [];
    return { ph: this.phase, tl, p, dp, ob, eq };
  }

  // --- inside ----------------------------------------------------------------

  private setPhase(ph: number): void {
    this.phase = ph;
    this.phaseTime = 0;
  }

  private restart(): void {
    this.setPhase(PHASE.lobby);
    this.obstacles = [];
    this.quake = undefined;
  }

  private randomCandidate(): number {
    return Math.floor(this.random() * this.plan.delivery_candidates.length);
  }

  private moveRider(r: Rider, dt: number): void {
    if (r.fallenUntil > this.time) return;
    // Now and then a rider falls and waits a short penalty.
    if (this.random() < dt * 0.01) {
      r.fallenUntil = this.time + 2;
      return;
    }
    const seg = this.plan.segments[r.segment];
    r.t += (r.dir * r.speed * dt) / seg.length_m;
    if (r.t > 1 || r.t < 0) {
      const over = Math.abs(r.t > 1 ? r.t - 1 : r.t) * seg.length_m;
      const node = r.t > 1 ? seg.b : seg.a;
      const options = this.atNode[node].filter((s) => s !== r.segment);
      const next = options.length > 0 ? options[Math.floor(this.random() * options.length)] : r.segment;
      const ns = this.plan.segments[next];
      r.segment = next;
      r.dir = ns.a === node ? 1 : -1;
      r.t = r.dir === 1 ? over / ns.length_m : 1 - over / ns.length_m;
    }
    // Delivery: close to the own point → flash for 1 s, then a new point.
    const c = this.plan.delivery_candidates[r.dp.candidate];
    const here = pointOnSegment(this.plan, r.segment, r.t);
    const there = pointOnSegment(this.plan, c.segment, c.t);
    if (r.dp.deliveredUntil <= this.time && Math.hypot(here.x - there.x, here.z - there.z) < 12) {
      r.dp.deliveredUntil = this.time + 1;
      r.carrying = false;
    } else if (r.dp.deliveredUntil > 0 && r.dp.deliveredUntil <= this.time) {
      r.dp = { candidate: this.randomCandidate(), deliveredUntil: 0 };
      r.carrying = true;
    }
  }

  /** Degrees clockwise from north. EW segments go east (90), NS segments go south (180). */
  private heading(r: Rider): number {
    const ew = this.plan.segments[r.segment].dir === "EW";
    if (ew) return r.dir === 1 ? 90 : 270;
    return r.dir === 1 ? 180 : 0;
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
