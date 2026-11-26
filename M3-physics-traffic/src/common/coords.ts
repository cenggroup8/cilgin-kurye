/**
 * The one place where M3 changes coordinates at its border.
 *
 * contracts/ (city plan, M1, M4, M6): metres, x to the east, z to the south,
 * heading in degrees, clockwise from north.
 *
 * Inside M3 (src/common/types.ts): metres, x to the east, y to the north,
 * heading in radians, 0 = east, counter clockwise positive. So a left turn
 * makes the heading larger, as in school maths.
 *
 * Changing:  y = -z,   heading_m3 = 90° - heading_contract (in radians).
 */
import type { Vec2 } from './types.js';

const DEG = Math.PI / 180;

/** Point of contracts/ (x, z) to M3 (x, y). */
export function fromContractPoint(x: number, z: number): Vec2 {
  return { x, y: -z };
}

/** Point of M3 (x, y) to contracts/ (x, z). */
export function toContractPoint(p: Vec2): { x: number; z: number } {
  return { x: p.x, z: -p.y };
}

/** Heading of contracts/ (degrees, clockwise from north) to M3 (radians, counter clockwise from east), in (-PI, PI]. */
export function fromContractHeading(deg: number): number {
  return wrap((90 - deg) * DEG);
}

/** Heading of M3 to contracts/, in [0, 360). */
export function toContractHeading(rad: number): number {
  const deg = 90 - rad / DEG;
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
