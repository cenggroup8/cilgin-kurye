import { describe, expect, it } from 'vitest';
import { type CityPlan } from '../../../src/traffic/graph/cityPlan.js';
import { RoutePlanner } from '../../../src/traffic/routes/routePlanner.js';
import { makeGridGraph } from '../../fakes/fakeRoadGraph.js';

function cityPlan(size = 6): CityPlan {
  const graph = makeGridGraph({ size, spacing: 100 });
  return {
    grid: { lanes_per_direction: 2, lane_width_m: 3.5 },
    nodes: graph.nodes.map(({ id, x, y }) => ({ id, x, z: y })),
    segments: graph.roads.map(({ id, a, b }) => ({ id, a, b })),
    stores: [0, size - 1, size * (size - 1), size * size - 1].map((node, team) => ({ team, node })),
    delivery_candidates: graph.roads.map(({ id }) => ({ id, segment: id, t: 0.5 })),
  };
}

describe('RoutePlanner', () => {
  it('keeps the contract IDs, axes and directed lanes', () => {
    const { graph } = new RoutePlanner(cityPlan());
    expect(graph.nodes).toHaveLength(36);
    expect(graph.roads).toHaveLength(60);
    expect(graph.edges).toHaveLength(120);
    expect(graph.nodes[7]).toEqual({ id: 7, x: 100, y: -100 });
    expect(graph.roads[31]).toEqual({ id: 31, a: 1, b: 7, lanesPerDirection: 2 });
    expect(graph.edges[graph.edges[62].reverseId]).toMatchObject({ from: 7, to: 1, roadId: 31 });
  });

  it('chooses a right turn over an equally long left turn and prices a U-turn', () => {
    const planner = new RoutePlanner(cityPlan(2));
    expect(planner.route(0, 3)?.edgeIds).toEqual([0, 6]);
    expect(planner.route(1, 0, 0)?.seconds).toBeCloseTo(100 / 15 + 3);
  });

  it('takes a detour and leaves unreachable candidates blank when roads close', () => {
    const planner = new RoutePlanner(cityPlan(2));
    expect(planner.route(0, 1)?.edgeIds).toEqual([0]);
    const closed = { id: 1, type: 'roadWork', roadId: 0 } as const;
    expect(planner.update([closed])).toBe(true);
    expect(planner.route(0, 1)?.edgeIds).toEqual([4, 2, 7]);
    expect(planner.travelTimes()[0].times_s['0']).toBeNull();
    planner.update([closed, { ...closed, id: 2, roadId: 2 }]);
    expect(planner.route(0, 1)).toBeNull();
    planner.update([]);
    expect(planner.route(0, 1)?.edgeIds).toEqual([0]);
  });

  it('updates existing searches after material traffic, obstacle and admin changes', () => {
    const planner = new RoutePlanner(cityPlan(2));
    planner.route(0, 1);
    expect(planner.update([], new Map([[0, 14.5]]))).toBe(false);
    expect(planner.update([], new Map([[0, 2]]))).toBe(true);
    expect(planner.route(0, 1)?.edgeIds).toEqual([4, 2, 7]);
    planner.update([{ id: 1, type: 'accident', roadId: 0 }]);
    expect(planner.route(0, 1)?.seconds).toBeCloseTo(100 * 1.5 / 15);
    planner.update([{ id: 2, type: 'heavyTraffic', roadId: 0 }]);
    expect(planner.route(0, 1)?.seconds).toBeCloseTo(100 * 2 / 15);
    planner.update([], new Map(), { cruiseSpeedMps: 20 });
    expect(planner.route(0, 1)?.seconds).toBeCloseTo(5);
  });

  it('prices partial roads and gives equivalent times to the four stores on a symmetric grid', () => {
    const planner = new RoutePlanner(cityPlan());
    const table = planner.travelTimes();
    expect(table.map(({ team }) => team)).toEqual([0, 1, 2, 3]);
    for (const [team, candidate] of [0, 4, 25, 29].entries()) {
      expect(Object.keys(table[team].times_s)).toHaveLength(60);
      expect(table[team].times_s[candidate]).toBeCloseTo(50 / 15);
    }
  });
});
