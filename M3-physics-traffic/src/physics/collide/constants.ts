// TAHMİN: the numbers of this file are guesses. No document gives them yet
// (M3-2, issue #39). They are in one file so a better value changes one line.
// Units: metres and metres per second, in the coordinates of M3 (x east, y north).

/** Radius of the circle that stands for a motorcycle (a lane is 3.5 m wide, so two bikes fit side by side). */
export const BIKE_RADIUS_M = 0.6;

/**
 * Thickness of the barrier that road work puts across a road. TAHMİN.
 * Rule: the movement in one substep must be below radius + thickness / 2, or a
 * fast bike can reach the far half and be pushed out on the wrong side. Worst
 * case: 30 m/s top speed x 1.5 speed factor = 45 m/s, and 1/60 s per substep.
 */
export const BARRIER_THICKNESS_M = 1.0;

/**
 * Distance (metres) from the city rectangle (0 to world.size_m, the outermost
 * road centre lines) to the INNER face of the outer wall, the face that
 * motorcycles hit. The wall behind that face has no thickness: it is a half
 * plane, so nothing gets through however far it is, and the 10 m does NOT
 * include any thickness. The motorcycle centre can go at most
 * OUTER_WALL_MARGIN_M - BIKE_RADIUS_M outside the rectangle. The road edge is
 * lanes_per_direction x lane_width_m = 7 m outside it, so this must be above 7
 * (outer-wall.test.ts reads both from the city plan).
 */
export const OUTER_WALL_MARGIN_M = 10;

/** The smallest speed into a shape (m/s) that counts as a hit. Below it is rounding noise, for example of a scrape along a wall. */
export const MIN_IMPACT_MPS = 1e-6;

/**
 * TAHMİN. Most contacts that one motorcycle resolves in one substep. A normal
 * motorcycle touches at most a few shapes (a corner of two buildings, a wall);
 * the cap only stops a jam between many shapes from taking unlimited time.
 * What is left over is found again in the next substep.
 */
export const MAX_CONTACTS_PER_BIKE = 8;

/** Radius of the slow zone around an accident. */
export const ACCIDENT_SLOW_RADIUS_M = 15;

/** Speed limit (m/s) inside the slow zone of an accident. */
export const ACCIDENT_SLOW_SPEED_MPS = 5;
