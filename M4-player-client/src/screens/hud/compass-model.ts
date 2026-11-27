// The compass arrow: which way must the player turn to face the target. No DOM.
//
// One rule only, the one of `contracts/README.md` (Coordinates): metres, x to
// the east, z to the south, heading in degrees clockwise from north. Poses
// from other modules are changed to this rule in `compass-source.ts`.
//
// The compass shows a direction and nothing else. It gives no distance and no
// road (requirement R5): the player must look at the board.

export interface CompassSelf {
  x: number;
  z: number;
  /** Degrees, clockwise from north. */
  headingDeg: number;
}

export interface CompassTarget {
  x: number;
  z: number;
}

/** A target closer than this (metres) gives no arrow: the player is there. */
export const MIN_TARGET_DISTANCE_M = 1;

const DEG = 180 / Math.PI;

/** Keeps an angle in [-180, 180). Exactly behind is -180. */
function wrapSigned(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * The angle of the arrow in degrees, in [-180, 180): 0 = the target is straight
 * ahead, positive = to the right (clockwise), -180 = straight behind.
 * Returns null when the target is closer than 1 m or a number is not finite.
 */
export function compassAngle(self: CompassSelf, target: CompassTarget): number | null {
  const { x, z, headingDeg } = self;
  if (![x, z, headingDeg, target.x, target.z].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  const dx = target.x - x;
  const dz = target.z - z;
  if (Math.hypot(dx, dz) < MIN_TARGET_DISTANCE_M) return null;
  // North is -z, so the bearing from north, clockwise, is atan2(east, north).
  const bearingDeg = Math.atan2(dx, -dz) * DEG;
  return wrapSigned(bearingDeg - headingDeg);
}
