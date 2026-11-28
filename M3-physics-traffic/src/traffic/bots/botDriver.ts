/**
 * Bot drivers (M3-5).
 *
 * A bot reads the same game data as a human player sees and makes the same
 * control record that a phone sends (throttle, brake, steer, seq). M1 feeds
 * that record into the physics like any other control, so for M1 a bot and a
 * human look the same.
 *
 * State machine of one bot:
 *
 *   toStore ──(at store)──▶ pickup ──(M1 gives package)──▶ toDelivery
 *      ▲                                                       │
 *      └──(M1 takes package)── deliver ◀──(at delivery point)──┘
 *
 * "Return" is toStore again after a delivery. A fallen motorcycle sends empty
 * controls until M1 lifts it, then the bot goes on in the same state.
 *
 * Pickup and delivery are done by M1 when the motorcycle stands still inside
 * the area, so the bot only has to stop there.
 */
import type { Obstacle, Vec2 } from '../../common/types.js';
import { Rng } from '../../common/rng.js';
import { buildEdgeFrames, lanePoint, type EdgeFrame } from '../graph/laneGeometry.js';
import type { CityPlan } from '../graph/cityPlan.js';
import { RoutePlanner, type RouteParams } from '../routes/routePlanner.js';
import { angleDiff, buildPath, type Path } from './path.js';
import { checkSkill, skillFromLevel, type BotSkill } from './skill.js';

/** The record a phone sends (contracts/messages.md, `control`). */
export interface BotControl {
  seq: number;
  throttle: number;
  brake: number;
  steer: number;
}

/** What a bot needs to know about its own motorcycle. BikeState of the physics part fits. */
export interface BotPose {
  x: number;
  y: number;
  /** Radians, 0 = +x, counter clockwise positive (M3 coordinates). */
  heading: number;
  speed: number;
  fallen: boolean;
}

/** Something on the road the bot must not drive into (NPC car, other motorcycle). */
export interface BotNeighbour {
  x: number;
  y: number;
  speed: number;
}

/** Game data of one bot for one tick, from M1. */
export interface BotTick {
  pose: BotPose;
  /** True while the bot carries a package. */
  carrying: boolean;
  /** Delivery candidate id of the bot's current order, or null when it has none. */
  delivery: number | null;
  neighbours?: readonly BotNeighbour[];
}

export type BotPhase = 'toStore' | 'pickup' | 'toDelivery' | 'deliver';

export interface BotTuning {
  /** Lane the bot rides in, 0 = next to the centre line. */
  lane: number;
  /** Seconds of standing still (while it should move) before the bot asks for a new route. */
  stuckSeconds: number;
  /** Distance to the goal that counts as arrived, metres. */
  arriveRadius: number;
  /** Comfortable braking, m/s². */
  brakeDecel: number;
  /** Speed for a right angle turn, m/s. */
  cornerSpeed: number;
  /** Bike max steer angle used to scale the steer output, radians. */
  maxSteerAngle: number;
}

export const DEFAULT_BOT_TUNING: BotTuning = {
  lane: 1,
  stuckSeconds: 2.5,
  arriveRadius: 3,
  brakeDecel: 4,
  cornerSpeed: 5,
  maxSteerAngle: 0.6,
};

interface Goal {
  /** Store node or delivery candidate. */
  kind: 'store' | 'delivery';
  id: number;
}

/**
 * Owns the route planner and every bot. M1 calls update() when obstacles or
 * road speeds change and tick() for each bot every tick.
 */
export class BotFleet {
  readonly planner: RoutePlanner;
  readonly frames: EdgeFrame[];
  readonly bots = new Map<number, BotDriver>();
  private readonly candidates: Map<number, { segment: number; t: number }>;
  private readonly storeNodes: Map<number, number>;
  private routeVersion = 0;

  constructor(plan: CityPlan, readonly tuning: BotTuning = DEFAULT_BOT_TUNING) {
    this.planner = new RoutePlanner(plan);
    this.frames = buildEdgeFrames(this.planner.graph);
    this.candidates = new Map(plan.delivery_candidates.map(({ id, segment, t }) => [id, { segment, t }]));
    this.storeNodes = new Map(plan.stores.map(({ team, node }) => [team, node]));
  }

  /** Obstacle list or road speeds changed. Bots get new routes when a route may be different. */
  update(obstacles: readonly Obstacle[], roadSpeedsMps?: ReadonlyMap<number, number>, params?: Partial<RouteParams>): boolean {
    const changed = this.planner.update(obstacles, roadSpeedsMps, params);
    if (changed) this.routeVersion++;
    return changed;
  }

  get version(): number {
    return this.routeVersion;
  }

  addBot(player: number, team: number, opts: { skill?: number | BotSkill; seed?: number } = {}): BotDriver {
    const store = this.storeNodes.get(team);
    if (store === undefined) throw new Error('No store for team ' + team);
    const bot = new BotDriver(this, player, store, opts.skill ?? 0.5, opts.seed ?? player + 1);
    this.bots.set(player, bot);
    return bot;
  }

  removeBot(player: number): void {
    this.bots.delete(player);
  }

  /** Route changes of all bots (traffic metric). */
  routeChanges(): number {
    let n = 0;
    for (const bot of this.bots.values()) n += bot.routeChanges;
    return n;
  }

  candidate(id: number): { segment: number; t: number } | undefined {
    return this.candidates.get(id);
  }
}

export class BotDriver {
  phase: BotPhase = 'toStore';
  /** Number of times the route was changed after the first one (metric). */
  routeChanges = 0;
  skill: BotSkill;

  private seq = 0;
  private path: Path | null = null;
  private pathEdges: number[] = [];
  private goal: Goal | null = null;
  private progress = 0;
  private routeVersion = -1;
  private stuckTime = 0;
  private stuckTries = 0;
  private readonly rng: Rng;
  /** Steer commands waiting for the reaction time, oldest first. */
  private readonly delayed: { t: number; steer: number }[] = [];
  private clock = 0;

  constructor(
    private readonly fleet: BotFleet,
    readonly player: number,
    readonly storeNode: number,
    skill: number | BotSkill,
    seed: number,
  ) {
    this.skill = typeof skill === 'number' ? skillFromLevel(skill) : checkSkill(skill);
    this.rng = new Rng(seed);
  }

  setSkill(skill: number | BotSkill): void {
    this.skill = typeof skill === 'number' ? skillFromLevel(skill) : checkSkill(skill);
  }

  /** The current path, for the debug page. */
  get currentPath(): Path | null {
    return this.path;
  }

  /** Directed edges of the current route, the edge the bot is on first. */
  get routeEdges(): readonly number[] {
    return this.pathEdges;
  }

  tick(input: BotTick, dt: number): BotControl {
    this.clock += dt;
    const { pose } = input;
    this.updatePhase(input);

    if (pose.fallen) {
      // Wait for the penalty; keep the phase and plan, start again from the pose M1 gives back.
      this.stuckTime = 0;
      this.delayed.length = 0;
      return this.control(0, 0, 0);
    }

    const goal = this.goalFor(input);
    if (!goal) return this.control(0, 1, 0);
    if (!this.path || !sameGoal(goal, this.goal) || this.routeVersion !== this.fleet.version) {
      this.plan(pose, goal);
    }
    if (!this.path) return this.control(0, 1, 0);

    const proj = this.path.project(pose, this.progress);
    this.progress = proj.s;
    const remaining = this.path.length - this.progress;
    const end = this.path.at(this.path.length);
    const atGoal = Math.hypot(end.x - pose.x, end.y - pose.y) < this.fleet.tuning.arriveRadius || remaining < 0.5;

    if (atGoal) {
      if (this.phase === 'toStore') this.phase = 'pickup';
      if (this.phase === 'toDelivery') this.phase = 'deliver';
    }
    if (this.phase === 'pickup' || this.phase === 'deliver') {
      this.stuckTime = 0;
      return this.control(0, 1, this.steerTo(pose, end, dt));
    }

    // Look ahead point: further ahead when faster.
    const look = 3 + 0.6 * pose.speed;
    const target = this.path.at(this.progress + look);
    const steer = this.steerTo(pose, target, dt);

    const vTarget = this.targetSpeed(pose, remaining, input.neighbours ?? []);
    const err = vTarget - pose.speed;
    const throttle = err > 0 ? Math.min(1, 0.3 * err + 0.2) : 0;
    const brake = err < -0.5 ? Math.min(1, -0.25 * err) : 0;

    this.watchStuck(pose, remaining > this.fleet.tuning.arriveRadius, dt);
    return this.control(throttle, brake, steer);
  }

  private updatePhase({ carrying, delivery }: BotTick): void {
    if (carrying && delivery !== null) {
      if (this.phase === 'toStore' || this.phase === 'pickup') this.phase = 'toDelivery';
    } else if (!carrying) {
      if (this.phase === 'toDelivery' || this.phase === 'deliver') this.phase = 'toStore';
    }
  }

  private goalFor({ carrying, delivery }: BotTick): Goal | null {
    if (this.phase === 'toDelivery' || this.phase === 'deliver') {
      return carrying && delivery !== null ? { kind: 'delivery', id: delivery } : null;
    }
    return { kind: 'store', id: this.storeNode };
  }

  /** Finds a route from where the motorcycle is now to the goal. */
  /**
   * Finds a route from where the motorcycle is now to the goal. With `turnBack` the bot
   * turns round on its road and leaves it at the other end by another road, so it does
   * not drive into the same block again.
   */
  private plan(pose: BotPose, goal: Goal, turnBack = false): void {
    const { planner } = this.fleet;
    const graph = planner.graph;
    let here = this.locate(pose);
    let avoidRoad: number | undefined;
    if (turnBack) {
      const back = graph.edges[here.edgeId].reverseId;
      avoidRoad = graph.edges[here.edgeId].roadId;
      here = { edgeId: back, s: Math.max(0, this.fleet.frames[back].length - here.s) };
    }
    const startNode = graph.edges[here.edgeId].to;

    let route: number[] | null = null;
    let endS: number | undefined;
    const c = goal.kind === 'delivery' ? this.fleet.candidate(goal.id) : undefined;
    const search = (node: number, incoming: number) => goal.kind === 'store'
      ? planner.route(node, goal.id, incoming)
      : planner.routeToCandidate(node, goal.id);
    let r = search(startNode, here.edgeId);
    if (avoidRoad !== undefined && r && r.edgeIds.length > 0 && graph.edges[r.edgeIds[0]].roadId === avoidRoad) {
      // The best way goes back onto the blocked road: take the best way that starts on another road.
      r = null;
      let best = Infinity;
      for (const e of graph.outgoing(startNode)) {
        if (e.roadId === avoidRoad) continue;
        const rest = search(e.to, e.id);
        const seconds = rest ? rest.seconds + this.fleet.frames[e.id].length / this.skill.maxSpeedMps : Infinity;
        if (rest && seconds < best) {
          best = seconds;
          r = { edgeIds: [e.id, ...rest.edgeIds], seconds };
        }
      }
    }
    if (goal.kind === 'store') {
      route = r?.edgeIds ?? null;
    } else {
      if (c && r) {
        route = r.edgeIds;
        const last = route[route.length - 1];
        // The candidate may be on the edge the bot is on right now.
        const onHere = graph.edges[here.edgeId].roadId === c.segment;
        if (onHere) {
          const s = here.edgeId % 2 === 0 ? c.t : 1 - c.t;
          const atS = s * this.fleet.frames[here.edgeId].length;
          if (atS > here.s + 2) route = [];
        }
        const lastId = route.length > 0 ? last : here.edgeId;
        const f = c.t * this.fleet.frames[lastId].length;
        endS = lastId % 2 === 0 ? f : this.fleet.frames[lastId].length - f;
      }
    }
    const old = this.pathEdges;
    if (route === null) {
      this.path = null;
      this.pathEdges = [];
    } else {
      const edges = [here.edgeId, ...route];
      this.path = buildPath(graph, this.fleet.frames, edges, this.lane(), {
        start: { x: pose.x, y: pose.y },
        startEdgeS: here.s,
        endS: route.length === 0 ? Math.max(here.s, endS ?? 0) : endS,
      });
      this.pathEdges = edges;
    }
    // A new goal is not a route change; a new way to the same goal is.
    if (sameGoal(goal, this.goal) && old.length > 0 && !sameTail(old, this.pathEdges)) this.routeChanges++;
    this.goal = goal;
    this.progress = 0;
    this.routeVersion = this.fleet.version;
  }

  private lane(): number {
    const lanes = this.fleet.planner.graph.roads[0]?.lanesPerDirection ?? 1;
    return Math.min(lanes - 1, this.fleet.tuning.lane);
  }

  /** The directed edge the motorcycle is on (or nearest to), facing its heading. */
  private locate(pose: BotPose): { edgeId: number; s: number } {
    const graph = this.fleet.planner.graph;
    let best = { edgeId: 0, s: 0, cost: Infinity };
    const dirX = Math.cos(pose.heading);
    const dirY = Math.sin(pose.heading);
    for (const e of graph.edges) {
      const f = this.fleet.frames[e.id];
      const a = lanePoint(graph, f, this.lane(), 0);
      const t = (pose.x - a.x) * f.dir.x + (pose.y - a.y) * f.dir.y;
      const s = Math.min(f.length, Math.max(-graph.intersectionHalfSize * 2, t));
      const px = a.x + f.dir.x * s;
      const py = a.y + f.dir.y * s;
      const dist = Math.hypot(pose.x - px, pose.y - py);
      const facing = dirX * f.dir.x + dirY * f.dir.y;
      const cost = dist + (1 - facing) * 8 + (t > f.length ? 50 : 0);
      if (cost < best.cost) best = { edgeId: e.id, s: Math.max(0, s), cost };
    }
    return { edgeId: best.edgeId, s: best.s };
  }

  private targetSpeed(pose: BotPose, remaining: number, neighbours: readonly BotNeighbour[]): number {
    const t = this.fleet.tuning;
    let v = this.skill.maxSpeedMps;
    // Stop at the goal: v² = 2·a·d.
    v = Math.min(v, Math.sqrt(2 * t.brakeDecel * Math.max(0, remaining - 1)));
    // Slow down before corners.
    if (this.path) {
      const ahead = Math.max(8, (pose.speed * pose.speed) / (2 * t.brakeDecel) + 6);
      const turn = this.path.turnAhead(this.progress, ahead);
      if (turn > 0.3) v = Math.min(v, t.cornerSpeed + (this.skill.maxSpeedMps - t.cornerSpeed) * Math.max(0, 1 - turn / (Math.PI / 2)));
    }
    // Keep a gap to what is in front (a simple car following rule).
    const hx = Math.cos(pose.heading);
    const hy = Math.sin(pose.heading);
    for (const n of neighbours) {
      const dx = n.x - pose.x;
      const dy = n.y - pose.y;
      const along = dx * hx + dy * hy;
      const side = Math.abs(-dx * hy + dy * hx);
      if (along <= 0 || along > 40 || side > 2.5) continue;
      const gap = along - 5;
      const safe = Math.max(0, n.speed) + Math.sqrt(2 * t.brakeDecel * Math.max(0, gap - 2));
      v = Math.min(v, gap < 2 ? 0 : safe);
    }
    return Math.max(0, v);
  }

  private steerTo(pose: BotPose, target: Vec2, dt: number): number {
    const want = Math.atan2(target.y - pose.y, target.x - pose.x);
    // Heading is counter clockwise; steer is positive to the right.
    const err = angleDiff(want, pose.heading);
    const raw = clamp(-err / this.fleet.tuning.maxSteerAngle, -1, 1);
    const noisy = raw + this.gauss() * this.skill.steerNoise;
    this.delayed.push({ t: this.clock, steer: noisy });
    let out = this.delayed[0].steer;
    while (this.delayed.length > 1 && this.delayed[1].t <= this.clock - this.skill.reactionS + 1e-9) {
      this.delayed.shift();
      out = this.delayed[0].steer;
    }
    if (this.skill.reactionS <= dt / 2) out = noisy;
    return clamp(out, -1, 1);
  }

  /** Standing still before the goal, for any reason (a wall, a stopped car), counts as stuck. */
  private watchStuck(pose: BotPose, wantsToMove: boolean, dt: number): void {
    if (pose.speed < 0.5 && wantsToMove) this.stuckTime += dt;
    else {
      this.stuckTime = 0;
      if (pose.speed > 3) this.stuckTries = 0;
    }
    if (this.stuckTime >= this.fleet.tuning.stuckSeconds && this.goal) {
      this.stuckTime = 0;
      this.stuckTries++;
      // First try: a new route from here. Then: turn round and leave this road by another one.
      this.plan(pose, this.goal, this.stuckTries > 1);
    }
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rng.next());
    const v = this.rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private control(throttle: number, brake: number, steer: number): BotControl {
    return { seq: ++this.seq, throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1), steer: clamp(steer, -1, 1) };
  }
}

function sameGoal(a: Goal | null, b: Goal | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/** Same remaining way: the new edge list is the end of the old one. */
function sameTail(old: readonly number[], next: readonly number[]): boolean {
  if (next.length > old.length) return false;
  const off = old.length - next.length;
  return next.every((e, i) => e === old[off + i]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
