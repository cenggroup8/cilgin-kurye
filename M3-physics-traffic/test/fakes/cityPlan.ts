/**
 * The shared city plan, read the way M3 needs it.
 *
 * city_plan.json here is a copy of contracts/city_plan.json (version 0.2.0,
 * PR #62, commit 704997e). When contracts/ is on main, import it from there and
 * delete the copy.
 */
import { fromContractHeading, fromContractPoint } from '../../src/common/coords.js';
import type { Vec2 } from '../../src/common/types.js';
import type { RoadGraph } from '../../src/traffic/graph/types.js';
import planJson from './city_plan.json' with { type: 'json' };
import { makeGridGraph } from './fakeRoadGraph.js';

export interface CityPlan {
  version: string;
  world: { size_m: number };
  grid: { lines: number; pitch_m: number; lanes_per_direction: number; lane_width_m: number };
  nodes: { id: number; name: string; x: number; z: number }[];
  segments: { id: number; name: string; a: number; b: number; dir: string; length_m: number }[];
  stores: { team: number; color: string; corner: string; node: number; pickup: { x: number; z: number; radius_m: number } }[];
  delivery_candidates: { id: number; segment: number; t: number; side: string }[];
  buildings: { id: number; block: string; footprint: number[][]; height_m: number }[];
}

export const CITY_PLAN: CityPlan = planJson;

/** The city in M3 coordinates (x east, y north). */
export interface M3City {
  size: number;
  laneWidth: number;
  lanesPerDirection: number;
  stores: { team: number; color: string; x: number; y: number; radius: number; heading: number }[];
  buildings: { id: number; polygon: Vec2[]; height: number }[];
  /** Road graph for NPC cars until M3-3 builds the real one from the plan. */
  graph: RoadGraph;
}

export function m3City(plan: CityPlan = CITY_PLAN): M3City {
  const size = plan.world.size_m;
  return {
    size,
    laneWidth: plan.grid.lane_width_m,
    lanesPerDirection: plan.grid.lanes_per_direction,
    stores: plan.stores.map((s) => {
      const p = fromContractPoint(s.pickup.x, s.pickup.z);
      // Start toward the inside of the city: east from a west corner, west from an east corner.
      const heading = fromContractHeading(s.pickup.x < size / 2 ? 90 : 270);
      return { team: s.team, color: s.color, x: p.x, y: p.y, radius: s.pickup.radius_m, heading };
    }),
    buildings: plan.buildings.map((b) => ({
      id: b.id,
      polygon: b.footprint.map(([x, z]) => fromContractPoint(x, z)),
      height: b.height_m,
    })),
    graph: planGraph(plan),
  };
}

/**
 * The fake grid of M3-4 with the same node numbers as the plan. The fake grid
 * puts row r at y = +r × pitch; in the plan row r is at z = r × pitch, so in
 * M3 coordinates at y = -r × pitch. Mirroring the nodes is enough, because the
 * lane geometry is computed from the node positions.
 */
function planGraph(plan: CityPlan): RoadGraph {
  const g = makeGridGraph({
    size: plan.grid.lines,
    spacing: plan.grid.pitch_m,
    lanesPerDirection: plan.grid.lanes_per_direction,
    laneWidth: plan.grid.lane_width_m,
  });
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, y: -n.y })) };
}
