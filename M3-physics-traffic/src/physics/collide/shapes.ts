/**
 * Shapes and contact tests for the collision solver (M3-2). Pure geometry:
 * no motorcycle, no world, no parameters.
 *
 * Every test answers null when the shapes do not touch, and otherwise a
 * `Contact`: how deep the circle is in the shape and the direction in which the
 * circle must be pushed out. The normal is a unit vector that points FROM THE
 * SHAPE TO THE CIRCLE, so moving the circle by `depth` along it ends the contact.
 *
 * Rules for all of them:
 * - A number that is not finite (NaN, Infinity), a circle with a negative radius
 *   or a shape that is not a shape (a polygon with fewer than 3 corners, a
 *   rectangle with no size) gives null. Nothing throws.
 * - Touching exactly (depth 0) is no contact.
 * - When the direction cannot be found (two circles with the same centre) the
 *   normal is +x, never NaN.
 * - Polygons may have any winding and may be concave (an L shape works).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export type Polygon = readonly Point[];

/** A rectangle that is turned: `length` runs along `heading` (radians, 0 = +x, counter clockwise). */
export interface Obb {
  x: number;
  y: number;
  length: number;
  width: number;
  heading: number;
}

export interface Contact {
  /** How far the circle must move to be free, metres, above 0. */
  depth: number;
  /** Unit vector from the shape to the circle. */
  normalX: number;
  normalY: number;
}

/** A centre closer to the boundary than this (metres) counts as on the boundary. */
const ON_BOUNDARY_M = 1e-9;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validCircle(c: Circle): boolean {
  return !!c && finite(c.x) && finite(c.y) && finite(c.r) && c.r >= 0;
}

function validPolygon(p: Polygon): boolean {
  return Array.isArray(p) && p.length >= 3 && p.every((pt) => !!pt && finite(pt.x) && finite(pt.y));
}

function validObb(b: Obb): boolean {
  return !!b && finite(b.x) && finite(b.y) && finite(b.heading) && finite(b.length) && finite(b.width) && b.length > 0 && b.width > 0;
}

/** True when the point is inside the polygon. Any winding, concave polygons too (even-odd rule). */
export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (!finite(x) || !finite(y) || !validPolygon(polygon)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function closestOnSegment(px: number, py: number, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Twice the signed area: positive when the corners go counter clockwise (x east, y north). */
function area2(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Unit vector of edge i that points out of the polygon, whatever the winding. */
function outwardNormal(polygon: Polygon, i: number): { x: number; y: number } {
  const a = polygon[i];
  const b = polygon[(i + 1) % polygon.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 1, y: 0 };
  return area2(polygon) >= 0 ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
}

/** Circle against circle. The normal points from `other` to `circle`. */
export function circleVsCircle(circle: Circle, other: Circle): Contact | null {
  if (!validCircle(circle) || !validCircle(other)) return null;
  const dx = circle.x - other.x;
  const dy = circle.y - other.y;
  const dist = Math.hypot(dx, dy);
  const reach = circle.r + other.r;
  if (!(dist < reach)) return null;
  if (dist === 0) return { depth: reach, normalX: 1, normalY: 0 };
  return { depth: reach - dist, normalX: dx / dist, normalY: dy / dist };
}

/**
 * Circle against a polygon. A centre outside: the contact is with the nearest
 * point of the boundary. A centre inside: the circle is pushed out through the
 * nearest edge, and the depth includes the radius.
 *
 * Limit: the test looks at one moment only. In a thin shape, a centre that is
 * already past the middle is pushed out through the FAR side. So a circle must
 * never move more than `radius + thickness / 2` in one step (tunnel.test.ts).
 */
export function circleVsPolygon(circle: Circle, polygon: Polygon): Contact | null {
  if (!validCircle(circle) || !validPolygon(polygon)) return null;

  let bestD2 = Infinity;
  let nearest: Point = polygon[0];
  let edge = 0;
  for (let i = 0; i < polygon.length; i++) {
    const q = closestOnSegment(circle.x, circle.y, polygon[i], polygon[(i + 1) % polygon.length]);
    const d2 = (circle.x - q.x) ** 2 + (circle.y - q.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearest = q;
      edge = i;
    }
  }
  const d = Math.sqrt(bestD2);

  const inside = pointInPolygon(circle.x, circle.y, polygon);
  const depth = inside ? d + circle.r : circle.r - d;
  if (!(depth > 0)) return null;

  if (d < ON_BOUNDARY_M) {
    // The centre is (almost) on the boundary. The line from the nearest point to
    // the centre is then only rounding noise and can point along the edge, so the
    // push goes straight out through the nearest edge instead.
    const n = outwardNormal(polygon, edge);
    return { depth, normalX: n.x, normalY: n.y };
  }
  const sign = inside ? -1 : 1; // inside: out through the nearest point; outside: away from it
  return { depth, normalX: (sign * (circle.x - nearest.x)) / d, normalY: (sign * (circle.y - nearest.y)) / d };
}

/** Circle against a turned rectangle. The normal points from the rectangle to the circle. */
export function circleVsOBB(circle: Circle, box: Obb): Contact | null {
  if (!validCircle(circle) || !validObb(box)) return null;
  const cos = Math.cos(box.heading);
  const sin = Math.sin(box.heading);
  // The centre of the circle in the frame of the box (x along the length, y along the width).
  const dx = circle.x - box.x;
  const dy = circle.y - box.y;
  const lx = cos * dx + sin * dy;
  const ly = -sin * dx + cos * dy;
  const halfL = box.length / 2;
  const halfW = box.width / 2;

  const cx = Math.max(-halfL, Math.min(halfL, lx));
  const cy = Math.max(-halfW, Math.min(halfW, ly));
  let depth: number;
  let nx: number;
  let ny: number;
  if (cx !== lx || cy !== ly) {
    // The centre is outside the box.
    const d = Math.hypot(lx - cx, ly - cy);
    depth = circle.r - d;
    if (!(depth > 0)) return null;
    nx = (lx - cx) / d;
    ny = (ly - cy) / d;
  } else {
    // The centre is inside the box (or on its edge): out through the nearest side.
    const px = halfL - Math.abs(lx);
    const py = halfW - Math.abs(ly);
    if (px <= py) {
      depth = px + circle.r;
      nx = lx < 0 ? -1 : 1;
      ny = 0;
    } else {
      depth = py + circle.r;
      nx = 0;
      ny = ly < 0 ? -1 : 1;
    }
    if (!(depth > 0)) return null;
  }
  return { depth, normalX: cos * nx - sin * ny, normalY: sin * nx + cos * ny };
}
