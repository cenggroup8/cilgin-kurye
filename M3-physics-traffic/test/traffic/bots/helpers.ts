import type { CityPlan } from '../../../src/traffic/graph/cityPlan.js';
import type { BotControl, BotDriver, BotFleet, BotNeighbour, BotPose } from '../../../src/traffic/bots/index.js';
import type { Obstacle } from '../../../src/common/types.js';

/** n x n grid with 100 m blocks, one store per corner and a candidate in the middle of every segment. */
export function gridPlan(n = 6): CityPlan {
  const nodes = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) nodes.push({ id: r * n + c, x: c * 100, z: r * 100 });
  const segments: { id: number; a: number; b: number }[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const id = r * n + c;
    if (c + 1 < n) segments.push({ id: segments.length, a: id, b: id + 1 });
    if (r + 1 < n) segments.push({ id: segments.length, a: id, b: id + n });
  }
  return {
    grid: { lanes_per_direction: 2, lane_width_m: 3.5 },
    nodes,
    segments,
    stores: [
      { team: 0, node: 0 },
      { team: 1, node: n - 1 },
      { team: 2, node: n * (n - 1) },
      { team: 3, node: n * n - 1 },
    ],
    delivery_candidates: segments.map(({ id }) => ({ id, segment: id, t: 0.5 })),
  };
}

/**
 * A small kinematic motorcycle, only for these tests. The real model is
 * M3-1 (src/physics/bike); a bot only needs something that answers to
 * throttle, brake and steer in about the same way.
 */
export class SimBike implements BotPose {
  fallen = false;
  speed = 0;
  constructor(public x: number, public y: number, public heading: number, public topSpeed = 20) {}

  step(c: BotControl, dt: number, speedCap = Infinity): void {
    if (this.fallen) return;
    this.speed += (c.throttle * 5 - c.brake * 8 - 0.3) * dt;
    this.speed = Math.max(0, Math.min(this.topSpeed, speedCap, this.speed));
    // Steer positive = right = clockwise = heading goes down.
    const yawRate = 1.6 * Math.min(1, this.speed / 3 + 0.25);
    this.heading -= c.steer * yawRate * dt;
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
  }
}

export interface RunResult {
  deliveries: number;
  seconds: number;
  controls: BotControl[];
}

/**
 * A tiny fake M1: gives the bot a package when it stands at its store, takes
 * it when it stands at the delivery point, and picks the next order from the
 * list.
 */
export function runDeliveries(
  fleet: BotFleet,
  bot: BotDriver,
  bike: SimBike,
  orders: number[],
  opts: {
    maxSeconds?: number;
    dt?: number;
    onTick?: (t: number) => void;
    neighbours?: (t: number) => BotNeighbour[];
    obstacles?: () => Obstacle[];
  } = {},
): RunResult {
  const dt = opts.dt ?? 1 / 30;
  const graph = fleet.planner.graph;
  const storeNode = graph.nodes[bot.storeNode];
  let carrying = false;
  let next = 0;
  let deliveries = 0;
  let t = 0;
  const controls: BotControl[] = [];
  while (t < (opts.maxSeconds ?? 600) && deliveries < orders.length) {
    opts.onTick?.(t);
    const delivery = next < orders.length ? orders[next] : null;
    const c = bot.tick({ pose: bike, carrying, delivery, neighbours: opts.neighbours?.(t) }, dt);
    controls.push(c);
    bike.step(c, dt);
    t += dt;
    const still = bike.speed < 0.6;
    if (!carrying && still && Math.hypot(bike.x - storeNode.x, bike.y - storeNode.y) < 15) carrying = true;
    if (carrying && still && delivery !== null) {
      const p = candidatePoint(fleet, delivery);
      if (Math.hypot(bike.x - p.x, bike.y - p.y) < 10) {
        carrying = false;
        deliveries++;
        next++;
      }
    }
  }
  return { deliveries, seconds: t, controls };
}

export function candidatePoint(fleet: BotFleet, id: number): { x: number; y: number } {
  const c = fleet.candidate(id)!;
  const road = fleet.planner.graph.roads[c.segment];
  const a = fleet.planner.graph.nodes[road.a];
  const b = fleet.planner.graph.nodes[road.b];
  return { x: a.x + (b.x - a.x) * c.t, y: a.y + (b.y - a.y) * c.t };
}
