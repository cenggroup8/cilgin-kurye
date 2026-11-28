import type { DirectedEdge, RoadGraph } from './types.js';

/** The routing fields of contracts/city_plan.json. */
export interface CityPlan {
  grid: { lanes_per_direction: number; lane_width_m: number };
  nodes: readonly { id: number; x: number; z: number }[];
  segments: readonly { id: number; a: number; b: number }[];
  stores: readonly { team: number; node: number }[];
  delivery_candidates: readonly { id: number; segment: number; t: number }[];
}

export function graphFromCityPlan(plan: CityPlan): RoadGraph {
  const laneWidth = plan.grid.lane_width_m;
  const lanesPerDirection = plan.grid.lanes_per_direction;
  const intersectionHalfSize = laneWidth * lanesPerDirection;
  const nodes = [...plan.nodes].sort((a, b) => a.id - b.id).map(({ id, x, z }, index) => {
    if (id !== index || !Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error('Invalid city plan node: ' + id);
    }
    return { id, x, y: -z };
  });
  const outgoing: DirectedEdge[][] = nodes.map(() => []);
  const edges: DirectedEdge[] = [];
  const roads = [...plan.segments].sort((a, b) => a.id - b.id).map(({ id, a, b }, index) => {
    if (id !== index || !nodes[a] || !nodes[b] ||
        Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) <= 2 * intersectionHalfSize) {
      throw new Error('Invalid city plan segment: ' + id);
    }
    const edge = edges.length;
    const forward = { id: edge, roadId: id, from: a, to: b, reverseId: edge + 1 };
    const reverse = { id: edge + 1, roadId: id, from: b, to: a, reverseId: edge };
    edges.push(forward, reverse);
    outgoing[a].push(forward);
    outgoing[b].push(reverse);
    return { id, a, b, lanesPerDirection };
  });
  if (!Number.isInteger(lanesPerDirection) || lanesPerDirection < 1 || !Number.isFinite(laneWidth) || laneWidth <= 0) {
    throw new Error('Invalid city plan lane geometry');
  }
  return { laneWidth, intersectionHalfSize, nodes, roads, edges, outgoing: (id) => outgoing[id] };
}
