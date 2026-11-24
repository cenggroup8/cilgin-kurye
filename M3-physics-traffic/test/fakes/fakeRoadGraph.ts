/**
 * Fake road graph for tests and demos until M3-3 builds the real one from the
 * city plan. Same shape as the real city: 6 roads in each direction, so
 * 36 intersections and 60 roads (module document 7.5).
 */
import type { DirectedEdge, GraphNode, Road, RoadGraph } from '../../src/traffic/graph/types';

export interface GridOptions {
  /** Roads in each direction. */
  size?: number;
  /** Distance between two parallel roads, metres. */
  spacing?: number;
  lanesPerDirection?: number;
  laneWidth?: number;
}

export function makeGridGraph(opts: GridOptions = {}): RoadGraph {
  const size = opts.size ?? 6;
  const spacing = opts.spacing ?? 50;
  const lanesPerDirection = opts.lanesPerDirection ?? 1;
  const laneWidth = opts.laneWidth ?? 3.5;

  const nodes: GraphNode[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      nodes.push({ id: j * size + i, x: i * spacing, y: j * spacing });
    }
  }

  const roads: Road[] = [];
  const addRoad = (a: number, b: number) => roads.push({ id: roads.length, a, b, lanesPerDirection });
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size - 1; i++) addRoad(j * size + i, j * size + i + 1);
  }
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size - 1; j++) addRoad(j * size + i, (j + 1) * size + i);
  }

  const edges: DirectedEdge[] = [];
  for (const r of roads) {
    const id = edges.length;
    edges.push({ id, roadId: r.id, from: r.a, to: r.b, reverseId: id + 1 });
    edges.push({ id: id + 1, roadId: r.id, from: r.b, to: r.a, reverseId: id });
  }

  const out: DirectedEdge[][] = nodes.map(() => []);
  for (const e of edges) out[e.from].push(e);

  return {
    laneWidth,
    intersectionHalfSize: lanesPerDirection * laneWidth,
    nodes,
    roads,
    edges,
    outgoing: (nodeId: number) => out[nodeId],
  };
}
