import type { DeliveryCityPlan, Point } from "./types.js";

/**
 * Where a delivery point lies: on its segment at position t (0 to 1), at the
 * edge of the road on its side (N, S, E or W). The city plan gives only the
 * segment, t and side; the edge of the road is 2 lanes from the centre line.
 */
export function candidatePositions(plan: DeliveryCityPlan): Map<number, Point> {
  const edge = plan.grid.lanes_per_direction * plan.grid.lane_width_m;
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  const segments = new Map(plan.segments.map((s) => [s.id, s]));
  const out = new Map<number, Point>();
  for (const c of plan.delivery_candidates) {
    const seg = segments.get(c.segment);
    const a = seg && nodes.get(seg.a);
    const b = seg && nodes.get(seg.b);
    if (!a || !b) throw new Error(`delivery candidate ${c.id}: unknown segment ${c.segment}`);
    let x = a.x + (b.x - a.x) * c.t;
    let z = a.z + (b.z - a.z) * c.t;
    if (c.side === "N") z -= edge;
    else if (c.side === "S") z += edge;
    else if (c.side === "E") x += edge;
    else if (c.side === "W") x -= edge;
    else throw new Error(`delivery candidate ${c.id}: unknown side ${c.side}`);
    out.set(c.id, { x, z });
  }
  return out;
}
