import type { Obstacle } from '../../common/types.js';
import { buildEdgeFrames, turnKind } from '../graph/laneGeometry.js';
import { graphFromCityPlan, type CityPlan } from '../graph/cityPlan.js';
import type { DirectedEdge } from '../graph/types.js';

export interface RouteParams {
  cruiseSpeedMps: number;
  leftTurnSeconds: number;
  uTurnSeconds: number;
  heavyTrafficMultiplier: number;
  accidentMultiplier: number;
  /** A relative change in expected road time that warrants recalculation. */
  trafficChangeRatio: number;
}

const defaults: RouteParams = {
  cruiseSpeedMps: 15,
  leftTurnSeconds: 1,
  uTurnSeconds: 3,
  heavyTrafficMultiplier: 2,
  accidentMultiplier: 1.5,
  trafficChangeRatio: 0.15,
};

export interface Route {
  /** Internal directed edge ids. Use graph.edges[id].roadId for the contract segment. */
  edgeIds: number[];
  seconds: number;
}

export interface TravelTimeTable {
  team: number;
  /** Keys are delivery candidate IDs. */
  times_s: Record<string, number | null>;
}

interface Search {
  seconds: number[];
  previous: number[];
}

export class RoutePlanner {
  readonly graph;
  private readonly frames;
  private readonly searchByStart = new Map<number, Search>();
  private readonly lengths: number[];
  private readonly incoming: DirectedEdge[][];
  private readonly candidates;
  private readonly stores;
  private params = defaults;
  private obstacleCosts: number[] = [];
  private costs: number[] = [];

  constructor(plan: CityPlan) {
    this.graph = graphFromCityPlan(plan);
    this.frames = buildEdgeFrames(this.graph);
    this.lengths = this.graph.roads.map(({ id }) => this.frames[2 * id].length + 2 * this.graph.intersectionHalfSize);
    this.incoming = this.graph.nodes.map(() => []);
    for (const edge of this.graph.edges) this.incoming[edge.to].push(edge);
    this.candidates = new Map(plan.delivery_candidates.map(({ id, segment, t }) => {
      if (!this.graph.roads[segment] || !Number.isFinite(t) || t < 0 || t > 1) {
        throw new Error('Invalid delivery candidate: ' + id);
      }
      return [id, { segment, t }];
    }));
    this.stores = plan.stores.map(({ team, node }) => {
      if (!this.graph.nodes[node]) throw new Error('Invalid store node: ' + node);
      return { team, node };
    });
    this.update([]);
  }

  /** Call with the current obstacle list and per-segment NPC speeds. Missing speeds mean free flow. */
  update(
    obstacles: readonly Obstacle[],
    roadSpeedsMps: ReadonlyMap<number, number> = new Map(),
    params?: Partial<RouteParams>,
  ): boolean {
    const next = { ...this.params, ...params };
    if (!Object.values(next).every(Number.isFinite) || next.cruiseSpeedMps <= 0 ||
        next.leftTurnSeconds < 0 || next.uTurnSeconds < 0 || next.trafficChangeRatio < 0 ||
        next.heavyTrafficMultiplier < 1 || next.accidentMultiplier < 1) {
      throw new RangeError('Invalid route parameters');
    }
    const obstacleCosts = this.lengths.map(() => 1);
    for (const { type, roadId } of obstacles) {
      if (!this.graph.roads[roadId]) continue;
      const factor = type === 'roadWork' ? Infinity
        : type === 'heavyTraffic' ? next.heavyTrafficMultiplier
        : type === 'accident' ? next.accidentMultiplier : 1;
      obstacleCosts[roadId] = Math.max(obstacleCosts[roadId], factor);
    }
    const costs = this.lengths.map((length, id) => {
      const speed = roadSpeedsMps.get(id);
      const expectedSpeed = speed === undefined || !Number.isFinite(speed) || speed < 0
        ? next.cruiseSpeedMps : Math.min(next.cruiseSpeedMps, Math.max(1, speed));
      return length * obstacleCosts[id] / expectedSpeed;
    });
    const changed = this.costs.length === 0 ||
      Object.keys(defaults).some((key) => next[key as keyof RouteParams] !== this.params[key as keyof RouteParams]) ||
      obstacleCosts.some((factor, id) => factor !== this.obstacleCosts[id]) ||
      costs.some((cost, id) => cost !== this.costs[id] &&
        Math.abs(cost - this.costs[id]) / this.costs[id] >= next.trafficChangeRatio);
    if (changed) {
      this.params = next;
      this.costs = costs;
      this.obstacleCosts = obstacleCosts;
      this.searchByStart.clear();
    }
    return changed;
  }

  /** Pass the incoming edge when replanning for an agent already on the road. */
  route(start: number, destination: number, incomingEdge?: number): Route | null {
    if (!this.graph.nodes[start] || !this.graph.nodes[destination] ||
        (incomingEdge !== undefined && this.graph.edges[incomingEdge]?.to !== start)) return null;
    if (start === destination) return { edgeIds: [], seconds: 0 };
    const search = this.search(start, incomingEdge);
    const best = this.incoming[destination].reduce<number>((best, edge) =>
      search.seconds[edge.id] < (search.seconds[best] ?? Infinity) ? edge.id : best, -1);
    return best < 0 ? null : { edgeIds: this.path(search, best), seconds: search.seconds[best] };
  }

  routeToCandidate(start: number, candidateId: number): Route | null {
    const candidate = this.candidates.get(candidateId);
    if (!this.graph.nodes[start] || !candidate || !Number.isFinite(this.costs[candidate.segment])) return null;
    const search = this.search(start);
    const { segment, t } = candidate;
    let best: Route | null = null;
    for (const [edgeId, portion] of [[2 * segment, t], [2 * segment + 1, 1 - t]]) {
      const edge = this.graph.edges[edgeId];
      const leg = this.costs[segment] * portion;
      if (edge.from === start && (!best || leg < best.seconds)) {
        best = { edgeIds: portion === 0 ? [] : [edgeId], seconds: leg };
      }
      for (const previous of this.incoming[edge.from]) {
        const seconds = search.seconds[previous.id] + this.turnCost(previous.id, edgeId) + leg;
        if (Number.isFinite(seconds) && (!best || seconds < best.seconds)) {
          best = {
            edgeIds: [...this.path(search, previous.id), edgeId],
            seconds,
          };
        }
      }
    }
    return best;
  }

  travelTimes(): TravelTimeTable[] {
    return this.stores.map(({ team, node }) => ({
      team,
      times_s: Object.fromEntries([...this.candidates.keys()].map((id) => [
        id, this.routeToCandidate(node, id)?.seconds ?? null,
      ])),
    }));
  }

  private turnCost(before: number, after: number): number {
    const turn = turnKind(this.frames[before], this.frames[after]);
    if (turn === 'left') return this.params.leftTurnSeconds;
    if (turn === 'uturn') return this.params.uTurnSeconds;
    return 0;
  }

  private path(search: Search, last: number): number[] {
    const edges: number[] = [];
    for (let edge = last; edge >= 0; edge = search.previous[edge]) edges.push(edge);
    return edges.reverse();
  }

  private search(start: number, incomingEdge?: number): Search {
    const key = incomingEdge === undefined ? start : this.graph.nodes.length + incomingEdge;
    const cached = this.searchByStart.get(key);
    if (cached) return cached;

    // Arriving via a different edge changes the cost of the next turn.
    const seconds = this.graph.edges.map(() => Infinity);
    const previous = this.graph.edges.map(() => -1);
    const settled = this.graph.edges.map(() => false);
    for (const edge of this.graph.outgoing(start)) {
      seconds[edge.id] = this.costs[edge.roadId] +
        (incomingEdge === undefined ? 0 : this.turnCost(incomingEdge, edge.id));
    }
    for (;;) {
      let best = -1;
      for (const { id } of this.graph.edges) {
        if (!settled[id] && seconds[id] < (seconds[best] ?? Infinity)) best = id;
      }
      if (best === -1) break;
      settled[best] = true;
      for (const edge of this.graph.outgoing(this.graph.edges[best].to)) {
        const cost = seconds[best] + this.turnCost(best, edge.id) + this.costs[edge.roadId];
        if (cost < seconds[edge.id]) {
          seconds[edge.id] = cost;
          previous[edge.id] = best;
        }
      }
    }
    const search = { seconds, previous };
    this.searchByStart.set(key, search);
    return search;
  }
}
