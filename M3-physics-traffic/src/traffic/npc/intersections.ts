/**
 * Intersections: the path a car drives through an intersection, and the locks
 * that let a car enter only when its way through is free (issue #41, item 3).
 *
 * Each intersection box is cut into four quarter cells around the node centre.
 * A movement (for example "from the west, turn left to the north") needs the
 * cells that its path crosses. A car enters only after it has locked all of its
 * cells at once, so two cars whose paths cross are never inside together. Cars
 * whose paths do not cross (for example two opposite straight movements) can
 * drive at the same time.
 *
 * Locking all cells at once (all or nothing) means no car holds one cell while
 * it waits for another, so the intersection itself cannot lock up.
 */
import type { Vec2 } from '../../common/types';
import { lanePoint, turnKind, type EdgeFrame, type TurnKind } from '../graph/laneGeometry';
import type { RoadGraph } from '../graph/types';

const SAMPLES = 24;

export interface TurnPath {
  node: number;
  kind: TurnKind;
  length: number;
  /** Sample points and the distance along the path at each one. */
  points: Vec2[];
  cum: number[];
  /** Quarter cells (0..3) that the path crosses. */
  cells: number[];
}

/** Cubic Bezier from the stop line of the incoming lane to the start of the outgoing lane. */
export function buildTurnPath(
  g: RoadGraph,
  fIn: EdgeFrame,
  inLane: number,
  fOut: EdgeFrame,
  outLane: number,
  node: number,
): TurnPath {
  const kind = turnKind(fIn, fOut);
  const p0 = lanePoint(g, fIn, inLane, fIn.length);
  const p3 = lanePoint(g, fOut, outLane, 0);
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const k = kind === 'uturn' ? g.intersectionHalfSize * 1.2 : dist * 0.45;
  const p1 = { x: p0.x + fIn.dir.x * k, y: p0.y + fIn.dir.y * k };
  const p2 = { x: p3.x - fOut.dir.x * k, y: p3.y - fOut.dir.y * k };

  const points: Vec2[] = [];
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const p = {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
    if (i > 0) total += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    points.push(p);
    cum.push(total);
  }

  const c = g.nodes[node];
  const cellSet = new Set<number>();
  for (const p of points) cellSet.add(cellOf(p.x - c.x, p.y - c.y));
  const cells = [...cellSet].sort((a, b) => a - b);

  return { node, kind, length: total, points, cum, cells };
}

function cellOf(dx: number, dy: number): number {
  return (dx >= 0 ? 0 : 1) + (dy >= 0 ? 0 : 2);
}

/** Point and heading at distance d along a path. */
export function pointOnPath(path: TurnPath, d: number): { x: number; y: number; heading: number } {
  const { points, cum } = path;
  if (d <= 0) return withHeading(points[0], points[1]);
  if (d >= path.length) return withHeading(points[points.length - 1], points[points.length - 2], true);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const seg = cum[i] - cum[i - 1];
  const t = seg > 0 ? (d - cum[i - 1]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}

function withHeading(p: Vec2, q: Vec2, reverse = false) {
  const h = reverse ? Math.atan2(p.y - q.y, p.x - q.x) : Math.atan2(q.y - p.y, q.x - p.x);
  return { x: p.x, y: p.y, heading: h };
}

/** Who holds which quarter cell of which intersection. */
export class IntersectionLocks {
  private readonly owner: Int32Array;

  constructor(nodeCount: number) {
    this.owner = new Int32Array(nodeCount * 4).fill(-1);
  }

  isFree(node: number, cells: readonly number[], blocked?: ReadonlySet<number>): boolean {
    for (const c of cells) {
      const key = node * 4 + c;
      if (this.owner[key] !== -1) return false;
      if (blocked && blocked.has(key)) return false;
    }
    return true;
  }

  lock(node: number, cells: readonly number[], carId: number): void {
    for (const c of cells) this.owner[node * 4 + c] = carId;
  }

  unlock(node: number, cells: readonly number[], carId: number): void {
    for (const c of cells) {
      const key = node * 4 + c;
      if (this.owner[key] === carId) this.owner[key] = -1;
    }
  }

  ownerOf(node: number, cell: number): number {
    return this.owner[node * 4 + cell];
  }

  static key(node: number, cell: number): number {
    return node * 4 + cell;
  }
}
