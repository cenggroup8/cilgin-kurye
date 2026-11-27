/**
 * NPC traffic (M3-4, issue #41).
 *
 * M1 calls step() once per tick, before the physics part (module document 7.5).
 * Every NPC car:
 *  - follows its lane and picks a new turn before each intersection,
 *  - keeps a safe gap to the car or motorcycle in front (IDM, idm.ts),
 *  - enters an intersection only when its way through is free (intersections.ts),
 *  - never drives onto a road closed by road work,
 *  - stops when it is hit, or leaves the road when the hit is hard,
 *  - is removed and added again elsewhere when it is stuck for too long.
 * The number of cars follows the admin parameter, new cars never appear close
 * to a player, and heavy traffic obstacles add extra slow cars on their road.
 *
 * All randomness comes from one seeded Rng, and cars are always handled in the
 * same order, so the same inputs and seed give exactly the same traffic.
 */
import { Rng } from '../../common/rng.js';
import type { Obstacle, PlayerPose, Vec2 } from '../../common/types.js';
import { buildEdgeFrames, lanePoint, turnKind, type EdgeFrame } from '../graph/laneGeometry.js';
import type { RoadGraph } from '../graph/types.js';
import { DEFAULT_IDM, idmAcceleration, type IdmParams } from './idm.js';
import { buildTurnPath, IntersectionLocks, pointOnPath, type TurnPath } from './intersections.js';
import { TrafficMetricsCounter } from './metrics.js';
import { checkTrafficParams } from './params.js';
import {
  DEFAULT_TRAFFIC_PARAMS,
  type CarHit,
  type NpcCarPose,
  type NpcState,
  type TrafficInput,
  type TrafficOutput,
  type TrafficParams,
} from './types.js';

const CAR_LENGTH = 4.5;
const CAR_WIDTH = 1.8;
/** Half length of a motorcycle, used for the gap to a player in front. */
const BIKE_HALF_LENGTH = 1.1;
/** How far ahead a car looks for players, metres. */
const PLAYER_LOOKAHEAD = 50;
/** A car blocked by an obstacle (road work barrier, accident) is moved away sooner, s. */
const OBSTACLE_STUCK_TIMEOUT = 4;
/** Below this speed a car counts as standing, m/s. */
const STAND_SPEED = 0.3;
/** A stuck car next to a player waits longer before it disappears, metres. */
const STUCK_PLAYER_RADIUS = 25;
/** Longest tick that is simulated in one go, s. */
const MAX_DT = 0.1;
const TURN_WEIGHTS = { straight: 3, right: 2, left: 1.5, uturn: 1 } as const;

interface Car {
  id: number;
  length: number;
  width: number;
  speed: number;
  speedFactor: number;
  state: NpcState;
  /** Position on an edge (used while not inside an intersection). */
  edge: number;
  lane: number;
  s: number;
  /** Next movement, chosen when the car enters an edge. turn is null if there is no way on. */
  nextEdge: number;
  nextLane: number;
  turn: TurnPath | null;
  /** Holds the cells of turn.node. */
  locked: boolean;
  inIntersection: boolean;
  pathD: number;
  waitTime: number;
  stuckTime: number;
  blockedByObstacle: boolean;
  /** Countdown for 'stopped' and 'offroad'. */
  timer: number;
  offPose: { x: number; y: number; heading: number } | null;
  /** Heavy traffic extra car: road it stays on and obstacle it belongs to (-1 = normal car). */
  homeRoad: number;
  extraFor: number;
  removed: boolean;
}

interface Leader {
  gap: number;
  speed: number;
  obstacle: boolean;
}

export interface NpcTrafficOptions {
  seed: number;
  params?: Partial<TrafficParams>;
  idm?: Partial<IdmParams>;
}

export class NpcTraffic {
  readonly graph: RoadGraph;
  private readonly frames: EdgeFrame[];
  private readonly roadEdges: number[][];
  private readonly maxLanes: number;
  private readonly idm: IdmParams;
  private readonly pathCache = new Map<string, TurnPath>();
  private seed: number;
  private rng: Rng;
  private locks: IntersectionLocks;
  private metrics = new TrafficMetricsCounter();
  private params: TrafficParams;

  private cars: Car[] = [];
  private nextId = 0;
  private initialized = false;
  private dt = 1 / 30;
  private players: readonly PlayerPose[] = [];

  /** Rebuilt every tick. */
  private laneIndex = new Map<number, Car[]>();
  private incoming = new Map<number, Car[]>();
  private closedRoads = new Set<number>();
  private laneObstacles = new Map<number, number[]>();
  private accidentEdges = new Set<number>();
  private heavyRoads = new Map<number, number>();

  constructor(graph: RoadGraph, opts: NpcTrafficOptions) {
    this.graph = graph;
    this.frames = buildEdgeFrames(graph);
    this.roadEdges = graph.roads.map(() => []);
    for (const e of graph.edges) this.roadEdges[e.roadId].push(e.id);
    this.maxLanes = Math.max(1, ...graph.roads.map((r) => r.lanesPerDirection));
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    this.idm = { ...DEFAULT_IDM, ...opts.idm };
    this.params = checkTrafficParams({ ...DEFAULT_TRAFFIC_PARAMS, ...opts.params });
    this.locks = new IntersectionLocks(graph.nodes.length);
  }

  /**
   * One tick. While the game is paused, M1 simply does not call step(), so
   * nothing moves and no timer runs.
   *
   * Throws RangeError for a bad dt, bad parameters or an obstacle that does
   * not fit the road graph. M1 checks these values before, so an error here
   * means a bug, and it should be loud.
   */
  step(input: TrafficInput): TrafficOutput {
    if (!Number.isFinite(input.dt) || input.dt <= 0) throw new RangeError(`Bad dt: ${input.dt}`);
    // A very long tick (for example after the server was stopped in a debugger)
    // is cut, so cars never jump through each other.
    this.dt = Math.min(input.dt, MAX_DT);
    this.players = input.players;
    if (input.params) this.params = checkTrafficParams({ ...this.params, ...input.params });

    this.applyObstacles(input.obstacles);
    this.applyHits(input.carHits);
    this.buildIndex();
    this.grantIntersections();
    this.move();
    this.updateTimersAndStuck();
    this.cars = this.cars.filter((c) => !c.removed);
    this.buildIndex();
    this.updateHeavyTrafficCars();
    this.followCarCount();
    this.cars = this.cars.filter((c) => !c.removed);

    return this.output();
  }

  /**
   * For a new game: removes every car, sets the counters to zero and starts the
   * random numbers again (with a new seed if one is given). The parameters stay,
   * like the admin values in M1. The next step() fills the city again.
   */
  reset(seed: number = this.seed): void {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.locks = new IntersectionLocks(this.graph.nodes.length);
    this.metrics = new TrafficMetricsCounter();
    this.cars = [];
    this.nextId = 0;
    this.initialized = false;
    this.players = [];
    this.laneIndex.clear();
    this.incoming.clear();
  }

  /** Called by the bot drivers (M3-5) when a bot asks for a new route. */
  countBotRouteChange(n = 1): void {
    this.metrics.countBotRouteChange(n);
  }

  get currentParams(): Readonly<TrafficParams> {
    return this.params;
  }

  // ---------------------------------------------------------------- inputs

  private applyObstacles(obstacles: readonly Obstacle[]): void {
    this.closedRoads.clear();
    this.laneObstacles.clear();
    this.accidentEdges.clear();
    this.heavyRoads.clear();

    for (const o of obstacles) {
      const ref = this.checkObstacle(o);
      switch (o.type) {
        case 'roadWork': {
          // The whole road is closed; a barrier stands across all its lanes.
          this.closedRoads.add(o.roadId);
          for (const e of this.roadEdges[o.roadId]) {
            const s = this.obstacleS(o, ref, e);
            for (let l = 0; l < this.frames[e].lanes; l++) this.addLaneObstacle(e, l, s);
          }
          break;
        }
        case 'accident': {
          if (o.lane === undefined) {
            // Whole road: solid in every lane of both directions (but not closed for routes).
            for (const e of this.roadEdges[o.roadId]) {
              const s = this.obstacleS(o, ref, e);
              for (let l = 0; l < this.frames[e].lanes; l++) this.addLaneObstacle(e, l, s);
              this.accidentEdges.add(e);
            }
          } else {
            // Solid in one lane.
            this.addLaneObstacle(ref, o.lane, this.obstacleS(o, ref, ref));
            this.accidentEdges.add(ref);
          }
          break;
        }
        case 'heavyTraffic':
          this.heavyRoads.set(o.id, o.roadId);
          break;
        case 'puddle':
          // Only motorcycles slide; cars are not affected.
          break;
        default:
          throw new RangeError(`Unknown obstacle type: ${(o as Obstacle).type}`);
      }
    }
  }

  /** Checks an obstacle against the road graph and gives the edge its lane and s are measured on. */
  private checkObstacle(o: Obstacle): number {
    const road = this.graph.roads[o.roadId];
    if (!Number.isInteger(o.roadId) || !road) throw new RangeError(`Obstacle ${o.id}: unknown road ${o.roadId}`);
    const ref = o.edgeId ?? this.forwardEdge(o.roadId);
    if (!this.roadEdges[o.roadId].includes(ref)) {
      throw new RangeError(`Obstacle ${o.id}: edge ${o.edgeId} is not on road ${o.roadId}`);
    }
    if (o.lane !== undefined && (!Number.isInteger(o.lane) || o.lane < 0 || o.lane >= this.frames[ref].lanes)) {
      throw new RangeError(`Obstacle ${o.id}: road ${o.roadId} has no lane ${o.lane}`);
    }
    if (o.s !== undefined && (!Number.isFinite(o.s) || o.s < 0 || o.s > this.frames[ref].length)) {
      throw new RangeError(`Obstacle ${o.id}: s ${o.s} is outside the road`);
    }
    return ref;
  }

  /** The edge of a road that goes from road.a to road.b (the direction of the contracts segment). */
  private forwardEdge(roadId: number): number {
    const a = this.graph.roads[roadId].a;
    return this.roadEdges[roadId].find((e) => this.graph.edges[e].from === a)!;
  }

  /** Position of an obstacle on edge `edge`; `o.s` is measured on edge `ref`. */
  private obstacleS(o: Obstacle, ref: number, edge: number): number {
    const L = this.frames[edge].length;
    if (o.s === undefined) return L / 2;
    return edge === ref ? o.s : L - o.s; // the other direction of the same road
  }

  private addLaneObstacle(edge: number, lane: number, s: number): void {
    const key = this.laneKey(edge, lane);
    const list = this.laneObstacles.get(key);
    if (list) list.push(s);
    else this.laneObstacles.set(key, [s]);
  }

  private applyHits(hits: readonly CarHit[]): void {
    if (hits.length === 0) return;
    const byId = new Map(this.cars.map((c) => [c.id, c]));
    for (const h of hits) {
      const car = byId.get(h.carId);
      if (!car || car.state === 'offroad') continue;
      if (h.impactSpeed >= this.params.offroadImpactSpeed) {
        const pose = this.poseOf(car);
        const off = this.graph.laneWidth;
        // Pushed to the right side of the road.
        pose.x += Math.sin(pose.heading) * off;
        pose.y -= Math.cos(pose.heading) * off;
        this.unlock(car);
        car.state = 'offroad';
        car.offPose = pose;
        car.speed = 0;
        car.timer = this.params.offroadTime;
      } else {
        car.state = 'stopped';
        car.speed = 0;
        car.timer = this.params.hitStopTime;
      }
    }
  }

  // ---------------------------------------------------------------- index

  private laneKey(edge: number, lane: number): number {
    return edge * this.maxLanes + lane;
  }

  private buildIndex(): void {
    this.laneIndex.clear();
    this.incoming.clear();
    for (const c of this.cars) {
      if (c.removed || c.state === 'offroad') continue;
      if (!c.inIntersection) push(this.laneIndex, this.laneKey(c.edge, c.lane), c);
      if (c.locked) push(this.incoming, this.laneKey(c.nextEdge, c.nextLane), c);
    }
    for (const list of this.laneIndex.values()) list.sort((a, b) => a.s - b.s || a.id - b.id);
  }

  // ---------------------------------------------------------- intersections

  /**
   * Cars that wait longest go first. When a car cannot get its cells, the
   * cells are blocked for cars behind it in the queue for this tick, so a car
   * that turns left is not passed by others forever.
   */
  private grantIntersections(): void {
    const candidates: Car[] = [];
    for (const c of this.cars) {
      if (c.state !== 'driving' || c.inIntersection || c.locked) continue;
      const list = this.laneIndex.get(this.laneKey(c.edge, c.lane))!;
      if (list[list.length - 1] !== c) continue; // only the first car of a lane
      const distToLine = this.frames[c.edge].length - c.s - c.length / 2;
      const askDist = Math.max(6, (c.speed * c.speed) / (2 * this.idm.b) + 6);
      if (distToLine > askDist) continue;
      if (c.nextEdge < 0 || this.closedRoads.has(this.graph.edges[c.nextEdge].roadId)) this.chooseNext(c);
      if (!c.turn) continue;
      candidates.push(c);
    }
    candidates.sort((a, b) => b.waitTime - a.waitTime || a.id - b.id);

    const blocked = new Set<number>();
    const blockedExits = new Set<number>();
    for (const c of candidates) {
      const turn = c.turn!;
      const exitKey = this.laneKey(c.nextEdge, c.nextLane);
      if (!this.locks.isFree(turn.node, turn.cells, blocked) || blockedExits.has(exitKey)) {
        for (const cell of turn.cells) blocked.add(IntersectionLocks.key(turn.node, cell));
        c.waitTime += this.dt;
        continue;
      }
      if (!this.exitHasRoom(c)) {
        // Keep the exit lane for this car: cars that waited less may not fill it first.
        blockedExits.add(exitKey);
        c.waitTime += this.dt;
        continue;
      }
      this.locks.lock(turn.node, turn.cells, c.id);
      c.locked = true;
      c.waitTime = 0;
      push(this.incoming, this.laneKey(c.nextEdge, c.nextLane), c);
    }
  }

  /** The car may only enter if it can leave the intersection again (no blocking the box). */
  private exitHasRoom(c: Car): boolean {
    const key = this.laneKey(c.nextEdge, c.nextLane);
    const first = this.laneIndex.get(key)?.[0];
    let free = first ? first.s - first.length / 2 : this.frames[c.nextEdge].length;
    for (const o of this.incoming.get(key) ?? []) free -= o.length + this.idm.s0;
    for (const s of this.laneObstacles.get(key) ?? []) free = Math.min(free, s);
    return free >= c.length + this.idm.s0 + 1;
  }

  private unlock(c: Car): void {
    if (c.locked && c.turn) this.locks.unlock(c.turn.node, c.turn.cells, c.id);
    c.locked = false;
  }

  /** Choose the movement at the end of the current edge. */
  private chooseNext(c: Car): void {
    const e = this.graph.edges[c.edge];
    const fIn = this.frames[c.edge];
    let next = -1;

    if (c.homeRoad >= 0 && e.roadId === c.homeRoad && !this.closedRoads.has(c.homeRoad)) {
      next = e.reverseId; // heavy traffic car: drive back and forth on its road
    } else {
      const open = this.graph.outgoing(e.to).filter((o) => !this.closedRoads.has(o.roadId));
      const noU = open.filter((o) => o.id !== e.reverseId);
      const pool = noU.length > 0 ? noU : open;
      if (pool.length > 0) {
        const weights = pool.map((o) => {
          const w = TURN_WEIGHTS[turnKind(fIn, this.frames[o.id])];
          return this.accidentEdges.has(o.id) ? w * 0.15 : w;
        });
        next = this.rng.weighted(pool, weights).id;
      }
    }

    if (next < 0) {
      c.nextEdge = -1;
      c.turn = null;
      return;
    }
    c.nextEdge = next;
    c.nextLane = Math.min(c.lane, this.frames[next].lanes - 1);
    c.turn = this.turnPath(c.edge, c.lane, next, c.nextLane);
  }

  private turnPath(inEdge: number, inLane: number, outEdge: number, outLane: number): TurnPath {
    const key = `${inEdge}:${inLane}:${outEdge}:${outLane}`;
    let p = this.pathCache.get(key);
    if (!p) {
      const node = this.graph.edges[inEdge].to;
      p = buildTurnPath(this.graph, this.frames[inEdge], inLane, this.frames[outEdge], outLane, node);
      this.pathCache.set(key, p);
    }
    return p;
  }

  // ---------------------------------------------------------------- motion

  private move(): void {
    const dt = this.dt;
    // 1. All accelerations from the same snapshot, so the order of cars does not matter.
    const plan: { car: Car; acc: number; gap: number }[] = [];
    for (const c of this.cars) {
      if (c.state !== 'driving') continue;
      const lead = this.findLeader(c);
      c.blockedByObstacle = lead.obstacle;
      const v0 = this.params.maxSpeed * c.speedFactor;
      plan.push({ car: c, acc: idmAcceleration(c.speed, v0, lead.gap, lead.speed, this.idm), gap: lead.gap });
    }
    // 2. Move. A car never moves further than its gap, so cars never overlap.
    for (const { car, acc, gap } of plan) {
      let v1 = Math.max(0, car.speed + acc * dt);
      let ds = ((car.speed + v1) / 2) * dt;
      const maxDs = Math.max(0, gap - 0.3);
      if (ds > maxDs) {
        ds = maxDs;
        v1 = Math.min(v1, maxDs / dt);
      }
      car.speed = v1;
      this.advance(car, ds);
    }
  }

  private findLeader(c: Car): Leader {
    const best: Leader = { gap: Infinity, speed: 0, obstacle: false };
    const consider = (gap: number, speed: number, obstacle: boolean) => {
      if (gap < best.gap) {
        best.gap = gap;
        best.speed = speed;
        best.obstacle = obstacle;
      }
    };
    const speedOf = (o: Car) => (o.state === 'driving' ? o.speed : 0);

    if (!c.inIntersection) {
      const key = this.laneKey(c.edge, c.lane);
      const list = this.laneIndex.get(key)!;
      const i = list.indexOf(c);
      const L = this.frames[c.edge].length;
      if (i < list.length - 1) {
        const a = list[i + 1];
        consider(a.s - c.s - (a.length + c.length) / 2, speedOf(a), false);
      } else if (c.locked && c.turn) {
        const first = this.laneIndex.get(this.laneKey(c.nextEdge, c.nextLane))?.[0];
        if (first) consider(L - c.s + c.turn.length + first.s - (first.length + c.length) / 2, speedOf(first), false);
      } else {
        // Wait at the stop line (the extra s0 lets the car stand right at the line).
        consider(L - c.s - c.length / 2 + this.idm.s0 * 0.8, 0, false);
      }
      for (const s of this.laneObstacles.get(key) ?? []) {
        if (s > c.s) consider(s - c.s - c.length / 2 - 0.5, 0, true);
      }
    } else if (c.turn) {
      const first = this.laneIndex.get(this.laneKey(c.nextEdge, c.nextLane))?.[0];
      if (first) consider(c.turn.length - c.pathD + first.s - (first.length + c.length) / 2, speedOf(first), false);
    }

    // Motorcycles in front of the car (issue #41, item 2).
    if (this.players.length > 0) {
      const pose = this.poseOf(c);
      const hx = Math.cos(pose.heading);
      const hy = Math.sin(pose.heading);
      const halfLane = this.graph.laneWidth / 2 + 0.6;
      for (const p of this.players) {
        if (p.fallen) continue;
        const rx = p.x - pose.x;
        const ry = p.y - pose.y;
        const along = rx * hx + ry * hy;
        if (along <= 0 || along > PLAYER_LOOKAHEAD) continue;
        if (Math.abs(rx * hy - ry * hx) > halfLane) continue;
        consider(along - c.length / 2 - BIKE_HALF_LENGTH, Math.max(0, p.speed * Math.cos(p.heading - pose.heading)), false);
      }
    }
    return best;
  }

  private advance(c: Car, ds: number): void {
    if (c.inIntersection) {
      c.pathD += ds;
      if (c.turn && c.pathD >= c.turn.length) this.enterEdge(c, c.pathD - c.turn.length);
      return;
    }
    c.s += ds;
    const L = this.frames[c.edge].length;
    if (c.s < L) return;
    if (c.locked && c.turn) {
      c.inIntersection = true;
      c.pathD = c.s - L;
      c.s = L;
      if (c.pathD >= c.turn.length) this.enterEdge(c, c.pathD - c.turn.length);
    } else {
      c.s = L; // safety; the stop line gap keeps this from happening
    }
  }

  private enterEdge(c: Car, s: number): void {
    this.unlock(c);
    c.inIntersection = false;
    c.pathD = 0;
    c.edge = c.nextEdge;
    c.lane = c.nextLane;
    c.s = s;
    this.chooseNext(c);
  }

  // ------------------------------------------------- timers, stuck, removal

  private updateTimersAndStuck(): void {
    for (const c of this.cars) {
      if (c.state === 'offroad') {
        c.timer -= this.dt;
        if (c.timer <= 0) this.remove(c);
        continue;
      }
      if (c.state === 'stopped') {
        c.timer -= this.dt;
        if (c.timer <= 0) c.state = 'driving';
        continue;
      }
      c.stuckTime = c.speed < STAND_SPEED ? c.stuckTime + this.dt : 0;
      const limit = c.blockedByObstacle ? OBSTACLE_STUCK_TIMEOUT : this.params.stuckTimeout;
      if (c.stuckTime > limit && (c.stuckTime > 2 * limit || !this.playerNear(this.poseOf(c), STUCK_PLAYER_RADIUS))) {
        this.remove(c);
        this.metrics.countStuckRemoval();
      }
    }
  }

  private remove(c: Car): void {
    this.unlock(c);
    c.removed = true;
  }

  // ------------------------------------------------------------- car count

  private updateHeavyTrafficCars(): void {
    for (const c of this.cars) {
      if (c.extraFor >= 0 && !this.heavyRoads.has(c.extraFor)) {
        // The obstacle ended: the car becomes a normal car (and may be removed by followCarCount).
        c.extraFor = -1;
        c.homeRoad = -1;
        c.speedFactor = this.normalSpeedFactor();
      }
    }
    for (const [obstacleId, roadId] of this.heavyRoads) {
      let have = 0;
      for (const c of this.cars) if (c.extraFor === obstacleId && !c.removed) have++;
      const want = Math.min(this.params.heavyTrafficExtraCars - have, this.params.maxSpawnPerTick);
      for (let k = 0; k < want; k++) {
        const car = this.spawn(roadId, 3);
        if (!car) break;
        car.extraFor = obstacleId;
        car.homeRoad = roadId;
        car.speedFactor = this.params.heavyTrafficSpeedFactor;
        car.speed = Math.min(car.speed, this.params.maxSpeed * car.speedFactor);
        this.chooseNext(car);
      }
    }
  }

  /** Move the number of normal cars toward params.carCount, a few cars per tick. */
  private followCarCount(): void {
    const normal = this.cars.filter((c) => c.extraFor < 0 && c.state !== 'offroad' && !c.removed);
    const target = Math.max(0, Math.floor(this.params.carCount));
    let diff = target - normal.length;

    if (!this.initialized) {
      this.initialized = true;
      for (let k = 0; k < diff; k++) if (!this.spawn(-1, 30)) break;
      return;
    }
    if (diff > 0) {
      const n = Math.min(diff, this.params.maxSpawnPerTick);
      for (let k = 0; k < n; k++) if (!this.spawn(-1, 10)) break;
    } else if (diff < 0) {
      // Remove cars that no player can see and that are not inside an intersection.
      const far = normal.filter(
        (c) => !c.locked && !c.inIntersection && !this.playerNear(this.poseOf(c), this.params.minSpawnDistance),
      );
      diff = Math.min(-diff, this.params.maxDespawnPerTick, far.length);
      for (let k = 0; k < diff; k++) {
        const i = this.rng.int(far.length);
        this.remove(far[i]);
        far.splice(i, 1);
      }
    }
  }

  private normalSpeedFactor(): number {
    return this.rng.range(0.8, 1.1);
  }

  /** Add one car on a free place far from the players. road = -1 means any open road. */
  private spawn(road: number, attempts: number): Car | null {
    for (let k = 0; k < attempts; k++) {
      const edge = road >= 0 ? this.rng.pick(this.roadEdges[road]) : this.rng.int(this.graph.edges.length);
      if (this.closedRoads.has(this.graph.edges[edge].roadId)) continue;
      const f = this.frames[edge];
      const lane = this.rng.int(f.lanes);
      const len = CAR_LENGTH;
      if (f.length < len + 6) continue;
      const s = this.rng.range(len / 2 + 3, f.length - len / 2 - 3);
      if (this.playerNear(lanePoint(this.graph, f, lane, s), this.params.minSpawnDistance)) continue;

      const key = this.laneKey(edge, lane);
      const list = this.laneIndex.get(key) ?? [];
      if (list.some((o) => Math.abs(o.s - s) < (o.length + len) / 2 + this.idm.s0 + 3)) continue;
      if (s < 15 && (this.incoming.get(key)?.length ?? 0) > 0) continue;
      if ((this.laneObstacles.get(key) ?? []).some((o) => Math.abs(o - s) < 10)) continue;

      const ahead = list.find((o) => o.s > s);
      const freeAhead = ahead ? ahead.s - s : f.length - s;
      const speedFactor = this.normalSpeedFactor();
      const car: Car = {
        id: this.nextId++,
        length: len,
        width: CAR_WIDTH,
        speed: freeAhead > 20 ? this.params.maxSpeed * speedFactor * 0.6 : 0,
        speedFactor,
        state: 'driving',
        edge,
        lane,
        s,
        nextEdge: -1,
        nextLane: 0,
        turn: null,
        locked: false,
        inIntersection: false,
        pathD: 0,
        waitTime: 0,
        stuckTime: 0,
        blockedByObstacle: false,
        timer: 0,
        offPose: null,
        homeRoad: -1,
        extraFor: -1,
        removed: false,
      };
      this.chooseNext(car);
      this.cars.push(car);
      list.push(car);
      list.sort((a, b) => a.s - b.s || a.id - b.id);
      this.laneIndex.set(key, list);
      return car;
    }
    return null;
  }

  // ---------------------------------------------------------------- output

  private playerNear(p: Vec2, radius: number): boolean {
    const r2 = radius * radius;
    for (const pl of this.players) {
      const dx = pl.x - p.x;
      const dy = pl.y - p.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  private poseOf(c: Car): { x: number; y: number; heading: number } {
    if (c.state === 'offroad' && c.offPose) return { ...c.offPose };
    if (c.inIntersection && c.turn) return pointOnPath(c.turn, c.pathD);
    const f = this.frames[c.edge];
    const p = lanePoint(this.graph, f, c.lane, c.s);
    return { x: p.x, y: p.y, heading: f.heading };
  }

  private output(): TrafficOutput {
    const cars: NpcCarPose[] = [];
    const speeds: number[] = [];
    for (const c of this.cars) {
      const p = this.poseOf(c);
      cars.push({
        id: c.id,
        x: p.x,
        y: p.y,
        heading: p.heading,
        speed: c.state === 'driving' ? c.speed : 0,
        edgeId: c.inIntersection || c.state === 'offroad' ? null : c.edge,
        lane: c.inIntersection ? c.nextLane : c.lane,
        length: c.length,
        width: c.width,
        state: c.state,
      });
      speeds.push(c.state === 'driving' ? c.speed : 0);
    }
    return { cars, metrics: this.metrics.snapshot(speeds) };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
