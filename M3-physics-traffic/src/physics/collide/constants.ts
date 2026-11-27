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

/** How far the outer wall stands outside the outermost road lines of the city. */
export const OUTER_WALL_MARGIN_M = 10;

/** Radius of the slow zone around an accident. */
export const ACCIDENT_SLOW_RADIUS_M = 15;

/** Speed limit (m/s) inside the slow zone of an accident. */
export const ACCIDENT_SLOW_SPEED_MPS = 5;
