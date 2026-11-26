/**
 * Lane geometry helpers on top of RoadGraph: where a lane is in the world and
 * what kind of turn two edges make. Used by NPC traffic; bots (M3-5) can use the
 * same helpers to follow lanes.
 */
import type { Vec2 } from '../../common/types.js';
import type { DirectedEdge, RoadGraph } from './types.js';

export interface EdgeFrame {
  /** Centre line point at the start stop line. */
  start: Vec2;
  /** Unit vector in the driving direction. */
  dir: Vec2;
  /** Unit vector to the right of the driving direction. */
  right: Vec2;
  /** Length between the two stop lines, metres. */
  length: number;
  heading: number;
  lanes: number;
}

export type TurnKind = 'straight' | 'left' | 'right' | 'uturn';

export function buildEdgeFrames(g: RoadGraph): EdgeFrame[] {
  return g.edges.map((e) => edgeFrame(g, e));
}

export function edgeFrame(g: RoadGraph, e: DirectedEdge): EdgeFrame {
  const a = g.nodes[e.from];
  const b = g.nodes[e.to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const dir = { x: dx / len, y: dy / len };
  const h = g.intersectionHalfSize;
  return {
    start: { x: a.x + dir.x * h, y: a.y + dir.y * h },
    dir,
    right: { x: dir.y, y: -dir.x },
    length: len - 2 * h,
    heading: Math.atan2(dir.y, dir.x),
    lanes: g.roads[e.roadId].lanesPerDirection,
  };
}

/** Distance of a lane centre from the road centre line. */
export function laneOffset(g: RoadGraph, lane: number): number {
  return (lane + 0.5) * g.laneWidth;
}

/** World point at distance s along a lane. */
export function lanePoint(g: RoadGraph, f: EdgeFrame, lane: number, s: number): Vec2 {
  const off = laneOffset(g, lane);
  return {
    x: f.start.x + f.dir.x * s + f.right.x * off,
    y: f.start.y + f.dir.y * s + f.right.y * off,
  };
}

export function turnKind(fIn: EdgeFrame, fOut: EdgeFrame): TurnKind {
  const dot = fIn.dir.x * fOut.dir.x + fIn.dir.y * fOut.dir.y;
  const cross = fIn.dir.x * fOut.dir.y - fIn.dir.y * fOut.dir.x;
  if (dot > 0.7) return 'straight';
  if (dot < -0.7) return 'uturn';
  return cross > 0 ? 'left' : 'right';
}
