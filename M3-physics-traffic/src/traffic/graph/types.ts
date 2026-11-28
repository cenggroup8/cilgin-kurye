/**
 * Road graph interface.
 *
 * M3-3 (road graph + route planner) owns the real graph that is built from the
 * city plan. This file is the interface that NPC traffic (M3-4) and the bots
 * (M3-5) read. It was written by M3-4 as a proposal so the packages can be
 * built in parallel; M3-3 can change it, and test/fakes/fakeRoadGraph.ts is a
 * 6 x 6 grid that follows it.
 *
 * Rules:
 * - ids are array indexes: nodes[i].id === i, roads[i].id === i, edges[i].id === i.
 * - Every road has two directed edges, one for each direction (reverseId).
 * - Lanes are counted from the centre line: lane 0 is next to the centre line.
 * - Traffic drives on the right.
 */

export interface GraphNode {
  id: number;
  /** Centre of the intersection, world metres. */
  x: number;
  y: number;
}

export interface Road {
  id: number;
  /** End nodes. */
  a: number;
  b: number;
  lanesPerDirection: number;
}

export interface DirectedEdge {
  id: number;
  roadId: number;
  from: number;
  to: number;
  /** The edge of the same road in the other direction. */
  reverseId: number;
}

export interface RoadGraph {
  /** Width of one lane, metres. */
  readonly laneWidth: number;
  /**
   * Half size of the square intersection box. An edge starts and ends this far
   * from the node centre (the stop lines).
   */
  readonly intersectionHalfSize: number;
  readonly nodes: readonly GraphNode[];
  readonly roads: readonly Road[];
  readonly edges: readonly DirectedEdge[];
  /** Edges that leave a node. */
  outgoing(nodeId: number): readonly DirectedEdge[];
}
