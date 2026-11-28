/**
 * The line a bot follows: lane centre points of the route edges, joined
 * through the intersections, and the "look ahead" point used for steering.
 */
import type { Vec2 } from '../../common/types.js';
import type { RoadGraph } from '../graph/types.js';
import { lanePoint, type EdgeFrame } from '../graph/laneGeometry.js';

export interface PathPoint extends Vec2 {
  /** Distance from the start of the path, metres. */
  s: number;
  /** Directed edge this point is on. */
  edgeId: number;
}

export class Path {
  readonly points: PathPoint[];
  readonly length: number;

  constructor(points: Vec2[], edgeIds: number[]) {
    let s = 0;
    this.points = points.map((p, i) => {
      if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
      return { x: p.x, y: p.y, s, edgeId: edgeIds[i] };
    });
    this.length = s;
  }

  /** Point at distance s along the path (clamped to the ends). */
  at(s: number): Vec2 {
    const pts = this.points;
    if (s <= 0 || pts.length === 1) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].s >= s) {
        const a = pts[i - 1];
        const b = pts[i];
        const f = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return pts[pts.length - 1];
  }

  /**
   * Distance along the path of the point nearest to p, searched forward from
   * `from` only, so a bot never jumps back to an earlier part of its route.
   */
  project(p: Vec2, from: number, window = 40): { s: number; offset: number } {
    let best = { s: from, offset: Infinity };
    const pts = this.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b.s < from - 1 || a.s > from + window) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const f = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const d = Math.hypot(p.x - (a.x + dx * f), p.y - (a.y + dy * f));
      if (d < best.offset) best = { s: Math.max(from, a.s + (b.s - a.s) * f), offset: d };
    }
    return best;
  }

  /** Directed edge at distance s, or undefined past the end. */
  edgeAt(s: number): number | undefined {
    for (let i = 1; i < this.points.length; i++) {
      if (this.points[i].s >= s) return this.points[i].edgeId;
    }
    return this.points[this.points.length - 1]?.edgeId;
  }

  /**
   * How much the path turns between s and s + ahead, radians (0 = straight,
   * π/2 = a right angle turn). Used to slow down before corners.
   */
  turnAhead(s: number, ahead: number): number {
    const step = 3;
    const base = this.dirAt(s, step);
    const h0 = Math.atan2(base.y, base.x);
    let total = 0;
    for (let d = step; d <= ahead; d += step) {
      const next = this.dirAt(s + d, step);
      if (next.x === 0 && next.y === 0) break;
      total = Math.max(total, Math.abs(angleDiff(Math.atan2(next.y, next.x), h0)));
    }
    return total;
  }

  private dirAt(s: number, step: number): Vec2 {
    const a = this.at(s);
    const b = this.at(s + step);
    return { x: b.x - a.x, y: b.y - a.y };
  }
}

/** Builds the path of a route on one lane. `endS` cuts the last edge (for a delivery point in the middle of a road). */
export function buildPath(
  graph: RoadGraph,
  frames: readonly EdgeFrame[],
  edgeIds: readonly number[],
  lane: number,
  opts: { start?: Vec2; startEdgeS?: number; endS?: number } = {},
): Path {
  const points: Vec2[] = [];
  const ids: number[] = [];
  const push = (p: Vec2, edgeId: number) => {
    const last = points[points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.01) return;
    points.push(p);
    ids.push(edgeId);
  };
  if (opts.start && edgeIds.length > 0) push(opts.start, edgeIds[0]);
  edgeIds.forEach((edgeId, i) => {
    const f = frames[edgeId];
    const from = i === 0 ? Math.max(0, Math.min(f.length, opts.startEdgeS ?? 0)) : 0;
    const to = i === edgeIds.length - 1 && opts.endS !== undefined ? Math.max(from, Math.min(f.length, opts.endS)) : f.length;
    push(lanePoint(graph, f, lane, from), edgeId);
    push(lanePoint(graph, f, lane, to), edgeId);
  });
  if (points.length === 1) {
    points.push({ ...points[0] });
    ids.push(ids[0]);
  }
  return new Path(points, ids);
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
