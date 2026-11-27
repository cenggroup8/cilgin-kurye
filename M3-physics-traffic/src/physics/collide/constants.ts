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

/**
 * TAHMİN. The smallest hit speed (m/s) that is sent to the traffic part as a
 * CarHit. A light scrape (below this) must not stop an NPC car for hitStopTime
 * (2.5 s). To be asked of the owner of M3-4.
 */
export const CAR_HIT_MIN_MPS = 1;

/** TAHMİN. Highest speed of an NPC car (m/s): the admin maximum of physics.npc_speed_mps. Only for the tunnel guard tests. */
export const NPC_MAX_SPEED_MPS = 20;

/**
 * TAHMİN. Width (across the road, metres) of the barrier of road work and of an accident
 * that has no lane. 20 m is from building to building: the road is 14 m (2 x 2 lanes of 3.5 m)
 * and each side has a sidewalk of 3 m (contracts/README.md, Buildings). With 14 m only, a
 * motorcycle could ride past on the sidewalk. The thickness along the road is BARRIER_THICKNESS_M.
 */
export const ROAD_BLOCK_WIDTH_M = 20;

/** TAHMİN. Length (along the lane, metres) of an accident in one lane: the length of an NPC car. */
export const ACCIDENT_LANE_BLOCK_LENGTH_M = 4.5;

/**
 * TAHMİN. Width (across the lane, metres) of an accident in one lane: the width of a whole lane
 * (lane_width_m 3.5), so the lane is really blocked. A car-wide block (1.8 m) would leave a gap
 * that a motorcycle fits through.
 */
export const ACCIDENT_LANE_BLOCK_WIDTH_M = 3.5;

/** TAHMİN. Length (along the road, metres) of a water puddle. The module document gives no size. */
export const PUDDLE_LENGTH_M = 8;

/**
 * TAHMİN. Width (across the road, metres) of a water puddle that has no lane: the road itself,
 * 2 x 2 lanes of 3.5 m. The sidewalks are not wet.
 */
export const PUDDLE_ROAD_WIDTH_M = 14;
